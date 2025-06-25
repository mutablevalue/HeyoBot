// src/systems/antinuke/moderation/cooldownManager.js - Enhanced for performance
export default class CooldownManager {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.fullConfig.get('moderation');
    
    // Tracking with auto-cleanup
    this.cooldowns = new Map();
    this.lastCleanup = Date.now();
    
    // Performance optimization
    this.cleanupInterval = this.config.cooldownCleanupInterval || 60000; // 1 minute
    this.maxCooldownEntries = this.config.maxCooldownEntries || 10000;
  }
  
  /**
   * Check cooldown for a command
   * @param {string} userId
   * @param {string} commandName
   * @returns {{onCooldown: boolean, timeLeft?: number}}
   */
  checkCooldown(userId, commandName) {
    // Skip cooldown for AntiNuke operations
    if (commandName === '_antinuke_action') {
      return { onCooldown: false };
    }
    
    const cooldownTime = (this.config.cooldowns?.[commandName] || this.config.cooldowns?.default || 3) * 1000;
    const key = `${userId}-${commandName}`;
    
    const now = Date.now();
    
    // Auto-cleanup check
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.performCleanup();
    }
    
    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key);
      
      if (now < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - now) / 1000);
        return { onCooldown: true, timeLeft };
      }
    }
    
    // Set cooldown
    this.cooldowns.set(key, now + cooldownTime);
    
    // Prevent memory overflow
    if (this.cooldowns.size > this.maxCooldownEntries) {
      this.emergencyCleanup();
    }
    
    return { onCooldown: false };
  }
  
  /**
   * Apply cooldown multiplier for multi-user commands
   */
  applyCooldownMultiplier(userId, commandName, multiplier) {
    const baseCooldown = (this.config.cooldowns?.[commandName] || this.config.cooldowns?.default || 3) * 1000;
    const cooldownTime = baseCooldown * multiplier;
    const key = `${userId}-${commandName}`;
    
    this.cooldowns.set(key, Date.now() + cooldownTime);
  }
  
  /**
   * Batch check cooldowns for multiple users (for raid handling)
   * @param {string[]} userIds
   * @param {string} commandName
   * @returns {Map<string, {onCooldown: boolean, timeLeft?: number}>}
   */
  batchCheckCooldowns(userIds, commandName) {
    const results = new Map();
    const now = Date.now();
    const cooldownTime = (this.config.cooldowns?.[commandName] || this.config.cooldowns?.default || 3) * 1000;
    
    for (const userId of userIds) {
      const key = `${userId}-${commandName}`;
      
      if (this.cooldowns.has(key)) {
        const expirationTime = this.cooldowns.get(key);
        
        if (now < expirationTime) {
          const timeLeft = Math.ceil((expirationTime - now) / 1000);
          results.set(userId, { onCooldown: true, timeLeft });
          continue;
        }
      }
      
      // Set cooldown
      this.cooldowns.set(key, now + cooldownTime);
      results.set(userId, { onCooldown: false });
    }
    
    return results;
  }
  
  /**
   * Get the number of active cooldowns
   */
  getActiveCooldowns() {
    const now = Date.now();
    let active = 0;
    
    for (const expirationTime of this.cooldowns.values()) {
      if (now < expirationTime) {
        active++;
      }
    }
    
    return active;
  }
  
  /**
   * Clear cooldown for a specific user and command
   */
  clearCooldown(userId, commandName) {
    const key = `${userId}-${commandName}`;
    this.cooldowns.delete(key);
  }
  
  /**
   * Clear all cooldowns for a user
   */
  clearUserCooldowns(userId) {
    const keysToDelete = [];
    
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(`${userId}-`)) {
        keysToDelete.push(key);
      }
    }
    
    // Delete in batch for performance
    for (const key of keysToDelete) {
      this.cooldowns.delete(key);
    }
  }
  
  /**
   * Clear all cooldowns for a command
   */
  clearCommandCooldowns(commandName) {
    const keysToDelete = [];
    
    for (const key of this.cooldowns.keys()) {
      if (key.endsWith(`-${commandName}`)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.cooldowns.delete(key);
    }
  }
  
  /**
   * Perform regular cleanup
   */
  performCleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, expirationTime] of this.cooldowns) {
      if (now >= expirationTime) {
        keysToDelete.push(key);
      }
    }
    
    // Batch delete for performance
    for (const key of keysToDelete) {
      this.cooldowns.delete(key);
    }
    
    this.lastCleanup = now;
  }
  
  /**
   * Emergency cleanup when approaching memory limit
   */
  emergencyCleanup() {
    const now = Date.now();
    const entries = Array.from(this.cooldowns.entries());
    
    // Sort by expiration time (oldest first)
    entries.sort((a, b) => a[1] - b[1]);
    
    // Remove expired and oldest entries
    let removed = 0;
    const targetSize = Math.floor(this.maxCooldownEntries * 0.7); // Keep 70%
    
    for (const [key, expirationTime] of entries) {
      if (this.cooldowns.size <= targetSize) break;
      
      // Always remove expired
      if (now >= expirationTime || removed < entries.length * 0.3) {
        this.cooldowns.delete(key);
        removed++;
      }
    }
    
    console.log(`[CooldownManager] Emergency cleanup: removed ${removed} entries`);
  }
  
  /**
   * Clean up expired cooldowns
   */
  cleanup() {
    this.performCleanup();
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;
    
    for (const expirationTime of this.cooldowns.values()) {
      if (now < expirationTime) {
        active++;
      } else {
        expired++;
      }
    }
    
    return {
      total: this.cooldowns.size,
      active,
      expired,
      lastCleanup: new Date(this.lastCleanup).toISOString()
    };
  }
}