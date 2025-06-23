// src/systems/j2cManager.js
import {
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { EventEmitter } from 'events';

export class J2CManager extends EventEmitter {
  /**
   * @param {import('discord.js').Client} client
   * @param {ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    super();
    this.client = client;
    this.config = configLoader;
    
    // Map to store J2C channel info: guildId -> { j2cChannelId, categoryId }
    this.j2cChannels = new Map();
    
    // Map to store created channels: channelId -> { ownerId, guildId }
    this.createdChannels = new Map();
    
    // Map to store user -> channelId (for quick lookup)
    this.userChannels = new Map();

    // Load persisted J2C channel after client is ready
    this.client.once('ready', () => {
      this._loadPersistedJ2CData();
    });

    this.setupEventHandlers();
  }

  /**
   * Load persisted J2C data from config
   */
  _loadPersistedJ2CData() {
    const j2cData = this.config.get("j2c.guilds") || {};
    
    for (const [guildId, data] of Object.entries(j2cData)) {
      // Skip null or undefined data entries
      if (!data) continue;
      
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      
      // Verify channel still exists
      const channel = guild.channels.cache.get(data.j2cChannelId);
      const category = guild.channels.cache.get(data.categoryId);
      
      if (channel && channel.type === ChannelType.GuildVoice) {
        this.j2cChannels.set(guildId, {
          j2cChannelId: data.j2cChannelId,
          categoryId: category ? data.categoryId : null
        });
      }
    }
  }

  setupEventHandlers() {
    // Voice state updates
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      try {
        // Joined a channel
        if (!oldState.channelId && newState.channelId) {
          await this.handleUserJoin(newState);
        }
        // Left a channel
        else if (oldState.channelId && !newState.channelId) {
          await this.handleUserLeave(oldState);
        }
        // Switched channels
        else if (oldState.channelId !== newState.channelId) {
          await this.handleUserLeave(oldState);
          await this.handleUserJoin(newState);
        }
      } catch (error) {
        console.error('[J2C] Error in voiceStateUpdate:', error);
      }
    });

    // Channel deletion cleanup
    this.client.on('channelDelete', (channel) => {
      if (this.createdChannels.has(channel.id)) {
        const info = this.createdChannels.get(channel.id);
        this.userChannels.delete(info.ownerId);
        this.createdChannels.delete(channel.id);
      }

      // If J2C channel itself is deleted, clear from config
      const j2cData = this.j2cChannels.get(channel.guild.id);
      if (j2cData && j2cData.j2cChannelId === channel.id) {
        this.j2cChannels.delete(channel.guild.id);
        this.config.set(`j2c.guilds.${channel.guild.id}`, null);
        this.config.save().catch(console.error);
      }
      
      // If a category is deleted that contains J2C channels, update the config
      if (channel.type === ChannelType.GuildCategory && j2cData && j2cData.categoryId === channel.id) {
        j2cData.categoryId = null;
        this.config.set(`j2c.guilds.${channel.guild.id}.categoryId`, null);
        this.config.save().catch(console.error);
        console.log(`[J2C] Category deleted for guild ${channel.guild.id}, J2C will create channels without category`);
      }
    });
  }

  async handleUserJoin(voiceState) {
    const { member, channel, guild } = voiceState;
    if (!member || !channel) return;

    // Check if this is the J2C channel
    const j2cData = this.j2cChannels.get(guild.id);
    if (!j2cData || channel.id !== j2cData.j2cChannelId) return;

    // Check if user already owns a channel
    if (this.userChannels.has(member.id)) {
      const existingChannelId = this.userChannels.get(member.id);
      const existingChannel = guild.channels.cache.get(existingChannelId);
      if (existingChannel) {
        await member.voice.setChannel(existingChannel);
        return;
      } else {
        // Clean up stale reference
        this.userChannels.delete(member.id);
        this.createdChannels.delete(existingChannelId);
      }
    }

    // Get the category to create channel in
    let categoryId = j2cData.categoryId;
    
    // Verify the category still exists
    if (categoryId) {
      const category = guild.channels.cache.get(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        console.error('[J2C] Category no longer exists, creating channel without category');
        categoryId = null;
        
        // Update the stored data to reflect the missing category
        j2cData.categoryId = null;
        this.config.set(`j2c.guilds.${guild.id}.categoryId`, null);
        this.config.save().catch(console.error);
      }
    }
    
    const channelName = `${member.displayName}'s Channel`;
    
    const newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.PrioritySpeaker
          ]
        },
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        }
      ]
    });

    // Store channel info
    this.createdChannels.set(newChannel.id, {
      ownerId: member.id,
      guildId: guild.id
    });
    this.userChannels.set(member.id, newChannel.id);

    // Move user to their new channel
    await member.voice.setChannel(newChannel);

    // Log if configured
    if (this.config.get('j2c.logChannel')) {
      const logChannel = guild.channels.cache.get(this.config.get('j2c.logChannel'));
      if (logChannel) {
        await logChannel.send(`Channel created for ${member.displayName}`);
      }
    }

    this.emit('channelCreated', { channel: newChannel, owner: member, guild });
  }

  async handleUserLeave(voiceState) {
    const { channel, member } = voiceState;
    if (!channel || !member) return;

    // Check if this is a created channel
    if (!this.createdChannels.has(channel.id)) return;
    const channelInfo = this.createdChannels.get(channel.id);

    // Count remaining members
    const remaining = channel.members.filter(m => m.id !== member.id);

    // Delete empty channel
    if (remaining.size === 0) {
      await channel.delete().catch(console.error);
      this.userChannels.delete(channelInfo.ownerId);
      this.createdChannels.delete(channel.id);
      this.emit('channelDeleted', { channelId: channel.id, ownerId: channelInfo.ownerId });
      return;
    }

    // Don't auto-transfer ownership when owner leaves
    // They can reclaim it with /vc take when they return
  }

  /**
   * Setup J2C channel for a guild
   */
  async setupJ2C(guild, channelName, categoryName) {
    // Check if already exists
    const existingData = this.j2cChannels.get(guild.id);
    if (existingData) {
      const existingChannel = guild.channels.cache.get(existingData.j2cChannelId);
      if (existingChannel) {
        return { success: false, message: 'J2C channel already exists', channel: existingChannel };
      }
      // Clean up stale reference
      this.j2cChannels.delete(guild.id);
      this.config.set(`j2c.guilds.${guild.id}`, null);
      await this.config.save();
    }

    // Create category for J2C channels
    const category = await guild.channels.create({
      name: categoryName || this.config.get('j2c.defaultCategoryName') || 'Voice Channels',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });

    // Create J2C channel in the category
    const j2cChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        }
      ]
    });

    // Save to memory and config
    this.j2cChannels.set(guild.id, {
      j2cChannelId: j2cChannel.id,
      categoryId: category.id
    });
    
    this.config.set(`j2c.guilds.${guild.id}`, {
      j2cChannelId: j2cChannel.id,
      categoryId: category.id,
      createdAt: new Date().toISOString()
    });
    
    await this.config.save();

    return { 
      success: true, 
      channel: j2cChannel,
      category: category 
    };
  }

  getChannelOwner(channelId) {
    const info = this.createdChannels.get(channelId);
    return info ? info.ownerId : null;
  }

  isUserOwner(userId, channelId) {
    return this.getChannelOwner(channelId) === userId;
  }

  getUserChannel(userId) {
    return this.userChannels.get(userId);
  }

  async takeOwnership(channel, userId) {
    // Check if this is a created channel
    const channelInfo = this.createdChannels.get(channel.id);
    if (!channelInfo) {
      return { success: false, message: 'This is not a created voice channel' };
    }
    
    // Check if user is in the channel
    if (!channel.members.has(userId)) {
      return { success: false, message: 'You must be in the voice channel to take ownership' };
    }
    
    // Check if current owner is in the channel
    const currentOwner = channelInfo.ownerId;
    if (channel.members.has(currentOwner)) {
      return { success: false, message: 'The owner is currently in the channel' };
    }
    
    // Check if user already owns a channel
    const existingChannel = this.getUserChannel(userId);
    if (existingChannel && existingChannel !== channel.id) {
      return { success: false, message: 'You already own another voice channel' };
    }
    
    // Transfer ownership
    try {
      const member = channel.members.get(userId);
      
      // Grant new owner permissions
      await channel.permissionOverwrites.edit(userId, {
        Connect: true,
        Speak: true,
        MuteMembers: true,
        DeafenMembers: true,
        MoveMembers: true,
        ManageChannels: true,
        PrioritySpeaker: true
      });
      
      // Remove old owner permissions (if they have overrides)
      const oldOwnerOverwrite = channel.permissionOverwrites.cache.get(currentOwner);
      if (oldOwnerOverwrite) {
        await channel.permissionOverwrites.delete(currentOwner);
      }
      
      // Update records
      this.userChannels.delete(currentOwner);
      this.userChannels.set(userId, channel.id);
      channelInfo.ownerId = userId;
      
      // Rename channel
      await channel.setName(`${member.displayName}'s Channel`);
      
      this.emit('ownershipTransferred', {
        channel,
        oldOwnerId: currentOwner,
        newOwner: member
      });
      
      return { 
        success: true, 
        message: `You have taken ownership of the voice channel` 
      };
    } catch (error) {
      console.error('[J2C] Error taking ownership:', error);
      return { success: false, message: 'Failed to take ownership of the channel' };
    }
  }

  async lockChannel(channel, userId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    await channel.permissionOverwrites.edit(channel.guild.id, { Connect: false });
    return { success: true };
  }

  async unlockChannel(channel, userId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    await channel.permissionOverwrites.edit(channel.guild.id, { Connect: true });
    return { success: true };
  }

  async rejectUser(channel, userId, targetUserId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    if (userId === targetUserId) {
      return { success: false, message: 'You cannot reject yourself' };
    }
    
    await channel.permissionOverwrites.edit(targetUserId, {
      ViewChannel: false,
      Connect: false
    });
    
    const targetMember = channel.members.get(targetUserId);
    if (targetMember) {
      await targetMember.voice.disconnect();
    }
    return { success: true };
  }

  async allowUser(channel, userId, targetUserId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    await channel.permissionOverwrites.delete(targetUserId);
    return { success: true };
  }

  async setUserLimit(channel, userId, limit) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    if (limit < 0 || limit > 99) {
      return { success: false, message: 'Limit must be between 0 and 99' };
    }
    await channel.setUserLimit(limit);
    return { success: true };
  }

  async renameChannel(channel, userId, newName) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel' };
    }
    if (newName.length > 100) {
      return { success: false, message: 'Channel name must be less than 100 characters' };
    }
    await channel.setName(newName);
    return { success: true };
  }
}