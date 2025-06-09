// src/systems/antiNuke.js
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export default class AntiNuke {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('antiNuke') || {};
    
    // Existing tracking
    this.tracker = new Map();
    this.suspiciousUsers = new Map();
    this.highAlert = false;
    this.originalLimits = null;
    
    // Content moderation tracking
    this.contentTracking = {
      messageHistory: new Map(),
      joinHistory: new Map(),
    };
    
    // Raid mode state
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
    // Enhanced stats
    this.contentStats = {
      massMentions: 0,
      massEmojis: 0,
      capsSpam: 0,
      duplicates: 0,
      raidsDetected: 0
    };
    
    this.setupEventListeners();
    
    // Setup content monitoring if enabled
    if (this.config.contentModeration?.enabled) {
      this.setupContentMonitoring();
    }
  }

  setupEventListeners() {
    // Ban tracking
    this.client.on('guildBanAdd', async (ban) => {
      const executor = await this.getExecutor(ban.guild, 'MEMBER_BAN_ADD');
      if (!executor) return;
      
      const violation = this.track(executor.id, 'bans', {
        targetId: ban.user.id,
        targetTag: ban.user.tag,
        guildId: ban.guild.id
      });
      
      if (violation) {
        await this.handleViolation(ban.guild, executor, 'bans', violation);
      }
    });

    // Kick tracking
    this.client.on('guildMemberRemove', async (member) => {
      const auditLog = await member.guild.fetchAuditLogs({
        limit: 1,
        type: 'MEMBER_KICK'
      }).catch(() => null);
      
      if (!auditLog) return;
      
      const kickLog = auditLog.entries.first();
      if (!kickLog || Date.now() - kickLog.createdTimestamp > 5000) return;
      
      const executor = kickLog.executor;
      if (!executor || executor.bot) return;
      
      const violation = this.track(executor.id, 'kicks', {
        targetId: member.id,
        targetTag: member.user.tag,
        guildId: member.guild.id
      });
      
      if (violation) {
        await this.handleViolation(member.guild, executor, 'kicks', violation);
      }
    });

    // Channel creation/deletion
    this.client.on('channelCreate', async (channel) => {
      const executor = await this.getExecutor(channel.guild, 'CHANNEL_CREATE');
      if (!executor) return;
      
      const violation = this.track(executor.id, 'channelCreate', {
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guild.id
      });
      
      if (violation) {
        await this.handleViolation(channel.guild, executor, 'channelCreate', violation);
      }
    });

    this.client.on('channelDelete', async (channel) => {
      const executor = await this.getExecutor(channel.guild, 'CHANNEL_DELETE');
      if (!executor) return;
      
      const violation = this.track(executor.id, 'channelDelete', {
        channelName: channel.name,
        guildId: channel.guild.id
      });
      
      if (violation) {
        await this.handleViolation(channel.guild, executor, 'channelDelete', violation);
      }
    });

    // Role creation/deletion
    this.client.on('roleCreate', async (role) => {
      const executor = await this.getExecutor(role.guild, 'ROLE_CREATE');
      if (!executor) return;
      
      const violation = this.track(executor.id, 'roleCreate', {
        roleId: role.id,
        roleName: role.name,
        guildId: role.guild.id
      });
      
      if (violation) {
        await this.handleViolation(role.guild, executor, 'roleCreate', violation);
      }
    });

    this.client.on('roleDelete', async (role) => {
      const executor = await this.getExecutor(role.guild, 'ROLE_DELETE');
      if (!executor) return;
      
      const violation = this.track(executor.id, 'roleDelete', {
        roleName: role.name,
        guildId: role.guild.id
      });
      
      if (violation) {
        await this.handleViolation(role.guild, executor, 'roleDelete', violation);
      }
    });

    // Command usage tracking
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;
      
      const violation = this.track(interaction.user.id, 'commands', {
        commandName: interaction.commandName,
        guildId: interaction.guild?.id
      });
      
      if (violation) {
        await interaction.reply({
          content: '⚠️ You are using commands too quickly. Please slow down.',
          ephemeral: true
        });
      }
    });
  }

  setupContentMonitoring() {
    // Message content monitoring
    this.client.on('messageCreate', async (message) => {
      if (!this.config.contentModeration?.enabled) return;
      if (message.author.bot) return;
      if (!message.guild) return;
      
      // Skip if user is whitelisted
      if (this.isWhitelisted(message.author.id)) return;
      
      // Skip if user has exempt role
      if (message.member?.roles.cache.some(role => 
        this.config.contentModeration.exemptRoles?.includes(role.id)
      )) return;
      
      await this.checkMessageContent(message);
    });
    
    // Anti-raid join monitoring
    if (this.config.contentModeration?.antiRaid?.enabled) {
      this.client.on('guildMemberAdd', async (member) => {
        await this.checkJoinRate(member);
      });
    }
  }

  async checkMessageContent(message) {
    const violations = [];
    const config = this.config.contentModeration;
    
    // Mass mention check
    if (config.massMention?.enabled) {
      const mentions = message.mentions.users.size + message.mentions.roles.size;
      if (mentions >= config.massMention.threshold) {
        violations.push({
          type: 'massMention',
          severity: 'high',
          details: `${mentions} mentions`
        });
        this.contentStats.massMentions++;
      }
    }
    
    // Mass emoji check
    if (config.massEmoji?.enabled) {
      const emojiCount = (message.content.match(/<a?:\w+:\d+>|[\u{1F300}-\u{1F9FF}]/gu) || []).length;
      if (emojiCount >= config.massEmoji.threshold) {
        violations.push({
          type: 'massEmoji',
          severity: 'low',
          details: `${emojiCount} emojis`
        });
        this.contentStats.massEmojis++;
      }
    }
    
    // Caps spam check
    if (config.capsSpam?.enabled && message.content.length >= config.capsSpam.minLength) {
      const upperCount = (message.content.match(/[A-Z]/g) || []).length;
      const letterCount = (message.content.match(/[a-zA-Z]/g) || []).length;
      if (letterCount > 0) {
        const capsPercentage = (upperCount / letterCount) * 100;
        if (capsPercentage >= config.capsSpam.percentage) {
          violations.push({
            type: 'capsSpam',
            severity: 'low',
            details: `${Math.round(capsPercentage)}% caps`
          });
          this.contentStats.capsSpam++;
        }
      }
    }
    
    // Duplicate message check
    if (config.duplicateMessages?.enabled) {
      const isDuplicate = this.checkDuplicateMessage(message);
      if (isDuplicate) {
        violations.push({
          type: 'duplicate',
          severity: 'medium',
          details: 'Duplicate message'
        });
        this.contentStats.duplicates++;
      }
    }
    
    // Handle violations
    if (violations.length > 0) {
      await this.handleContentViolations(message, violations);
    }
    
    // Update message history
    this.updateMessageHistory(message);
  }

  checkDuplicateMessage(message) {
    const userId = message.author.id;
    const history = this.contentTracking.messageHistory.get(userId) || [];
    const config = this.config.contentModeration.duplicateMessages;
    const now = Date.now();
    
    // Check recent messages for duplicates
    const recentMessages = history.filter(
      msg => now - msg.timestamp < config.timeWindow
    );
    
    const duplicates = recentMessages.filter(
      msg => msg.content === message.content
    );
    
    return duplicates.length >= config.threshold - 1;
  }

  updateMessageHistory(message) {
    const userId = message.author.id;
    const history = this.contentTracking.messageHistory.get(userId) || [];
    
    history.push({
      content: message.content,
      timestamp: Date.now(),
      channelId: message.channel.id
    });
    
    // Keep only last 20 messages
    if (history.length > 20) {
      history.shift();
    }
    
    this.contentTracking.messageHistory.set(userId, history);
  }

  async checkJoinRate(member) {
    const config = this.config.contentModeration.antiRaid;
    const guildId = member.guild.id;
    const now = Date.now();
    
    // Initialize join history for guild
    if (!this.contentTracking.joinHistory.has(guildId)) {
      this.contentTracking.joinHistory.set(guildId, []);
    }
    
    const joins = this.contentTracking.joinHistory.get(guildId);
    joins.push(now);
    
    // Filter recent joins
    const recentJoins = joins.filter(
      timestamp => now - timestamp < config.timeWindow
    );
    
    // Update the array with only recent joins
    this.contentTracking.joinHistory.set(guildId, recentJoins);
    
    // Check if raid threshold is met
    if (recentJoins.length >= config.joinThreshold) {
      await this.triggerRaidMode(member.guild, 'Mass joins detected');
    }
  }

  async handleContentViolations(message, violations) {
    // Delete message if needed
    const deleteViolations = violations.filter(v => 
      this.config.contentModeration[v.type]?.action === 'delete'
    );
    
    if (deleteViolations.length > 0) {
      try {
        await message.delete();
      } catch (error) {
        console.error('[AntiNuke] Failed to delete message:', error);
      }
    }
    
    // Apply punishment for severe violations
    const severeViolations = violations.filter(v => v.severity === 'high');
    if (severeViolations.length > 0) {
      const timeoutDuration = this.config.contentModeration.timeoutDuration || 300000; // 5 minutes default
      try {
        await message.member.timeout(timeoutDuration, `AntiNuke: ${severeViolations.map(v => v.type).join(', ')}`);
      } catch (error) {
        console.error('[AntiNuke] Failed to timeout member:', error);
      }
    }
    
    // Log the action
    await this.logContentViolation(message, violations);
  }

  async triggerRaidMode(guild, reason) {
    if (this.raidMode.enabled) return;
    
    console.log(`[AntiNuke] Raid mode triggered in ${guild.name}: ${reason}`);
    
    this.raidMode = {
      enabled: true,
      triggeredAt: Date.now(),
      triggeredBy: reason
    };
    
    this.contentStats.raidsDetected++;
    
    // Apply lockdown
    if (this.config.contentModeration.antiRaid.lockdownEnabled) {
      await this.lockdownServer(guild);
    }
    
    // Log the raid
    await this.logToAdminChannel({
      title: '🚨 RAID MODE ACTIVATED',
      description: `Raid mode has been activated.\nReason: ${reason}`,
      color: 0xff0000,
      fields: [
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Time', value: new Date().toLocaleString(), inline: true }
      ]
    });
    
    // Auto-disable raid mode after 30 minutes
    setTimeout(() => {
      if (this.raidMode.enabled) {
        this.disableRaidMode(guild);
      }
    }, 30 * 60 * 1000);
  }

  async disableRaidMode(guild) {
    this.raidMode.enabled = false;
    
    // Restore permissions
    try {
      const everyoneRole = guild.roles.everyone;
      await everyoneRole.setPermissions(
        everyoneRole.permissions.add([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.Connect
        ]),
        'AntiNuke: Raid mode disabled'
      );
    } catch (error) {
      console.error('[AntiNuke] Failed to restore permissions:', error);
    }
    
    await this.logToAdminChannel({
      title: '✅ Raid Mode Disabled',
      description: 'Server has been restored to normal operation.',
      color: 0x00ff00
    });
  }

  async lockdownServer(guild) {
    try {
      const everyoneRole = guild.roles.everyone;
      await everyoneRole.setPermissions(
        everyoneRole.permissions.remove([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.Connect
        ]),
        'AntiNuke: Raid lockdown'
      );
    } catch (error) {
      console.error('[AntiNuke] Failed to lockdown server:', error);
    }
  }

  async logContentViolation(message, violations) {
    const logChannel = this.config.abuseLogChannel || this.config.adminLogChannel;
    if (!logChannel) return;
    
    const channel = message.guild.channels.cache.get(logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle('Content Violation Detected')
      .setDescription(`User ${message.author} violated content rules`)
      .addFields(
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Violations', value: violations.map(v => `• **${v.type}**: ${v.details}`).join('\n') }
      )
      .setColor(0xffa500)
      .setTimestamp();
    
    if (message.content) {
      embed.addFields({ 
        name: 'Message Content', 
        value: message.content.slice(0, 1024) 
      });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AntiNuke] Failed to log content violation:', error);
    }
  }

  async getExecutor(guild, auditType) {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 1,
        type: auditType
      });
      
      const auditEntry = auditLogs.entries.first();
      if (!auditEntry || Date.now() - auditEntry.createdTimestamp > 5000) return null;
      
      return auditEntry.executor;
    } catch (error) {
      console.error('[AntiNuke] Error fetching audit logs:', error);
      return null;
    }
  }

  track(userId, action, metadata = {}) {
    // Skip if user is whitelisted
    if (this.isWhitelisted(userId)) return null;
    
    // Check if user is suspicious and apply stricter limits
    let limit = this.config.limits[action];
    if (this.isSuspicious(userId) && limit?.maxActions) {
      limit = {
        ...limit,
        maxActions: Math.max(1, Math.floor(limit.maxActions / 2))
      };
    }
    
    if (!limit) return null;
    
    const now = Date.now();
    
    // Initialize user tracking
    if (!this.tracker.has(userId)) {
      this.tracker.set(userId, {});
    }
    
    const userTracker = this.tracker.get(userId);
    
    if (!userTracker[action]) {
      userTracker[action] = {
        count: 0,
        firstAction: now,
        lastAction: now,
        metadata: []
      };
    }
    
    const actionTracker = userTracker[action];
    
    // Check if time window has passed
    if (now - actionTracker.firstAction > limit.timeWindowSeconds * 1000) {
      // Reset tracking
      actionTracker.count = 0;
      actionTracker.firstAction = now;
      actionTracker.metadata = [];
    }
    
    actionTracker.count++;
    actionTracker.lastAction = now;
    actionTracker.metadata.push({ ...metadata, timestamp: now });
    
    // Check for violation
    if (actionTracker.count > limit.maxActions) {
      return {
        userId,
        action,
        count: actionTracker.count,
        limit: limit.maxActions,
        timeWindow: limit.timeWindowSeconds,
        metadata: actionTracker.metadata
      };
    }
    
    return null;
  }

  async handleViolation(guild, user, action, violation) {
    console.log(`[AntiNuke] Violation detected: ${user.tag} - ${action} (${violation.count}/${violation.limit})`);
    
    // Get member
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    // Apply punishment based on action type
    let punishment = 'None';
    
    try {
      switch (action) {
        case 'bans':
        case 'kicks':
          if (member.bannable) {
            await member.ban({ reason: `AntiNuke: Excessive ${action}` });
            punishment = 'Banned';
          }
          break;
          
        case 'channelCreate':
        case 'channelDelete':
        case 'roleCreate':
        case 'roleDelete':
          // Remove all roles except @everyone
          const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
          if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove, `AntiNuke: Excessive ${action}`);
            punishment = 'Roles Removed';
          }
          break;
          
        case 'commands':
          // Timeout for 5 minutes
          if (member.moderatable) {
            await member.timeout(5 * 60 * 1000, `AntiNuke: Command spam`);
            punishment = 'Timed Out';
          }
          break;
      }
    } catch (error) {
      console.error('[AntiNuke] Error applying punishment:', error);
    }
    
    // Log the violation
    await this.logViolation(guild, user, action, violation, punishment);
  }

  async logViolation(guild, user, action, violation, punishment) {
    await this.logToAdminChannel({
      title: '🚨 AntiNuke Violation Detected',
      description: `User ${user.tag} exceeded ${action} limit`,
      color: 0xff0000,
      fields: [
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Action', value: action, inline: true },
        { name: 'Count', value: `${violation.count}/${violation.limit}`, inline: true },
        { name: 'Time Window', value: `${violation.timeWindow}s`, inline: true },
        { name: 'Punishment', value: punishment, inline: true },
        { name: 'Guild', value: guild.name, inline: true }
      ],
      timestamp: new Date()
    });
    
    // Also log to abuse channel if different
    if (this.config.abuseLogChannel && this.config.abuseLogChannel !== this.config.adminLogChannel) {
      const abuseChannel = guild.channels.cache.get(this.config.abuseLogChannel);
      if (abuseChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Suspicious Activity')
          .setDescription(`${user.tag} may be attempting to nuke the server`)
          .setColor(0xffa500)
          .addFields(
            { name: 'Action', value: action, inline: true },
            { name: 'Count', value: `${violation.count}`, inline: true }
          )
          .setTimestamp();
        
        await abuseChannel.send({ embeds: [embed] });
      }
    }
  }

  async logToAdminChannel(embedData) {
    if (!this.config.adminLogChannel) return;
    
    for (const guild of this.client.guilds.cache.values()) {
      const channel = guild.channels.cache.get(this.config.adminLogChannel);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(embedData.title)
          .setDescription(embedData.description)
          .setColor(embedData.color)
          .setTimestamp(embedData.timestamp || new Date());
        
        if (embedData.fields) {
          embed.addFields(embedData.fields);
        }
        
        try {
          await channel.send({ embeds: [embed] });
        } catch (error) {
          console.error('[AntiNuke] Error sending log:', error);
        }
      }
    }
  }

  isWhitelisted(userId) {
    return this.config.whitelist?.users?.includes(userId) || false;
  }

  isRoleWhitelisted(roleId) {
    return this.config.whitelist?.roles?.includes(roleId) || false;
  }

  addToWhitelist(type, id) {
    if (!this.config.whitelist) {
      this.config.whitelist = { users: [], roles: [] };
    }
    
    if (type === 'user' && !this.config.whitelist.users.includes(id)) {
      this.config.whitelist.users.push(id);
      return true;
    } else if (type === 'role' && !this.config.whitelist.roles.includes(id)) {
      this.config.whitelist.roles.push(id);
      return true;
    }
    
    return false;
  }

  removeFromWhitelist(type, id) {
    if (!this.config.whitelist) return false;
    
    if (type === 'user') {
      const index = this.config.whitelist.users.indexOf(id);
      if (index > -1) {
        this.config.whitelist.users.splice(index, 1);
        return true;
      }
    } else if (type === 'role') {
      const index = this.config.whitelist.roles.indexOf(id);
      if (index > -1) {
        this.config.whitelist.roles.splice(index, 1);
        return true;
      }
    }
    
    return false;
  }

  setHighAlert(enabled) {
    if (enabled && !this.highAlert) {
      // Store original limits
      this.originalLimits = JSON.parse(JSON.stringify(this.config.limits));
      
      // Reduce all thresholds by 50% during high alert
      for (const [action, limit] of Object.entries(this.config.limits)) {
        if (limit.maxActions) {
          this.config.limits[action].maxActions = Math.max(1, Math.floor(limit.maxActions / 2));
        }
      }
      
      this.highAlert = true;
      console.log('[AntiNuke] High alert mode enabled - thresholds reduced');
      
      // Log to admin channel
      this.logToAdminChannel({
        title: '🚨 High Alert Mode Enabled',
        description: 'AntiNuke thresholds have been reduced due to detected raid activity.',
        color: 0xff0000
      });
    } else if (!enabled && this.highAlert && this.originalLimits) {
      // Restore original limits
      this.config.limits = this.originalLimits;
      this.originalLimits = null;
      this.highAlert = false;
      
      console.log('[AntiNuke] High alert mode disabled - thresholds restored');
      
      // Log to admin channel
      this.logToAdminChannel({
        title: '✅ High Alert Mode Disabled',
        description: 'AntiNuke thresholds have been restored to normal.',
        color: 0x00ff00
      });
    }
  }

  trackSuspiciousUser(userId, report) {
    const userData = this.suspiciousUsers.get(userId) || {
      reports: [],
      lastReport: 0
    };
    
    userData.reports.push({
      ...report,
      timestamp: Date.now()
    });
    userData.lastReport = Date.now();
    
    // Keep only last 10 reports
    if (userData.reports.length > 10) {
      userData.reports.shift();
    }
    
    this.suspiciousUsers.set(userId, userData);
    
    // Clean up old reports (older than 24 hours)
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [uid, data] of this.suspiciousUsers) {
      if (data.lastReport < dayAgo) {
        this.suspiciousUsers.delete(uid);
      }
    }
  }

  isSuspicious(userId) {
    const userData = this.suspiciousUsers.get(userId);
    if (!userData) return false;
    
    // User is suspicious if they have recent reports
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return userData.lastReport > fiveMinutesAgo;
  }

  async saveConfig() {
    this.configLoader.set('antiNuke', this.config);
    return this.configLoader.save();
  }

  getStats() {
    const baseStats = {
      trackedActions: {},
      trackedUsers: this.tracker.size
    };
    
    // Count tracked actions
    for (const [, userData] of this.tracker) {
      for (const [action, data] of Object.entries(userData)) {
        if (action !== 'warnings') {
          baseStats.trackedActions[action] = (baseStats.trackedActions[action] || 0) + data.count;
        }
      }
    }
    
    return {
      ...baseStats,
      highAlert: this.highAlert,
      suspiciousUsers: this.suspiciousUsers.size,
      contentModeration: {
        enabled: this.config.contentModeration?.enabled || false,
        violations: this.contentStats,
        raidMode: this.raidMode,
        trackedMessages: this.contentTracking.messageHistory.size,
        trackedGuilds: this.contentTracking.joinHistory.size
      }
    };
  }

  cleanup() {
    const now = Date.now();
    
    // Clean old message history
    for (const [userId, history] of this.contentTracking.messageHistory) {
      const filtered = history.filter(msg => 
        now - msg.timestamp < 300000 // Keep 5 minutes
      );
      
      if (filtered.length === 0) {
        this.contentTracking.messageHistory.delete(userId);
      } else {
        this.contentTracking.messageHistory.set(userId, filtered);
      }
    }
    
    // Clean old join history
    for (const [guildId, joins] of this.contentTracking.joinHistory) {
      const filtered = joins.filter(timestamp => 
        now - timestamp < 300000 // Keep 5 minutes
      );
      
      if (filtered.length === 0) {
        this.contentTracking.joinHistory.delete(guildId);
      } else {
        this.contentTracking.joinHistory.set(guildId, filtered);
      }
    }
  }
}