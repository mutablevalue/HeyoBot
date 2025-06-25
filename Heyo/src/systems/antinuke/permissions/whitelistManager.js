// src/systems/antinuke/permissions/whitelistManager.js
export default class WhitelistManager {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Ensure whitelist structure exists
    if (!this.config.whitelist) {
      this.config.whitelist = { users: [], roles: [] };
    }
  }
  
  /**
   * Check if a user is whitelisted
   * @param {string} userId 
   * @returns {boolean}
   */
  isUserWhitelisted(userId) {
    return this.config.whitelist.users.includes(userId);
  }
  
  /**
   * Check if a member is whitelisted (checks user and roles)
   * @param {GuildMember} member 
   * @returns {boolean}
   */
  isMemberWhitelisted(member) {
    if (!member) return false;
    
    // Check user whitelist
    if (this.isUserWhitelisted(member.id)) return true;
    
    // Check role whitelist
    if (member.roles && member.roles.cache) {
      return member.roles.cache.some(role => 
        this.config.whitelist.roles.includes(role.id)
      );
    }
    
    return false;
  }
  
  /**
   * Add a user to whitelist
   * @param {string} userId 
   * @returns {boolean} Success
   */
  async addUser(userId) {
    if (!this.config.whitelist.users.includes(userId)) {
      this.config.whitelist.users.push(userId);
      await this.antiNuke.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * Remove a user from whitelist
   * @param {string} userId 
   * @returns {boolean} Success
   */
  async removeUser(userId) {
    // Cannot remove bot owner from whitelist
    if (userId === this.antiNuke.permissions?.BOT_OWNER_ID) {
      return false;
    }
    
    const index = this.config.whitelist.users.indexOf(userId);
    if (index > -1) {
      this.config.whitelist.users.splice(index, 1);
      await this.antiNuke.saveConfig();
      return true;
    }
    
    return false;
  }
  
  /**
   * Add a role to whitelist
   * @param {string} roleId 
   * @returns {boolean} Success
   */
  async addRole(roleId) {
    if (!this.config.whitelist.roles.includes(roleId)) {
      this.config.whitelist.roles.push(roleId);
      await this.antiNuke.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * Remove a role from whitelist
   * @param {string} roleId 
   * @returns {boolean} Success
   */
  async removeRole(roleId) {
    const index = this.config.whitelist.roles.indexOf(roleId);
    if (index > -1) {
      this.config.whitelist.roles.splice(index, 1);
      await this.antiNuke.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * Get all whitelisted users
   * @returns {string[]}
   */
  getUsers() {
    return [...this.config.whitelist.users];
  }
  
  /**
   * Get all whitelisted roles
   * @returns {string[]}
   */
  getRoles() {
    return [...this.config.whitelist.roles];
  }
  
  /**
   * Get whitelist statistics
   * @returns {Object}
   */
  getStats() {
    return {
      users: this.config.whitelist.users.length,
      roles: this.config.whitelist.roles.length,
      total: this.config.whitelist.users.length + this.config.whitelist.roles.length
    };
  }
  
  /**
   * Clear all whitelisted users (dangerous!)
   */
  async clearUsers() {
    // Keep bot owner if they're in the list
    const botOwnerId = this.antiNuke.permissions?.BOT_OWNER_ID;
    const hadBotOwner = this.config.whitelist.users.includes(botOwnerId);
    
    this.config.whitelist.users = [];
    
    if (hadBotOwner && botOwnerId) {
      this.config.whitelist.users.push(botOwnerId);
    }
    
    await this.antiNuke.saveConfig();
  }
  
  /**
   * Clear all whitelisted roles
   */
  async clearRoles() {
    this.config.whitelist.roles = [];
    await this.antiNuke.saveConfig();
  }
}