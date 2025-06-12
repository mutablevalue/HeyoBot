// src/utils/rateLimiter.js
import { PermissionFlagsBits } from 'discord.js';

export class RateLimiter {
  constructor(config) {
    this.userLimits = new Map();
    this.config = config;
    this.permissionSystem = null;
    
    // Clean up expired entries based on config interval
    if (this.config.cleanupInterval) {
      setInterval(() => this.cleanup(), this.config.cleanupInterval);
    }
  }
  
  /**
   * Set the unified permission system
   */
  setPermissionSystem(system) {
    this.permissionSystem = system;
  }

  async checkLimit(member) {
    const limit = this.getUserLimit(member);
    
    // No rate limit for this user
    if (limit === 0) {
      return { allowed: true };
    }

    const now = Date.now();
    const userId = member.id;
    const userLimit = this.userLimits.get(userId);

    // First command or limit expired
    if (!userLimit || now > userLimit.resetTime) {
      this.userLimits.set(userId, {
        commands: 1,
        resetTime: now + this.config.windowMs
      });
      return { allowed: true };
    }

    // Check if user exceeded limit
    if (userLimit.commands >= limit) {
      const timeLeft = Math.ceil((userLimit.resetTime - now) / 1000);
      return { allowed: false, timeLeft };
    }

    // Increment command count
    userLimit.commands++;
    return { allowed: true };
  }

  getUserLimit(member) {
    // First check if unified permission system is available
    if (this.permissionSystem) {
      const level = this.permissionSystem.getPermissionLevel(member);
      
      // Check for permission-level based limits in config
      if (this.config.limits.antiNukeAdmin !== undefined && 
          level >= this.permissionSystem.LEVELS.ANTINUKE_ADMIN) {
        return this.config.limits.antiNukeAdmin;
      }
      
      if (this.config.limits.administrator !== undefined && 
          level >= this.permissionSystem.LEVELS.ADMINISTRATOR) {
        return this.config.limits.administrator;
      }
      
      if (this.config.limits.whitelisted !== undefined && 
          level >= this.permissionSystem.LEVELS.WHITELISTED) {
        return this.config.limits.whitelisted;
      }
      
      if (this.config.limits.moderator !== undefined && 
          level >= this.permissionSystem.LEVELS.MODERATOR) {
        return this.config.limits.moderator;
      }
    }
    
    // Original role-based system (still supported)
    
    // Check if server owner
    if (member.id === member.guild.ownerId) {
      return this.config.limits.serverOwner;
    }

    // Check custom role limits by role ID first
    if (this.config.customRoles) {
      for (const [roleIdOrName, limit] of Object.entries(this.config.customRoles)) {
        // Check by role ID
        if (member.roles.cache.has(roleIdOrName)) {
          return limit;
        }
        // Check by role name (backward compatibility)
        if (member.roles.cache.some(role => role.name === roleIdOrName)) {
          return limit;
        }
      }
    }
    
    // Check for specific permission role limits
    if (this.config.permissionRoles) {
      // Check antiNukeAdmin roles
      if (this.config.permissionRoles.antiNukeAdmin) {
        for (const roleId of this.config.permissionRoles.antiNukeAdmin) {
          if (member.roles.cache.has(roleId)) {
            return this.config.limits.antiNukeAdmin || 0;
          }
        }
      }
      
      // Check administrator roles
      if (this.config.permissionRoles.administrator) {
        for (const roleId of this.config.permissionRoles.administrator) {
          if (member.roles.cache.has(roleId)) {
            return this.config.limits.administrator || 10;
          }
        }
      }
      
      // Check whitelisted roles
      if (this.config.permissionRoles.whitelisted) {
        for (const roleId of this.config.permissionRoles.whitelisted) {
          if (member.roles.cache.has(roleId)) {
            return this.config.limits.whitelisted || 15;
          }
        }
      }
      
      // Check moderator roles
      if (this.config.permissionRoles.moderator) {
        for (const roleId of this.config.permissionRoles.moderator) {
          if (member.roles.cache.has(roleId)) {
            return this.config.limits.moderator || 20;
          }
        }
      }
    }

    // Check for Administrator permission (Discord permission)
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.config.limits.administrator;
    }

    // Default limit for everyone else
    return this.config.limits.default;
  }

  resetUser(userId) {
    this.userLimits.delete(userId);
  }

  resetAll() {
    this.userLimits.clear();
  }

  getCooldownMessage(timeLeft) {
    return this.config.message.replace('{time}', timeLeft.toString());
  }

  cleanup() {
    const now = Date.now();
    for (const [userId, limit] of this.userLimits.entries()) {
      if (now > limit.resetTime) {
        this.userLimits.delete(userId);
      }
    }
  }

  getUserStatus(member) {
    const limit = this.getUserLimit(member);
    const userLimit = this.userLimits.get(member.id);
    
    if (limit === 0) {
      return { limit: 0, used: 0, remaining: Infinity, resetIn: 0 };
    }

    if (!userLimit || Date.now() > userLimit.resetTime) {
      return { limit, used: 0, remaining: limit, resetIn: 0 };
    }

    const resetIn = Math.ceil((userLimit.resetTime - Date.now()) / 1000);
    return {
      limit,
      used: userLimit.commands,
      remaining: Math.max(0, limit - userLimit.commands),
      resetIn
    };
  }
  
  /**
   * Get permission level name for a member (if unified system available)
   */
  getUserPermissionLevel(member) {
    if (!this.permissionSystem) {
      return 'Unknown';
    }
    
    const level = this.permissionSystem.getPermissionLevel(member);
    return this.permissionSystem.getLevelName(level);
  }
}