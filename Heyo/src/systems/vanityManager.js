// src/systems/vanityManager.js
import { EmbedLoader } from '../utils/embedLoader.js';

export class VanityManager {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = new EmbedLoader(configLoader);
    
    // Load vanity config - no defaults
    const vanityConfig = this.configLoader.get('vanity');
    if (!vanityConfig) {
      console.error('[VanityManager] No vanity configuration found');
      return;
    }
    
    this.config = vanityConfig;

    this.checkInterval = null;
    this.lastCheck = new Date();

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
    this.configLoader.set('vanity', this.config);
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

    // Check on presence update (status/activities change)
    this.client.on('presenceUpdate', async (oldPresence, newPresence) => {
      if (!this.config.enabled) return;
      if (!this.config.checkStatus) return;
      
      // Get member from presence
      const member = newPresence.member;
      if (!member || member.user.bot) return;
      
      // Check if status changed
      const oldStatus = oldPresence?.activities?.find(a => a.type === 4)?.state;
      const newStatus = newPresence?.activities?.find(a => a.type === 4)?.state;
      
      if (oldStatus !== newStatus) {
        await this.checkMemberVanity(member);
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

    for (const guild of this.client.guilds.cache.values()) {
      // Only check members who already have vanity roles
      for (const roleId of this.config.roles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        
        // Check each member with this role
        for (const [memberId, member] of role.members) {
          if (!member.user.bot) {
            await this.checkMemberVanity(member);
          }
        }
      }
      
      // Also check members without roles to see if they should get one
      for (const member of guild.members.cache.values()) {
        if (!member.user.bot && !this.hasAnyVanityRole(member)) {
          await this.checkMemberVanity(member);
        }
      }
    }
  }

  /**
   * Check if member has any vanity role
   * @param {import("discord.js").GuildMember} member 
   * @returns {boolean}
   */
  hasAnyVanityRole(member) {
    return this.config.roles.some(roleId => member.roles.cache.has(roleId));
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

      const hasVanity = await this.memberHasVanity(member);
      const currentRoles = member.roles.cache;

      for (const roleId of this.config.roles) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) continue;

        const hasRole = currentRoles.has(roleId);

        // Only add role if they have vanity and don't have the role
        if (hasVanity && !hasRole) {
          try {
            await member.roles.add(role, 'Has vanity in name/bio/status');
            await this.logAction(member.guild, {
              action: 'Role Added',
              member: member,
              role: role,
              reason: 'Has vanity in name/bio/status'
            });
          } catch (error) {
            console.error(`[VanityManager] Failed to add role to ${member.user.tag}:`, error);
          }
        } 
        // Only remove role if they DON'T have vanity AND they HAVE the role AND removal is enabled
        else if (!hasVanity && hasRole && this.config.removeOnVanityLoss) {
          try {
            await member.roles.remove(role, 'No longer has vanity in name/bio/status');
            await this.logAction(member.guild, {
              action: 'Role Removed',
              member: member,
              role: role,
              reason: 'No longer has vanity in name/bio/status'
            });
          } catch (error) {
            console.error(`[VanityManager] Failed to remove role from ${member.user.tag}:`, error);
          }
        }
        // If they don't have vanity and don't have the role, do nothing (this was the bug)
      }
    } catch (error) {
      console.error('[VanityManager] Error checking member vanity:', error);
    }
  }

  /**
   * Check if member has any vanity string in their name, bio, or status
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<boolean>}
   */
  async memberHasVanity(member) {
    const stringsToCheck = [];
    
    // Check username
    if (this.config.checkUsername) {
      stringsToCheck.push(member.user.username);
    }
    
    // Check nickname
    if (this.config.checkNickname && member.nickname) {
      stringsToCheck.push(member.nickname);
    }

    // Check bio (about me)
    if (this.config.checkBio) {
      try {
        // Fetch full user profile to get bio
        const user = await this.client.users.fetch(member.user.id, { force: true });
        // Note: Discord.js doesn't directly expose bio, this would need additional implementation
        // For now, we'll skip bio checking as it requires additional API calls
      } catch (error) {
        // Bio fetching failed, skip
      }
    }

    // Check custom status
    if (this.config.checkStatus) {
      const presence = member.presence;
      if (presence) {
        const customStatus = presence.activities.find(activity => activity.type === 4);
        if (customStatus && customStatus.state) {
          stringsToCheck.push(customStatus.state);
        }
      }
    }

    // Check all strings for vanity
    for (const str of stringsToCheck) {
      for (const vanity of this.config.vanityStrings) {
        if (this.config.caseSensitive) {
          if (str.includes(vanity)) return true;
        } else {
          if (str.toLowerCase().includes(vanity.toLowerCase())) return true;
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
    return member.roles.cache.some(role => this.config.exemptRoles?.includes(role.id));
  }

  /**
   * Log vanity action
   * @param {import("discord.js").Guild} guild 
   * @param {Object} data 
   */
  async logAction(guild, data) {
    if (!this.config.enableLogging || !this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = this.embedLoader.createEmbed({
      title: `Vanity ${data.action}`,
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
      ]
    });

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
    if (!this.config.vanityStrings) this.config.vanityStrings = [];
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
    if (!this.config.vanityStrings) return false;
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
    if (!this.config.roles) this.config.roles = [];
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
    if (!this.config.roles) return false;
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
   * Get vanity system configuration
   */
  getConfig() {
    return {
      enabled: this.config.enabled,
      lastCheck: this.lastCheck,
      nextCheck: this.checkInterval ? new Date(this.lastCheck.getTime() + (this.config.checkIntervalSeconds * 1000)) : null,
      vanityStrings: this.config.vanityStrings?.length || 0,
      roles: this.config.roles?.length || 0,
      checkingSettings: {
        username: this.config.checkUsername,
        nickname: this.config.checkNickname,
        bio: this.config.checkBio,
        status: this.config.checkStatus
      }
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