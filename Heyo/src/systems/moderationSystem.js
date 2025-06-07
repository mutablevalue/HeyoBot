// src/systems/moderationSystem.js
import { PermissionFlagsBits } from 'discord.js';

export class ModerationSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load moderation config
    const modConfig = this.configLoader.get('moderation') || {};
    this.config = {
      // Permission levels
      permissions: {
        administrator: {
          users: modConfig.permissions?.administrator?.users || [],
          roles: modConfig.permissions?.administrator?.roles || [],
          commands: modConfig.permissions?.administrator?.commands || [
            'ban', 'unban', 'kick', 'timeout', 'role', 'nuke', 'setupperms'
          ]
        },
        moderator: {
          users: modConfig.permissions?.moderator?.users || [],
          roles: modConfig.permissions?.moderator?.roles || [],
          commands: modConfig.permissions?.moderator?.commands || [
            'lockchannel', 'unlockchannel', 'timeout'
          ]
        }
      },
      // Created permission roles
      permRoles: modConfig.permRoles || {
        vc: null,
        pic: null,
        link: null
      },
      // Logging
      logChannel: modConfig.logChannel || null,
      // Command cooldowns (in seconds)
      cooldowns: modConfig.cooldowns || {
        default: 3,
        nuke: 30,
        setupperms: 60
      }
    };

    // Cooldown tracking
    this.cooldowns = new Map();
  }

  /**
   * Save configuration back to disk
   */
  async saveConfig() {
    this.configLoader.set('moderation', {
      permissions: this.config.permissions,
      permRoles: this.config.permRoles,
      logChannel: this.config.logChannel,
      cooldowns: this.config.cooldowns
    });
    return this.configLoader.save();
  }

  /**
   * Check if a member has permission to use a specific command
   * @param {import("discord.js").GuildMember} member 
   * @param {string} commandName 
   * @returns {{allowed: boolean, level: string|null, reason: string}}
   */
  checkPermission(member, commandName) {
    // Server owner always has permission
    if (member.id === member.guild.ownerId) {
      return { allowed: true, level: 'owner', reason: 'Server owner' };
    }

    // Check Discord Administrator permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { allowed: true, level: 'discord_admin', reason: 'Discord Administrator permission' };
    }

    // Check administrator level
    if (this.hasPermissionLevel(member, 'administrator')) {
      if (this.config.permissions.administrator.commands.includes(commandName)) {
        return { allowed: true, level: 'administrator', reason: 'Administrator level access' };
      }
    }

    // Check moderator level
    if (this.hasPermissionLevel(member, 'moderator')) {
      if (this.config.permissions.moderator.commands.includes(commandName)) {
        return { allowed: true, level: 'moderator', reason: 'Moderator level access' };
      }
      // If moderator tries to use admin command
      if (this.config.permissions.administrator.commands.includes(commandName)) {
        return { 
          allowed: false, 
          level: 'moderator', 
          reason: 'This command requires administrator level access' 
        };
      }
    }

    return { allowed: false, level: null, reason: 'No permission to use moderation commands' };
  }

  /**
   * Check if member has a specific permission level
   * @param {import("discord.js").GuildMember} member 
   * @param {string} level - 'administrator' or 'moderator'
   * @returns {boolean}
   */
  hasPermissionLevel(member, level) {
    const perms = this.config.permissions[level];
    if (!perms) return false;

    // Check user whitelist
    if (perms.users.includes(member.id)) return true;

    // Check role whitelist
    return member.roles.cache.some(role => perms.roles.includes(role.id));
  }

  /**
   * Get all permission levels for a member
   * @param {import("discord.js").GuildMember} member 
   * @returns {string[]}
   */
  getMemberPermissionLevels(member) {
    const levels = [];

    if (member.id === member.guild.ownerId) {
      levels.push('owner');
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      levels.push('discord_admin');
    }

    if (this.hasPermissionLevel(member, 'administrator')) {
      levels.push('administrator');
    }

    if (this.hasPermissionLevel(member, 'moderator')) {
      levels.push('moderator');
    }

    return levels;
  }

  /**
   * Check command cooldown
   * @param {string} userId 
   * @param {string} commandName 
   * @returns {{onCooldown: boolean, timeLeft: number}}
   */
  checkCooldown(userId, commandName) {
    const cooldownTime = (this.config.cooldowns[commandName] || this.config.cooldowns.default) * 1000;
    const key = `${userId}-${commandName}`;
    const now = Date.now();

    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key) + cooldownTime;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return { onCooldown: true, timeLeft: Math.ceil(timeLeft) };
      }
    }

    this.cooldowns.set(key, now);
    // Clean up old cooldowns
    setTimeout(() => this.cooldowns.delete(key), cooldownTime);

    return { onCooldown: false, timeLeft: 0 };
  }

  /**
   * Log moderation action
   * @param {import("discord.js").Guild} guild 
   * @param {Object} data 
   */
  async logAction(guild, data) {
    if (!this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = {
      title: `Moderation Action: ${data.action}`,
      color: data.color || 0x0099ff,
      fields: [
        { name: 'Moderator', value: `${data.moderator.tag} (${data.moderator.id})`, inline: true },
        { name: 'Target', value: data.target || 'N/A', inline: true },
        { name: 'Reason', value: data.reason || 'No reason provided', inline: false }
      ],
      timestamp: new Date().toISOString()
    };

    if (data.additional) {
      embed.fields.push({ name: 'Additional Info', value: data.additional, inline: false });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[ModerationSystem] Failed to log action:', error);
    }
  }

  /**
   * Add a user to a permission level
   * @param {string} level - 'administrator' or 'moderator'
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async addUserToLevel(level, userId) {
    if (!this.config.permissions[level]) return false;

    if (!this.config.permissions[level].users.includes(userId)) {
      this.config.permissions[level].users.push(userId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a user from a permission level
   * @param {string} level 
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async removeUserFromLevel(level, userId) {
    if (!this.config.permissions[level]) return false;

    const index = this.config.permissions[level].users.indexOf(userId);
    if (index > -1) {
      this.config.permissions[level].users.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Add a role to a permission level
   * @param {string} level 
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async addRoleToLevel(level, roleId) {
    if (!this.config.permissions[level]) return false;

    if (!this.config.permissions[level].roles.includes(roleId)) {
      this.config.permissions[level].roles.push(roleId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a role from a permission level
   * @param {string} level 
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async removeRoleFromLevel(level, roleId) {
    if (!this.config.permissions[level]) return false;

    const index = this.config.permissions[level].roles.indexOf(roleId);
    if (index > -1) {
      this.config.permissions[level].roles.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Update permission roles (called by setupperms command)
   * @param {Object} roles 
   */
  async updatePermRoles(roles) {
    this.config.permRoles = roles;
    await this.saveConfig();
  }

  /**
   * Get statistics about moderation system
   */
  getStats() {
    return {
      administrators: {
        users: this.config.permissions.administrator.users.length,
        roles: this.config.permissions.administrator.roles.length,
        commands: this.config.permissions.administrator.commands.length
      },
      moderators: {
        users: this.config.permissions.moderator.users.length,
        roles: this.config.permissions.moderator.roles.length,
        commands: this.config.permissions.moderator.commands.length
      },
      permRoles: {
        configured: Object.values(this.config.permRoles).filter(id => id !== null).length,
        total: Object.keys(this.config.permRoles).length
      },
      activeCooldowns: this.cooldowns.size
    };
  }
}