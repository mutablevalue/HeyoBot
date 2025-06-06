import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';
import { EventEmitter } from 'events';

export class J2CManager extends EventEmitter {
  constructor(client, config) {
    super();
    this.client = client;
    this.config = config;
    
    // Map to store J2C channel info: guildId -> j2cChannelId
    this.j2cChannels = new Map();
    
    // Map to store created channels: channelId -> { ownerId, guildId }
    this.createdChannels = new Map();
    
    // Map to store user -> channelId (for quick lookup)
    this.userChannels = new Map();
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    // Handle voice state updates
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      try {
        // User joined a channel
        if (!oldState.channelId && newState.channelId) {
          await this.handleUserJoin(newState);
        }
        // User left a channel
        else if (oldState.channelId && !newState.channelId) {
          await this.handleUserLeave(oldState);
        }
        // User switched channels
        else if (oldState.channelId !== newState.channelId) {
          await this.handleUserLeave(oldState);
          await this.handleUserJoin(newState);
        }
      } catch (error) {
        console.error('Error in voice state update:', error);
      }
    });
    
    // Clean up when channels are deleted
    this.client.on('channelDelete', (channel) => {
      if (this.createdChannels.has(channel.id)) {
        const info = this.createdChannels.get(channel.id);
        this.userChannels.delete(info.ownerId);
        this.createdChannels.delete(channel.id);
      }
    });
  }
  
  async handleUserJoin(voiceState) {
    const { member, channel, guild } = voiceState;
    
    // Check if this is a J2C channel
    const j2cChannelId = this.j2cChannels.get(guild.id);
    if (!j2cChannelId || channel.id !== j2cChannelId) return;
    
    // Check if user already owns a channel
    if (this.userChannels.has(member.id)) {
      const existingChannelId = this.userChannels.get(member.id);
      const existingChannel = guild.channels.cache.get(existingChannelId);
      
      if (existingChannel) {
        // Move user to their existing channel
        await member.voice.setChannel(existingChannel);
        return;
      } else {
        // Clean up stale reference
        this.userChannels.delete(member.id);
        this.createdChannels.delete(existingChannelId);
      }
    }
    
    // Create new voice channel
    const newChannel = await guild.channels.create({
      name: `${member.displayName}'s Channel`,
      type: ChannelType.GuildVoice,
      parent: channel.parent,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
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
    
    // Move user to new channel
    await member.voice.setChannel(newChannel);
    
    this.emit('channelCreated', {
      channel: newChannel,
      owner: member,
      guild: guild
    });
  }
  
  async handleUserLeave(voiceState) {
    const { member, channel } = voiceState;
    
    // Check if this was a created channel
    if (!this.createdChannels.has(channel.id)) return;
    
    const channelInfo = this.createdChannels.get(channel.id);
    
    // Get remaining members
    const remainingMembers = channel.members.filter(m => m.id !== member.id);
    
    // If channel is empty, delete it
    if (remainingMembers.size === 0) {
      await channel.delete();
      this.userChannels.delete(channelInfo.ownerId);
      this.createdChannels.delete(channel.id);
      
      this.emit('channelDeleted', {
        channelId: channel.id,
        ownerId: channelInfo.ownerId
      });
      return;
    }
    
    // If owner left, transfer ownership
    if (channelInfo.ownerId === member.id) {
      const newOwner = remainingMembers.first();
      
      // Update permissions
      await channel.permissionOverwrites.edit(newOwner.id, {
        ManageChannels: true,
        Connect: true,
        Speak: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true,
        PrioritySpeaker: true
      });
      
      // Remove old owner permissions
      await channel.permissionOverwrites.delete(member.id);
      
      // Update owner info
      channelInfo.ownerId = newOwner.id;
      this.userChannels.delete(member.id);
      this.userChannels.set(newOwner.id, channel.id);
      
      // Update channel name
      await channel.setName(`${newOwner.displayName}'s Channel`);
      
      this.emit('ownershipTransferred', {
        channel: channel,
        oldOwner: member,
        newOwner: newOwner
      });
    }
  }
  
  async setupJ2C(guild, channelName = '➕ Create Voice Channel') {
    // Check if J2C already exists
    if (this.j2cChannels.has(guild.id)) {
      const existingId = this.j2cChannels.get(guild.id);
      const existing = guild.channels.cache.get(existingId);
      
      if (existing) {
        return { success: false, message: 'J2C channel already exists!', channel: existing };
      }
    }
    
    // Create J2C channel
    const j2cChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        }
      ]
    });
    
    this.j2cChannels.set(guild.id, j2cChannel.id);
    
    return { success: true, channel: j2cChannel };
  }
  
  getChannelOwner(channelId) {
    const info = this.createdChannels.get(channelId);
    return info ? info.ownerId : null;
  }
  
  isUserOwner(userId, channelId) {
    const ownerId = this.getChannelOwner(channelId);
    return ownerId === userId;
  }
  
  getUserChannel(userId) {
    return this.userChannels.get(userId);
  }
  
  async lockChannel(channel, userId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    // Deny connect permission for @everyone
    await channel.permissionOverwrites.edit(channel.guild.id, {
      Connect: false
    });
    
    return { success: true };
  }
  
  async unlockChannel(channel, userId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    // Allow connect permission for @everyone
    await channel.permissionOverwrites.edit(channel.guild.id, {
      Connect: true
    });
    
    return { success: true };
  }
  
  async rejectUser(channel, userId, targetUserId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    if (userId === targetUserId) {
      return { success: false, message: 'You cannot reject yourself!' };
    }
    
    // Remove view and connect permissions for target user
    await channel.permissionOverwrites.edit(targetUserId, {
      ViewChannel: false,
      Connect: false
    });
    
    // Disconnect user if they're in the channel
    const targetMember = channel.members.get(targetUserId);
    if (targetMember) {
      await targetMember.voice.disconnect();
    }
    
    return { success: true };
  }
  
  async allowUser(channel, userId, targetUserId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    // Remove permission overwrites for target user (revert to default)
    await channel.permissionOverwrites.delete(targetUserId);
    
    return { success: true };
  }
  
  async setUserLimit(channel, userId, limit) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    if (limit < 0 || limit > 99) {
      return { success: false, message: 'Limit must be between 0 and 99!' };
    }
    
    await channel.setUserLimit(limit);
    
    return { success: true };
  }
  
  async renameChannel(channel, userId, newName) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    
    if (newName.length > 100) {
      return { success: false, message: 'Channel name must be less than 100 characters!' };
    }
    
    await channel.setName(newName);
    
    return { success: true };
  }
}