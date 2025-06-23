// src/systems/snipeSystem.js
import { PermissionFlagsBits, Events } from 'discord.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SnipeSystem {
  constructor(client, configLoader, embedLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = embedLoader;
    this.config = this.configLoader.get('snipe');
    
    // Snipe storage: channelId -> array of snipes
    this.snipes = new Map();
    this.reactionSnipes = new Map();
    
    // Track message creation times for ghost ping detection (temporary, not saved)
    this.messageTimestamps = new Map(); // messageId -> { createdAt, mentions, authorId, authorTag, content, channelId }
    
    // Configure ghost ping settings
    this.ghostPingConfig = {
      enabled: this.config.ghostPing?.enabled ?? true,
      ignoreBots: this.config.ghostPing?.ignoreBots ?? true,
      notifyOnGhostPing: this.config.ghostPing?.notifyOnGhostPing ?? true,
      maxDeleteTime: 5000 // 5 seconds - message must be deleted within this time to count as ghost ping
    };
    
    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
    
    // Cleanup interval
    setInterval(() => this.cleanup(), 60000); // Every minute
  }
  
  setupEventListeners() {
    // Track message creation for ghost ping detection
    if (this.ghostPingConfig.enabled) {
      this.client.on('messageCreate', async (message) => {
        if (!message.guild) return;
        if (this.ghostPingConfig.ignoreBots && message.author?.bot) return;
        
        // Only track messages with actual @ mentions
        const hasMentions = message.mentions.users.size > 0 || 
                           message.mentions.roles.size > 0 || 
                           message.mentions.everyone;
        
        if (hasMentions) {
          // Extract mentioned user IDs
          const mentionedUsers = new Set();
          
          // User mentions
          message.mentions.users.forEach(user => {
            if (user.id !== message.author.id) mentionedUsers.add(user.id);
          });
          
          // Role mentions
          message.mentions.roles.forEach(role => {
            role.members.forEach(member => {
              if (member.id !== message.author.id) mentionedUsers.add(member.id);
            });
          });
          
          // @everyone/@here
          if (message.mentions.everyone) {
            message.guild.members.cache.forEach(member => {
              if (member.id !== message.author.id && 
                  message.channel.permissionsFor(member).has('ViewChannel')) {
                mentionedUsers.add(member.id);
              }
            });
          }
          
          if (mentionedUsers.size > 0) {
            this.messageTimestamps.set(message.id, {
              createdAt: Date.now(),
              mentions: Array.from(mentionedUsers),
              authorId: message.author.id,
              authorTag: message.author.tag,
              content: message.content,
              channelId: message.channel.id,
              guildId: message.guild.id,
              guildName: message.guild.name
            });
            
            // Auto-cleanup after 10 seconds (no longer tracking after that)
            setTimeout(() => {
              this.messageTimestamps.delete(message.id);
            }, 10000);
          }
        }
      });
    }
    
    // Track deleted messages
    this.client.on('messageDelete', async (message) => {
      if (!message.partial && message.guild) {
        await this.handleMessageDelete(message);
      }
    });
    
    // Track removed reactions if enabled
    if (this.config.trackReactions) {
      this.client.on('messageReactionRemove', async (reaction, user) => {
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch (error) {
            console.error('[SnipeSystem] Failed to fetch partial reaction:', error);
            return;
          }
        }
        
        if (reaction.message.guild) {
          await this.handleReactionRemove(reaction, user);
        }
      });
    }
    
    // Track bulk deletions for ghost pings
    if (this.ghostPingConfig.enabled) {
      this.client.on(Events.MessageBulkDelete, async (messages) => {
        for (const message of messages.values()) {
          if (!message.guild) continue;
          if (this.ghostPingConfig.ignoreBots && message.author?.bot) continue;
          
          // Check if we tracked this message
          const trackedInfo = this.messageTimestamps.get(message.id);
          if (trackedInfo) {
            const deleteTime = Date.now() - trackedInfo.createdAt;
            
            // Only notify if deleted within 5 seconds
            if (deleteTime <= this.ghostPingConfig.maxDeleteTime) {
              await this.notifyGhostPing(trackedInfo, deleteTime);
            }
            
            this.messageTimestamps.delete(message.id);
          }
        }
      });
    }
  }
  
  async handleMessageDelete(message) {
    // Skip if in excluded channel
    if (this.config.excludedChannels.includes(message.channel.id)) return;
    
    // Skip bots if configured
    if (message.author.bot && !this.config.includeBots) return;
    
    // Check for ghost pings
    if (this.ghostPingConfig.enabled && !message.author?.bot) {
      const trackedInfo = this.messageTimestamps.get(message.id);
      
      if (trackedInfo) {
        const deleteTime = Date.now() - trackedInfo.createdAt;
        
        // Only notify if deleted within 5 seconds
        if (deleteTime <= this.ghostPingConfig.maxDeleteTime) {
          await this.notifyGhostPing(trackedInfo, deleteTime);
        }
        
        this.messageTimestamps.delete(message.id);
      }
    }
    
    // Create snipe object
    const snipe = {
      author: {
        id: message.author.id,
        tag: message.author.tag,
        avatar: message.author.displayAvatarURL()
      },
      content: message.content,
      attachments: message.attachments.map(att => ({
        name: att.name,
        url: att.url
      })),
      channelId: message.channel.id,
      guildId: message.guild.id,
      deletedAt: Date.now(),
      type: 'delete'
    };
    
    // Add to snipes
    this.addSnipe(message.channel.id, snipe);
    
    // Log if enabled
    if (this.config.logDeleted && this.config.logChannel) {
      await this.logSnipe(message.guild, snipe, 'Message Deleted');
    }
  }
  
  async handleReactionRemove(reaction, user) {
    // Skip if in excluded channel
    if (this.config.excludedChannels.includes(reaction.message.channel.id)) return;
    
    // Skip bots if configured
    if (user.bot && !this.config.includeBots) return;
    
    // Fetch the message if partial
    let message = reaction.message;
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch (error) {
        console.error('[SnipeSystem] Failed to fetch partial message:', error);
        return;
      }
    }
    
    // Create reaction snipe object
    const reactionSnipe = {
      user: {
        id: user.id,
        tag: user.tag || `${user.username}#${user.discriminator}`,
        avatar: user.displayAvatarURL()
      },
      emoji: reaction.emoji.toString(),
      messageId: message.id,
      messageAuthor: {
        id: message.author.id,
        tag: message.author.tag
      },
      messageContent: message.content,
      messageUrl: message.url,
      channelId: message.channel.id,
      guildId: message.guild.id,
      removedAt: Date.now(),
      type: 'reaction'
    };
    
    // Add to reaction snipes
    this.addReactionSnipe(message.channel.id, reactionSnipe);
    
    // Log if enabled
    if (this.config.logDeleted && this.config.logChannel) {
      await this.logReactionSnipe(message.guild, reactionSnipe);
    }
  }
  
  async notifyGhostPing(pingData, deleteTime) {
    if (!this.ghostPingConfig.notifyOnGhostPing) return;
    
    try {
      const channel = this.client.channels.cache.get(pingData.channelId);
      if (!channel?.isTextBased()) return;
      
      // Notify each mentioned user
      for (const userId of pingData.mentions) {
        const embed = this.embedLoader.createEmbed({
          title: '👻 Ghost Ping!',
          description: `<@${userId}> You were ghost pinged!`,
          fields: [
            { name: 'By', value: `${pingData.authorTag}`, inline: true },
            { name: 'Deleted After', value: `${(deleteTime / 1000).toFixed(1)} seconds`, inline: true },
            { name: 'Message', value: pingData.content.slice(0, 1024) || '[No content]' }
          ]
        });
        
        await channel.send({ embeds: [embed] });
        break; // Only send one notification per ghost ping event
      }
    } catch (error) {
      console.error('[SnipeSystem] Error notifying ghost ping:', error);
    }
  }
  
  addSnipe(channelId, snipe) {
    if (!this.snipes.has(channelId)) {
      this.snipes.set(channelId, []);
    }
    
    const channelSnipes = this.snipes.get(channelId);
    
    // Add to beginning (newest first)
    channelSnipes.unshift(snipe);
    
    // Limit number of snipes per channel
    if (channelSnipes.length > this.config.maxSnipesPerChannel) {
      channelSnipes.pop();
    }
  }
  
  addReactionSnipe(channelId, reactionSnipe) {
    if (!this.reactionSnipes.has(channelId)) {
      this.reactionSnipes.set(channelId, []);
    }
    
    const channelReactionSnipes = this.reactionSnipes.get(channelId);
    
    // Add to beginning (newest first)
    channelReactionSnipes.unshift(reactionSnipe);
    
    // Limit number of reaction snipes per channel
    if (channelReactionSnipes.length > this.config.maxSnipesPerChannel) {
      channelReactionSnipes.pop();
    }
  }
  
  getSnipes(channelId, limit = 1) {
    const channelSnipes = this.snipes.get(channelId) || [];
    return channelSnipes.slice(0, limit);
  }
  
  getReactionSnipes(channelId, limit = 1) {
    const channelReactionSnipes = this.reactionSnipes.get(channelId) || [];
    return channelReactionSnipes.slice(0, limit);
  }
  
  clearSnipes() {
    this.snipes.clear();
    this.reactionSnipes.clear();
  }
  
  clearChannelSnipes(channelId) {
    this.snipes.delete(channelId);
    this.reactionSnipes.delete(channelId);
  }
  
  clearReactionSnipes() {
    this.reactionSnipes.clear();
  }
  
  clearChannelReactionSnipes(channelId) {
    this.reactionSnipes.delete(channelId);
  }
  
  cleanup() {
    const now = Date.now();
    const expiryTime = this.config.messageExpiry * 1000;
    
    // Cleanup message snipes
    for (const [channelId, snipes] of this.snipes) {
      const filtered = snipes.filter(snipe => 
        now - snipe.deletedAt < expiryTime
      );
      
      if (filtered.length === 0) {
        this.snipes.delete(channelId);
      } else {
        this.snipes.set(channelId, filtered);
      }
    }
    
    // Cleanup reaction snipes
    for (const [channelId, reactionSnipes] of this.reactionSnipes) {
      const filtered = reactionSnipes.filter(snipe => 
        now - snipe.removedAt < expiryTime
      );
      
      if (filtered.length === 0) {
        this.reactionSnipes.delete(channelId);
      } else {
        this.reactionSnipes.set(channelId, filtered);
      }
    }
    
    // Cleanup old message timestamps
    for (const [messageId, info] of this.messageTimestamps) {
      if (now - info.createdAt > 10000) { // 10 seconds
        this.messageTimestamps.delete(messageId);
      }
    }
  }
  
  async logSnipe(guild, snipe, title) {
    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = this.embedLoader.createEmbed({
      description: snipe.content || 'No content',
      fields: []
    });
    
    embed.setAuthor({
      name: snipe.author.tag,
      iconURL: snipe.author.avatar
    });
    
    if (snipe.attachments.length > 0) {
      embed.addFields({
        name: 'Attachments',
        value: snipe.attachments.map(att => att.name).join(', ')
      });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[SnipeSystem] Error logging snipe:', error);
    }
  }
  
  async logReactionSnipe(guild, reactionSnipe) {
    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = this.embedLoader.createEmbed({
      description: `Removed reaction ${reactionSnipe.emoji} from [this message](${reactionSnipe.messageUrl})`,
      fields: [
        { name: 'Message Author', value: reactionSnipe.messageAuthor.tag, inline: true },
        { name: 'Emoji', value: reactionSnipe.emoji, inline: true }
      ]
    });
    
    embed.setAuthor({
      name: reactionSnipe.user.tag,
      iconURL: reactionSnipe.user.avatar
    });
    
    if (reactionSnipe.messageContent) {
      embed.addFields({
        name: 'Message Content',
        value: reactionSnipe.messageContent.slice(0, 1024)
      });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[SnipeSystem] Error logging reaction snipe:', error);
    }
  }
  
  getChannelSnipeCount(channelId) {
    return this.snipes.get(channelId)?.length || 0;
  }
  
  getChannelReactionSnipeCount(channelId) {
    return this.reactionSnipes.get(channelId)?.length || 0;
  }

  getTotalSnipeCount() {
    let total = 0;
    for (const channelSnipes of this.snipes.values()) {
      total += channelSnipes.length;
    }
    return total;
  }
  
  getTotalReactionSnipeCount() {
    let total = 0;
    for (const channelReactionSnipes of this.reactionSnipes.values()) {
      total += channelReactionSnipes.length;
    }
    return total;
  }

  hasPermission(member, command) {
    // If permission checking is disabled, allow everyone for snipe commands
    if (!this.config.requirePermission && (command === 'snipe' || command === 'reactionsnipe')) {
      return true;
    }
    
    // Admins always have permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }
    
    // For clearsnipes, check moderator roles
    if (command === 'clearsnipes') {
      return member.roles.cache.some(role => 
        this.config.moderatorRoles.includes(role.id)
      );
    }
    
    // For snipe/reactionsnipe commands with permission requirement
    if (this.config.requirePermission && (command === 'snipe' || command === 'reactionsnipe')) {
      return member.roles.cache.some(role => 
        this.config.allowedRoles.includes(role.id)
      );
    }
    
    return false;
  }

  async createSnipeEmbed(snipe, index, total) {
    const fields = [];
    
    // Get user info
    let authorName = snipe.author.tag || 'Unknown User';
    try {
      const user = await this.client.users.fetch(snipe.author.id);
      authorName = user.tag;
    } catch {
      // Use cached name
    }
    
    // Add content
    const description = snipe.content || 'No content';
    
    // Add attachments info
    if (snipe.attachments && snipe.attachments.length > 0) {
      const attachmentList = snipe.attachments
        .map(att => `[${att.name || 'Attachment'}](${att.url})`)
        .join('\n');
      fields.push({
        name: 'Attachments',
        value: attachmentList.slice(0, 1024)
      });
    }
    
    // Add channel info
    fields.push({
      name: 'Channel',
      value: `<#${snipe.channelId}>`,
      inline: true
    });
    
    // Add deletion time
    const deletedAgo = this.getTimeAgo(snipe.deletedAt);
    fields.push({
      name: 'Deleted',
      value: deletedAgo,
      inline: true
    });
    
    const embed = this.embedLoader.createEmbed({
      description: description,
      fields: fields
    });
    
    embed.setAuthor({
      name: authorName,
      iconURL: snipe.author.avatar
    });
    
    // Set footer with pagination info
    if (total > 1) {
      embed.setFooter({ text: `Snipe ${index + 1} of ${total}` });
    }
    
    return embed;
  }
  
  async createReactionSnipeEmbed(reactionSnipe, index, total) {
    const fields = [];
    
    // Get user info
    let userName = reactionSnipe.user.tag || 'Unknown User';
    try {
      const user = await this.client.users.fetch(reactionSnipe.user.id);
      userName = user.tag;
    } catch {
      // Use cached name
    }
    
    // Add reaction info
    const description = `Removed reaction: ${reactionSnipe.emoji}`;
    
    // Add message info
    fields.push(
      {
        name: 'Original Message',
        value: `[Jump to Message](${reactionSnipe.messageUrl})`,
        inline: true
      },
      {
        name: 'Message Author',
        value: reactionSnipe.messageAuthor.tag,
        inline: true
      },
      {
        name: 'Channel',
        value: `<#${reactionSnipe.channelId}>`,
        inline: true
      }
    );
    
    // Add message content preview if available
    if (reactionSnipe.messageContent) {
      const preview = reactionSnipe.messageContent.length > 100 
        ? reactionSnipe.messageContent.slice(0, 97) + '...'
        : reactionSnipe.messageContent;
      fields.push({
        name: 'Message Preview',
        value: preview || 'No content'
      });
    }
    
    // Add removal time
    const removedAgo = this.getTimeAgo(reactionSnipe.removedAt);
    fields.push({
      name: 'Removed',
      value: removedAgo,
      inline: true
    });
    
    const embed = this.embedLoader.createEmbed({
      title: 'Reaction Snipe',
      description: description,
      fields: fields
    });
    
    embed.setAuthor({
      name: userName,
      iconURL: reactionSnipe.user.avatar
    });
    
    // Set footer with pagination info
    if (total > 1) {
      embed.setFooter({ text: `Reaction Snipe ${index + 1} of ${total}` });
    }
    
    return embed;
  }

  getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  
  getStats() {
    return {
      messageSnipes: this.getTotalSnipeCount(),
      reactionSnipes: this.getTotalReactionSnipeCount(),
      ghostPings: {
        enabled: this.ghostPingConfig.enabled
      }
    };
  }
  
  // Dummy methods for compatibility
  getUserGhostPings() { return []; }
  clearUserGhostPings() { }
  loadGhostPingData() { }
  saveGhostPingData() { }
}