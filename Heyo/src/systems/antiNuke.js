// src/systems/antiNuke.js - Main AntiNuke orchestrator
import { Events } from 'discord.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Import AntiNuke modules
import SpamDetection from './antinuke/spamDetection.js';
import SelfbotDetection from './antinuke/selfbotDetection.js';
import ThreatDetection from './antinuke/threatDetection.js';
import ProtectionHandler from './antinuke/protectionHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class AntiNuke {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('antiNuke');
    this.fullConfig = config;
    this.embedLoader = null;
    this.permissionSystem = null;
    
    // Initialize modules
    this.spamDetection = new SpamDetection(this);
    this.selfbotDetection = new SelfbotDetection(this);
    this.threatDetection = new ThreatDetection(this);
    this.protectionHandler = new ProtectionHandler(this);
    
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
      }
    };
    
    this.setupEventListeners();
    console.log('[AntiNuke] System initialized with modular architecture');
    
    // Setup cleanup interval
    if (this.cooldownConfig.cleanupInterval) {
      setInterval(() => this.cleanup(), this.cooldownConfig.cleanupInterval);
    }
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
   * Check if a user is whitelisted
   */
  isWhitelisted(userId) {
    const whitelist = this.config.whitelist || { users: [], roles: [] };
    return whitelist.users.includes(userId);
  }
  
  /**
   * Check if a member is whitelisted
   */
  isMemberWhitelisted(member) {
    if (!member) return false;
    
    if (this.isWhitelisted(member.id)) return true;
    
    if (member.roles && member.roles.cache) {
      const whitelist = this.config.whitelist || { users: [], roles: [] };
      return member.roles.cache.some(role => whitelist.roles.includes(role.id));
    }
    
    return false;
  }
  
  /**
   * Check if a user is an AntiNuke admin
   */
  isAntiNukeAdmin(userId) {
    if (!this.permissionSystem) return false;
    
    const mockMember = {
      id: userId,
      guild: { id: 'check' },
      roles: { cache: new Map() }
    };
    
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
   * Check if member can create webhooks
   */
  canCreateWebhooks(member) {
    if (!this.permissionSystem) return false;
    
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    return this.permissionSystem.getPermissionLevel(member) >= this.permissionSystem.LEVELS.ADMINISTRATOR;
  }
  
  /**
   * Check if member can invite bots
   */
  canInviteBots(member) {
    if (!this.permissionSystem) return false;
    
    if (this.fullConfig.get('moderation.ownerBypass') && member.id === member.guild.ownerId) {
      return true;
    }
    
    return this.permissionSystem.getPermissionLevel(member) >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
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
      if (error.code !== 50013) {
        console.error('[AntiNuke] Error logging security event:', error);
      }
    }
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
      if (error.code !== 50013) {
        console.error('[AntiNuke] Error logging abuse:', error);
      }
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Delegate to threat detection module
    this.threatDetection.setupEventListeners();
    
    // Message events
    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guild || message.author.bot) return;
      
      if (message.member && this.isMemberWhitelisted(message.member)) return;
      
      // Check spam
      await this.spamDetection.checkMessage(message);
      
      // Check selfbot patterns
      await this.selfbotDetection.checkMessage(message);
      
      // Check content violations
      await this.threatDetection.checkMessageContent(message);
      
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
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      highAlert: this.highAlert,
      trackedUsers: this.threatDetection.getTrackedUserCount(),
      suspiciousUsers: this.suspiciousUsers.size,
      trackedActions: Object.fromEntries(this.stats.trackedActions),
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
        warnings: this.warningCooldowns.size
      },
      selfbotDetection: this.selfbotDetection.getStats(),
      messageSpam: this.spamDetection.getStats()
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
}