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
    
    // Map to store J2C channel info: guildId -> j2cChannelId
    this.j2cChannels = new Map();
    
    // Map to store created channels: channelId -> { ownerId, guildId }
    this.createdChannels = new Map();
    
    // Map to store user -> channelId (for quick lookup)
    this.userChannels = new Map();

    // Load persisted J2C channel after client is ready
    this.client.once('ready', () => {
      this._loadPersistedJ2CChannel();
    });

    this.setupEventHandlers();
  }

  /**
   * Load persisted J2C channel from config
   */
  _loadPersistedJ2CChannel() {
    const persistedId = this.config.get("j2c.j2cChannelId");
    if (!persistedId) return;

    // Find the guild that has this voice channel
    for (const [guildId, guild] of this.client.guilds.cache) {
      const channel = guild.channels.cache.get(persistedId);
      if (channel && channel.type === ChannelType.GuildVoice) {
        this.j2cChannels.set(guildId, persistedId);
        break;
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
      if (this.j2cChannels.has(channel.guild.id) && this.j2cChannels.get(channel.guild.id) === channel.id) {
        this.j2cChannels.delete(channel.guild.id);
        this.config.set("j2c.j2cChannelId", null);
        this.config.save().catch(console.error);
      }
    });
  }

  async handleUserJoin(voiceState) {
    const { member, channel, guild } = voiceState;
    if (!member || !channel) return;

    // Check if this is the J2C channel
    const j2cChannelId = this.j2cChannels.get(guild.id);
    if (!j2cChannelId || channel.id !== j2cChannelId) return;

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

    // Create new voice channel
    const parentCategory = channel.parentId ? channel.parent : null;
    const channelName = `${member.displayName}'s Channel`;
    
    const newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: parentCategory,
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

    // Transfer ownership if owner left
    if (channelInfo.ownerId === member.id) {
      const newOwner = remaining.first();

      // Grant new owner permissions
      await channel.permissionOverwrites.edit(newOwner.id, {
        Connect: true,
        Speak: true,
        MuteMembers: true,
        DeafenMembers: true,
        MoveMembers: true,
        ManageChannels: true,
        PrioritySpeaker: true
      });

      // Remove old owner permissions
      await channel.permissionOverwrites.delete(member.id);

      // Update records
      channelInfo.ownerId = newOwner.id;
      this.userChannels.delete(member.id);
      this.userChannels.set(newOwner.id, channel.id);

      // Rename channel
      await channel.setName(`${newOwner.displayName}'s Channel`);

      this.emit('ownershipTransferred', {
        channel,
        oldOwner: member,
        newOwner
      });
    }
  }

  /**
   * Setup J2C channel for a guild
   */
  async setupJ2C(guild, channelName) {
    // Check if already exists
    if (this.j2cChannels.has(guild.id)) {
      const existingId = this.j2cChannels.get(guild.id);
      const existing = guild.channels.cache.get(existingId);
      if (existing) {
        return { success: false, message: 'J2C channel already exists', channel: existing };
      }
      // Clean up stale reference
      this.j2cChannels.delete(guild.id);
      this.config.set("j2c.j2cChannelId", null);
      await this.config.save();
    }

    // Get category from config if specified
    const categoryId = this.config.get('j2c.categoryId');
    const category = categoryId ? guild.channels.cache.get(categoryId) : null;

    // Create J2C channel
    const j2cChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: category,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        }
      ]
    });

    // Save to memory and config
    this.j2cChannels.set(guild.id, j2cChannel.id);
    this.config.set("j2c.j2cChannelId", j2cChannel.id);
    await this.config.save();

    return { success: true, channel: j2cChannel };
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