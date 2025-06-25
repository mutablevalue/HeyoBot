// src/systems/antinuke/moderation/roleManager.js
export default class RoleManager {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.client = antiNuke.client;
    this.config = antiNuke.fullConfig.get('moderation');
    
    // Cache for mute roles
    this.muteRoles = new Map();
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
        console.error('[RoleManager] Error creating mute role:', error);
        throw error;
      }
    }
    
    this.muteRoles.set(guild.id, muteRole.id);
    return muteRole;
  }
  
  /**
   * Get permission role by type
   * @param {Guild} guild 
   * @param {string} type - 'vc', 'pic', or 'link'
   * @returns {Role|null}
   */
  getPermissionRole(guild, type) {
    const roleId = this.config.permRoles[type];
    if (!roleId) return null;
    
    return guild.roles.cache.get(roleId);
  }
  
  /**
   * Check if member has permission role
   * @param {GuildMember} member 
   * @param {string} type 
   * @returns {boolean}
   */
  hasPermissionRole(member, type) {
    const role = this.getPermissionRole(member.guild, type);
    if (!role) return false;
    
    return member.roles.cache.has(role.id);
  }
  
  /**
   * Grant permission role to member
   * @param {GuildMember} member 
   * @param {string} type 
   * @returns {boolean} Success
   */
  async grantPermissionRole(member, type) {
    const role = this.getPermissionRole(member.guild, type);
    if (!role) return false;
    
    try {
      await member.roles.add(role, `Granted ${type} permission`);
      return true;
    } catch (error) {
      console.error(`[RoleManager] Error granting ${type} role:`, error);
      return false;
    }
  }
  
  /**
   * Revoke permission role from member
   * @param {GuildMember} member 
   * @param {string} type 
   * @returns {boolean} Success
   */
  async revokePermissionRole(member, type) {
    const role = this.getPermissionRole(member.guild, type);
    if (!role) return false;
    
    try {
      await member.roles.remove(role, `Revoked ${type} permission`);
      return true;
    } catch (error) {
      console.error(`[RoleManager] Error revoking ${type} role:`, error);
      return false;
    }
  }
  
  /**
   * Clear mute role cache for a guild
   */
  clearMuteRoleCache(guildId) {
    this.muteRoles.delete(guildId);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      cachedMuteRoles: this.muteRoles.size,
      configuredPermRoles: Object.values(this.config.permRoles).filter(id => id).length
    };
  }
}