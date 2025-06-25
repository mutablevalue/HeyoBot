// src/systems/antinuke/moderation/actionHandler.js
import { PermissionFlagsBits } from 'discord.js';

export default class ActionHandler {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.client = antiNuke.client;
    this.config = antiNuke.fullConfig.get('moderation');
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
    if (!this.antiNuke.permissions) {
      console.warn('[ActionHandler] Permission system not initialized');
      return isOwnerWithBypass;
    }
    
    // Check AntiNuke admin via permission system
    const permissionLevel = this.antiNuke.permissions.getPermissionLevel(member);
    const isAntiNukeAdmin = permissionLevel >= this.antiNuke.permissions.LEVELS.ANTINUKE_ADMIN;
    
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
    if (!this.antiNuke.permissions) {
      // Fallback: check if user has Administrator permission
      return member.permissions.has(PermissionFlagsBits.Administrator);
    }
    
    // AntiNuke admins and higher are exempt
    const permissionLevel = this.antiNuke.permissions.getPermissionLevel(member);
    return permissionLevel >= this.antiNuke.permissions.LEVELS.ANTINUKE_ADMIN;
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
    
    // Use permission system for hierarchy check
    if (this.antiNuke.permissions) {
      return this.antiNuke.permissions.canManageMember(executor, target, 'moderate');
    }
    
    // Fallback: Bypass hierarchy check for owners with bypass and AntiNuke admins
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
   * Check permission for command
   */
  checkPermission(member, commandName) {
    if (!this.antiNuke.permissions) {
      // Fallback to legacy if permission system not available
      return this.legacyCheckPermission(member, commandName);
    }
    
    return this.antiNuke.permissions.canExecuteCommand(member, commandName);
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
   * Update permission roles in config
   * @param {Object} roles 
   */
  async updatePermRoles(roles) {
    Object.assign(this.config.permRoles, roles);
    await this.antiNuke.saveConfig();
  }
  
  /**
   * Add user to permission level
   */
  async addUserToLevel(level, userId) {
    if (!this.antiNuke.permissions) {
      // Fallback to direct config modification
      const permissions = this.config.permissions;
      if (!permissions[level]) return false;
      
      if (!permissions[level].users.includes(userId)) {
        permissions[level].users.push(userId);
        await this.antiNuke.saveConfig();
        return true;
      }
      return false;
    }
    
    return await this.antiNuke.permissions.addUserToLevel(userId, level);
  }
  
  /**
   * Remove user from permission level
   */
  async removeUserFromLevel(level, userId) {
    if (!this.antiNuke.permissions) {
      // Fallback to direct config modification
      const permissions = this.config.permissions;
      if (!permissions[level]) return false;
      
      const index = permissions[level].users.indexOf(userId);
      if (index > -1) {
        permissions[level].users.splice(index, 1);
        await this.antiNuke.saveConfig();
        return true;
      }
      return false;
    }
    
    return await this.antiNuke.permissions.removeUserFromLevel(userId, level);
  }
  
  /**
   * Add role to permission level
   */
  async addRoleToLevel(level, roleId) {
    const permissions = this.config.permissions;
    if (!permissions[level]) return false;
    
    if (!permissions[level].roles.includes(roleId)) {
      permissions[level].roles.push(roleId);
      await this.antiNuke.saveConfig();
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
      await this.antiNuke.saveConfig();
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
      }
    };
  }
}