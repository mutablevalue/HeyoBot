import { GuildMember, PermissionFlagsBits } from 'discord.js';

interface RateLimitConfig {
  windowMs: number;
  limits: {
    serverOwner: number;
    administrator: number;
    default: number;
  };
  customRoles?: Record<string, number>;
  message: string;
}

interface UserRateLimit {
  commands: number;
  resetTime: number;
}

export class RateLimiter {
  private userLimits: Map<string, UserRateLimit> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a user can execute a command based on their rate limit
   * @returns true if allowed, false if rate limited
   */
  async checkLimit(member: GuildMember): Promise<{ allowed: boolean; timeLeft?: number }> {
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

  /**
   * Get the rate limit for a specific member based on their roles and permissions
   */
  private getUserLimit(member: GuildMember): number {
    // Check if server owner
    if (member.id === member.guild.ownerId) {
      return this.config.limits.serverOwner;
    }

    // Check custom role limits first (highest priority after owner)
    if (this.config.customRoles) {
      for (const [roleName, limit] of Object.entries(this.config.customRoles)) {
        if (member.roles.cache.some(role => role.name === roleName)) {
          return limit;
        }
      }
    }

    // Check for Administrator permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.config.limits.administrator;
    }

    // Default limit for everyone else
    return this.config.limits.default;
  }

  /**
   * Reset rate limit for a specific user
   */
  resetUser(userId: string): void {
    this.userLimits.delete(userId);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.userLimits.clear();
  }

  /**
   * Get formatted cooldown message
   */
  getCooldownMessage(timeLeft: number): string {
    return this.config.message.replace('{time}', timeLeft.toString());
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [userId, limit] of this.userLimits.entries()) {
      if (now > limit.resetTime) {
        this.userLimits.delete(userId);
      }
    }
  }

  /**
   * Get current rate limit status for a user (for debugging/info)
   */
  getUserStatus(member: GuildMember): {
    limit: number;
    used: number;
    remaining: number;
    resetIn: number;
  } {
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
}