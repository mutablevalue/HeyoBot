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

    // ─────────── DEFERRED LOADING ─────────────────────────────────────
    // We wait until the client is fully “ready” and has cached guilds+channels,
    // then read config.get("j2c.j2cChannelId") and populate this.j2cChannels.
    this.client.once('ready', () => {
      this._loadPersistedJ2CChannel();
    });
    // ─────────────────────────────────────────────────────────────────

    this.setupEventHandlers();
  }

  /**
   * Called once Discord.js is “ready,” so guilds.cache and channel caches are populated.
   * Reads `j2c.j2cChannelId` from config.yaml and, if that channel still exists as a voice
   * channel in any guild, remembers it.
   */
  _loadPersistedJ2CChannel() {
    const persistedId = this.config.get("j2c.j2cChannelId");
    if (!persistedId) return;

    // Loop through all cached guilds until we find one that has a voice channel with this ID.
    for (const [guildId, guild] of this.client.guilds.cache) {
      const channel = guild.channels.cache.get(persistedId);
      if (channel && channel.type === ChannelType.GuildVoice) {
        this.j2cChannels.set(guildId, persistedId);
        break;
      }
    }
  }

  setupEventHandlers() {
    // Whenever someone’s voice state updates, see if they join/leave the J2C channel
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
        // Switched from one channel to another
        else if (oldState.channelId !== newState.channelId) {
          await this.handleUserLeave(oldState);
          await this.handleUserJoin(newState);
        }
      } catch (error) {
        console.error('Error in voiceStateUpdate:', error);
      }
    });

    // If someone deletes a channel, we need to clean up our in‐memory maps
    this.client.on('channelDelete', (channel) => {
      if (this.createdChannels.has(channel.id)) {
        const info = this.createdChannels.get(channel.id);
        this.userChannels.delete(info.ownerId);
        this.createdChannels.delete(channel.id);
      }

      // If the J2C channel itself is deleted by someone in Discord UI, we should
      // also zero out config.j2c.j2cChannelId so that next restart “forgets” it.
      //
      // (Optional—for safety) if the owner manually deleted the “➕ Create Voice Channel,”
      // we wipe it from memory & from the YAML so that you can run /setupj2c again.
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

    // Is this channel the “Join‐to‐Create” channel for this guild?
    const j2cChannelId = this.j2cChannels.get(guild.id);
    if (!j2cChannelId || channel.id !== j2cChannelId) return;

    // If the user already owns a channel, move them there instead of creating a new one:
    if (this.userChannels.has(member.id)) {
      const existingChannelId = this.userChannels.get(member.id);
      const existingChannel = guild.channels.cache.get(existingChannelId);
      if (existingChannel) {
        await member.voice.setChannel(existingChannel);
        return;
      } else {
        // If the channel was deleted but the in‐memory map wasn’t cleaned, clean up now:
        this.userChannels.delete(member.id);
        this.createdChannels.delete(existingChannelId);
      }
    }

    // Create a new voice channel under the same parent category as the J2C channel:
    const parentCategory = channel.parentId ? channel.parent : null;
    const newChannel = await guild.channels.create({
      name: `${member.displayName}'s Channel`,
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

    // Store it in our in‐memory maps
    this.createdChannels.set(newChannel.id, {
      ownerId: member.id,
      guildId: guild.id
    });
    this.userChannels.set(member.id, newChannel.id);

    // Finally move the user into their newly created channel:
    await member.voice.setChannel(newChannel);

    // Emit an event in case anything else wants to listen
    this.emit('channelCreated', { channel: newChannel, owner: member, guild });
  }

  async handleUserLeave(voiceState) {
    const { channel, member } = voiceState;
    if (!channel || !member) return;

    // If that channel was one we “created,” check for emptiness:
    if (!this.createdChannels.has(channel.id)) return;
    const channelInfo = this.createdChannels.get(channel.id);

    // Count how many other members remain (besides the one who left):
    const remaining = channel.members.filter(m => m.id !== member.id);

    // If the channel is now empty, delete it
    if (remaining.size === 0) {
      await channel.delete().catch(console.error);
      this.userChannels.delete(channelInfo.ownerId);
      this.createdChannels.delete(channel.id);
      this.emit('channelDeleted', { channelId: channel.id, ownerId: channelInfo.ownerId });
      return;
    }

    // If the original owner left but there are still people in it, transfer ownership:
    if (channelInfo.ownerId === member.id) {
      const newOwner = remaining.first();

      // Grant the new owner all the per‐member perms:
      await channel.permissionOverwrites.edit(newOwner.id, {
        Connect: true,
        Speak: true,
        MuteMembers: true,
        DeafenMembers: true,
        MoveMembers: true,
        ManageChannels: true,
        PrioritySpeaker: true
      });

      // Remove the old owner’s explicit overwrite (revert to default)
      await channel.permissionOverwrites.delete(member.id);

      // Update our in‐memory records
      channelInfo.ownerId = newOwner.id;
      this.userChannels.delete(member.id);
      this.userChannels.set(newOwner.id, channel.id);

      // Rename the channel
      await channel.setName(`${newOwner.displayName}'s Channel`);

      this.emit('ownershipTransferred', {
        channel,
        oldOwner: member,
        newOwner
      });
    }
  }

  /**
   * Call this once from your slash command /setupj2c.
   * If a J2C channel already exists in memory (or in config), we refuse.
   */
  async setupJ2C(guild, channelName = '➕ Create Voice Channel') {
    // 1) If we already have a persisted J2C channel in memory → refuse
    if (this.j2cChannels.has(guild.id)) {
      const existingId = this.j2cChannels.get(guild.id);
      const existing = guild.channels.cache.get(existingId);
      if (existing) {
        return { success: false, message: 'J2C channel already exists!', channel: existing };
      }
      // If we had a stale ID but that channel was deleted, wipe it:
      this.j2cChannels.delete(guild.id);
      this.config.set("j2c.j2cChannelId", null);
      await this.config.save();
    }

    // 2) Create the actual Join‐to‐Create voice channel
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

    // 3) Persist it (both in memory _and_ in config.yaml)
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
      return { success: false, message: 'You do not own this channel!' };
    }
    // Deny connect for @everyone
    await channel.permissionOverwrites.edit(channel.guild.id, { Connect: false });
    return { success: true };
  }

  async unlockChannel(channel, userId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    // Allow connect for @everyone
    await channel.permissionOverwrites.edit(channel.guild.id, { Connect: true });
    return { success: true };
  }

  async rejectUser(channel, userId, targetUserId) {
    if (!this.isUserOwner(userId, channel.id)) {
      return { success: false, message: 'You do not own this channel!' };
    }
    if (userId === targetUserId) {
      return { success: false, message: 'You cannot reject yourself!' };
    }
    // Deny view & connect for target user
    await channel.permissionOverwrites.edit(targetUserId, {
      ViewChannel: false,
      Connect: false
    });
    // If they’re in voice, disconnect them
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
    // Remove custom overwrite for that user (they revert to default @everyone perms)
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
      return { success: false, message: 'Channel name must be < 100 characters!' };
    }
    await channel.setName(newName);
    return { success: true };
  }
}
