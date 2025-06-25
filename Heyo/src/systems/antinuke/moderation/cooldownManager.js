// src/systems/antinuke/moderation/cooldownManager.js
export default class CooldownManager {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.fullConfig.get('moderation');
    
    // Tracking
    this.cooldowns = new Map();
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
      this.cleanup();
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
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(`${userId}-`)) {
        this.cooldowns.delete(key);
      }
    }
  }
  
  /**
   * Clean up expired cooldowns
   */
  cleanup() {
    const now = Date.now();
    for (const [key, expirationTime] of this.cooldowns) {
      if (now >= expirationTime) {
        this.cooldowns.delete(key);
      }
    }
  }
}