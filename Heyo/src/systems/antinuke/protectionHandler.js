// src/systems/antiNuke/protectionHandler.js - Protection handler module
import { AuditLogEvent } from 'discord.js';

export default class ProtectionHandler {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Webhook tracking
    this.webhookMessages = new Map(); // webhookId -> timestamp array
  }
  
  /**
   * Check webhook spam
   */
  async checkWebhookSpam(message) {
    if (!message.webhookId) return false;
    
    const webhookConfig = this.config.webhookProtection?.spamDetection;
    if (!webhookConfig?.enabled) return false;
    
    const now = Date.now();
    const webhookId = message.webhookId;
    
    if (!this.webhookMessages.has(webhookId)) {
      this.webhookMessages.set(webhookId, []);
    }
    
    const timestamps = this.webhookMessages.get(webhookId);
    timestamps.push(now);
    
    const timeWindow = webhookConfig.timeWindowSeconds ? webhookConfig.timeWindowSeconds * 1000 : null;
    if (!timeWindow) return false;
    
    const recentMessages = timestamps.filter(ts => now - ts < timeWindow);
    this.webhookMessages.set(webhookId, recentMessages);
    
    const maxMessages = webhookConfig.maxMessages;
    if (maxMessages && recentMessages.length >= maxMessages) {
      try {
        const webhooks = await message.channel.fetchWebhooks();
        const webhook = webhooks.get(webhookId);
        
        if (webhook) {
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
            console.error('[ProtectionHandler] Error fetching webhook creator:', error);
          }
          
          await webhook.delete('AntiNuke: Webhook spam detected');
          this.antiNuke.stats.contentViolations.webhookAbuse++;
          
          this.antiNuke.logSecurity(message.guild, 'Webhook Spam Detected', 
            `Webhook "${webhook.name}" deleted for spamming.\n` +
            `Creator: ${creatorId ? `<@${creatorId}>` : 'Unknown'}\n` +
            `Messages sent: ${recentMessages.length} in ${timeWindow/1000} seconds`);
          
          if (creatorId) {
            const member = await message.guild.members.fetch(creatorId).catch(() => null);
            if (member && member.moderatable) {
              const timeoutDuration = this.config.contentModeration?.timeoutDuration;
              if (timeoutDuration) {
                await member.timeout(timeoutDuration, 'AntiNuke: Created spamming webhook');
              }
            }
          }
          
          return true;
        }
      } catch (error) {
        console.error('[ProtectionHandler] Error handling webhook spam:', error);
      }
    }
    
    return false;
  }
  
  /**
   * Handle webhook update/creation
   */
  async handleWebhookUpdate(channel) {
    if (!channel.guild) return;
    
    try {
      const logs = await this.antiNuke.fetchAuditLogs(channel.guild, AuditLogEvent.WebhookCreate);
      if (!logs) return;
      
      const createLog = logs.entries.first();
      if (!createLog || Date.now() - createLog.createdTimestamp > 
          (this.config.webhookProtection?.logTimeWindow || 5000)) return;
      
      const { executor, target } = createLog;
      
      const member = await channel.guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;
      
      // Check permission level - webhooks require whitelisted or higher
      const permLevel = this.antiNuke.getPermissionLevel(member);
      
      if (permLevel < this.antiNuke.permissions.LEVELS.WHITELISTED) {
        // Not whitelisted - delete webhook immediately
        const webhooks = await channel.fetchWebhooks();
        const webhook = webhooks.find(w => w.id === target.id);
        
        if (webhook) {
          await webhook.delete('AntiNuke: Unauthorized webhook creation - not whitelisted');
          this.antiNuke.logSecurity(channel.guild, 'Unauthorized Webhook Blocked', 
            `${executor.tag} tried to create webhook "${webhook.name}" without whitelist permissions\n` +
            `Permission Level: ${permLevel} (Whitelisted required)`);
          
          if (member.moderatable) {
            const timeoutDuration = this.config.contentModeration?.timeoutDuration;
            if (timeoutDuration) {
              await member.timeout(timeoutDuration, 'AntiNuke: Unauthorized webhook creation');
            }
          }
        }
      } else if (!this.antiNuke.canCreateWebhooks(member)) {
        // Whitelisted but not admin+ - check specific webhook permissions
        const webhooks = await channel.fetchWebhooks();
        const webhook = webhooks.find(w => w.id === target.id);
        
        if (webhook) {
          await webhook.delete('AntiNuke: Unauthorized webhook creation - requires Administrator+');
          this.antiNuke.logSecurity(channel.guild, 'Unauthorized Webhook Blocked', 
            `${executor.tag} tried to create webhook "${webhook.name}" without Administrator+ permissions`);
          
          if (member.moderatable) {
            const timeoutDuration = this.config.contentModeration?.timeoutDuration;
            if (timeoutDuration) {
              await member.timeout(timeoutDuration, 'AntiNuke: Unauthorized webhook creation');
            }
          }
        }
      }
    } catch (error) {
      console.error('[ProtectionHandler] Error handling webhook creation:', error);
    }
  }
  
  /**
   * Handle member join (especially bot joins)
   */
  async handleMemberJoin(member) {
    if (member.user.bot) {
      try {
        const logs = await this.antiNuke.fetchAuditLogs(member.guild, AuditLogEvent.BotAdd);
        let inviter = null;
        
        if (logs) {
          const botAddLog = logs.entries.find(entry => 
            entry.target.id === member.id && 
            Date.now() - entry.createdTimestamp < (this.config.botProtection?.logTimeWindow || 10000)
          );
          
          if (botAddLog) {
            inviter = botAddLog.executor;
          }
        }
        
        let hasPermission = false;
        let permissionLevel = 0;
        
        if (inviter) {
          const inviterMember = await member.guild.members.fetch(inviter.id).catch(() => null);
          if (inviterMember) {
            permissionLevel = this.antiNuke.getPermissionLevel(inviterMember);
            hasPermission = this.antiNuke.canInviteBots(inviterMember);
          }
        }
        
        // Check whitelisted bots
        const whitelistedBots = this.config.botProtection?.whitelistedBots || [];
        if (whitelistedBots.includes(member.id)) {
          hasPermission = true;
        }
        
        if (!hasPermission) {
          // Determine the reason
          let reason = 'AntiNuke: Unauthorized bot';
          let details = '';
          
          if (permissionLevel < this.antiNuke.permissions.LEVELS.WHITELISTED) {
            reason += ' (requires whitelist)';
            details = 'User is not whitelisted. Only whitelisted users can invite bots.';
          } else {
            reason += ' (requires AntiNuke Admin+)';
            details = 'User is whitelisted but needs AntiNuke Admin permissions to invite bots.';
          }
          
          await member.ban({ reason });
          this.antiNuke.stats.contentViolations.unauthorizedBots++;
          
          this.antiNuke.logSecurity(member.guild, 'Unauthorized Bot Banned', 
            `Bot: ${member.user.tag} (${member.id})\n` +
            `Invited by: ${inviter ? `${inviter.tag} (${inviter.id})` : 'Unknown'}\n` +
            `Permission Level: ${permissionLevel}\n` +
            `Reason: ${details}`);
          
          if (inviter) {
            const inviterMember = await member.guild.members.fetch(inviter.id).catch(() => null);
            if (inviterMember && inviterMember.moderatable) {
              const inviterTimeout = this.config.botProtection?.inviterTimeout;
              if (inviterTimeout) {
                await inviterMember.timeout(inviterTimeout, 'AntiNuke: Invited unauthorized bot');
              }
            }
          }
        } else if (inviter) {
          this.antiNuke.logSecurity(member.guild, 'Bot Added', 
            `Bot: ${member.user.tag}\nAuthorized by: ${inviter.tag}\nPermission Level: ${permissionLevel}`);
        }
      } catch (error) {
        console.error('[ProtectionHandler] Error handling bot join:', error);
      }
    }
  }
  
  /**
   * Apply raid mode restrictions
   */
  async applyRaidMode(guild) {
    try {
      const restrictions = this.config.raidMode?.restrictions || [];
      
      if (restrictions.includes('disableInvites')) {
        const invites = await guild.invites.fetch();
        for (const invite of invites.values()) {
          await invite.delete('Raid mode: Disabling invites').catch(() => {});
        }
      }
      
      if (restrictions.includes('requireVerification')) {
        await guild.setVerificationLevel(4, 'Raid mode: Maximum verification');
      }
      
      if (restrictions.includes('slowMode')) {
        const slowModeRate = this.config.raidMode?.slowModeRate;
        if (slowModeRate) {
          const channels = guild.channels.cache.filter(ch => ch.isTextBased());
          for (const channel of channels.values()) {
            await channel.setRateLimitPerUser(slowModeRate, 'Raid mode: Slowmode enabled').catch(() => {});
          }
        }
      }
      
      const autoDisableTime = this.config.raidMode?.autoDisableAfter;
      if (autoDisableTime) {
        setTimeout(() => {
          if (this.antiNuke.raidMode.enabled) {
            this.antiNuke.disableRaidMode(guild);
          }
        }, autoDisableTime);
      }
    } catch (error) {
      console.error('[ProtectionHandler] Error applying raid mode:', error);
    }
  }
  
  /**
   * Remove raid mode restrictions
   */
  async removeRaidMode(guild) {
    try {
      const normalLevel = this.config.raidMode?.normalVerificationLevel;
      if (normalLevel !== undefined) {
        await guild.setVerificationLevel(normalLevel, 'Raid mode ended');
      }
      
      const channels = guild.channels.cache.filter(ch => ch.isTextBased());
      for (const channel of channels.values()) {
        if (channel.rateLimitPerUser > 0) {
          await channel.setRateLimitPerUser(0, 'Raid mode ended').catch(() => {});
        }
      }
    } catch (error) {
      console.error('[ProtectionHandler] Error disabling raid mode:', error);
    }
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const webhookMaxAge = this.config.webhookProtection?.trackingMaxAge;
    
    if (webhookMaxAge) {
      for (const [webhookId, timestamps] of this.webhookMessages) {
        const valid = timestamps.filter(ts => now - ts < webhookMaxAge);
        if (valid.length === 0) {
          this.webhookMessages.delete(webhookId);
        } else {
          this.webhookMessages.set(webhookId, valid);
        }
      }
    }
  }
}