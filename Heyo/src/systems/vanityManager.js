// src/systems/vanityManager.js
export class VanityManager {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load vanity config
    const vanityConfig = this.configLoader.get('vanity') || {};
    this.config = {
      enabled: vanityConfig.enabled ?? false,
      checkIntervalSeconds: vanityConfig.checkIntervalSeconds ?? 1800, // Default 30 minutes = 1800 seconds
      vanityStrings: vanityConfig.vanityStrings || [],
      roles: vanityConfig.roles || [],
      logChannel: vanityConfig.logChannel || null,
      caseSensitive: vanityConfig.caseSensitive ?? false,
      checkUsername: vanityConfig.checkUsername ?? true,
      checkNickname: vanityConfig.checkNickname ?? true,
      exemptRoles: vanityConfig.exemptRoles || [], // Roles that bypass vanity checks
      removeOnVanityLoss: vanityConfig.removeOnVanityLoss ?? true
    };

    this.checkInterval = null;
    this.lastCheck = new Date();
    this.stats = {
      totalChecks: 0,
      rolesAdded: 0,
      rolesRemoved: 0,
      errors: 0
    };

    // Start the checking loop if enabled
    if (this.config.enabled) {
      this.startChecking();
    }

    // Listen for member updates
    this.setupEventListeners();
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('vanity', {
      enabled: this.config.enabled,
      checkIntervalSeconds: this.config.checkIntervalSeconds,
      vanityStrings: this.config.vanityStrings,
      roles: this.config.roles,
      logChannel: this.config.logChannel,
      caseSensitive: this.config.caseSensitive,
      checkUsername: this.config.checkUsername,
      checkNickname: this.config.checkNickname,
      exemptRoles: this.config.exemptRoles,
      removeOnVanityLoss: this.config.removeOnVanityLoss
    });
    return this.configLoader.save();
  }

  /**
   * Setup event listeners for real-time vanity checking
   */
  setupEventListeners() {
    // Check on member update (nickname change)
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      if (!this.config.enabled) return;
      
      // Check if nickname changed
      if (oldMember.displayName !== newMember.displayName) {
        await this.checkMemberVanity(newMember);
      }
    });

    // Check on member join
    this.client.on('guildMemberAdd', async (member) => {
      if (!this.config.enabled) return;
      await this.checkMemberVanity(member);
    });

    // Check on user update (username change)
    this.client.on('userUpdate', async (oldUser, newUser) => {
      if (!this.config.enabled) return;
      
      if (oldUser.username !== newUser.username) {
        // Check all guilds this user is in
        for (const guild of this.client.guilds.cache.values()) {
          const member = guild.members.cache.get(newUser.id);
          if (member) {
            await this.checkMemberVanity(member);
          }
        }
      }
    });
  }

  /**
   * Start the periodic checking loop
   */
  startChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    console.log(`[VanityManager] Starting vanity check loop (every ${this.config.checkIntervalSeconds} seconds)`);

    // Initial check
    this.checkAllMembers();

    // Set up interval
    this.checkInterval = setInterval(() => {
      this.checkAllMembers();
    }, this.config.checkIntervalSeconds * 1000);
  }

  /**
   * Stop the checking loop
   */
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[VanityManager] Stopped vanity check loop');
    }
  }

  /**
   * Enable vanity system
   */
  async enable() {
    this.config.enabled = true;
    await this.saveConfig();
    this.startChecking();
    return true;
  }

  /**
   * Disable vanity system
   */
  async disable() {
    this.config.enabled = false;
    await this.saveConfig();
    this.stopChecking();
    return true;
  }

  /**
   * Check all members in all guilds
   */
  async checkAllMembers() {
    if (!this.config.enabled) return;

    console.log('[VanityManager] Running scheduled vanity check...');
    this.lastCheck = new Date();
    this.stats.totalChecks++;

    for (const guild of this.client.guilds.cache.values()) {
      for (const member of guild.members.cache.values()) {
        if (!member.user.bot) {
          await this.checkMemberVanity(member);
        }
      }
    }
  }

  /**
   * Check if a member has vanity and manage roles accordingly
   * @param {import("discord.js").GuildMember} member 
   */
  async checkMemberVanity(member) {
    if (!this.config.enabled) return;

    try {
      // Skip if member has exempt role
      if (this.isExempt(member)) return;

      const hasVanity = this.memberHasVanity(member);
      const currentRoles = member.roles.cache;

      for (const roleId of this.config.roles) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) continue;

        const hasRole = currentRoles.has(roleId);

        if (hasVanity && !hasRole) {
          // Add role
          try {
            await member.roles.add(role, 'Has vanity in name');
            this.stats.rolesAdded++;
            await this.logAction(member.guild, {
              action: 'Role Added',
              member: member,
              role: role,
              reason: 'Has vanity in name'
            });
          } catch (error) {
            console.error(`[VanityManager] Failed to add role to ${member.user.tag}:`, error);
            this.stats.errors++;
          }
        } else if (!hasVanity && hasRole && this.config.removeOnVanityLoss) {
          // Remove role
          try {
            await member.roles.remove(role, 'No longer has vanity in name');
            this.stats.rolesRemoved++;
            await this.logAction(member.guild, {
              action: 'Role Removed',
              member: member,
              role: role,
              reason: 'No longer has vanity in name'
            });
          } catch (error) {
            console.error(`[VanityManager] Failed to remove role from ${member.user.tag}:`, error);
            this.stats.errors++;
          }
        }
      }
    } catch (error) {
      console.error('[VanityManager] Error checking member vanity:', error);
      this.stats.errors++;
    }
  }

  /**
   * Check if member has any vanity string in their name
   * @param {import("discord.js").GuildMember} member 
   * @returns {boolean}
   */
  memberHasVanity(member) {
    const namesToCheck = [];
    
    if (this.config.checkUsername) {
      namesToCheck.push(member.user.username);
    }
    
    if (this.config.checkNickname && member.nickname) {
      namesToCheck.push(member.nickname);
    }

    for (const name of namesToCheck) {
      for (const vanity of this.config.vanityStrings) {
        if (this.config.caseSensitive) {
          if (name.includes(vanity)) return true;
        } else {
          if (name.toLowerCase().includes(vanity.toLowerCase())) return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if member is exempt from vanity checks
   * @param {import("discord.js").GuildMember} member 
   * @returns {boolean}
   */
  isExempt(member) {
    return member.roles.cache.some(role => this.config.exemptRoles.includes(role.id));
  }

  /**
   * Log vanity action
   * @param {import("discord.js").Guild} guild 
   * @param {Object} data 
   */
  async logAction(guild, data) {
    if (!this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = {
      title: `Vanity System: ${data.action}`,
      color: data.action === 'Role Added' ? 0x00ff00 : 0xff0000,
      fields: [
        { 
          name: 'Member', 
          value: `${data.member.user.tag} (${data.member.user.id})`, 
          inline: true 
        },
        { 
          name: 'Role', 
          value: `${data.role}`, 
          inline: true 
        },
        { 
          name: 'Reason', 
          value: data.reason, 
          inline: false 
        }
      ],
      timestamp: new Date().toISOString()
    };

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[VanityManager] Failed to log action:', error);
    }
  }

  /**
   * Add a vanity string
   * @param {string} vanity 
   * @returns {Promise<boolean>}
   */
  async addVanityString(vanity) {
    if (!this.config.vanityStrings.includes(vanity)) {
      this.config.vanityStrings.push(vanity);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a vanity string
   * @param {string} vanity 
   * @returns {Promise<boolean>}
   */
  async removeVanityString(vanity) {
    const index = this.config.vanityStrings.indexOf(vanity);
    if (index > -1) {
      this.config.vanityStrings.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Add a role to assign
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async addRole(roleId) {
    if (!this.config.roles.includes(roleId)) {
      this.config.roles.push(roleId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a role
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async removeRole(roleId) {
    const index = this.config.roles.indexOf(roleId);
    if (index > -1) {
      this.config.roles.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Update check interval
   * @param {number} seconds 
   */
  async setCheckInterval(seconds) {
    this.config.checkIntervalSeconds = seconds;
    await this.saveConfig();
    
    if (this.config.enabled) {
      this.stopChecking();
      this.startChecking();
    }
  }

  /**
   * Get vanity system statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      lastCheck: this.lastCheck,
      nextCheck: this.checkInterval ? new Date(this.lastCheck.getTime() + (this.config.checkIntervalSeconds * 1000)) : null,
      vanityStrings: this.config.vanityStrings.length,
      roles: this.config.roles.length,
      stats: { ...this.stats }
    };
  }

  /**
   * Force check a specific member
   * @param {import("discord.js").GuildMember} member 
   */
  async forceCheckMember(member) {
    await this.checkMemberVanity(member);
  }
}