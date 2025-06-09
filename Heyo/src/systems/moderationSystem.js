// src/systems/moderationSystem.js
import { PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ModerationSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get moderation config from config loader
    // Config loader should provide complete config with all values
    this.config = this.configLoader.get('moderation');
    
    // Validate required config exists
    if (!this.config) {
      throw new Error('[ModerationSystem] Moderation configuration not found in config.yaml');
    }
    
    // Validate config structure
    this.validateConfig();
    
    // Cooldown tracking
    this.cooldowns = new Map();
    
    // Forced nicknames tracking
    this.forcedNicknamesMap = new Map();
    this.forcedNicknamesPath = path.join(__dirname, '../../data', this.config.forcedNicknames.dataFile);
    this.loadForcedNicknames();
    
    // Mute role tracking for each guild
    this.muteRoles = new Map(); // guildId -> roleId
    
    // Set up event listeners for nickname changes
    this.setupNicknameMonitoring();
  }

  /**
   * Validate configuration structure
   */
  validateConfig() {
    const required = [
      'ownerBypass',
      'permissions',
      'permissions.administrator',
      'permissions.moderator',
      'permRoles',
      'cooldowns',
      'forcedNicknames'
    ];

    for (const path of required) {
      const value = path.split('.').reduce((obj, key) => obj?.[key], this.config);
      if (value === undefined) {
        throw new Error(`[ModerationSystem] Missing required config: moderation.${path}`);
      }
    }
  }

  /**
   * Load forced nicknames from file
   */
  loadForcedNicknames() {
    try {
      if (fs.existsSync(this.forcedNicknamesPath)) {
        const data = JSON.parse(fs.readFileSync(this.forcedNicknamesPath, 'utf8'));
        for (const [userId, value] of Object.entries(data)) {
          // Handle both old format (string) and new format (object)
          if (typeof value === 'string') {
            // Old format - convert to new format
            this.forcedNicknamesMap.set(userId, {
              nickname: value,
              guildId: null
            });
          } else {
            // New format
            this.forcedNicknamesMap.set(userId, value);
          }
        }
        console.log(`[ModerationSystem] Loaded ${this.forcedNicknamesMap.size} forced nicknames`);
      }
    } catch (error) {
      console.error('[ModerationSystem] Error loading forced nicknames:', error);
    }
  }

  /**
   * Save forced nicknames to file
   */
  saveForcedNicknames() {
    try {
      const data = Object.fromEntries(this.forcedNicknamesMap);
      const dir = path.dirname(this.forcedNicknamesPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.forcedNicknamesPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[ModerationSystem] Error saving forced nicknames:', error);
    }
  }

  /**
   * Set up nickname monitoring
   */
  setupNicknameMonitoring() {
    // Monitor member updates for nickname changes
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      const forcedData = this.forcedNicknamesMap.get(newMember.id);
      if (!forcedData) return;

      // Check if nickname was changed
      if (newMember.nickname !== forcedData.nickname) {
        try {
          await newMember.setNickname(forcedData.nickname, 'Forced nickname - user attempted to change');
          
          // Log the attempt
          await this.logAction(newMember.guild, {
            action: 'Forced Nickname Revert',
            moderator: this.client.user,
            target: `${newMember.user.tag} (${newMember.id})`,
            additional: `Attempted to change from "${forcedData.nickname}" to "${newMember.nickname}"`,
            color: 0xffa500
          });
        } catch (error) {
          console.error('[ModerationSystem] Failed to revert nickname:', error);
        }
      }
    });

    // Periodic check to ensure nicknames haven't been changed
    setInterval(() => {
      this.checkForcedNicknames();
    }, this.config.forcedNicknames.checkInterval);
  }

  /**
   * Check all forced nicknames
   */
  async checkForcedNicknames() {
    for (const [userId, forcedData] of this.forcedNicknamesMap) {
      for (const guild of this.client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member && member.nickname !== forcedData.nickname) {
            await member.setNickname(forcedData.nickname, 'Periodic forced nickname check');
          }
        } catch (error) {
          // Member might not be in this guild
        }
      }
    }
  }

  /**
   * Get or create the forced nickname role
   * @param {import("discord.js").Guild} guild 
   * @returns {Promise<import("discord.js").Role|null>}
   */
  async getOrCreateForcedNicknameRole(guild) {
    // First check if role ID is configured and exists
    if (this.config.forcedNicknames.roleId) {
      const existingRole = guild.roles.cache.get(this.config.forcedNicknames.roleId);
      if (existingRole) {
        return existingRole;
      }
    }

    // Create new role
    try {
      const role = await guild.roles.create({
        name: 'Forced Nickname',
        color: 0x808080,
        permissions: [],
        reason: 'Role for users with forced nicknames'
      });

      // Update config with new role ID
      this.config.forcedNicknames.roleId = role.id;
      await this.saveConfig();

      return role;
    } catch (error) {
      console.error('[ModerationSystem] Error creating forced nickname role:', error);
      return null;
    }
  }

  /**
   * Get or create mute role for a guild
   * @param {import("discord.js").Guild} guild
   * @returns {Promise<import("discord.js").Role>}
   */
  async getOrCreateMuteRole(guild) {
    // Check if we have a cached mute role for this guild
    let muteRoleId = this.muteRoles.get(guild.id);
    
    // If not cached, check if configured role exists
    if (!muteRoleId && this.config.permMuteRole?.roleId) {
      const configuredRole = guild.roles.cache.get(this.config.permMuteRole.roleId);
      if (configuredRole) {
        this.muteRoles.set(guild.id, configuredRole.id);
        return configuredRole;
      }
    }
    
    // Check if cached role still exists
    if (muteRoleId) {
      const existingRole = guild.roles.cache.get(muteRoleId);
      if (existingRole) return existingRole;
    }
    
    // Create new mute role
    try {
      const muteRole = await guild.roles.create({
        name: this.config.permMuteRole?.defaultName || 'Muted',
        color: this.config.permMuteRole?.defaultColor || 0x808080,
        permissions: [],
        reason: 'Mute role for moderation'
      });
      
      // Set up channel overwrites
      for (const channel of guild.channels.cache.values()) {
        if (channel.isTextBased() || channel.isVoiceBased()) {
          try {
            await channel.permissionOverwrites.create(muteRole, {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              AddReactions: false,
              Speak: false,
              Stream: false,
              UseVAD: false
            });
          } catch (error) {
            console.error(`[ModerationSystem] Failed to set mute permissions for channel ${channel.name}:`, error);
          }
        }
      }
      
      // Cache the role
      this.muteRoles.set(guild.id, muteRole.id);
      
      return muteRole;
    } catch (error) {
      console.error('[ModerationSystem] Error creating mute role:', error);
      throw error;
    }
  }

  /**
   * Force a nickname on a user
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} nickname 
   * @returns {Promise<boolean>}
   */
  async forceNickname(guildId, userId, nickname) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;

      const member = await guild.members.fetch(userId);
      if (!member) return false;

      // Set the nickname
      await member.setNickname(nickname, 'Forced nickname by moderator');
      
      // Get or create the forced nickname role
      const forcedNicknameRole = await this.getOrCreateForcedNicknameRole(guild);
      
      if (forcedNicknameRole) {
        // Add the role to the member
        await member.roles.add(forcedNicknameRole, 'Forced nickname applied');
      }
      
      // Save to forced nicknames
      this.forcedNicknamesMap.set(userId, {
        nickname: nickname,
        guildId: guildId
      });
      this.saveForcedNicknames();

      return true;
    } catch (error) {
      console.error('[ModerationSystem] Error forcing nickname:', error);
      return false;
    }
  }

  /**
   * Remove forced nickname from a user
   * @param {string} guildId 
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async removeForcedNickname(guildId, userId) {
    try {
      const forcedData = this.forcedNicknamesMap.get(userId);
      if (!forcedData) return false;

      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          // Remove the forced nickname role if configured
          if (this.config.forcedNicknames.roleId) {
            const forcedNicknameRole = guild.roles.cache.get(this.config.forcedNicknames.roleId);
            if (forcedNicknameRole && member.roles.cache.has(forcedNicknameRole.id)) {
              await member.roles.remove(forcedNicknameRole, 'Forced nickname removed by moderator');
            }
          }
          
          // Reset their nickname
          await member.setNickname(null, 'Forced nickname removed by moderator');
        }
      }

      this.forcedNicknamesMap.delete(userId);
      this.saveForcedNicknames();

      return true;
    } catch (error) {
      console.error('[ModerationSystem] Error removing forced nickname:', error);
      return false;
    }
  }

  /**
   * Get forced nickname for a user
   * @param {string} userId 
   * @returns {string|null}
   */
  getForcedNickname(userId) {
    const data = this.forcedNicknamesMap.get(userId);
    return data ? data.nickname : null;
  }

  /**
   * Save configuration back to disk
   */
  async saveConfig() {
    this.configLoader.set('moderation', this.config);
    return this.configLoader.save();
  }

  /**
   * Check if a member has permission to use a specific command
   * @param {import("discord.js").GuildMember} member 
   * @param {string} commandName 
   * @returns {{allowed: boolean, level: string|null, reason: string}}
   */
  checkPermission(member, commandName) {
    // Server owner always has permission if ownerBypass is enabled
    if (this.config.ownerBypass && member.id === member.guild.ownerId) {
      return { allowed: true, level: 'owner', reason: 'Server owner (bypass enabled)' };
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
      activeCooldowns: this.cooldowns.size,
      forcedNicknames: this.forcedNicknamesMap.size,
      forcedNicknameRoleId: this.config.forcedNicknames.roleId
    };
  }
}