// src/systems/boosterSystem.js
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BoosterSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   * @param {import("./moderationSystem.js").ModerationSystem} moderationSystem
   */
  constructor(client, configLoader, moderationSystem) {
    this.client = client;
    this.configLoader = configLoader;
    this.moderationSystem = moderationSystem;
    
    // Load booster system config
    const boosterConfig = this.configLoader.get('boosterSystem') || {};
    this.config = {
      enabled: boosterConfig.enabled ?? true,
      dataFile: boosterConfig.dataFile || 'booster_data.json',
      boostMessageChannel: boosterConfig.boostMessageChannel || null,
      
      // Voice Channel Settings
      vcNameFormat: boosterConfig.vcNameFormat || "{username}'s Channel",
      vcUserLimit: boosterConfig.vcUserLimit || 10,
      vcBitrate: boosterConfig.vcBitrate || 64000,
      vcCategory: boosterConfig.vcCategory || null,
      
      // Role Settings  
      roleNameFormat: boosterConfig.roleNameFormat || "{username}'s Role",
      roleColor: boosterConfig.roleColor || 'Random', // 'Random' or hex color
      rolePosition: boosterConfig.rolePosition || null,
      roleHoist: boosterConfig.roleHoist ?? false,
      roleMentionable: boosterConfig.roleMentionable ?? false,
      
      // Cleanup
      checkInterval: boosterConfig.checkInterval || 86400000, // 24 hours in ms
      
      // Logging
      logChannel: boosterConfig.logChannel || null,
      enableLogging: boosterConfig.enableLogging ?? true
    };

    // Booster perks tracking
    this.boosterPerks = new Map(); // userId -> { claimed: Date, roles: [], channels: [], permRoles: [] }
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadBoosterData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
      this.startPeriodicCheck();
    }
  }

  /**
   * Load booster data from file
   */
  loadBoosterData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.boosterPerks = new Map(Object.entries(data));
        console.log(`[BoosterSystem] Loaded booster data for ${this.boosterPerks.size} users`);
      }
    } catch (error) {
      console.error('[BoosterSystem] Error loading booster data:', error);
    }
  }

  /**
   * Save booster data to file
   */
  saveBoosterData() {
    try {
      const data = Object.fromEntries(this.boosterPerks);
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[BoosterSystem] Error saving booster data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for boost messages
    if (this.config.boostMessageChannel) {
      this.client.on('messageCreate', async (message) => {
        if (message.channel.id === this.config.boostMessageChannel && 
            message.type === 8) { // USER_PREMIUM_GUILD_SUBSCRIPTION
          await this.handleBoostMessage(message);
        }
      });
    }

    // Clean up when member loses boost
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      // Check if member lost boost
      if (oldMember.premiumSince && !newMember.premiumSince) {
        await this.removeBoosterPerks(newMember.guild.id, newMember.id, 'Lost server boost');
      }
    });

    // Clean up when member leaves
    this.client.on('guildMemberRemove', async (member) => {
      await this.removeBoosterPerks(member.guild.id, member.id, 'Left server');
    });
  }

  /**
   * Start periodic check for boost status
   */
  startPeriodicCheck() {
    // Initial check on startup
    this.checkAllBoosters();

    // Set up interval
    setInterval(() => {
      this.checkAllBoosters();
    }, this.config.checkInterval);
  }

  /**
   * Check all boosters
   */
  async checkAllBoosters() {
    console.log('[BoosterSystem] Running periodic booster check...');

    for (const [userId, perks] of this.boosterPerks) {
      for (const guild of this.client.guilds.cache.values()) {
        const member = await guild.members.fetch(userId).catch(() => null);
        
        if (!member || !member.premiumSince) {
          // User not in guild or no longer boosting
          await this.removeBoosterPerks(guild.id, userId, 'No longer boosting (periodic check)');
        }
      }
    }
  }

  /**
   * Handle boost message
   * @param {import("discord.js").Message} message
   */
  async handleBoostMessage(message) {
    const embed = {
      title: '🎉 Thank you for boosting!',
      description: `Thank you ${message.author} for boosting the server!\n\nUse \`/claimboosterperks\` to claim your perks!`,
      color: 0xff73fa,
      timestamp: new Date().toISOString()
    };

    await message.reply({ embeds: [embed] });
  }

  /**
   * Claim booster perks
   * @param {import("discord.js").Guild} guild 
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async claimBoosterPerks(guild, member) {
    // Check if user is a booster
    if (!member.premiumSince) {
      return { success: false, error: 'You must be a server booster to claim perks.' };
    }

    // Check if already claimed
    const existingPerks = this.boosterPerks.get(member.id);
    if (existingPerks && existingPerks.permRoles?.length > 0) {
      return { success: false, error: 'You have already claimed your booster perks.' };
    }

    try {
      // Get permission roles from moderation system
      const permRoles = this.moderationSystem.config.permRoles;
      const rolesToAdd = [];

      // Add VC role
      if (permRoles.vc) {
        const vcRole = guild.roles.cache.get(permRoles.vc);
        if (vcRole) {
          await member.roles.add(vcRole, 'Booster perks claimed');
          rolesToAdd.push(permRoles.vc);
        }
      }

      // Add Pic role
      if (permRoles.pic) {
        const picRole = guild.roles.cache.get(permRoles.pic);
        if (picRole) {
          await member.roles.add(picRole, 'Booster perks claimed');
          rolesToAdd.push(permRoles.pic);
        }
      }

      // Add Link role
      if (permRoles.link) {
        const linkRole = guild.roles.cache.get(permRoles.link);
        if (linkRole) {
          await member.roles.add(linkRole, 'Booster perks claimed');
          rolesToAdd.push(permRoles.link);
        }
      }

      // Update tracking
      const perks = existingPerks || { roles: [], channels: [] };
      perks.claimed = new Date().toISOString();
      perks.permRoles = rolesToAdd;
      this.boosterPerks.set(member.id, perks);
      this.saveBoosterData();

      // Log action
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Booster Perks Claimed',
          user: member.user,
          roles: rolesToAdd.map(id => `<@&${id}>`).join(', ')
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[BoosterSystem] Error claiming perks:', error);
      return { success: false, error: 'Failed to claim perks. ' + error.message };
    }
  }

  /**
   * Create booster voice channel
   * @param {import("discord.js").Guild} guild 
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<{success: boolean, channel?: import("discord.js").VoiceChannel, error?: string}>}
   */
  async createBoosterVC(guild, member) {
    // Check if user has claimed perks
    const perks = this.boosterPerks.get(member.id);
    if (!perks || !perks.permRoles?.length) {
      return { success: false, error: 'You must claim your booster perks first using `/claimboosterperks`.' };
    }

    // Check if user already has a channel
    if (perks.channels?.some(id => guild.channels.cache.has(id))) {
      return { success: false, error: 'You already have a personal voice channel.' };
    }

    try {
      // Format channel name
      const channelName = this.config.vcNameFormat
        .replace('{username}', member.user.username)
        .replace('{tag}', member.user.tag)
        .replace('{id}', member.user.id);

      // Create access role for the channel
      const accessRole = await guild.roles.create({
        name: `${member.user.username}'s VC Access`,
        color: 0x808080,
        reason: `Booster VC access role for ${member.user.tag}`
      });

      // Give role to member
      await member.roles.add(accessRole, 'Booster VC created');

      // Create channel
      const channelOptions = {
        name: channelName,
        type: ChannelType.GuildVoice,
        userLimit: this.config.vcUserLimit,
        bitrate: this.config.vcBitrate,
        reason: `Booster VC for ${member.user.tag}`,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.Connect], // Deny @everyone
          },
          {
            id: accessRole.id,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] // Allow access role
          },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers
            ] // Owner permissions
          }
        ]
      };

      // Set category if configured
      if (this.config.vcCategory) {
        channelOptions.parent = this.config.vcCategory;
      }

      const channel = await guild.channels.create(channelOptions);

      // Update tracking
      perks.channels.push(channel.id);
      perks.vcAccessRole = accessRole.id;
      this.boosterPerks.set(member.id, perks);
      this.saveBoosterData();

      // Log creation
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Booster VC Created',
          user: member.user,
          channel: channel,
          accessRole: accessRole
        });
      }

      return { success: true, channel };
    } catch (error) {
      console.error('[BoosterSystem] Error creating booster VC:', error);
      return { success: false, error: 'Failed to create voice channel. ' + error.message };
    }
  }

  /**
   * Create booster role
   * @param {import("discord.js").Guild} guild 
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<{success: boolean, role?: import("discord.js").Role, error?: string}>}
   */
  async createBoosterRole(guild, member) {
    // Check if user has claimed perks
    const perks = this.boosterPerks.get(member.id);
    if (!perks || !perks.permRoles?.length) {
      return { success: false, error: 'You must claim your booster perks first using `/claimboosterperks`.' };
    }

    // Check if user already has a role
    if (perks.roles?.some(id => guild.roles.cache.has(id))) {
      return { success: false, error: 'You already have a personal role.' };
    }

    try {
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
        reason: `Booster role for ${member.user.tag}`
      };

      // Set position if configured
      if (this.config.rolePosition !== null) {
        roleOptions.position = this.config.rolePosition;
      }

      const role = await guild.roles.create(roleOptions);

      // Give role to member
      await member.roles.add(role, 'Booster role created');

      // Update tracking
      perks.roles.push(role.id);
      this.boosterPerks.set(member.id, perks);
      this.saveBoosterData();

      // Log creation
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Booster Role Created',
          user: member.user,
          role: role
        });
      }

      return { success: true, role };
    } catch (error) {
      console.error('[BoosterSystem] Error creating booster role:', error);
      return { success: false, error: 'Failed to create role. ' + error.message };
    }
  }

  /**
   * Delete booster items
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} type - 'channel' or 'role'
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteBoosterItems(guildId, userId, type) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild not found' };

    const perks = this.boosterPerks.get(userId);
    if (!perks) return { success: false, error: 'No booster perks found' };

    try {
      // Delete channels
      if (type === 'channel') {
        for (const channelId of perks.channels || []) {
          const channel = guild.channels.cache.get(channelId);
          if (channel) {
            await channel.delete('Booster channel deletion requested');
          }
        }

        // Delete access role
        if (perks.vcAccessRole) {
          const role = guild.roles.cache.get(perks.vcAccessRole);
          if (role) {
            await role.delete('Booster VC access role deletion');
          }
        }

        perks.channels = [];
        perks.vcAccessRole = null;
      }

      // Delete roles
      if (type === 'role') {
        for (const roleId of perks.roles || []) {
          const role = guild.roles.cache.get(roleId);
          if (role) {
            await role.delete('Booster role deletion requested');
          }
        }
        perks.roles = [];
      }

      // Update tracking
      this.boosterPerks.set(userId, perks);
      this.saveBoosterData();

      // Log deletion
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: `Booster ${type === 'channel' ? 'Channel' : 'Role'} Deleted`,
          userId: userId,
          type: type
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[BoosterSystem] Error deleting items:', error);
      return { success: false, error: 'Failed to delete items. ' + error.message };
    }
  }

  /**
   * Remove all booster perks
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} reason 
   */
  async removeBoosterPerks(guildId, userId, reason) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const perks = this.boosterPerks.get(userId);
    if (!perks) return;

    const member = await guild.members.fetch(userId).catch(() => null);

    try {
      // Remove permission roles
      if (member && perks.permRoles) {
        for (const roleId of perks.permRoles) {
          const role = guild.roles.cache.get(roleId);
          if (role && member.roles.cache.has(roleId)) {
            await member.roles.remove(role, reason);
          }
        }
      }

      // Delete channels
      for (const channelId of perks.channels || []) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          await channel.delete(reason);
        }
      }

      // Delete VC access role
      if (perks.vcAccessRole) {
        const role = guild.roles.cache.get(perks.vcAccessRole);
        if (role) {
          await role.delete(reason);
        }
      }

      // Delete personal roles
      for (const roleId of perks.roles || []) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
          await role.delete(reason);
        }
      }

      // Remove from tracking
      this.boosterPerks.delete(userId);
      this.saveBoosterData();

      // Log removal
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Booster Perks Removed',
          userId: userId,
          reason: reason
        });
      }
    } catch (error) {
      console.error('[BoosterSystem] Error removing perks:', error);
    }
  }

  /**
   * Get user's booster perks
   * @param {string} userId 
   * @returns {Object}
   */
  getUserPerks(userId) {
    return this.boosterPerks.get(userId) || null;
  }

  /**
   * Log action
   * @param {import("discord.js").Guild} guild 
   * @param {Object} data 
   */
  async logAction(guild, data) {
    if (!this.config.enableLogging || !this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = {
      title: `Booster System: ${data.action}`,
      color: data.action.includes('Created') || data.action.includes('Claimed') ? 0x00ff00 : 0xff0000,
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

    if (data.accessRole) {
      embed.fields.push({
        name: 'Access Role',
        value: `${data.accessRole.name} (${data.accessRole.id})`,
        inline: true
      });
    }

    if (data.roles) {
      embed.fields.push({
        name: 'Permission Roles',
        value: data.roles,
        inline: false
      });
    }

    if (data.reason) {
      embed.fields.push({
        name: 'Reason',
        value: data.reason,
        inline: false
      });
    }

    if (data.type) {
      embed.fields.push({
        name: 'Type',
        value: data.type,
        inline: true
      });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[BoosterSystem] Failed to log action:', error);
    }
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('boosterSystem', this.config);
    return this.configLoader.save();
  }
}