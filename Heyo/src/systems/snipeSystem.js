// src/systems/snipeSystem.js
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export class SnipeSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('snipe') || {};
    
    // Default configuration
    this.config = {
      enabled: true,
      maxSnipesPerChannel: 5,
      messageExpiry: 3600, // 1 hour
      trackEdits: true,
      includeBots: false,
      excludedChannels: [],
      ephemeral: false,
      requirePermission: false,
      allowedRoles: [],
      moderatorRoles: [],
      embedColor: 0x2f3136,
      logDeleted: false,
      logChannel: null,
      ...this.config
    };
    
    // Snipe storage: channelId -> array of snipes
    this.snipes = new Map();
    
    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
    
    // Cleanup interval
    setInterval(() => this.cleanup(), 60000); // Every minute
  }
  
  setupEventListeners() {
    // Track deleted messages
    this.client.on('messageDelete', async (message) => {
      if (!message.partial && message.guild) {
        await this.handleMessageDelete(message);
      }
    });
    
    // Track edited messages if enabled
    if (this.config.trackEdits) {
      this.client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (!oldMessage.partial && oldMessage.guild && oldMessage.content !== newMessage.content) {
          await this.handleMessageEdit(oldMessage, newMessage);
        }
      });
    }
  }
  
  async handleMessageDelete(message) {
    // Skip if in excluded channel
    if (this.config.excludedChannels.includes(message.channel.id)) return;
    
    // Skip bots if configured
    if (message.author.bot && !this.config.includeBots) return;
    
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
        url: att.url,
        size: att.size
      })),
      embeds: message.embeds.map(embed => embed.toJSON()),
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
  
  async handleMessageEdit(oldMessage, newMessage) {
    // Skip if in excluded channel
    if (this.config.excludedChannels.includes(oldMessage.channel.id)) return;
    
    // Skip bots if configured
    if (oldMessage.author.bot && !this.config.includeBots) return;
    
    // Create edit snipe
    const snipe = {
      author: {
        id: oldMessage.author.id,
        tag: oldMessage.author.tag,
        avatar: oldMessage.author.displayAvatarURL()
      },
      content: newMessage.content,
      oldContent: oldMessage.content,
      attachments: newMessage.attachments.map(att => ({
        name: att.name,
        url: att.url,
        size: att.size
      })),
      embeds: newMessage.embeds.map(embed => embed.toJSON()),
      channelId: oldMessage.channel.id,
      guildId: oldMessage.guild.id,
      deletedAt: Date.now(),
      type: 'edit'
    };
    
    // Add to snipes
    this.addSnipe(oldMessage.channel.id, snipe);
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
  
  getSnipes(channelId, limit = 1) {
    const channelSnipes = this.snipes.get(channelId) || [];
    return channelSnipes.slice(0, limit);
  }
  
  clearSnipes() {
    this.snipes.clear();
  }
  
  clearChannelSnipes(channelId) {
    this.snipes.delete(channelId);
  }
  
  cleanup() {
    const now = Date.now();
    const expiryTime = this.config.messageExpiry * 1000;
    
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
  }
  
  async logSnipe(guild, snipe, title) {
    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setAuthor({
        name: snipe.author.tag,
        iconURL: snipe.author.avatar
      })
      .setDescription(snipe.content || 'No content')
      .setColor(this.config.embedColor)
      .setTimestamp(snipe.deletedAt);
    
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
  
  // NEW METHODS TO ADD:
  
  /**
   * Get the number of snipes for a specific channel
   * @param {string} channelId 
   * @returns {number}
   */
  getChannelSnipeCount(channelId) {
    return this.snipes.get(channelId)?.length || 0;
  }

  /**
   * Get the total number of snipes across all channels
   * @returns {number}
   */
  getTotalSnipeCount() {
    let total = 0;
    for (const channelSnipes of this.snipes.values()) {
      total += channelSnipes.length;
    }
    return total;
  }

  /**
   * Check if a member has permission to use snipe commands
   * @param {import('discord.js').GuildMember} member 
   * @param {string} command - 'snipe' or 'clearsnipes'
   * @returns {boolean}
   */
  hasPermission(member, command) {
    // If permission checking is disabled, allow everyone
    if (!this.config.requirePermission && command === 'snipe') {
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
    
    // For snipe command with permission requirement
    if (this.config.requirePermission && command === 'snipe') {
      return member.roles.cache.some(role => 
        this.config.allowedRoles.includes(role.id)
      );
    }
    
    return false;
  }

  /**
   * Create a snipe embed with consistent formatting
   * @param {Object} snipe 
   * @param {number} index 
   * @param {number} total 
   * @returns {EmbedBuilder}
   */
  async createSnipeEmbed(snipe, index, total) {
    const embed = new EmbedBuilder()
      .setColor(this.config.embedColor || 0x2f3136)
      .setTimestamp(snipe.deletedAt);
    
    // Get user info
    try {
      const user = await this.client.users.fetch(snipe.author.id);
      embed.setAuthor({
        name: user.tag,
        iconURL: user.displayAvatarURL()
      });
    } catch {
      embed.setAuthor({
        name: snipe.author.tag || 'Unknown User'
      });
    }
    
    // Add content
    if (snipe.content) {
      embed.setDescription(snipe.content);
    }
    
    // Add attachments info
    if (snipe.attachments && snipe.attachments.length > 0) {
      const attachmentList = snipe.attachments
        .map(att => `[${att.name || 'Attachment'}](${att.url})`)
        .join('\n');
      embed.addFields({
        name: 'Attachments',
        value: attachmentList.slice(0, 1024)
      });
    }
    
    // Add embeds info
    if (snipe.embeds && snipe.embeds.length > 0) {
      embed.addFields({
        name: 'Embeds',
        value: `Message contained ${snipe.embeds.length} embed(s)`
      });
    }
    
    // Add edit info if this is an edited message
    if (snipe.type === 'edit' && snipe.oldContent) {
      embed.addFields({
        name: 'Original Content',
        value: snipe.oldContent.slice(0, 1024)
      });
      embed.setTitle('Message Edit');
    }
    
    // Add channel info
    embed.addFields({
      name: 'Channel',
      value: `<#${snipe.channelId}>`,
      inline: true
    });
    
    // Add deletion time
    const deletedAgo = this.getTimeAgo(snipe.deletedAt);
    embed.addFields({
      name: 'Deleted',
      value: deletedAgo,
      inline: true
    });
    
    return embed;
  }

  /**
   * Get human-readable time ago string
   * @param {number} timestamp 
   * @returns {string}
   */
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
}