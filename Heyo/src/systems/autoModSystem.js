// src/systems/autoModSystem.js
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AutoModSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get automod config from config loader
    this.config = this.configLoader.get('autoMod');
    
    // Validate config
    if (!this.config) {
      throw new Error('[AutoModSystem] Auto-moderation configuration not found in config.yaml');
    }
    
    // Tracking maps
    this.messageCache = new Map(); // userId -> array of message timestamps
    this.joinCache = new Map(); // timestamp -> array of user joins
    this.mentionCache = new Map(); // userId -> array of mention timestamps
    this.emojiCache = new Map(); // userId -> array of emoji timestamps
    this.capsCache = new Map(); // userId -> array of caps message timestamps
    this.duplicateCache = new Map(); // userId -> Map(content -> count)
    this.punishmentCache = new Map(); // userId -> punishment level
    
    // Raid mode state
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadAutoModData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
      this.startCleanupInterval();
    }
  }

  /**
   * Load automod data from file
   */
  loadAutoModData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.punishments) {
          this.punishmentCache = new Map(Object.entries(data.punishments));
        }
        
        if (data.raidMode) {
          this.raidMode = data.raidMode;
        }
        
        console.log(`[AutoModSystem] Loaded automod data`);
      }
    } catch (error) {
      console.error('[AutoModSystem] Error loading automod data:', error);
    }
  }

  /**
   * Save automod data to file
   */
  saveAutoModData() {
    try {
      const data = {
        punishments: Object.fromEntries(this.punishmentCache),
        raidMode: this.raidMode,
        stats: {
          messagesDeleted: this.config.stats?.messagesDeleted || 0,
          usersTimedOut: this.config.stats?.usersTimedOut || 0,
          usersBanned: this.config.stats?.usersBanned || 0,
          raidsDetected: this.config.stats?.raidsDetected || 0
        }
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[AutoModSystem] Error saving automod data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Message spam detection
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;
      if (this.isExempt(message.member)) return;
      
      await this.checkMessage(message);
    });

    // Join raid detection
    this.client.on('guildMemberAdd', async (member) => {
      if (member.user.bot) return;
      
      await this.checkJoin(member);
    });
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval() {
    // Clean up old cache entries every minute
    setInterval(() => {
      const now = Date.now();
      const maxAge = 300000; // 5 minutes
      
      // Clean message cache
      for (const [userId, timestamps] of this.messageCache) {
        const filtered = timestamps.filter(t => now - t < maxAge);
        if (filtered.length === 0) {
          this.messageCache.delete(userId);
        } else {
          this.messageCache.set(userId, filtered);
        }
      }
      
      // Clean other caches similarly
      this.cleanCache(this.mentionCache, maxAge);
      this.cleanCache(this.emojiCache, maxAge);
      this.cleanCache(this.capsCache, maxAge);
      
      // Clean join cache
      for (const [timestamp, users] of this.joinCache) {
        if (now - timestamp > maxAge) {
          this.joinCache.delete(timestamp);
        }
      }
      
      // Clean duplicate cache
      for (const [userId, contentMap] of this.duplicateCache) {
        if (contentMap.size === 0) {
          this.duplicateCache.delete(userId);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Clean a cache
   * @param {Map} cache
   * @param {number} maxAge
   */
  cleanCache(cache, maxAge) {
    const now = Date.now();
    
    for (const [userId, timestamps] of cache) {
      const filtered = timestamps.filter(t => now - t < maxAge);
      if (filtered.length === 0) {
        cache.delete(userId);
      } else {
        cache.set(userId, filtered);
      }
    }
  }

  /**
   * Check if member is exempt from automod
   * @param {import("discord.js").GuildMember} member
   * @returns {boolean}
   */
  isExempt(member) {
    if (!member) return true;
    
    // Check exempt roles
    if (member.roles.cache.some(role => this.config.exemptRoles.includes(role.id))) {
      return true;
    }
    
    // Check exempt channels
    if (this.config.exemptChannels.includes(member.voice?.channelId)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check message for violations
   * @param {import("discord.js").Message} message
   */
  async checkMessage(message) {
    const violations = [];
    
    // Check spam
    if (this.config.antiSpam.enabled) {
      const spamViolation = await this.checkSpam(message);
      if (spamViolation) violations.push(spamViolation);
    }
    
    // Check mass mentions
    if (this.config.massMention.enabled) {
      const mentionViolation = this.checkMassMentions(message);
      if (mentionViolation) violations.push(mentionViolation);
    }
    
    // Check mass emojis
    if (this.config.massEmoji.enabled) {
      const emojiViolation = this.checkMassEmojis(message);
      if (emojiViolation) violations.push(emojiViolation);
    }
    
    // Check caps spam
    if (this.config.capsSpam.enabled) {
      const capsViolation = this.checkCapsSpam(message);
      if (capsViolation) violations.push(capsViolation);
    }
    
    // Check duplicate messages
    if (this.config.duplicateMessages.enabled) {
      const duplicateViolation = this.checkDuplicates(message);
      if (duplicateViolation) violations.push(duplicateViolation);
    }
    
    // Take action if violations found
    if (violations.length > 0) {
      await this.handleViolations(message, violations);
    }
  }

  /**
   * Check for spam
   * @param {import("discord.js").Message} message
   * @returns {Object|null}
   */
  async checkSpam(message) {
    const userId = message.author.id;
    const now = Date.now();
    
    // Get or create message timestamps
    const timestamps = this.messageCache.get(userId) || [];
    timestamps.push(now);
    
    // Filter old timestamps
    const recentTimestamps = timestamps.filter(t => 
      now - t < this.config.antiSpam.timeWindow
    );
    
    this.messageCache.set(userId, recentTimestamps);
    
    // Check if exceeds limit
    if (recentTimestamps.length > this.config.antiSpam.messageLimit) {
      return {
        type: 'spam',
        severity: 'high',
        details: `${recentTimestamps.length} messages in ${this.config.antiSpam.timeWindow}ms`
      };
    }
    
    return null;
  }

  /**
   * Check for mass mentions
   * @param {import("discord.js").Message} message
   * @returns {Object|null}
   */
  checkMassMentions(message) {
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    
    if (mentions > this.config.massMention.threshold) {
      // Track mention spam
      const userId = message.author.id;
      const timestamps = this.mentionCache.get(userId) || [];
      timestamps.push(Date.now());
      this.mentionCache.set(userId, timestamps);
      
      return {
        type: 'massMention',
        severity: 'high',
        details: `${mentions} mentions`
      };
    }
    
    return null;
  }

  /**
   * Check for mass emojis
   * @param {import("discord.js").Message} message
   * @returns {Object|null}
   */
  checkMassEmojis(message) {
    const emojiRegex = /<a?:\w+:\d+>|[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    const emojiMatches = message.content.match(emojiRegex) || [];
    
    if (emojiMatches.length > this.config.massEmoji.threshold) {
      // Track emoji spam
      const userId = message.author.id;
      const timestamps = this.emojiCache.get(userId) || [];
      timestamps.push(Date.now());
      this.emojiCache.set(userId, timestamps);
      
      return {
        type: 'massEmoji',
        severity: 'medium',
        details: `${emojiMatches.length} emojis`
      };
    }
    
    return null;
  }

  /**
   * Check for caps spam
   * @param {import("discord.js").Message} message
   * @returns {Object|null}
   */
  checkCapsSpam(message) {
    if (message.content.length < this.config.capsSpam.minLength) return null;
    
    const capsCount = (message.content.match(/[A-Z]/g) || []).length;
    const percentage = (capsCount / message.content.length) * 100;
    
    if (percentage > this.config.capsSpam.threshold) {
      // Track caps spam
      const userId = message.author.id;
      const timestamps = this.capsCache.get(userId) || [];
      timestamps.push(Date.now());
      this.capsCache.set(userId, timestamps);
      
      return {
        type: 'capsSpam',
        severity: 'low',
        details: `${percentage.toFixed(1)}% caps`
      };
    }
    
    return null;
  }

  /**
   * Check for duplicate messages
   * @param {import("discord.js").Message} message
   * @returns {Object|null}
   */
  checkDuplicates(message) {
    const userId = message.author.id;
    const contentMap = this.duplicateCache.get(userId) || new Map();
    
    const content = message.content.toLowerCase();
    const count = (contentMap.get(content) || 0) + 1;
    
    contentMap.set(content, count);
    this.duplicateCache.set(userId, contentMap);
    
    // Clean old entries
    setTimeout(() => {
      const map = this.duplicateCache.get(userId);
      if (map) {
        map.set(content, map.get(content) - 1);
        if (map.get(content) <= 0) {
          map.delete(content);
        }
      }
    }, this.config.duplicateMessages.timeWindow);
    
    if (count > this.config.duplicateMessages.threshold) {
      return {
        type: 'duplicate',
        severity: 'medium',
        details: `${count} duplicate messages`
      };
    }
    
    return null;
  }

  /**
   * Check for join raids
   * @param {import("discord.js").GuildMember} member
   */
  async checkJoin(member) {
    if (!this.config.antiRaid.enabled) return;
    
    const now = Date.now();
    const recentJoins = [];
    
    // Clean old joins and count recent
    for (const [timestamp, users] of this.joinCache) {
      if (now - timestamp < this.config.antiRaid.timeWindow) {
        recentJoins.push(...users);
      } else {
        this.joinCache.delete(timestamp);
      }
    }
    
    // Add current join
    const currentJoins = this.joinCache.get(now) || [];
    currentJoins.push(member.id);
    this.joinCache.set(now, currentJoins);
    recentJoins.push(member.id);
    
    // Check if raid detected
    if (recentJoins.length >= this.config.antiRaid.joinThreshold) {
      await this.handleRaid(member.guild, recentJoins);
    }
  }

  /**
   * Handle violations
   * @param {import("discord.js").Message} message
   * @param {Array} violations
   */
  async handleViolations(message, violations) {
    // Delete message
    try {
      await message.delete();
      this.config.stats = this.config.stats || {};
      this.config.stats.messagesDeleted = (this.config.stats.messagesDeleted || 0) + 1;
    } catch (error) {
      console.error('[AutoModSystem] Failed to delete message:', error);
    }
    
    // Get punishment level
    const userId = message.author.id;
    const punishmentLevel = this.punishmentCache.get(userId) || 0;
    
    // Determine action based on violations and punishment level
    const highSeverityViolations = violations.filter(v => v.severity === 'high').length;
    const totalViolations = violations.length;
    
    let action = 'warn';
    let duration = 0;
    
    if (highSeverityViolations > 0 || totalViolations >= 2 || punishmentLevel >= 2) {
      action = 'timeout';
      duration = this.config.punishments.timeoutDuration;
      
      if (punishmentLevel >= this.config.punishments.banThreshold) {
        action = 'ban';
      }
    }
    
    // Take action
    switch (action) {
      case 'warn':
        await this.warnUser(message.member, violations);
        break;
      case 'timeout':
        await this.timeoutUser(message.member, duration, violations);
        break;
      case 'ban':
        await this.banUser(message.member, violations);
        break;
    }
    
    // Update punishment level
    this.punishmentCache.set(userId, punishmentLevel + 1);
    
    // Log violation
    if (this.config.enableLogging) {
      await this.logViolation(message.guild, {
        user: message.author,
        violations: violations,
        action: action,
        channel: message.channel
      });
    }
    
    this.saveAutoModData();
  }

  /**
   * Warn user
   * @param {import("discord.js").GuildMember} member
   * @param {Array} violations
   */
  async warnUser(member, violations) {
    try {
      const violationText = violations.map(v => v.type).join(', ');
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ Auto-Moderation Warning')
            .setDescription(`Your message was deleted for: ${violationText}`)
            .setColor(0xffa500)
            .setFooter({ text: 'Repeated violations may result in timeout or ban' })
            .setTimestamp()
        ]
      });
    } catch (error) {
      // User has DMs disabled
    }
  }

  /**
   * Timeout user
   * @param {import("discord.js").GuildMember} member
   * @param {number} duration
   * @param {Array} violations
   */
  async timeoutUser(member, duration, violations) {
    try {
      const violationText = violations.map(v => v.type).join(', ');
      await member.timeout(duration, `Auto-mod: ${violationText}`);
      
      this.config.stats = this.config.stats || {};
      this.config.stats.usersTimedOut = (this.config.stats.usersTimedOut || 0) + 1;
    } catch (error) {
      console.error('[AutoModSystem] Failed to timeout user:', error);
    }
  }

  /**
   * Ban user
   * @param {import("discord.js").GuildMember} member
   * @param {Array} violations
   */
  async banUser(member, violations) {
    try {
      const violationText = violations.map(v => v.type).join(', ');
      await member.ban({ reason: `Auto-mod: Repeated violations - ${violationText}` });
      
      this.config.stats = this.config.stats || {};
      this.config.stats.usersBanned = (this.config.stats.usersBanned || 0) + 1;
    } catch (error) {
      console.error('[AutoModSystem] Failed to ban user:', error);
    }
  }

  /**
   * Handle raid
   * @param {import("discord.js").Guild} guild
   * @param {Array} userIds
   */
  async handleRaid(guild, userIds) {
    if (this.raidMode.enabled) return; // Already in raid mode
    
    // Enable raid mode
    this.raidMode = {
      enabled: true,
      triggeredAt: Date.now(),
      triggeredBy: userIds
    };
    
    this.config.stats = this.config.stats || {};
    this.config.stats.raidsDetected = (this.config.stats.raidsDetected || 0) + 1;
    
    this.saveAutoModData();
    
    // Take raid actions
    if (this.config.antiRaid.actions.lockdown) {
      await this.lockdownServer(guild);
    }
    
    if (this.config.antiRaid.actions.kickNewJoins) {
      // Kick recent joins
      for (const userId of userIds) {
        try {
          const member = await guild.members.fetch(userId);
          if (member && member.kickable) {
            await member.kick('Anti-raid: Mass join detected');
          }
        } catch (error) {
          // Member might have already left
        }
      }
    }
    
    // Notify staff
    if (this.config.antiRaid.notifyChannel) {
      const channel = guild.channels.cache.get(this.config.antiRaid.notifyChannel);
      if (channel) {
        const embed = new EmbedBuilder()
          .setTitle('🚨 RAID DETECTED')
          .setDescription(`${userIds.length} users joined within ${this.config.antiRaid.timeWindow}ms`)
          .setColor(0xff0000)
          .addFields(
            { name: 'Action Taken', value: 'Server locked down', inline: true },
            { name: 'Users Affected', value: `${userIds.length}`, inline: true }
          )
          .setTimestamp();
        
        await channel.send({
          content: this.config.antiRaid.notifyRole ? `<@&${this.config.antiRaid.notifyRole}>` : null,
          embeds: [embed]
        });
      }
    }
    
    // Auto disable after timeout
    if (this.config.antiRaid.autoDisableTimeout) {
      setTimeout(() => {
        this.disableRaidMode(guild);
      }, this.config.antiRaid.autoDisableTimeout);
    }
  }

  /**
   * Lockdown server
   * @param {import("discord.js").Guild} guild
   */
  async lockdownServer(guild) {
    try {
      // Update verification level
      await guild.setVerificationLevel(4); // VERY_HIGH
      
      // Disable @everyone permissions in all channels
      for (const channel of guild.channels.cache.values()) {
        if (channel.isTextBased()) {
          try {
            await channel.permissionOverwrites.edit(guild.id, {
              SendMessages: false
            });
          } catch (error) {
            // Channel might not allow permission changes
          }
        }
      }
    } catch (error) {
      console.error('[AutoModSystem] Failed to lockdown server:', error);
    }
  }

  /**
   * Disable raid mode
   * @param {import("discord.js").Guild} guild
   */
  async disableRaidMode(guild) {
    if (!this.raidMode.enabled) return;
    
    this.raidMode.enabled = false;
    this.saveAutoModData();
    
    // Restore permissions
    try {
      for (const channel of guild.channels.cache.values()) {
        if (channel.isTextBased()) {
          try {
            await channel.permissionOverwrites.edit(guild.id, {
              SendMessages: null
            });
          } catch (error) {
            // Channel might not allow permission changes
          }
        }
      }
    } catch (error) {
      console.error('[AutoModSystem] Failed to restore permissions:', error);
    }
    
    // Notify staff
    if (this.config.antiRaid.notifyChannel) {
      const channel = guild.channels.cache.get(this.config.antiRaid.notifyChannel);
      if (channel) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('✅ Raid Mode Disabled')
              .setDescription('Server has been restored to normal operation.')
              .setColor(0x00ff00)
              .setTimestamp()
          ]
        });
      }
    }
  }

  /**
   * Log violation
   * @param {import("discord.js").Guild} guild
   * @param {Object} data
   */
  async logViolation(guild, data) {
    if (!this.config.logChannel) return;
    
    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle('🚫 Auto-Moderation Action')
      .setColor(0xff0000)
      .addFields(
        { name: 'User', value: `${data.user.tag} (${data.user.id})`, inline: true },
        { name: 'Channel', value: `${data.channel}`, inline: true },
        { name: 'Action', value: data.action, inline: true }
      )
      .setTimestamp();
    
    if (data.violations) {
      const violationText = data.violations
        .map(v => `• **${v.type}**: ${v.details}`)
        .join('\n');
      
      embed.addFields({
        name: 'Violations',
        value: violationText,
        inline: false
      });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AutoModSystem] Failed to log violation:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      raidMode: this.raidMode,
      stats: this.config.stats || {
        messagesDeleted: 0,
        usersTimedOut: 0,
        usersBanned: 0,
        raidsDetected: 0
      },
      activePunishments: this.punishmentCache.size
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('autoMod', this.config);
    return this.configLoader.save();
  }
}