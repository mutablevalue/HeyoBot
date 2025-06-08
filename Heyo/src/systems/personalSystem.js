// src/systems/personalSystem.js
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PersonalSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load personal system config
    const personalConfig = this.configLoader.get('personalSystem') || {};
    this.config = {
      enabled: personalConfig.enabled ?? true,
      dataFile: personalConfig.dataFile || 'personal_data.json',
      
      // Requirements
      requireBooster: personalConfig.requireBooster ?? true,
      requiredRoles: personalConfig.requiredRoles || [],
      blacklistedRoles: personalConfig.blacklistedRoles || [],
      
      // Voice Channel Settings
      vcEnabled: personalConfig.vcEnabled ?? true,
      vcCategory: personalConfig.vcCategory || null,
      vcNameFormat: personalConfig.vcNameFormat || "{username}'s Channel",
      vcUserLimit: personalConfig.vcUserLimit || 10,
      vcBitrate: personalConfig.vcBitrate || 64000,
      vcPermissions: personalConfig.vcPermissions || {
        manage: true,        // Can manage channel
        moveMembers: true,   // Can move members
        muteMembers: true,   // Can mute members
        deafenMembers: true, // Can deafen members
      },
      
      // Role Settings
      roleEnabled: personalConfig.roleEnabled ?? true,
      rolePosition: personalConfig.rolePosition || null, // Position to place role (null = bottom)
      roleNameFormat: personalConfig.roleNameFormat || "{username}'s Role",
      roleColor: personalConfig.roleColor || 'Random', // 'Random' or hex color
      rolePermissions: personalConfig.rolePermissions || [], // Additional permissions for the role
      roleHoist: personalConfig.roleHoist ?? false,
      roleMentionable: personalConfig.roleMentionable ?? false,
      
      // Limits
      maxPerUser: personalConfig.maxPerUser || 1, // Max personal items per user
      
      // Cleanup
      deleteOnBoostEnd: personalConfig.deleteOnBoostEnd ?? true,
      deleteOnLeave: personalConfig.deleteOnLeave ?? true,
      
      // Logging
      logChannel: personalConfig.logChannel || null
    };

    // Personal items tracking
    this.personalItems = new Map(); // userId -> { roles: [], channels: [] }
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadPersonalData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Load personal data from file
   */
  loadPersonalData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.personalItems = new Map(Object.entries(data));
        console.log(`[PersonalSystem] Loaded personal data for ${this.personalItems.size} users`);
      }
    } catch (error) {
      console.error('[PersonalSystem] Error loading personal data:', error);
    }
  }

  /**
   * Save personal data to file
   */
  savePersonalData() {
    try {
      const data = Object.fromEntries(this.personalItems);
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[PersonalSystem] Error saving personal data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Clean up when member loses boost
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      if (this.config.deleteOnBoostEnd && this.config.requireBooster) {
        // Check if member lost boost
        if (oldMember.premiumSince && !newMember.premiumSince) {
          await this.cleanupUserItems(newMember.guild.id, newMember.id, 'Lost server boost');
        }
      }
    });

    // Clean up when member leaves
    this.client.on('guildMemberRemove', async (member) => {
      if (this.config.deleteOnLeave) {
        await this.cleanupUserItems(member.guild.id, member.id, 'Left server');
      }
    });

    // Clean up on bot ready (remove items for users no longer in server)
    this.client.once('ready', async () => {
      await this.cleanupOrphanedItems();
    });
  }

  /**
   * Check if user meets requirements
   * @param {import("discord.js").GuildMember} member 
   * @returns {{eligible: boolean, reason: string}}
   */
  checkRequirements(member) {
    // Check booster requirement
    if (this.config.requireBooster && !member.premiumSince) {
      return { eligible: false, reason: 'You must be a server booster to use this feature.' };
    }

    // Check required roles
    if (this.config.requiredRoles.length > 0) {
      const hasRequired = this.config.requiredRoles.some(roleId => member.roles.cache.has(roleId));
      if (!hasRequired) {
        return { eligible: false, reason: 'You do not have the required role to use this feature.' };
      }
    }

    // Check blacklisted roles
    if (this.config.blacklistedRoles.length > 0) {
      const hasBlacklisted = this.config.blacklistedRoles.some(roleId => member.roles.cache.has(roleId));
      if (hasBlacklisted) {
        return { eligible: false, reason: 'You have a role that prevents you from using this feature.' };
      }
    }

    return { eligible: true, reason: '' };
  }

  /**
   * Create personal voice channel
   * @param {import("discord.js").Guild} guild 
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<{success: boolean, channel?: import("discord.js").VoiceChannel, error?: string}>}
   */
  async createPersonalVC(guild, member) {
    if (!this.config.vcEnabled) {
      return { success: false, error: 'Personal voice channels are disabled.' };
    }

    try {
      // Check existing items
      const userItems = this.personalItems.get(member.id) || { roles: [], channels: [] };
      const existingChannels = userItems.channels.filter(id => guild.channels.cache.has(id));
      
      if (existingChannels.length >= this.config.maxPerUser) {
        return { success: false, error: `You already have the maximum number of personal voice channels (${this.config.maxPerUser}).` };
      }

      // Format channel name
      const channelName = this.config.vcNameFormat
        .replace('{username}', member.user.username)
        .replace('{tag}', member.user.tag)
        .replace('{id}', member.user.id);

      // Create channel
      const channelOptions = {
        name: channelName,
        type: ChannelType.GuildVoice,
        userLimit: this.config.vcUserLimit,
        bitrate: this.config.vcBitrate,
        reason: `Personal VC for ${member.user.tag}`,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.Connect], // Deny @everyone by default
          },
          {
            id: member.id,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] // Allow owner
          }
        ]
      };

      // Add management permissions
      const managementPerms = [];
      if (this.config.vcPermissions.manage) {
        managementPerms.push(PermissionFlagsBits.ManageChannels);
      }
      if (this.config.vcPermissions.moveMembers) {
        managementPerms.push(PermissionFlagsBits.MoveMembers);
      }
      if (this.config.vcPermissions.muteMembers) {
        managementPerms.push(PermissionFlagsBits.MuteMembers);
      }
      if (this.config.vcPermissions.deafenMembers) {
        managementPerms.push(PermissionFlagsBits.DeafenMembers);
      }

      if (managementPerms.length > 0) {
        channelOptions.permissionOverwrites[1].allow = [
          ...channelOptions.permissionOverwrites[1].allow,
          ...managementPerms
        ];
      }

      // Set category if configured
      if (this.config.vcCategory) {
        channelOptions.parent = this.config.vcCategory;
      }

      const channel = await guild.channels.create(channelOptions);

      // Update tracking
      userItems.channels.push(channel.id);
      this.personalItems.set(member.id, userItems);
      this.savePersonalData();

      // Log creation
      await this.logAction(guild, {
        action: 'Personal VC Created',
        user: member.user,
        channel: channel,
        type: 'voice'
      });

      return { success: true, channel };
    } catch (error) {
      console.error('[PersonalSystem] Error creating personal VC:', error);
      return { success: false, error: 'Failed to create voice channel. ' + error.message };
    }
  }

  /**
   * Create personal role
   * @param {import("discord.js").Guild} guild 
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<{success: boolean, role?: import("discord.js").Role, error?: string}>}
   */
  async createPersonalRole(guild, member) {
    if (!this.config.roleEnabled) {
      return { success: false, error: 'Personal roles are disabled.' };
    }

    try {
      // Check existing items
      const userItems = this.personalItems.get(member.id) || { roles: [], channels: [] };
      const existingRoles = userItems.roles.filter(id => guild.roles.cache.has(id));
      
      if (existingRoles.length >= this.config.maxPerUser) {
        return { success: false, error: `You already have the maximum number of personal roles (${this.config.maxPerUser}).` };
      }

      // Format role name
      const roleName = this.config.roleNameFormat
        .replace('{username}', member.user.username)
        .replace('{tag}', member.user.tag)
        .replace('{id}', member.user.id);

      // Determine color
      let color = this.config.roleColor;
      if (color === 'Random') {
        color = Math.floor(Math.random() * 16777215); // Random color
      }

      // Create role
      const roleOptions = {
        name: roleName,
        color: color,
        hoist: this.config.roleHoist,
        mentionable: this.config.roleMentionable,
        permissions: this.config.rolePermissions,
        reason: `Personal role for ${member.user.tag}`
      };

      // Set position if configured
      if (this.config.rolePosition !== null) {
        roleOptions.position = this.config.rolePosition;
      }

      const role = await guild.roles.create(roleOptions);

      // Give role to member
      await member.roles.add(role, 'Personal role created');

      // Update tracking
      userItems.roles.push(role.id);
      this.personalItems.set(member.id, userItems);
      this.savePersonalData();

      // Log creation
      await this.logAction(guild, {
        action: 'Personal Role Created',
        user: member.user,
        role: role,
        type: 'role'
      });

      return { success: true, role };
    } catch (error) {
      console.error('[PersonalSystem] Error creating personal role:', error);
      return { success: false, error: 'Failed to create role. ' + error.message };
    }
  }

  /**
   * Delete personal items
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} type - 'all', 'role', or 'channel'
   * @returns {Promise<{success: boolean, deleted: {roles: number, channels: number}}>}
   */
  async deletePersonalItems(guildId, userId, type = 'all') {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { success: false, deleted: { roles: 0, channels: 0 } };

    const userItems = this.personalItems.get(userId) || { roles: [], channels: [] };
    const deleted = { roles: 0, channels: 0 };

    // Delete roles
    if (type === 'all' || type === 'role') {
      for (const roleId of userItems.roles) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
          try {
            await role.delete('Personal role deletion requested');
            deleted.roles++;
          } catch (error) {
            console.error(`[PersonalSystem] Failed to delete role ${roleId}:`, error);
          }
        }
      }
      userItems.roles = [];
    }

    // Delete channels
    if (type === 'all' || type === 'channel') {
      for (const channelId of userItems.channels) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          try {
            await channel.delete('Personal channel deletion requested');
            deleted.channels++;
          } catch (error) {
            console.error(`[PersonalSystem] Failed to delete channel ${channelId}:`, error);
          }
        }
      }
      userItems.channels = [];
    }

    // Update tracking
    if (userItems.roles.length === 0 && userItems.channels.length === 0) {
      this.personalItems.delete(userId);
    } else {
      this.personalItems.set(userId, userItems);
    }
    this.savePersonalData();

    return { success: true, deleted };
  }

  /**
   * Clean up user's personal items
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} reason 
   */
  async cleanupUserItems(guildId, userId, reason) {
    const result = await this.deletePersonalItems(guildId, userId, 'all');
    
    if (result.deleted.roles > 0 || result.deleted.channels > 0) {
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        await this.logAction(guild, {
          action: 'Personal Items Cleaned Up',
          userId: userId,
          reason: reason,
          deleted: result.deleted
        });
      }
    }
  }

  /**
   * Clean up orphaned items (items for users no longer in server)
   */
  async cleanupOrphanedItems() {
    for (const [userId, items] of this.personalItems) {
      for (const guild of this.client.guilds.cache.values()) {
        const member = await guild.members.fetch(userId).catch(() => null);
        
        if (!member) {
          // User not in guild, clean up their items in this guild
          await this.cleanupUserItems(guild.id, userId, 'User no longer in server');
        } else if (this.config.requireBooster && !member.premiumSince) {
          // User no longer boosting
          await this.cleanupUserItems(guild.id, userId, 'No longer boosting');
        }
      }
    }
  }

  /**
   * Get user's personal items
   * @param {string} userId 
   * @returns {Object}
   */
  getUserItems(userId) {
    return this.personalItems.get(userId) || { roles: [], channels: [] };
  }

  /**
   * Log action
   * @param {import("discord.js").Guild} guild 
   * @param {Object} data 
   */
  async logAction(guild, data) {
    if (!this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = {
      title: `Personal System: ${data.action}`,
      color: data.action.includes('Created') ? 0x00ff00 : 0xff0000,
      fields: [],
      timestamp: new Date().toISOString()
    };

    if (data.user) {
      embed.fields.push({
        name: 'User',
        value: `${data.user.tag} (${data.user.id})`,
        inline: true
      });
    } else if (data.userId) {
      embed.fields.push({
        name: 'User ID',
        value: data.userId,
        inline: true
      });
    }

    if (data.channel) {
      embed.fields.push({
        name: 'Channel',
        value: `${data.channel.name} (${data.channel.id})`,
        inline: true
      });
    }

    if (data.role) {
      embed.fields.push({
        name: 'Role',
        value: `${data.role.name} (${data.role.id})`,
        inline: true
      });
    }

    if (data.reason) {
      embed.fields.push({
        name: 'Reason',
        value: data.reason,
        inline: false
      });
    }

    if (data.deleted) {
      embed.fields.push({
        name: 'Deleted',
        value: `Roles: ${data.deleted.roles}, Channels: ${data.deleted.channels}`,
        inline: false
      });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[PersonalSystem] Failed to log action:', error);
    }
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('personalSystem', this.config);
    return this.configLoader.save();
  }
}