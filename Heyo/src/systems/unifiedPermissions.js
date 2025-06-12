// src/systems/unifiedPermissions.js
import { PermissionFlagsBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class UnifiedPermissionSystem {
  constructor(config) {
    this.config = config;
    this.hierarchyConfig = config.get('permissionHierarchy');
    this.moderationConfig = config.get('moderation');
    this.antiNukeConfig = config.get('antiNuke');
    
    // Permission levels from config
    this.LEVELS = {
      USER: 0,
      MODERATOR: 1, 
      WHITELISTED: 2,
      ADMINISTRATOR: 3,
      ANTINUKE_ADMIN: 4,
      OWNER: 5
    };
    
    // Cache for user permission levels
    this.userPermissionCache = new Map();
    
    // Synchronize permissions on initialization
    this.synchronizePermissions();
  }
  
  /**
   * Synchronize permissions between systems
   */
  synchronizePermissions() {
    // No automatic synchronization - only what's in config
  }
  
  /**
   * Get the permission level of a member
   * @param {GuildMember} member 
   * @returns {number} Permission level (0-5)
   */
  getPermissionLevel(member) {
    if (!member) return this.LEVELS.USER;
    
    // Check cache first
    const cacheKey = `${member.guild.id}-${member.id}`;
    if (this.userPermissionCache.has(cacheKey)) {
      const cached = this.userPermissionCache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.level;
      }
      this.userPermissionCache.delete(cacheKey);
    }
    
    let level = this.LEVELS.USER;
    
    // Check if owner with bypass
    if (this.moderationConfig.ownerBypass && member.id === member.guild.ownerId) {
      level = this.LEVELS.OWNER;
    }
    // Check if owner without bypass (treated as AntiNuke admin)
    else if (!this.moderationConfig.ownerBypass && member.id === member.guild.ownerId) {
      level = this.LEVELS.ANTINUKE_ADMIN;
    }
    // Check AntiNuke Admin
    else if (this.isAntiNukeAdmin(member)) {
      level = this.LEVELS.ANTINUKE_ADMIN;
    }
    // Check Administrator
    else if (this.isAdministrator(member)) {
      level = this.LEVELS.ADMINISTRATOR;
    }
    // Check Whitelisted (explicit in whitelist config)
    else if (this.isWhitelisted(member)) {
      level = this.LEVELS.WHITELISTED;
    }
    // Check Moderator
    else if (this.isModerator(member)) {
      level = this.LEVELS.MODERATOR;
    }
    
    // Cache the result for 5 minutes
    this.userPermissionCache.set(cacheKey, {
      level,
      expires: Date.now() + 300000
    });
    
    return level;
  }
  
  /**
   * Check if a member has a specific permission level or higher
   * @param {GuildMember} member 
   * @param {number} requiredLevel 
   * @returns {boolean}
   */
  hasPermissionLevel(member, requiredLevel) {
    return this.getPermissionLevel(member) >= requiredLevel;
  }
  
  /**
   * Check if a member can execute a specific command
   * @param {GuildMember} member 
   * @param {string} commandName 
   * @returns {{allowed: boolean, reason?: string}}
   */
  canExecuteCommand(member, commandName) {
    const level = this.getPermissionLevel(member);
    
    // AntiNuke admins can execute all commands
    if (level >= this.LEVELS.ANTINUKE_ADMIN) {
      return { allowed: true };
    }
    
    // Check specific command permissions
    const permissions = this.moderationConfig.permissions;
    
    // Check administrator commands
    if (level >= this.LEVELS.ADMINISTRATOR && 
        permissions.administrator.commands.includes(commandName)) {
      return { allowed: true };
    }
    
    // Check moderator commands
    if (level >= this.LEVELS.MODERATOR && 
        permissions.moderator.commands.includes(commandName)) {
      return { allowed: true };
    }
    
    return { 
      allowed: false, 
      reason: `You need at least ${this.getRequiredLevelName(commandName)} permissions to use this command.`
    };
  }
  
  /**
   * Check if a member can manage another member's permissions
   * @param {GuildMember} executor 
   * @param {GuildMember} target 
   * @param {string} action 
   * @returns {{allowed: boolean, reason?: string}}
   */
  canManageMember(executor, target, action) {
    const executorLevel = this.getPermissionLevel(executor);
    const targetLevel = this.getPermissionLevel(target);
    
    // Can't manage someone with equal or higher permission level
    if (targetLevel >= executorLevel && executorLevel < this.LEVELS.OWNER) {
      return { 
        allowed: false, 
        reason: 'You cannot manage someone with equal or higher permissions.'
      };
    }
    
    // Check Discord role hierarchy
    if (target.roles.highest.position >= executor.roles.highest.position && 
        executorLevel < this.LEVELS.OWNER) {
      return { 
        allowed: false, 
        reason: 'Target has a higher or equal role position.'
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check if a member can assign a specific permission role
   * @param {GuildMember} member 
   * @param {string} roleType 
   * @returns {{allowed: boolean, reason?: string}}
   */
  canAssignPermissionRole(member, roleType) {
    const level = this.getPermissionLevel(member);
    const management = this.hierarchyConfig?.roleManagement;
    
    if (!management) {
      return { 
        allowed: false, 
        reason: 'Permission role management not configured.'
      };
    }
    
    // Check each level's permissions
    switch (level) {
      case this.LEVELS.OWNER:
        if (management.owner?.canAssign?.includes('all') || 
            management.owner?.canAssign?.includes(roleType)) {
          return { allowed: true };
        }
        break;
        
      case this.LEVELS.ANTINUKE_ADMIN:
        if (management.antiNukeAdmin?.canAssign?.includes(roleType)) {
          return { allowed: true };
        }
        break;
        
      case this.LEVELS.ADMINISTRATOR:
        if (management.administrator?.canAssign?.includes(roleType)) {
          return { allowed: true };
        }
        break;
        
      default:
        return { 
          allowed: false, 
          reason: 'You do not have permission to assign permission roles.'
        };
    }
    
    return { 
      allowed: false, 
      reason: `You cannot assign ${roleType} permissions.`
    };
  }
  
  /**
   * Check if a member can modify the whitelist
   * @param {GuildMember} member 
   * @returns {boolean}
   */
  canModifyWhitelist(member) {
    const level = this.getPermissionLevel(member);
    const management = this.hierarchyConfig?.roleManagement;
    
    if (level === this.LEVELS.OWNER && management?.owner?.canWhitelist) {
      return true;
    }
    
    if (level === this.LEVELS.ANTINUKE_ADMIN && management?.antiNukeAdmin?.canWhitelist) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if a member can modify permission configurations
   * @param {GuildMember} member 
   * @returns {boolean}
   */
  canModifyPermissions(member) {
    const level = this.getPermissionLevel(member);
    const management = this.hierarchyConfig?.roleManagement;
    
    if (level === this.LEVELS.OWNER && management?.owner?.canManagePermissions) {
      return true;
    }
    
    if (level === this.LEVELS.ANTINUKE_ADMIN && management?.antiNukeAdmin?.canManagePermissions) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Add a user to a permission level
   * @param {string} userId 
   * @param {string} levelName 
   * @returns {boolean} Success
   */
  async addUserToLevel(userId, levelName) {
    const permissions = this.moderationConfig.permissions;
    
    if (!permissions[levelName]) return false;
    
    // Remove from other levels first
    await this.removeUserFromAllLevels(userId);
    
    // Add to new level
    if (!permissions[levelName].users.includes(userId)) {
      permissions[levelName].users.push(userId);
      await this.saveConfig();
      return true;
    }
    
    return false;
  }
  
  /**
   * Remove a user from a permission level
   * @param {string} userId 
   * @param {string} levelName 
   * @returns {boolean} Success
   */
  async removeUserFromLevel(userId, levelName) {
    const permissions = this.moderationConfig.permissions;
    
    if (!permissions[levelName]) return false;
    
    const index = permissions[levelName].users.indexOf(userId);
    if (index > -1) {
      permissions[levelName].users.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    
    return false;
  }
  
  /**
   * Remove a user from all permission levels
   * @param {string} userId 
   */
  async removeUserFromAllLevels(userId) {
    const permissions = this.moderationConfig.permissions;
    
    for (const level of ['antiNukeAdmin', 'administrator', 'whitelisted', 'moderator']) {
      if (permissions[level]) {
        const index = permissions[level].users.indexOf(userId);
        if (index > -1) {
          permissions[level].users.splice(index, 1);
        }
      }
    }
    
    // Also remove from AntiNuke whitelist
    if (this.antiNukeConfig.whitelist?.users) {
      const index = this.antiNukeConfig.whitelist.users.indexOf(userId);
      if (index > -1) {
        this.antiNukeConfig.whitelist.users.splice(index, 1);
      }
    }
    
    await this.saveConfig();
  }
  
  /**
   * Add a user to whitelist
   * @param {string} userId 
   * @returns {boolean} Success
   */
  async addToWhitelist(userId) {
    if (!this.antiNukeConfig.whitelist) {
      this.antiNukeConfig.whitelist = { users: [], roles: [] };
    }
    
    if (!this.antiNukeConfig.whitelist.users.includes(userId)) {
      this.antiNukeConfig.whitelist.users.push(userId);
      
      // Also add to whitelisted permission level if it exists
      if (this.moderationConfig.permissions.whitelisted && 
          !this.moderationConfig.permissions.whitelisted.users.includes(userId)) {
        this.moderationConfig.permissions.whitelisted.users.push(userId);
      }
      
      await this.saveConfig();
      return true;
    }
    
    return false;
  }
  
  /**
   * Remove a user from whitelist
   * @param {string} userId 
   * @returns {boolean} Success
   */
  async removeFromWhitelist(userId) {
    let removed = false;
    
    // Remove from AntiNuke whitelist
    if (this.antiNukeConfig.whitelist?.users) {
      const index = this.antiNukeConfig.whitelist.users.indexOf(userId);
      if (index > -1) {
        this.antiNukeConfig.whitelist.users.splice(index, 1);
        removed = true;
      }
    }
    
    // Remove from whitelisted permission level
    if (this.moderationConfig.permissions.whitelisted) {
      const index = this.moderationConfig.permissions.whitelisted.users.indexOf(userId);
      if (index > -1) {
        this.moderationConfig.permissions.whitelisted.users.splice(index, 1);
        removed = true;
      }
    }
    
    if (removed) {
      await this.saveConfig();
    }
    
    return removed;
  }
  
  /**
   * Get all users at a specific permission level
   * @param {string} levelName 
   * @returns {string[]} User IDs
   */
  getUsersAtLevel(levelName) {
    const permissions = this.moderationConfig.permissions;
    return permissions[levelName]?.users || [];
  }
  
  /**
   * Check if multi-user command execution is allowed
   * @param {GuildMember} member 
   * @param {string} commandName 
   * @returns {boolean}
   */
  canUseMultiUserCommand(member, commandName) {
    const multiUserConfig = this.moderationConfig.multiUserCommands?.[commandName];
    if (!multiUserConfig?.enabled) return false;
    
    const memberLevel = this.getPermissionLevel(member);
    const requiredLevel = multiUserConfig.requiresPermissionLevel;
    
    if (requiredLevel === undefined) return false;
    
    return memberLevel >= requiredLevel;
  }
  
  /**
   * Get permission level name
   * @param {number} level 
   * @returns {string}
   */
  getLevelName(level) {
    const names = {
      [this.LEVELS.USER]: 'User',
      [this.LEVELS.MODERATOR]: 'Moderator',
      [this.LEVELS.WHITELISTED]: 'Whitelisted',
      [this.LEVELS.ADMINISTRATOR]: 'Administrator',
      [this.LEVELS.ANTINUKE_ADMIN]: 'AntiNuke Admin',
      [this.LEVELS.OWNER]: 'Server Owner'
    };
    return names[level] || 'Unknown';
  }
  
  /**
   * Get required level name for a command
   * @param {string} commandName 
   * @returns {string}
   */
  getRequiredLevelName(commandName) {
    const permissions = this.moderationConfig.permissions;
    
    if (permissions.moderator?.commands?.includes(commandName)) {
      return 'Moderator';
    }
    if (permissions.administrator?.commands?.includes(commandName)) {
      return 'Administrator';
    }
    if (permissions.antiNukeAdmin?.commands?.includes('all') || 
        permissions.antiNukeAdmin?.commands?.includes(commandName)) {
      return 'AntiNuke Admin';
    }
    
    return 'Unknown';
  }
  
  /**
   * Get statistics about the permission system
   * @returns {Object}
   */
  getStats() {
    const permissions = this.moderationConfig.permissions;
    const whitelistUsers = this.antiNukeConfig.whitelist?.users?.length || 0;
    
    return {
      antiNukeAdmins: permissions.antiNukeAdmin?.users?.length || 0,
      administrators: permissions.administrator?.users?.length || 0,
      moderators: permissions.moderator?.users?.length || 0,
      whitelisted: permissions.whitelisted?.users?.length || 0,
      antiNukeWhitelist: whitelistUsers,
      totalManaged: new Set([
        ...(permissions.antiNukeAdmin?.users || []),
        ...(permissions.administrator?.users || []),
        ...(permissions.moderator?.users || []),
        ...(permissions.whitelisted?.users || [])
      ]).size
    };
  }
  
  /**
   * Clear permission cache
   */
  clearCache() {
    this.userPermissionCache.clear();
  }
  
  /**
   * Clear cache for a specific user
   * @param {string} guildId 
   * @param {string} userId 
   */
  clearUserCache(guildId, userId) {
    const cacheKey = `${guildId}-${userId}`;
    this.userPermissionCache.delete(cacheKey);
  }
  
  // Helper methods for specific permission checks
  isAntiNukeAdmin(member) {
    const users = this.moderationConfig.permissions.antiNukeAdmin?.users || [];
    const roles = this.moderationConfig.permissions.antiNukeAdmin?.roles || [];
    
    return users.includes(member.id) || 
           member.roles.cache.some(role => roles.includes(role.id));
  }
  
  isAdministrator(member) {
    const users = this.moderationConfig.permissions.administrator?.users || [];
    const roles = this.moderationConfig.permissions.administrator?.roles || [];
    
    return users.includes(member.id) || 
           member.roles.cache.some(role => roles.includes(role.id));
  }
  
  isModerator(member) {
    const users = this.moderationConfig.permissions.moderator?.users || [];
    const roles = this.moderationConfig.permissions.moderator?.roles || [];
    
    return users.includes(member.id) || 
           member.roles.cache.some(role => roles.includes(role.id));
  }
  
  isWhitelisted(member) {
    // Check explicit whitelist permissions
    const whitelistUsers = this.moderationConfig.permissions.whitelisted?.users || [];
    const whitelistRoles = this.moderationConfig.permissions.whitelisted?.roles || [];
    
    if (whitelistUsers.includes(member.id) || 
        member.roles.cache.some(role => whitelistRoles.includes(role.id))) {
      return true;
    }
    
    // Check AntiNuke whitelist
    const antiNukeUsers = this.antiNukeConfig.whitelist?.users || [];
    const antiNukeRoles = this.antiNukeConfig.whitelist?.roles || [];
    
    return antiNukeUsers.includes(member.id) || 
           member.roles.cache.some(role => antiNukeRoles.includes(role.id));
  }
  
  /**
   * Save configuration changes
   */
  async saveConfig() {
    try {
      await this.config.save();
      console.log('[UnifiedPermissions] Configuration saved');
    } catch (error) {
      console.error('[UnifiedPermissions] Error saving config:', error);
    }
  }
}