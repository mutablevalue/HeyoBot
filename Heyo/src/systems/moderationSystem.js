// src/systems/moderationSystem.js
import { PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ModerationSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    this.config = this.configLoader.get('moderation');
    if (!this.config) {
      throw new Error('[ModerationSystem] Moderation configuration not found in config.yaml');
    }
    
    this.validateConfig();
    
    // Cooldown tracking
    this.cooldowns = new Map();
    
    // Forced nicknames tracking
    this.forcedNicknamesMap = new Map();
    this.forcedNicknamesPath = path.join(__dirname, '../../data', this.config.forcedNicknames.dataFile);
    this.loadForcedNicknames();
    
    // Mute role tracking for each guild
    this.muteRoles = new Map();
    
    // Reference to AntiNuke system (will be set by index.js)
    this.antiNuke = null;
    
    this.setupNicknameMonitoring();
  }

  /**
   * Set AntiNuke reference for hierarchy checking
   */
  setAntiNuke(antiNuke) {
    this.antiNuke = antiNuke;
  }

  /**
   * CENTRALIZED PERMISSION CHECK - All systems should use this
   * Checks hierarchy: AntiNuke Admin -> Owner Bypass -> Discord Admin -> System Permissions
   * @param {import("discord.js").GuildMember} member 
   * @param {string} action - The action being performed
   * @param {Object} options - Additional options
   * @returns {{allowed: boolean, reason: string, level: string}}
   */
  checkGlobalPermission(member, action, options = {}) {
    // 1. Check AntiNuke admin status (highest priority)
    if (this.antiNuke) {
      const antiNukeConfig = this.antiNuke.config;
      if (antiNukeConfig.adminUsers?.includes(member.id)) {
        return { allowed: true, reason: 'AntiNuke Admin', level: 'antinuke_admin' };
      }
      if (member.roles.cache.some(role => antiNukeConfig.adminRoles?.includes(role.id))) {
        return { allowed: true, reason: 'AntiNuke Admin Role', level: 'antinuke_admin' };
      }
    }
    
    // 2. Server owner bypass (if enabled)
    if (this.config.ownerBypass && member.id === member.guild.ownerId) {
      return { allowed: true, reason: 'Server Owner (bypass enabled)', level: 'owner' };
    }
    
    // 3. Discord Administrator permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { allowed: true, reason: 'Discord Administrator', level: 'discord_admin' };
    }
    
    // 4. Check system-specific permissions if provided
    if (options.requireModeration) {
      const modCheck = this.checkPermission(member, options.command || action);
      if (modCheck.allowed) {
        return { 
          allowed: true, 
          reason: modCheck.reason, 
          level: modCheck.level 
        };
      }
    }
    
    // 5. Check custom permission callback if provided
    if (options.customCheck && typeof options.customCheck === 'function') {
      const customResult = options.customCheck(member);
      if (customResult) {
        return { 
          allowed: true, 
          reason: options.customReason || 'Custom permission', 
          level: 'custom' 
        };
      }
    }
    
    return { 
      allowed: false, 
      reason: 'No permission', 
      level: null 
    };
  }

  /**
   * Check if user is exempt from all restrictions
   * Used by filter systems, link protection, etc.
   */
  isGloballyExempt(member) {
    const check = this.checkGlobalPermission(member, 'exempt', {});
    return check.allowed;
  }

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

  loadForcedNicknames() {
    try {
      if (fs.existsSync(this.forcedNicknamesPath)) {
        const data = JSON.parse(fs.readFileSync(this.forcedNicknamesPath, 'utf8'));
        for (const [userId, value] of Object.entries(data)) {
          if (typeof value === 'string') {
            this.forcedNicknamesMap.set(userId, {
              nickname: value,
              guildId: null
            });
          } else {
            this.forcedNicknamesMap.set(userId, value);
          }
        }
        console.log(`[ModerationSystem] Loaded ${this.forcedNicknamesMap.size} forced nicknames`);
      }
    } catch (error) {
      console.error('[ModerationSystem] Error loading forced nicknames:', error);
    }
  }

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

  setupNicknameMonitoring() {
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      const forcedData = this.forcedNicknamesMap.get(newMember.id);
      if (!forcedData) return;

      if (newMember.nickname !== forcedData.nickname) {
        try {
          await newMember.setNickname(forcedData.nickname, 'Forced nickname - user attempted to change');
          
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

    setInterval(() => {
      this.checkForcedNicknames();
    }, this.config.forcedNicknames.checkInterval);
  }

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

  async getOrCreateForcedNicknameRole(guild) {
    if (this.config.forcedNicknames.roleId) {
      const existingRole = guild.roles.cache.get(this.config.forcedNicknames.roleId);
      if (existingRole) {
        return existingRole;
      }
    }

    try {
      const role = await guild.roles.create({
        name: 'Forced Nickname',
        color: 0x808080,
        permissions: [],
        reason: 'Role for users with forced nicknames'
      });

      this.config.forcedNicknames.roleId = role.id;
      await this.saveConfig();

      return role;
    } catch (error) {
      console.error('[ModerationSystem] Error creating forced nickname role:', error);
      return null;
    }
  }

  async getOrCreateMuteRole(guild) {
    let muteRoleId = this.muteRoles.get(guild.id);
    
    if (!muteRoleId && this.config.permMuteRole?.roleId) {
      const configuredRole = guild.roles.cache.get(this.config.permMuteRole.roleId);
      if (configuredRole) {
        this.muteRoles.set(guild.id, configuredRole.id);
        return configuredRole;
      }
    }
    
    if (muteRoleId) {
      const existingRole = guild.roles.cache.get(muteRoleId);
      if (existingRole) return existingRole;
    }
    
    try {
      const muteRole = await guild.roles.create({
        name: this.config.permMuteRole?.defaultName || 'Muted',
        color: this.config.permMuteRole?.defaultColor || 0x808080,
        permissions: [],
        reason: 'Mute role for moderation'
      });
      
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
      
      this.muteRoles.set(guild.id, muteRole.id);
      
      return muteRole;
    } catch (error) {
      console.error('[ModerationSystem] Error creating mute role:', error);
      throw error;
    }
  }

  async forceNickname(guildId, userId, nickname) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;

      const member = await guild.members.fetch(userId);
      if (!member) return false;

      await member.setNickname(nickname, 'Forced nickname by moderator');
      
      const forcedNicknameRole = await this.getOrCreateForcedNicknameRole(guild);
      
      if (forcedNicknameRole) {
        await member.roles.add(forcedNicknameRole, 'Forced nickname applied');
      }
      
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

  async removeForcedNickname(guildId, userId) {
    try {
      const forcedData = this.forcedNicknamesMap.get(userId);
      if (!forcedData) return false;

      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          if (this.config.forcedNicknames.roleId) {
            const forcedNicknameRole = guild.roles.cache.get(this.config.forcedNicknames.roleId);
            if (forcedNicknameRole && member.roles.cache.has(forcedNicknameRole.id)) {
              await member.roles.remove(forcedNicknameRole, 'Forced nickname removed by moderator');
            }
          }
          
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

  getForcedNickname(userId) {
    const data = this.forcedNicknamesMap.get(userId);
    return data ? data.nickname : null;
  }

  async saveConfig() {
    this.configLoader.set('moderation', this.config);
    return this.configLoader.save();
  }

  checkPermission(member, commandName) {
    if (this.config.ownerBypass && member.id === member.guild.ownerId) {
      return { allowed: true, level: 'owner', reason: 'Server owner (bypass enabled)' };
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { allowed: true, level: 'discord_admin', reason: 'Discord Administrator permission' };
    }

    if (this.hasPermissionLevel(member, 'administrator')) {
      if (this.config.permissions.administrator.commands.includes(commandName)) {
        return { allowed: true, level: 'administrator', reason: 'Administrator level access' };
      }
    }

    if (this.hasPermissionLevel(member, 'moderator')) {
      if (this.config.permissions.moderator.commands.includes(commandName)) {
        return { allowed: true, level: 'moderator', reason: 'Moderator level access' };
      }
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

  hasPermissionLevel(member, level) {
    const perms = this.config.permissions[level];
    if (!perms) return false;

    if (perms.users.includes(member.id)) return true;

    return member.roles.cache.some(role => perms.roles.includes(role.id));
  }

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
    setTimeout(() => this.cooldowns.delete(key), cooldownTime);

    return { onCooldown: false, timeLeft: 0 };
  }

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

  async addUserToLevel(level, userId) {
    if (!this.config.permissions[level]) return false;

    if (!this.config.permissions[level].users.includes(userId)) {
      this.config.permissions[level].users.push(userId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

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

  async addRoleToLevel(level, roleId) {
    if (!this.config.permissions[level]) return false;

    if (!this.config.permissions[level].roles.includes(roleId)) {
      this.config.permissions[level].roles.push(roleId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

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

  async updatePermRoles(roles) {
    this.config.permRoles = roles;
    await this.saveConfig();
  }

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