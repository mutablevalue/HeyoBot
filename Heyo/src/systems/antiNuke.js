// src/systems/antiNuke.js - Main Security System orchestrator
import { Events } from 'discord.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Import AntiNuke protection modules
import SpamDetection from './antinuke/spamDetection.js';
import SelfbotDetection from './antinuke/selfbotDetection.js';
import ThreatDetection from './antinuke/threatDetection.js';
import ProtectionHandler from './antinuke/protectionHandler.js';

// Import Permission modules
import PermissionManager from './antinuke/permissions/permissionManager.js';
import WhitelistManager from './antinuke/permissions/whitelistManager.js';

// Import Moderation modules
import ActionHandler from './antinuke/moderation/actionHandler.js';
import CooldownManager from './antinuke/moderation/cooldownManager.js';
import RoleManager from './antinuke/moderation/roleManager.js';
import NicknameManager from './antinuke/moderation/nicknameManager.js';
import LoggingHandler from './antinuke/moderation/loggingHandler.js';
import LinkProtectionModule from './antinuke/moderation/linkProtection.js';
import FilterSystemModule from './antinuke/moderation/filterSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class AntiNuke {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('antiNuke');
    this.fullConfig = config;
    this.embedLoader = null;
    
    // Initialize protection modules
    this.spamDetection = new SpamDetection(this);
    this.selfbotDetection = new SelfbotDetection(this);
    this.threatDetection = new ThreatDetection(this);
    this.protectionHandler = new ProtectionHandler(this);
    
    // Initialize permission modules
    this.permissions = new PermissionManager(this);
    this.whitelist = new WhitelistManager(this);
    
    // Initialize moderation modules
    this.actions = new ActionHandler(this);
    this.cooldowns = new CooldownManager(this);
    this.roles = new RoleManager(this);
    this.nicknames = new NicknameManager(this);
    this.logging = new LoggingHandler(this);
    this.linkProtection = new LinkProtectionModule(this);
    this.filterSystem = new FilterSystemModule(this);
    
    // Core tracking data
    this.suspiciousUsers = new Set();
    this.logCooldowns = new Map();
    this.warningCooldowns = new Map();
    
    // Cooldown configuration
    this.cooldownConfig = {
      logCooldown: this.config.logCooldown,
      warningCooldown: this.config.warningCooldown,
      cleanupInterval: this.config.cleanupInterval
    };
    
    // High alert state
    this.highAlert = this.config.highAlert?.enabled || false;
    
    // Raid mode state
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
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
        unauthorizedBots: 0,
        selfbotsDetected: 0,
        messageSpam: 0
      },
      unauthorizedAttempts: new Map()
    };
    
    this.setupEventListeners();
    console.log('[AntiNuke] Unified Security System initialized');
    console.log('[AntiNuke] ├─ Protection modules loaded');
    console.log('[AntiNuke] ├─ Permission system integrated');
    console.log('[AntiNuke] ├─ Moderation system integrated');
    console.log('[AntiNuke] ├─ Link protection integrated');
    console.log('[AntiNuke] └─ Filter system integrated');
    
    // Setup cleanup interval
    if (this.cooldownConfig.cleanupInterval) {
      setInterval(() => this.cleanup(), this.cooldownConfig.cleanupInterval);
    }
  }
  
  /**
   * Set the embed loader
   */
  setEmbedLoader(loader) {
    this.embedLoader = loader;
    // Pass to modules that need it
    this.logging.setEmbedLoader(loader);
  }
  
  /**
   * Set external permission system (for backwards compatibility)
   */
  setPermissionSystem(system) {
    // This is now internal, but kept for compatibility
    console.log('[AntiNuke] External permission system ignored - using internal system');
  }
  
  /**
   * Get permission level of a member
   */
  getPermissionLevel(member) {
    return this.permissions.getPermissionLevel(member);
  }
  
  /**
   * Check if a user is whitelisted
   */
  isWhitelisted(userId) {
    return this.whitelist.isUserWhitelisted(userId);
  }
  
  /**
   * Check if a member is whitelisted
   */
  isMemberWhitelisted(member) {
    return this.whitelist.isMemberWhitelisted(member);
  }
  
  /**
   * Check if a user is an AntiNuke admin
   */
  isAntiNukeAdmin(userId) {
    return this.permissions.isAntiNukeAdmin({ id: userId });
  }
  
  /**
   * Check if a member is an AntiNuke admin
   */
  isMemberAntiNukeAdmin(member) {
    return this.permissions.isAntiNukeAdmin(member);
  }
  
  /**
   * Check if member can create webhooks
   */
  canCreateWebhooks(member) {
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    return this.permissions.getPermissionLevel(member) >= this.permissions.LEVELS.ADMINISTRATOR;
  }
  
  /**
   * Check if member can invite bots
   */
  canInviteBots(member) {
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    return this.permissions.getPermissionLevel(member) >= this.permissions.LEVELS.ANTINUKE_ADMIN;
  }
  
  /**
   * Check if a member can perform admin actions
   * @param {GuildMember} member 
   * @param {string} action - The type of action (e.g., 'channelCreate', 'roleCreate')
   * @returns {{allowed: boolean, level: number, reason?: string}}
   */
  canPerformAdminAction(member, action) {
    const permLevel = this.getPermissionLevel(member);
    
    // Define which actions require which permission levels
    const actionRequirements = {
      // Basic admin actions require at least WHITELISTED
      channelCreate: this.permissions.LEVELS.WHITELISTED,
      channelDelete: this.permissions.LEVELS.WHITELISTED,
      channelUpdate: this.permissions.LEVELS.WHITELISTED,
      roleCreate: this.permissions.LEVELS.WHITELISTED,
      roleDelete: this.permissions.LEVELS.WHITELISTED,
      roleUpdate: this.permissions.LEVELS.WHITELISTED,
      serverUpdate: this.permissions.LEVELS.WHITELISTED,
      
      // Webhook actions require ADMINISTRATOR or higher
      webhookCreate: this.permissions.LEVELS.ADMINISTRATOR,
      webhookDelete: this.permissions.LEVELS.ADMINISTRATOR,
      
      // Bot invites require ANTINUKE_ADMIN or higher
      botInvite: this.permissions.LEVELS.ANTINUKE_ADMIN,
      
      // Mass actions require higher permissions
      massBan: this.permissions.LEVELS.ADMINISTRATOR,
      massKick: this.permissions.LEVELS.ADMINISTRATOR
    };
    
    const requiredLevel = actionRequirements[action] || this.permissions.LEVELS.WHITELISTED;
    
    if (permLevel < requiredLevel) {
      let reason = 'Insufficient permissions.';
      
      if (permLevel === 0) {
        reason = 'You must be whitelisted to perform admin actions.';
      } else if (requiredLevel === this.permissions.LEVELS.ADMINISTRATOR) {
        reason = 'This action requires Administrator permissions.';
      } else if (requiredLevel === this.permissions.LEVELS.ANTINUKE_ADMIN) {
        reason = 'This action requires AntiNuke Admin permissions.';
      }
      
      return {
        allowed: false,
        level: permLevel,
        reason
      };
    }
    
    return {
      allowed: true,
      level: permLevel
    };
  }
  
  /**
   * Log unauthorized admin action attempt
   * @param {Guild} guild 
   * @param {User} user 
   * @param {string} action 
   * @param {string} details 
   */
  async logUnauthorizedAction(guild, user, action, details = '') {
    const member = await guild.members.fetch(user.id).catch(() => null);
    const permLevel = member ? this.getPermissionLevel(member) : 0;
    const levelName = this.permissions.getLevelName ? this.permissions.getLevelName(permLevel) : `Level ${permLevel}`;
    
    await this.logSecurity(guild, 'Unauthorized Action Attempt', 
      `User: ${user.tag} (${user.id})\n` +
      `Action: ${action}\n` +
      `Permission Level: ${permLevel} (${levelName})\n` +
      `Required: Whitelisted or higher\n` +
      (details ? `Details: ${details}` : '')
    );
    
    // Track as suspicious
    this.suspiciousUsers.add(user.id);
    
    // Update stats
    const attempts = this.stats.unauthorizedAttempts.get(user.id) || 0;
    this.stats.unauthorizedAttempts.set(user.id, attempts + 1);
  }
  
  /**
   * Get the current threshold for an action
   */
  getThreshold(action) {
    const baseLimit = this.config.limits[action];
    if (!baseLimit) return null;
    
    let maxActions = baseLimit.maxActions;
    
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
    
    if (this.suspiciousUsers.size >= autoConfig.triggers.suspiciousUsers) {
      this.setHighAlert(true);
      this.logSecurity(null, 'High Alert Auto-Enabled', `${this.suspiciousUsers.size} suspicious users detected`);
      return;
    }
    
    let recentActions = 0;
    const trackedActions = this.threatDetection.getAllTrackedActions();
    for (const [userId, actions] of trackedActions) {
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
    
    await this.protectionHandler.applyRaidMode(guild);
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
    
    await this.protectionHandler.removeRaidMode(guild);
  }
  
  /**
   * Log security events
   */
  async logSecurity(guild, action, details) {
    if (!this.embedLoader || !guild) return;
    
    const logKey = `${guild.id}-${action}`;
    const now = Date.now();
    const lastLog = this.logCooldowns.get(logKey);
    
    if (this.cooldownConfig.logCooldown && lastLog && (now - lastLog) < this.cooldownConfig.logCooldown) return;
    
    if (this.cooldownConfig.logCooldown) {
      this.logCooldowns.set(logKey, now);
    }
    
    await this.logging.logSecurityEvent(guild, action, details, {
      highAlert: this.highAlert,
      raidMode: this.raidMode.enabled
    });
  }
  
  /**
   * Log abuse events
   */
  async logAbuse(guild, type, user) {
    if (!this.embedLoader) return;
    
    const logKey = `${user.id}-${type}`;
    const now = Date.now();
    const lastLog = this.logCooldowns.get(logKey);
    
    if (this.cooldownConfig.logCooldown && lastLog && (now - lastLog) < this.cooldownConfig.logCooldown) return;
    
    if (this.cooldownConfig.logCooldown) {
      this.logCooldowns.set(logKey, now);
    }
    
    await this.logging.logAbuseEvent(guild, type, user);
  }
  
  /**
   * Log moderation action
   */
  async logAction(guild, actionData) {
    return await this.logging.logModerationAction(guild, actionData);
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Delegate to modules
    this.threatDetection.setupEventListeners();
    this.nicknames.setupEventListeners();
    this.linkProtection.setupEventListeners();
    this.filterSystem.setupEventListeners();
    
    // Message events
    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guild || message.author.bot) return;
      
      // NOTE: Whitelist checking is now handled individually by each module
      // - Spam detection: Bypassed for whitelisted/admin users
      // - Selfbot detection: NO bypasses (applies to everyone)
      // - Other content violations: Check whitelist individually
      
      // IMPORTANT: Spam detection handles ALL message-based spam/duplicate violations first
      // This includes rate spam, duplicate messages, and coordinated attacks
      // Spam detection will handle punishment THEN deletion in the correct order
      await this.spamDetection.checkMessage(message);
      
      // Check selfbot patterns (NO BYPASSES - applies to everyone including admins)
      await this.selfbotDetection.checkMessage(message);
      
      // Check OTHER content violations (NOT duplicates - those are handled by spam)
      // This includes mass mentions, mass emojis, caps spam
      if (message.member && !this.isMemberWhitelisted(message.member)) {
        await this.threatDetection.checkMessageContent(message);
      }
      
      // Check webhook spam
      if (message.webhookId) {
        await this.protectionHandler.checkWebhookSpam(message);
      }
    });
    
    // Message delete tracking
    this.client.on(Events.MessageDelete, async (message) => {
      if (!message.guild || !message.author || message.author.bot) return;
      
      this.selfbotDetection.trackDeletedMessage(message);
    });
    
    // Member join events
    this.client.on(Events.GuildMemberAdd, async (member) => {
      await this.protectionHandler.handleMemberJoin(member);
      await this.threatDetection.checkForRaid(member.guild);
    });
    
    // Webhook events
    this.client.on('webhooksUpdate', async (channel) => {
      await this.protectionHandler.handleWebhookUpdate(channel);
    });
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    
    // Delegate cleanup to modules
    this.spamDetection.cleanup();
    this.selfbotDetection.cleanup();
    this.threatDetection.cleanup();
    this.protectionHandler.cleanup();
    this.permissions.cleanup();
    this.cooldowns.cleanup();
    this.linkProtection.cleanup();
    this.filterSystem.cleanup();
    
    // Clean log cooldowns
    if (this.cooldownConfig.logCooldown) {
      for (const [key, timestamp] of this.logCooldowns) {
        if (now - timestamp > this.cooldownConfig.logCooldown * 2) {
          this.logCooldowns.delete(key);
        }
      }
    }
    
    // Clean warning cooldowns
    if (this.cooldownConfig.warningCooldown) {
      for (const [key, timestamp] of this.warningCooldowns) {
        if (now - timestamp > this.cooldownConfig.warningCooldown * 2) {
          this.warningCooldowns.delete(key);
        }
      }
    }
    
    // Clean unauthorized attempts older than 1 hour
    for (const [userId, attempts] of this.stats.unauthorizedAttempts) {
      if (attempts === 0) {
        this.stats.unauthorizedAttempts.delete(userId);
      }
    }
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      highAlert: this.highAlert,
      trackedUsers: this.threatDetection.getTrackedUserCount(),
      suspiciousUsers: this.suspiciousUsers.size,
      trackedActions: Object.fromEntries(this.stats.trackedActions),
      unauthorizedAttempts: Object.fromEntries(this.stats.unauthorizedAttempts),
      contentModeration: {
        enabled: this.config.contentModeration?.enabled || false,
        violations: this.stats.contentViolations,
        raidMode: this.raidMode
      },
      protection: {
        webhookAbuses: this.stats.contentViolations.webhookAbuse,
        unauthorizedBots: this.stats.contentViolations.unauthorizedBots,
        selfbotsDetected: this.stats.contentViolations.selfbotsDetected,
        messageSpam: this.stats.contentViolations.messageSpam
      },
      activeCooldowns: {
        logs: this.logCooldowns.size,
        warnings: this.warningCooldowns.size,
        commands: this.cooldowns.getActiveCooldowns()
      },
      selfbotDetection: this.selfbotDetection.getStats(),
      messageSpam: this.spamDetection.getStats(),
      permissions: this.permissions.getStats(),
      moderation: this.actions.getStats(),
      linkProtection: this.linkProtection.getStats(),
      filterSystem: this.filterSystem.getStats()
    };
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
  
  // === MODERATION SYSTEM INTERFACE ===
  // These methods provide the moderation interface for backwards compatibility
  
  /**
   * Check permission for command
   */
  checkPermission(member, commandName) {
    return this.actions.checkPermission(member, commandName);
  }
  
  /**
   * Check cooldown for a command
   */
  checkCooldown(userId, commandName) {
    return this.cooldowns.checkCooldown(userId, commandName);
  }
  
  /**
   * Apply cooldown multiplier
   */
  applyCooldownMultiplier(userId, commandName, multiplier) {
    return this.cooldowns.applyCooldownMultiplier(userId, commandName, multiplier);
  }
  
  /**
   * Get or create mute role
   */
  async getOrCreateMuteRole(guild) {
    return await this.roles.getOrCreateMuteRole(guild);
  }
  
  /**
   * Get mute roles map (for backwards compatibility)
   */
  get muteRoles() {
    return this.roles.muteRoles;
  }
  
  /**
   * Update permission roles in config
   * @param {Object} roles - Object with role IDs { vc: roleId, pic: roleId, link: roleId }
   */
  async updatePermRoles(roles) {
    return await this.actions.updatePermRoles(roles);
  }
  
  /**
   * Force nickname
   */
  async forceNickname(guildId, userId, nickname) {
    return await this.nicknames.forceNickname(guildId, userId, nickname);
  }
  
  /**
   * Remove forced nickname
   */
  async removeForcedNickname(guildId, userId) {
    return await this.nicknames.removeForcedNickname(guildId, userId);
  }
  
  /**
   * Get forced nickname
   */
  getForcedNickname(userId) {
    return this.nicknames.getForcedNickname(userId);
  }
  
  /**
   * Can manage member
   */
  canManageMember(executor, target) {
    return this.actions.canManageMember(executor, target);
  }
  
  /**
   * Can manage role
   */
  canManageRole(executor, role) {
    return this.actions.canManageRole(executor, role);
  }
  
  /**
   * Check if globally exempt
   */
  isGloballyExempt(member) {
    return this.actions.isGloballyExempt(member);
  }
  
  /**
   * Has bypass permissions
   */
  hasBypassPermissions(member) {
    return this.actions.hasBypassPermissions(member);
  }
  
  // === PERMISSION SYSTEM INTERFACE ===
  // These methods provide the permission interface for backwards compatibility
  
  /**
   * Can execute command
   */
  canExecuteCommand(member, commandName) {
    return this.permissions.canExecuteCommand(member, commandName);
  }
  
  /**
   * Add to whitelist
   */
  async addToWhitelist(userId) {
    return await this.whitelist.addUser(userId);
  }
  
  /**
   * Remove from whitelist
   */
  async removeFromWhitelist(userId) {
    return await this.whitelist.removeUser(userId);
  }
  
  /**
   * Add user to permission level
   */
  async addUserToLevel(userId, level) {
    return await this.permissions.addUserToLevel(userId, level);
  }
  
  /**
   * Remove user from permission level
   */
  async removeUserFromLevel(userId, level) {
    return await this.permissions.removeUserFromLevel(userId, level);
  }
  
  // === LINK PROTECTION INTERFACE ===
  // These methods provide the link protection interface
  
  /**
   * Check if link protection is enabled
   */
  isLinkProtectionEnabled() {
    return this.linkProtection.config.enabled;
  }
  
  /**
   * Add allowed user for links
   */
  async addLinkAllowedUser(userId) {
    return await this.linkProtection.addAllowedUser(userId);
  }
  
  /**
   * Remove allowed user for links
   */
  async removeLinkAllowedUser(userId) {
    return await this.linkProtection.removeAllowedUser(userId);
  }
  
  /**
   * Add allowed role for links
   */
  async addLinkAllowedRole(roleId) {
    return await this.linkProtection.addAllowedRole(roleId);
  }
  
  /**
   * Remove allowed role for links
   */
  async removeLinkAllowedRole(roleId) {
    return await this.linkProtection.removeAllowedRole(roleId);
  }
  
  /**
   * Add GIF service
   */
  async addGifService(domain) {
    return await this.linkProtection.addGifService(domain);
  }
  
  /**
   * Remove GIF service
   */
  async removeGifService(domain) {
    return await this.linkProtection.removeGifService(domain);
  }
  
  // === FILTER SYSTEM INTERFACE ===
  // These methods provide the filter system interface
  
  /**
   * Check if filter system is enabled
   */
  isFilterSystemEnabled() {
    return this.filterSystem.config.enabled;
  }
  
  /**
   * Add filtered word
   */
  addFilteredWord(word) {
    return this.filterSystem.addFilteredWord(word);
  }
  
  /**
   * Remove filtered word
   */
  removeFilteredWord(word) {
    return this.filterSystem.removeFilteredWord(word);
  }
  
  /**
   * Get filter statistics
   */
  getFilterStats() {
    return this.filterSystem.getStats();
  }
}