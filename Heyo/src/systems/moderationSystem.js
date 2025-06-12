// src/systems/moderationSystem.js
import { Events, PermissionFlagsBits, Collection } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ModerationSystem {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('moderation');
    this.fullConfig = config;
    this.embedLoader = null;
    this.antiNuke = null;
    this.permissionSystem = null; // Will be set by main
    
    // Tracking
    this.cooldowns = new Map();
    this.forcedNicknames = new Map();
    this.muteRoles = new Map();
    
    this.setupEventListeners();
    this.loadForcedNicknames();
    
    console.log('[ModerationSystem] Initialized with unified permissions');
  }
  
  setAntiNuke(antiNuke) {
    this.antiNuke = antiNuke;
  }
  
  setEmbedLoader(loader) {
    this.embedLoader = loader;
  }
  
  setPermissionSystem(system) {
    this.permissionSystem = system;
  }
  
  /**
   * Check if member has hierarchy bypass permissions
   * @param {GuildMember} member 
   * @returns {boolean}
   */
  hasBypassPermissions(member) {
    // Check owner bypass
    const isOwnerWithBypass = this.config.ownerBypass && member.id === member.guild.ownerId;
    
    // Check if permission system is available
    if (!this.permissionSystem) {
      console.warn('[ModerationSystem] Permission system not initialized - cannot check AntiNuke admin status');
      return isOwnerWithBypass;
    }
    
    // Check AntiNuke admin via permission system
    const permissionLevel = this.permissionSystem.getPermissionLevel(member);
    const isAntiNukeAdmin = permissionLevel >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
    
    return isOwnerWithBypass || isAntiNukeAdmin;
  }
  
  /**
   * Check if member is globally exempt from restrictions (for filter system)
   * @param {GuildMember} member 
   * @returns {boolean}
   */
  isGloballyExempt(member) {
    if (!member) return false;
    
    // Owner with bypass is always exempt
    if (this.config.ownerBypass && member.id === member.guild.ownerId) {
      return true;
    }
    
    // Check if permission system is available
    if (!this.permissionSystem) {
      // Fallback: check if user has Administrator permission
      return member.permissions.has(PermissionFlagsBits.Administrator);
    }
    
    // AntiNuke admins and higher are exempt
    const permissionLevel = this.permissionSystem.getPermissionLevel(member);
    return permissionLevel >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN;
  }
  
  /**
   * Check if member can manage a role (for role commands)
   * @param {GuildMember} executor 
   * @param {Role} role 
   * @returns {{allowed: boolean, reason?: string}}
   */
  canManageRole(executor, role) {
    // Get bot member
    const botMember = executor.guild.members.me;
    
    // Check if bot can manage this role first
    if (role.position >= botMember.roles.highest.position) {
      return { 
        allowed: false, 
        reason: 'I cannot manage this role. It\'s higher than my highest role.'
      };
    }
    
    // Owners with bypass and AntiNuke admins can manage any role below the bot
    if (this.hasBypassPermissions(executor)) {
      return { allowed: true };
    }
    
    // For everyone else, check role hierarchy
    if (role.position >= executor.roles.highest.position) {
      return { 
        allowed: false, 
        reason: 'You need AntiNuke admin permissions or owner bypass to manage roles above your highest role.'
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check if a member can manage another member (for moderation actions)
   * @param {GuildMember} executor 
   * @param {GuildMember} target 
   * @returns {{allowed: boolean, reason?: string}}
   */
  canManageMember(executor, target) {
    // Check if bot can manage target first
    if (!target.bannable && !target.kickable && !target.moderatable) {
      return { 
        allowed: false, 
        reason: 'I cannot manage this user. They may have higher permissions than me.'
      };
    }
    
    // Bypass hierarchy check for owners with bypass and AntiNuke admins
    if (this.hasBypassPermissions(executor)) {
      return { allowed: true };
    }
    
    // For everyone else, check role hierarchy
    if (target.roles.highest.position >= executor.roles.highest.position) {
      return { 
        allowed: false, 
        reason: 'You need AntiNuke admin permissions or owner bypass to manage users with equal or higher roles.'
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check permission for command using unified system
   */
  checkPermission(member, commandName) {
    if (!this.permissionSystem) {
      // Fallback to legacy if permission system not available
      return this.legacyCheckPermission(member, commandName);
    }
    
    return this.permissionSystem.canExecuteCommand(member, commandName);
  }
  
  /**
   * Legacy permission check (fallback)
   */
  legacyCheckPermission(member, commandName) {
    // Check if owner with bypass
    if (this.config.ownerBypass && member.id === member.guild.ownerId) {
      return { allowed: true };
    }
    
    // Check administrator permissions
    const adminUsers = this.config.permissions.administrator.users;
    const adminRoles = this.config.permissions.administrator.roles;
    const adminCommands = this.config.permissions.administrator.commands;
    
    if ((adminUsers.includes(member.id) || 
         member.roles.cache.some(role => adminRoles.includes(role.id))) &&
        adminCommands.includes(commandName)) {
      return { allowed: true };
    }
    
    // Check moderator permissions
    const modUsers = this.config.permissions.moderator.users;
    const modRoles = this.config.permissions.moderator.roles;
    const modCommands = this.config.permissions.moderator.commands;
    
    if ((modUsers.includes(member.id) || 
         member.roles.cache.some(role => modRoles.includes(role.id))) &&
        modCommands.includes(commandName)) {
      return { allowed: true };
    }
    
    // Check Discord permissions
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { allowed: true };
    }
    
    return { 
      allowed: false, 
      reason: 'You do not have permission to use this command.' 
    };
  }
  
  /**
   * Check cooldown for a command
   * @param {string} userId 
   * @param {string} commandName 
   * @returns {{onCooldown: boolean, timeLeft?: number}}
   */
  checkCooldown(userId, commandName) {
    const cooldownTime = (this.config.cooldowns[commandName] || this.config.cooldowns.default || 3) * 1000;
    const key = `${userId}-${commandName}`;
    
    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key);
      const now = Date.now();
      
      if (now < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - now) / 1000);
        return { onCooldown: true, timeLeft };
      }
    }
    
    // Set cooldown
    this.cooldowns.set(key, Date.now() + cooldownTime);
    
    // Clean up old cooldowns periodically
    if (this.cooldowns.size > 1000) {
      this.cleanupCooldowns();
    }
    
    return { onCooldown: false };
  }
  
  /**
   * Apply cooldown multiplier for multi-user commands
   */
  applyCooldownMultiplier(userId, commandName, multiplier) {
    const baseCooldown = (this.config.cooldowns[commandName] || this.config.cooldowns.default || 3) * 1000;
    const cooldownTime = baseCooldown * multiplier;
    const key = `${userId}-${commandName}`;
    
    this.cooldowns.set(key, Date.now() + cooldownTime);
  }
  
  /**
   * Clean up expired cooldowns
   */
  cleanupCooldowns() {
    const now = Date.now();
    for (const [key, expirationTime] of this.cooldowns) {
      if (now >= expirationTime) {
        this.cooldowns.delete(key);
      }
    }
  }
  
  /**
   * Get or create mute role for a guild
   * @param {Guild} guild 
   * @returns {Role}
   */
  async getOrCreateMuteRole(guild) {
    // Check cache first
    if (this.muteRoles.has(guild.id)) {
      const roleId = this.muteRoles.get(guild.id);
      const role = guild.roles.cache.get(roleId);
      if (role) return role;
    }
    
    // Check config
    const configRoleId = this.config.permMuteRole?.roleId;
    if (configRoleId) {
      const role = guild.roles.cache.get(configRoleId);
      if (role) {
        this.muteRoles.set(guild.id, role.id);
        return role;
      }
    }
    
    // Look for existing mute role
    let muteRole = guild.roles.cache.find(role => 
      role.name.toLowerCase() === 'muted' || 
      role.name.toLowerCase() === this.config.permMuteRole.defaultName.toLowerCase()
    );
    
    // Create if doesn't exist
    if (!muteRole) {
      try {
        muteRole = await guild.roles.create({
          name: this.config.permMuteRole.defaultName || 'Muted',
          color: this.config.permMuteRole.defaultColor || 0x808080,
          permissions: [],
          reason: 'Auto-created mute role'
        });
        
        // Setup channel overwrites
        for (const channel of guild.channels.cache.values()) {
          if (channel.isTextBased() || channel.isVoiceBased()) {
            await channel.permissionOverwrites.create(muteRole, {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              AddReactions: false,
              Speak: false,
              Stream: false
            }).catch(() => {});
          }
        }
      } catch (error) {
        console.error('[ModerationSystem] Error creating mute role:', error);
        throw error;
      }
    }
    
    this.muteRoles.set(guild.id, muteRole.id);
    return muteRole;
  }
  
  /**
   * Force a nickname on a user
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} nickname 
   */
  async forceNickname(guildId, userId, nickname) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;
      
      const member = await guild.members.fetch(userId);
      if (!member) return false;
      
      // Set the nickname
      await member.setNickname(nickname, 'Forced nickname by moderation');
      
      // Track it
      this.forcedNicknames.set(userId, {
        nickname,
        guildId,
        timestamp: Date.now()
      });
      
      await this.saveForcedNicknames();
      return true;
    } catch (error) {
      console.error('[ModerationSystem] Error forcing nickname:', error);
      return false;
    }
  }
  
  /**
   * Remove forced nickname
   * @param {string} guildId 
   * @param {string} userId 
   */
  async removeForcedNickname(guildId, userId) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;
      
      const member = await guild.members.fetch(userId);
      if (!member) return false;
      
      // Remove nickname
      await member.setNickname(null, 'Removed forced nickname');
      
      // Remove from tracking
      this.forcedNicknames.delete(userId);
      
      await this.saveForcedNicknames();
      return true;
    } catch (error) {
      console.error('[ModerationSystem] Error removing forced nickname:', error);
      return false;
    }
  }
  
  /**
   * Get forced nickname for a user
   * @param {string} userId 
   */
  getForcedNickname(userId) {
    const data = this.forcedNicknames.get(userId);
    return data ? data.nickname : null;
  }
  
  /**
   * Load forced nicknames from file
   */
  async loadForcedNicknames() {
    try {
      const dataFile = this.config.forcedNicknames?.dataFile;
      if (!dataFile) return;
      
      const filePath = path.join(__dirname, '../../data', dataFile);
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.forcedNicknames = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[ModerationSystem] Error loading forced nicknames:', error);
      }
    }
  }
  
  /**
   * Save forced nicknames to file
   */
  async saveForcedNicknames() {
    try {
      const dataFile = this.config.forcedNicknames?.dataFile;
      if (!dataFile) return;
      
      const dirPath = path.join(__dirname, '../../data');
      await fs.mkdir(dirPath, { recursive: true });
      
      const filePath = path.join(dirPath, dataFile);
      const data = Object.fromEntries(this.forcedNicknames);
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[ModerationSystem] Error saving forced nicknames:', error);
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Monitor nickname changes for forced nicknames
    if (this.config.forcedNicknames?.checkInterval) {
      setInterval(() => {
        this.checkForcedNicknames();
      }, this.config.forcedNicknames.checkInterval);
    }
    
    // Monitor member updates
    this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
      // Check if nickname was changed
      if (oldMember.nickname !== newMember.nickname) {
        const forcedData = this.forcedNicknames.get(newMember.id);
        if (forcedData && forcedData.guildId === newMember.guild.id) {
          // Check if the new nickname is different from forced
          if (newMember.nickname !== forcedData.nickname) {
            // Restore forced nickname
            await newMember.setNickname(forcedData.nickname, 'Restoring forced nickname');
          }
        }
      }
    });
    
    // Clean up when members leave
    this.client.on(Events.GuildMemberRemove, async (member) => {
      if (this.forcedNicknames.has(member.id)) {
        this.forcedNicknames.delete(member.id);
        await this.saveForcedNicknames();
      }
    });
  }
  
  /**
   * Check and restore forced nicknames
   */
  async checkForcedNicknames() {
    for (const [userId, data] of this.forcedNicknames) {
      try {
        const guild = this.client.guilds.cache.get(data.guildId);
        if (!guild) continue;
        
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          // Member not in guild, remove from tracking
          this.forcedNicknames.delete(userId);
          continue;
        }
        
        if (member.nickname !== data.nickname) {
          await member.setNickname(data.nickname, 'Restoring forced nickname');
        }
      } catch (error) {
        console.error(`[ModerationSystem] Error checking forced nickname for ${userId}:`, error);
      }
    }
  }
  
  /**
   * Log moderation action
   * @param {Guild} guild 
   * @param {Object} actionData 
   */
  async logAction(guild, actionData) {
    if (!this.embedLoader || !this.config.logChannel) return;
    
    const logChannel = guild.channels.cache.get(this.config.logChannel);
    if (!logChannel) return;
    
    const fields = [
      { name: 'Action', value: actionData.action, inline: true },
      { name: 'Moderator', value: `${actionData.moderator}`, inline: true },
      { name: 'Target', value: actionData.target, inline: true }
    ];
    
    if (actionData.reason) {
      fields.push({ name: 'Reason', value: actionData.reason, inline: false });
    }
    
    if (actionData.additional) {
      fields.push({ name: 'Details', value: actionData.additional, inline: false });
    }
    
    const embed = this.embedLoader.createEmbed({
      title: 'Moderation Log',
      formatDescription: false,
      fields,
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[ModerationSystem] Error logging action:', error);
    }
  }
  
  /**
   * Update permission roles in config
   * @param {Object} roles 
   */
  async updatePermRoles(roles) {
    Object.assign(this.config.permRoles, roles);
    await this.saveConfig();
  }
  
  /**
   * Add user to permission level using unified system
   */
  async addUserToLevel(level, userId) {
    if (!this.permissionSystem) {
      // Fallback to direct config modification
      const permissions = this.config.permissions;
      if (!permissions[level]) return false;
      
      if (!permissions[level].users.includes(userId)) {
        permissions[level].users.push(userId);
        await this.saveConfig();
        return true;
      }
      return false;
    }
    
    return await this.permissionSystem.addUserToLevel(userId, level);
  }
  
  /**
   * Remove user from permission level using unified system
   */
  async removeUserFromLevel(level, userId) {
    if (!this.permissionSystem) {
      // Fallback to direct config modification
      const permissions = this.config.permissions;
      if (!permissions[level]) return false;
      
      const index = permissions[level].users.indexOf(userId);
      if (index > -1) {
        permissions[level].users.splice(index, 1);
        await this.saveConfig();
        return true;
      }
      return false;
    }
    
    return await this.permissionSystem.removeUserFromLevel(userId, level);
  }
  
  /**
   * Add role to permission level
   */
  async addRoleToLevel(level, roleId) {
    const permissions = this.config.permissions;
    if (!permissions[level]) return false;
    
    if (!permissions[level].roles.includes(roleId)) {
      permissions[level].roles.push(roleId);
      await this.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * Remove role from permission level
   */
  async removeRoleFromLevel(level, roleId) {
    const permissions = this.config.permissions;
    if (!permissions[level]) return false;
    
    const index = permissions[level].roles.indexOf(roleId);
    if (index > -1) {
      permissions[level].roles.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const permissions = this.config.permissions;
    
    return {
      administrators: {
        users: permissions.administrator.users.length,
        roles: permissions.administrator.roles.length,
        commands: permissions.administrator.commands.length
      },
      moderators: {
        users: permissions.moderator.users.length,
        roles: permissions.moderator.roles.length,
        commands: permissions.moderator.commands.length
      },
      antiNukeAdmins: {
        users: permissions.antiNukeAdmin?.users.length || 0,
        roles: permissions.antiNukeAdmin?.roles.length || 0,
        commands: 'all'
      },
      permRoles: {
        configured: Object.values(this.config.permRoles).filter(id => id).length,
        total: 3
      },
      activeCooldowns: this.cooldowns.size,
      forcedNicknames: this.forcedNicknames.size
    };
  }
  
  /**
   * Save configuration
   */
  async saveConfig() {
    try {
      await this.fullConfig.save();
      console.log('[ModerationSystem] Configuration saved');
    } catch (error) {
      console.error('[ModerationSystem] Error saving config:', error);
    }
  }
}