"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
const discord_js_1 = require("discord.js");
class RateLimiter {
    constructor(config) {
        this.userLimits = new Map();
        this.config = config;
        // Clean up expired entries every minute
        setInterval(() => this.cleanup(), 60000);
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
        if (member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
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
}
exports.RateLimiter = RateLimiter;
