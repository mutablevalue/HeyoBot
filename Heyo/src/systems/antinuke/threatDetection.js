// src/systems/antinuke/threatDetection.js - Threat detection module
import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';

export default class ThreatDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    this.client = antiNuke.client;
    
    // Action tracking
    this.userActions = new Map();
    this.channelActions = new Map();
    this.roleActions = new Map();
    this.multiUserTracking = new Map();
  }
  
  /**
   * Track user action
   */
  async trackAction(userId, action, guild) {
    if (this.antiNuke.isWhitelisted(userId)) return false;
    
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && this.antiNuke.isMemberWhitelisted(member)) return false;
    } catch (error) {
      // Continue with tracking
    }
    
    const now = Date.now();
    const threshold = this.antiNuke.getThreshold(action);
    
    if (!threshold) return false;
    
    // Initialize tracking
    if (!this.userActions.has(userId)) {
      this.userActions.set(userId, new Map());
    }
    
    const userMap = this.userActions.get(userId);
    if (!userMap.has(action)) {
      userMap.set(action, []);
    }
    
    const timestamps = userMap.get(action);
    timestamps.push(now);
    
    // Clean old timestamps
    const validTimestamps = timestamps.filter(ts => now - ts < threshold.timeWindow);
    userMap.set(action, validTimestamps);
    
    // Update stats
    if (!this.antiNuke.stats.trackedActions.has(action)) {
      this.antiNuke.stats.trackedActions.set(action, 0);
    }
    this.antiNuke.stats.trackedActions.set(action, 
      this.antiNuke.stats.trackedActions.get(action) + 1);
    
    // Check for auto high alert
    this.antiNuke.checkAutoHighAlert();
    
    // Check if threshold exceeded
    if (validTimestamps.length > threshold.maxActions) {
      this.antiNuke.suspiciousUsers.add(userId);
      return true;
    }
    
    return false;
  }
  
  /**
   * Handle threshold exceeded
   */
  async handleThresholdExceeded(member, action, guild) {
    console.log(`[ThreatDetection] Threshold exceeded: ${member.user.tag} - ${action}`);
    
    try {
      switch (action) {
        case 'bans':
        case 'kicks':
        case 'channelDelete':
        case 'roleDelete':
          if (member.bannable) {
            await member.ban({ reason: `AntiNuke: Exceeded ${action} threshold` });
            this.antiNuke.logSecurity(guild, 'Member Banned', 
              `${member.user.tag} exceeded ${action} threshold`);
          } else {
            await this.removeAllRoles(member);
            this.antiNuke.logSecurity(guild, 'Roles Removed', 
              `${member.user.tag} exceeded ${action} threshold`);
          }
          break;
          
        case 'messages':
        case 'reactions':
          if (member.moderatable) {
            const duration = this.config.contentModeration?.timeoutDuration;
            if (duration) {
              await member.timeout(duration, `AntiNuke: Exceeded ${action} threshold`);
              this.antiNuke.logSecurity(guild, 'Member Timed Out', 
                `${member.user.tag} exceeded ${action} threshold`);
            }
          }
          break;
          
        default:
          await this.removeDangerousPermissions(member);
          this.antiNuke.logSecurity(guild, 'Permissions Removed', 
            `${member.user.tag} exceeded ${action} threshold`);
      }
      
      if (this.multiUserTracking.size >= 3) {
        await this.antiNuke.triggerRaidMode(guild, `Multiple users exceeding thresholds`);
      }
    } catch (error) {
      console.error(`[ThreatDetection] Error handling threshold exceeded:`, error);
    }
  }
  
  /**
   * Remove all roles from a member
   */
  async removeAllRoles(member) {
    try {
      const rolesToRemove = member.roles.cache.filter(role => role.id !== member.guild.id);
      await member.roles.remove(rolesToRemove, 'AntiNuke: Security action');
    } catch (error) {
      console.error('[ThreatDetection] Error removing roles:', error);
    }
  }
  
  /**
   * Remove dangerous permissions
   */
  async removeDangerousPermissions(member) {
    const dangerousPerms = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ManageWebhooks
    ];
    
    try {
      const dangerousRoles = member.roles.cache.filter(role => 
        dangerousPerms.some(perm => role.permissions.has(perm))
      );
      
      if (dangerousRoles.size > 0) {
        await member.roles.remove(dangerousRoles, 'AntiNuke: Removed dangerous permissions');
      }
    } catch (error) {
      console.error('[ThreatDetection] Error removing dangerous permissions:', error);
    }
  }
  
  /**
   * Check for raid patterns (member joins, not message spam)
   */
  async checkForRaid(guild) {
    const config = this.config.contentModeration?.antiRaid;
    if (!config?.enabled) return;
    
    const now = Date.now();
    const key = guild.id;
    
    if (!this.multiUserTracking.has(key)) {
      this.multiUserTracking.set(key, []);
    }
    
    const joins = this.multiUserTracking.get(key);
    joins.push(now);
    
    const recentJoins = joins.filter(timestamp => now - timestamp < config.timeWindow);
    this.multiUserTracking.set(key, recentJoins);
    
    if (recentJoins.length >= config.joinThreshold) {
      this.antiNuke.stats.contentViolations.raidsDetected++;
      
      if (config.lockdownEnabled && !this.antiNuke.raidMode.enabled) {
        await this.antiNuke.triggerRaidMode(guild, 
          `${recentJoins.length} users joined in ${config.timeWindow/1000}s`);
      }
    }
  }
  
  /**
   * Check message content for violations
   * NOTE: Duplicate messages are now handled by SpamDetection
   */
  async checkMessageContent(message) {
    const config = this.config.contentModeration;
    if (!config?.enabled) return;
    
    let violated = false;
    let violationType = null;
    
    // Check mass mentions
    if (config.massMention?.enabled) {
      const mentionCount = message.mentions.users.size + message.mentions.roles.size;
      if (mentionCount >= config.massMention.threshold) {
        violated = true;
        violationType = 'massMention';
        this.antiNuke.stats.contentViolations.massMentions++;
      }
    }
    
    // Check mass emojis (only if not already violated)
    if (!violated && config.massEmoji?.enabled) {
      const emojiCount = (message.content.match(/<a?:\w+:\d+>/g) || []).length;
      if (emojiCount >= config.massEmoji.threshold) {
        violated = true;
        violationType = 'massEmoji';
        this.antiNuke.stats.contentViolations.massEmojis++;
      }
    }
    
    // Check caps spam (only if not already violated)
    if (!violated && config.capsSpam?.enabled && message.content.length >= config.capsSpam.minLength) {
      const capsCount = (message.content.match(/[A-Z]/g) || []).length;
      const capsPercentage = (capsCount / message.content.length) * 100;
      if (capsPercentage >= config.capsSpam.percentage) {
        violated = true;
        violationType = 'capsSpam';
        this.antiNuke.stats.contentViolations.capsSpam++;
      }
    }
    
    // REMOVED: Duplicate message checking - now handled by SpamDetection
    // This prevents double processing and ensures proper order of operations
    
    if (violated) {
      try {
        const action = config[violationType]?.action;
        
        // For delete actions, check if spam detection is already handling this user
        // If so, let spam detection handle everything to maintain proper order
        if (action === 'delete' && this.antiNuke.spamDetection.activeSpamSessions.has(message.guild.id)) {
          const session = this.antiNuke.spamDetection.activeSpamSessions.get(message.guild.id);
          if (session.spammers.has(message.author.id)) {
            // Spam detection is already handling this user, skip
            return;
          }
        }
        
        // Handle the violation
        if (action === 'delete') {
          await message.delete();
        } else if (action === 'timeout' && message.member.moderatable) {
          await message.delete();
          const timeoutDuration = config.timeoutDuration;
          if (timeoutDuration) {
            await message.member.timeout(
              timeoutDuration,
              `AntiNuke: ${violationType} violation`
            );
          }
        } else if (action === 'warn') {
          const warningKey = `${message.channel.id}-${violationType}`;
          const now = Date.now();
          const lastWarning = this.antiNuke.warningCooldowns.get(warningKey);
          
          if (!this.antiNuke.cooldownConfig.warningCooldown || !lastWarning || 
              (now - lastWarning) > this.antiNuke.cooldownConfig.warningCooldown) {
            if (this.antiNuke.cooldownConfig.warningCooldown) {
              this.antiNuke.warningCooldowns.set(warningKey, now);
            }
            
            await message.reply({
              content: `Warning: Your message violates our ${violationType} policy.`,
              allowedMentions: { repliedUser: true }
            }).catch(() => {});
          }
        }
        
        this.antiNuke.logAbuse(message.guild, violationType, message.author);
      } catch (error) {
        if (error.code !== 50013 && error.code !== 10008) {
          console.error('[ThreatDetection] Error handling content violation:', error);
        }
      }
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Member ban
    this.client.on(Events.GuildBanAdd, async (ban) => {
      const guild = ban.guild;
      const logs = await this.antiNuke.fetchAuditLogs(guild, AuditLogEvent.MemberBanAdd);
      if (!logs) return;
      
      const banLog = logs.entries.first();
      if (!banLog) return;
      
      const { executor } = banLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'bans', guild)) {
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member) {
          await this.handleThresholdExceeded(member, 'bans', guild);
        }
      }
    });
    
    // Member kick
    this.client.on(Events.GuildMemberRemove, async (member) => {
      const guild = member.guild;
      const logs = await this.antiNuke.fetchAuditLogs(guild, AuditLogEvent.MemberKick);
      if (!logs) return;
      
      const kickLog = logs.entries.first();
      if (!kickLog || Date.now() - kickLog.createdTimestamp > 
          (this.config.limits?.kicks?.logTimeWindow || 5000)) return;
      
      const { executor } = kickLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'kicks', guild)) {
        const executorMember = await guild.members.fetch(executor.id).catch(() => null);
        if (executorMember) {
          await this.handleThresholdExceeded(executorMember, 'kicks', guild);
        }
      }
    });
    
    // Channel events
    this.client.on(Events.ChannelCreate, async (channel) => {
      if (!channel.guild) return;
      
      const logs = await this.antiNuke.fetchAuditLogs(channel.guild, AuditLogEvent.ChannelCreate);
      if (!logs) return;
      
      const createLog = logs.entries.first();
      if (!createLog) return;
      
      const { executor } = createLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'channelCreate', channel.guild)) {
        const member = await channel.guild.members.fetch(executor.id).catch(() => null);
        if (member) {
          await this.handleThresholdExceeded(member, 'channelCreate', channel.guild);
        }
      }
    });
    
    this.client.on(Events.ChannelDelete, async (channel) => {
      if (!channel.guild) return;
      
      const logs = await this.antiNuke.fetchAuditLogs(channel.guild, AuditLogEvent.ChannelDelete);
      if (!logs) return;
      
      const deleteLog = logs.entries.first();
      if (!deleteLog) return;
      
      const { executor } = deleteLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'channelDelete', channel.guild)) {
        const member = await channel.guild.members.fetch(executor.id).catch(() => null);
        if (member) {
          await this.handleThresholdExceeded(member, 'channelDelete', channel.guild);
        }
      }
    });
    
    // Role events
    this.client.on(Events.GuildRoleCreate, async (role) => {
      const logs = await this.antiNuke.fetchAuditLogs(role.guild, AuditLogEvent.RoleCreate);
      if (!logs) return;
      
      const createLog = logs.entries.first();
      if (!createLog) return;
      
      const { executor } = createLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'roleCreate', role.guild)) {
        const member = await role.guild.members.fetch(executor.id).catch(() => null);
        if (member) {
          await this.handleThresholdExceeded(member, 'roleCreate', role.guild);
        }
      }
    });
    
    this.client.on(Events.GuildRoleDelete, async (role) => {
      const logs = await this.antiNuke.fetchAuditLogs(role.guild, AuditLogEvent.RoleDelete);
      if (!logs) return;
      
      const deleteLog = logs.entries.first();
      if (!deleteLog) return;
      
      const { executor } = deleteLog;
      if (executor.bot) return;
      
      if (await this.trackAction(executor.id, 'roleDelete', role.guild)) {
        const member = await role.guild.members.fetch(executor.id).catch(() => null);
        if (member) {
          await this.handleThresholdExceeded(member, 'roleDelete', role.guild);
        }
      }
    });
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.config.maxTrackingAge;
    if (!maxAge) return;
    
    // Clean user actions
    for (const [userId, actions] of this.userActions) {
      for (const [action, timestamps] of actions) {
        const valid = timestamps.filter(ts => now - ts < maxAge);
        if (valid.length === 0) {
          actions.delete(action);
        } else {
          actions.set(action, valid);
        }
      }
      if (actions.size === 0) {
        this.userActions.delete(userId);
      }
    }
    
    // Clean multi-user tracking (for join raids)
    for (const [key, timestamps] of this.multiUserTracking) {
      const valid = timestamps.filter(ts => now - ts < maxAge);
      if (valid.length === 0) {
        this.multiUserTracking.delete(key);
      } else {
        this.multiUserTracking.set(key, valid);
      }
    }
  }
  
  /**
   * Get all tracked actions for high alert checking
   */
  getAllTrackedActions() {
    return this.userActions;
  }
  
  /**
   * Get tracked user count
   */
  getTrackedUserCount() {
    return this.userActions.size;
  }
}