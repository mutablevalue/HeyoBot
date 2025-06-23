// src/systems/antiNuke.js - Fixed version
import { Events, PermissionFlagsBits, AuditLogEvent } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class AntiNuke {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('antiNuke');
    this.fullConfig = config;
    this.embedLoader = null;
    this.permissionSystem = null; // Will be set by main
    
    // Tracking data
    this.userActions = new Map();
    this.channelActions = new Map();
    this.roleActions = new Map();
    this.suspiciousUsers = new Set();
    
    // Webhook spam tracking (temporary, in-memory only)
    this.webhookMessages = new Map(); // webhookId -> timestamp array
    
    // High alert state from config
    this.highAlert = this.config.highAlert?.enabled || false;
    
    // Raid mode state
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
    // Content moderation tracking
    this.contentTracking = new Map();
    this.multiUserTracking = new Map();
    
    // Statistics
    this.stats = {
      trackedActions: new Map(),
      contentViolations: {
        massMentions: 0,
        massEmojis: 0,
        capsSpam: 0,
        duplicates: 0,
        raidsDetected: 0,
        webhookAbuse: 0,
        unauthorizedBots: 0
      }
    };
    
    this.setupEventListeners();
    console.log('[AntiNuke] System initialized with unified permissions, webhook & bot protection');
  }
  
  /**
   * Set the unified permission system
   */
  setPermissionSystem(system) {
    this.permissionSystem = system;
  }
  
  /**
   * Set the embed loader
   */
  setEmbedLoader(loader) {
    this.embedLoader = loader;
  }
  
  /**
   * Check if a user is whitelisted (uses unified permission system)
   */
  isWhitelisted(userId) {
    // Use AntiNuke whitelist as single source of truth
    const whitelist = this.config.whitelist || { users: [], roles: [] };
    return whitelist.users.includes(userId);
  }
  
  /**
   * Check if a member is whitelisted
   * @param {GuildMember|Object} member - Either a full GuildMember or an object with {id, guild}
   */
  isMemberWhitelisted(member) {
    if (!member) return false;
    
    // Check user whitelist first (always available)
    if (this.isWhitelisted(member.id)) return true;
    
    // For role whitelist, we need a proper GuildMember object
    // Check if this is a real GuildMember (has roles property)
    if (member.roles && member.roles.cache) {
      const whitelist = this.config.whitelist || { users: [], roles: [] };
      return member.roles.cache.some(role => whitelist.roles.includes(role.id));
    }
    
    // If we only have partial member data, we can't check roles
    // Return false for now (non-whitelisted by default)
    return false;
  }
  
  /**
   * Check if a user is an AntiNuke admin (uses permission system)
   */
  isAntiNukeAdmin(userId) {
    if (!this.permissionSystem) return false;
    
    // Create a mock member object for permission checking
    const mockMember = {
      id: userId,
      guild: { id: 'check' },
      roles: { cache: new Map() }
    };
    
    // Use permission system's ANTINUKE_ADMIN level constant
    return this.permissionSystem.getPermissionLevel(mockMember) >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
  }
  
  /**
   * Check if a member is an AntiNuke admin
   */
  isMemberAntiNukeAdmin(member) {
    if (!this.permissionSystem) return false;
    return this.permissionSystem.getPermissionLevel(member) >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
  }
  
  /**
   * Check if member can create webhooks (Administrator+ only)
   */
  canCreateWebhooks(member) {
    if (!this.permissionSystem) return false;
    
    // Owner with bypass can always create webhooks
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    // Administrator level (3) or higher can create webhooks
    return this.permissionSystem.getPermissionLevel(member) >= this.permissionSystem.LEVELS.ADMINISTRATOR;
  }
  
  /**
   * Check if member can invite bots (AntiNuke Admin+ only)
   */
  canInviteBots(member) {
    if (!this.permissionSystem) return false;
    
    // Owner with bypass can always invite bots
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    // AntiNuke Admin level (4) or higher can invite bots
    return this.permissionSystem.getPermissionLevel(member) >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
  }
  
  /**
   * Get the current threshold for an action based on high alert status
   */
  getThreshold(action) {
    const baseLimit = this.config.limits[action];
    if (!baseLimit) return null;
    
    let maxActions = baseLimit.maxActions;
    
    // Use high alert threshold if enabled
    if (this.highAlert && baseLimit.highAlertMaxActions) {
      maxActions = baseLimit.highAlertMaxActions;
    }
    
    return {
      maxActions,
      timeWindow: baseLimit.timeWindowSeconds * 1000
    };
  }
  
  /**
   * Set high alert mode
   */
  setHighAlert(enabled) {
    this.highAlert = enabled;
    this.config.highAlert.enabled = enabled;
    
    if (enabled) {
      console.log('[AntiNuke] High alert mode ENABLED - thresholds reduced');
    } else {
      console.log('[AntiNuke] High alert mode DISABLED - thresholds normal');
    }
    
    // Save config
    this.saveConfig();
  }
  
  /**
   * Check if high alert should be auto-enabled
   */
  checkAutoHighAlert() {
    const autoConfig = this.config.highAlert.autoEnable;
    if (!autoConfig?.enabled || this.highAlert) return;
    
    const now = Date.now();
    const timeWindow = autoConfig.timeWindow;
    
    // Check suspicious users count
    if (this.suspiciousUsers.size >= autoConfig.triggers.suspiciousUsers) {
      this.setHighAlert(true);
      this.logSecurity(null, 'High Alert Auto-Enabled', `${this.suspiciousUsers.size} suspicious users detected`);
      return;
    }
    
    // Check tracked actions count
    let recentActions = 0;
    for (const [userId, actions] of this.userActions) {
      for (const [action, timestamps] of actions) {
        recentActions += timestamps.filter(ts => now - ts < timeWindow).length;
      }
    }
    
    if (recentActions >= autoConfig.triggers.trackedActions) {
      this.setHighAlert(true);
      this.logSecurity(null, 'High Alert Auto-Enabled', `${recentActions} tracked actions in ${timeWindow/1000}s`);
    }
  }
  
  /**
   * Track user action
   */
  async trackAction(userId, action, guild) {
    // First check if user is whitelisted by ID
    if (this.isWhitelisted(userId)) return false;
    
    // Try to get the full member object to check role whitelist
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && this.isMemberWhitelisted(member)) return false;
    } catch (error) {
      // If we can't fetch member, continue with tracking
    }
    
    const now = Date.now();
    const threshold = this.getThreshold(action);
    
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
    if (!this.stats.trackedActions.has(action)) {
      this.stats.trackedActions.set(action, 0);
    }
    this.stats.trackedActions.set(action, this.stats.trackedActions.get(action) + 1);
    
    // Check for auto high alert
    this.checkAutoHighAlert();
    
    // Check if threshold exceeded
    if (validTimestamps.length > threshold.maxActions) {
      this.suspiciousUsers.add(userId);
      return true;
    }
    
    return false;
  }
  
  /**
   * Track webhook message for spam detection
   */
  async checkWebhookSpam(message) {
    if (!message.webhookId) return false;
    
    const now = Date.now();
    const webhookId = message.webhookId;
    
    // Initialize tracking
    if (!this.webhookMessages.has(webhookId)) {
      this.webhookMessages.set(webhookId, []);
    }
    
    const timestamps = this.webhookMessages.get(webhookId);
    timestamps.push(now);
    
    // Clean old timestamps (keep last 10 seconds)
    const recentMessages = timestamps.filter(ts => now - ts < 10000);
    this.webhookMessages.set(webhookId, recentMessages);
    
    // Check if it's spamming (10+ messages in 10 seconds)
    if (recentMessages.length >= 10) {
      try {
        // Find and delete the webhook
        const webhooks = await message.channel.fetchWebhooks();
        const webhook = webhooks.get(webhookId);
        
        if (webhook) {
          // Get creator from audit logs
          let creatorId = null;
          try {
            const logs = await message.guild.fetchAuditLogs({
              type: AuditLogEvent.WebhookCreate,
              limit: 50
            });
            
            const entry = logs.entries.find(e => e.target?.id === webhookId);
            if (entry) {
              creatorId = entry.executor.id;
            }
          } catch (error) {
            console.error('[AntiNuke] Error fetching webhook creator:', error);
          }
          
          // Delete the webhook
          await webhook.delete('AntiNuke: Webhook spam detected');
          this.stats.contentViolations.webhookAbuse++;
          
          // Log the event
          this.logSecurity(message.guild, 'Webhook Spam Detected', 
            `Webhook "${webhook.name}" deleted for spamming.\n` +
            `Creator: ${creatorId ? `<@${creatorId}>` : 'Unknown'}\n` +
            `Messages sent: ${recentMessages.length} in 10 seconds`);
          
          // Take action against creator if known
          if (creatorId) {
            const member = await message.guild.members.fetch(creatorId).catch(() => null);
            if (member && member.moderatable) {
              await member.timeout(300000, 'AntiNuke: Created spamming webhook');
            }
          }
          
          return true;
        }
      } catch (error) {
        console.error('[AntiNuke] Error handling webhook spam:', error);
      }
    }
    
    return false;
  }
  
  /**
   * Handle threshold exceeded
   */
  async handleThresholdExceeded(member, action, guild) {
    console.log(`[AntiNuke] Threshold exceeded: ${member.user.tag} - ${action}`);
    
    try {
      // Take action based on severity
      switch (action) {
        case 'bans':
        case 'kicks':
        case 'channelDelete':
        case 'roleDelete':
          // Severe actions - remove all permissions
          if (member.bannable) {
            await member.ban({ reason: `AntiNuke: Exceeded ${action} threshold` });
            this.logSecurity(guild, 'Member Banned', `${member.user.tag} exceeded ${action} threshold`);
          } else {
            await this.removeAllRoles(member);
            this.logSecurity(guild, 'Roles Removed', `${member.user.tag} exceeded ${action} threshold`);
          }
          break;
          
        case 'messages':
        case 'reactions':
          // Less severe - timeout
          if (member.moderatable) {
            const duration = this.config.contentModeration?.timeoutDuration || 300000;
            await member.timeout(duration, `AntiNuke: Exceeded ${action} threshold`);
            this.logSecurity(guild, 'Member Timed Out', `${member.user.tag} exceeded ${action} threshold`);
          }
          break;
          
        default:
          // Other actions - remove dangerous permissions
          await this.removeDangerousPermissions(member);
          this.logSecurity(guild, 'Permissions Removed', `${member.user.tag} exceeded ${action} threshold`);
      }
      
      // Check for raid pattern
      if (this.multiUserTracking.size >= 3) {
        await this.triggerRaidMode(guild, `Multiple users exceeding thresholds`);
      }
    } catch (error) {
      console.error(`[AntiNuke] Error handling threshold exceeded:`, error);
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
      console.error('[AntiNuke] Error removing roles:', error);
    }
  }
  
  /**
   * Remove dangerous permissions from a member
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
      console.error('[AntiNuke] Error removing dangerous permissions:', error);
    }
  }
  
  /**
   * Trigger raid mode
   */
  async triggerRaidMode(guild, reason) {
    if (this.raidMode.enabled) return;
    
    this.raidMode = {
      enabled: true,
      triggeredAt: Date.now(),
      triggeredBy: reason
    };
    
    console.log(`[AntiNuke] RAID MODE ACTIVATED: ${reason}`);
    this.logSecurity(guild, 'RAID MODE ACTIVATED', reason);
    
    try {
      // Apply raid mode restrictions
      const restrictions = this.config.raidMode?.restrictions || [];
      
      if (restrictions.includes('disableInvites')) {
        // Disable all invites
        const invites = await guild.invites.fetch();
        for (const invite of invites.values()) {
          await invite.delete('Raid mode: Disabling invites').catch(() => {});
        }
      }
      
      if (restrictions.includes('requireVerification')) {
        // Set verification level to highest
        await guild.setVerificationLevel(4, 'Raid mode: Maximum verification');
      }
      
      if (restrictions.includes('slowMode')) {
        // Enable slowmode in all channels
        const channels = guild.channels.cache.filter(ch => ch.isTextBased());
        for (const channel of channels.values()) {
          await channel.setRateLimitPerUser(30, 'Raid mode: Slowmode enabled').catch(() => {});
        }
      }
      
      // Auto-disable after configured time
      const autoDisableTime = this.config.raidMode?.autoDisableAfter || 3600000;
      setTimeout(() => {
        if (this.raidMode.enabled) {
          this.disableRaidMode(guild);
        }
      }, autoDisableTime);
    } catch (error) {
      console.error('[AntiNuke] Error applying raid mode:', error);
    }
  }
  
  /**
   * Disable raid mode
   */
  async disableRaidMode(guild) {
    if (!this.raidMode.enabled) return;
    
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
    console.log('[AntiNuke] Raid mode deactivated');
    this.logSecurity(guild, 'Raid Mode Deactivated', 'Threat level normalized');
    
    try {
      // Restore normal verification level
      await guild.setVerificationLevel(2, 'Raid mode ended');
      
      // Remove slowmode
      const channels = guild.channels.cache.filter(ch => ch.isTextBased());
      for (const channel of channels.values()) {
        if (channel.rateLimitPerUser > 0) {
          await channel.setRateLimitPerUser(0, 'Raid mode ended').catch(() => {});
        }
      }
    } catch (error) {
      console.error('[AntiNuke] Error disabling raid mode:', error);
    }
  }
  
  /**
   * Log security events
   */
  async logSecurity(guild, action, details) {
    if (!this.embedLoader || !guild) return;
    
    const logChannel = guild.channels.cache.get(this.config.adminLogChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: `AntiNuke: ${action}`,
      description: details,
      timestamp: true,
      fields: [
        {
          name: 'High Alert',
          value: this.highAlert ? 'ENABLED' : 'Disabled',
          inline: true
        },
        {
          name: 'Raid Mode',
          value: this.raidMode.enabled ? 'ACTIVE' : 'Inactive',
          inline: true
        }
      ]
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AntiNuke] Error logging security event:', error);
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Member ban
    this.client.on(Events.GuildBanAdd, async (ban) => {
      const guild = ban.guild;
      const logs = await this.fetchAuditLogs(guild, AuditLogEvent.MemberBanAdd);
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
      const logs = await this.fetchAuditLogs(guild, AuditLogEvent.MemberKick);
      if (!logs) return;
      
      const kickLog = logs.entries.first();
      if (!kickLog || Date.now() - kickLog.createdTimestamp > 5000) return;
      
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
      
      const logs = await this.fetchAuditLogs(channel.guild, AuditLogEvent.ChannelCreate);
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
      
      const logs = await this.fetchAuditLogs(channel.guild, AuditLogEvent.ChannelDelete);
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
      const logs = await this.fetchAuditLogs(role.guild, AuditLogEvent.RoleCreate);
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
      const logs = await this.fetchAuditLogs(role.guild, AuditLogEvent.RoleDelete);
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
    
    // Webhook creation detection
    this.client.on('webhooksUpdate', async (channel) => {
      if (!channel.guild) return;
      
      try {
        const logs = await this.fetchAuditLogs(channel.guild, AuditLogEvent.WebhookCreate);
        if (!logs) return;
        
        const createLog = logs.entries.first();
        if (!createLog || Date.now() - createLog.createdTimestamp > 5000) return;
        
        const { executor, target } = createLog;
        
        // Check if executor has permission
        const member = await channel.guild.members.fetch(executor.id).catch(() => null);
        if (!member) return;
        
        if (!this.canCreateWebhooks(member)) {
          // Find and delete the webhook
          const webhooks = await channel.fetchWebhooks();
          const webhook = webhooks.find(w => w.id === target.id);
          
          if (webhook) {
            await webhook.delete('AntiNuke: Unauthorized webhook creation');
            this.logSecurity(channel.guild, 'Unauthorized Webhook Blocked', 
              `${executor.tag} tried to create webhook "${webhook.name}" without Administrator+ permissions`);
            
            if (member.moderatable) {
              await member.timeout(300000, 'AntiNuke: Unauthorized webhook creation');
            }
          }
        }
      } catch (error) {
        console.error('[AntiNuke] Error handling webhook creation:', error);
      }
    });
    
    // Message events for webhook spam detection
    this.client.on(Events.MessageCreate, async (message) => {
      // Check for webhook spam
      if (message.webhookId && message.guild) {
        await this.checkWebhookSpam(message);
      }
      
      // Original content moderation
      if (!message.guild || message.author.bot) return;
      if (message.member && this.isMemberWhitelisted(message.member)) return;
      
      await this.checkMessageContent(message);
    });
    
    // Bot join detection
    this.client.on(Events.GuildMemberAdd, async (member) => {
      // Check if it's a bot
      if (member.user.bot) {
        try {
          // Check audit logs to see who invited the bot
          const logs = await this.fetchAuditLogs(member.guild, AuditLogEvent.BotAdd);
          let inviter = null;
          
          if (logs) {
            const botAddLog = logs.entries.find(entry => 
              entry.target.id === member.id && 
              Date.now() - entry.createdTimestamp < 10000
            );
            
            if (botAddLog) {
              inviter = botAddLog.executor;
            }
          }
          
          // Check if inviter has permission
          let hasPermission = false;
          
          if (inviter) {
            const inviterMember = await member.guild.members.fetch(inviter.id).catch(() => null);
            if (inviterMember) {
              hasPermission = this.canInviteBots(inviterMember);
            }
          }
          
          // Check whitelist
          const whitelistedBots = this.config.botProtection?.whitelistedBots || [];
          if (whitelistedBots.includes(member.id)) {
            hasPermission = true;
          }
          
          if (!hasPermission) {
            // Unauthorized bot - ban it
            await member.ban({ reason: 'AntiNuke: Unauthorized bot (requires AntiNuke Admin+)' });
            this.stats.contentViolations.unauthorizedBots++;
            
            this.logSecurity(member.guild, 'Unauthorized Bot Banned', 
              `Bot: ${member.user.tag} (${member.id})\n` +
              `Invited by: ${inviter ? `${inviter.tag} (${inviter.id})` : 'Unknown'}\n` +
              `Only AntiNuke Admins or the server owner can invite bots.`);
            
            // Take action against inviter if known
            if (inviter) {
              const inviterMember = await member.guild.members.fetch(inviter.id).catch(() => null);
              if (inviterMember && inviterMember.moderatable) {
                await inviterMember.timeout(600000, 'AntiNuke: Invited unauthorized bot');
              }
            }
          } else if (inviter) {
            // Log authorized bot addition
            this.logSecurity(member.guild, 'Bot Added', 
              `Bot: ${member.user.tag}\nAuthorized by: ${inviter.tag}`);
          }
        } catch (error) {
          console.error('[AntiNuke] Error handling bot join:', error);
        }
      }
      
      // Original raid detection
      await this.checkForRaid(member.guild);
    });
    
    // Setup cleanup interval
    setInterval(() => this.cleanup(), 300000); // Clean every 5 minutes
  }
  
  /**
   * Check message content for violations
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
        this.stats.contentViolations.massMentions++;
      }
    }
    
    // Check mass emojis
    if (config.massEmoji?.enabled) {
      const emojiCount = (message.content.match(/<a?:\w+:\d+>/g) || []).length;
      if (emojiCount >= config.massEmoji.threshold) {
        violated = true;
        violationType = 'massEmoji';
        this.stats.contentViolations.massEmojis++;
      }
    }
    
    // Check caps spam
    if (config.capsSpam?.enabled && message.content.length >= config.capsSpam.minLength) {
      const capsCount = (message.content.match(/[A-Z]/g) || []).length;
      const capsPercentage = (capsCount / message.content.length) * 100;
      if (capsPercentage >= config.capsSpam.percentage) {
        violated = true;
        violationType = 'capsSpam';
        this.stats.contentViolations.capsSpam++;
      }
    }
    
    // Check duplicate messages
    if (config.duplicateMessages?.enabled) {
      const key = `${message.author.id}-${message.guild.id}`;
      if (!this.contentTracking.has(key)) {
        this.contentTracking.set(key, []);
      }
      
      const userMessages = this.contentTracking.get(key);
      const now = Date.now();
      
      // Clean old messages
      const recentMessages = userMessages.filter(m => now - m.timestamp < config.duplicateMessages.timeWindow);
      
      // Check for duplicates
      const duplicates = recentMessages.filter(m => m.content === message.content).length;
      if (duplicates >= config.duplicateMessages.threshold - 1) {
        violated = true;
        violationType = 'duplicate';
        this.stats.contentViolations.duplicates++;
      }
      
      // Add current message
      recentMessages.push({
        content: message.content,
        timestamp: now
      });
      this.contentTracking.set(key, recentMessages);
    }
    
    // Handle violation
    if (violated) {
      try {
        // Check the specific action for this violation type
        const action = config[violationType]?.action;
        
        // FIXED: Only perform the action specified in config
        if (action === 'delete') {
          await message.delete();
        } else if (action === 'timeout' && message.member.moderatable) {
          await message.delete(); // Delete message when timing out
          await message.member.timeout(
            config.timeoutDuration || 300000,
            `AntiNuke: ${violationType} violation`
          );
        } else if (action === 'warn') {
          // Just warn, don't delete or timeout
          await message.reply({
            content: `Warning: Your message violates our ${violationType} policy.`,
            allowedMentions: { repliedUser: true }
          });
        }
        
        this.logAbuse(message.guild, violationType, message.author);
      } catch (error) {
        console.error('[AntiNuke] Error handling content violation:', error);
      }
    }
  }
  
  /**
   * Check for raid patterns
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
    
    // Clean old joins
    const recentJoins = joins.filter(timestamp => now - timestamp < config.timeWindow);
    this.multiUserTracking.set(key, recentJoins);
    
    // Check threshold
    if (recentJoins.length >= config.joinThreshold) {
      this.stats.contentViolations.raidsDetected++;
      
      if (config.lockdownEnabled && !this.raidMode.enabled) {
        await this.triggerRaidMode(guild, `${recentJoins.length} users joined in ${config.timeWindow/1000}s`);
      }
    }
  }
  
  /**
   * Log abuse events
   */
  async logAbuse(guild, type, user) {
    if (!this.embedLoader) return;
    
    const logChannel = guild.channels.cache.get(this.config.abuseLogChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: 'Content Violation Detected',
      description: `**User:** ${user}\n**Type:** ${type}`,
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AntiNuke] Error logging abuse:', error);
    }
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
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
    
    // Clean content tracking
    for (const [key, messages] of this.contentTracking) {
      const valid = messages.filter(m => now - m.timestamp < maxAge);
      if (valid.length === 0) {
        this.contentTracking.delete(key);
      } else {
        this.contentTracking.set(key, valid);
      }
    }
    
    // Clean multi-user tracking
    for (const [key, timestamps] of this.multiUserTracking) {
      const valid = timestamps.filter(ts => now - ts < maxAge);
      if (valid.length === 0) {
        this.multiUserTracking.delete(key);
      } else {
        this.multiUserTracking.set(key, valid);
      }
    }
    
    // Clean webhook message tracking
    for (const [webhookId, timestamps] of this.webhookMessages) {
      const valid = timestamps.filter(ts => now - ts < 60000); // Keep for 1 minute
      if (valid.length === 0) {
        this.webhookMessages.delete(webhookId);
      } else {
        this.webhookMessages.set(webhookId, valid);
      }
    }
  }
  
  /**
   * Fetch audit logs safely
   */
  async fetchAuditLogs(guild, type) {
    try {
      return await guild.fetchAuditLogs({ limit: 1, type });
    } catch (error) {
      console.error('[AntiNuke] Error fetching audit logs:', error);
      return null;
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      highAlert: this.highAlert,
      trackedUsers: this.userActions.size,
      suspiciousUsers: this.suspiciousUsers.size,
      trackedActions: Object.fromEntries(this.stats.trackedActions),
      contentModeration: {
        enabled: this.config.contentModeration?.enabled || false,
        violations: this.stats.contentViolations,
        raidMode: this.raidMode
      },
      protection: {
        webhookAbuses: this.stats.contentViolations.webhookAbuse,
        unauthorizedBots: this.stats.contentViolations.unauthorizedBots
      }
    };
  }
  
  /**
   * Save configuration
   */
  async saveConfig() {
    try {
      await this.fullConfig.save();
      console.log('[AntiNuke] Configuration saved');
    } catch (error) {
      console.error('[AntiNuke] Error saving config:', error);
    }
  }
}