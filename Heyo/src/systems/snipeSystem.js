// src/systems/snipeSystem.js
import { 
  EmbedBuilder,
  AttachmentBuilder,
  Collection
} from 'discord.js';

export class SnipeSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('snipe');
    
    if (!this.config.enabled) {
      console.log('[SnipeSystem] System is disabled in config');
      return;
    }
    
    // Store deleted messages by channel
    this.deletedMessages = new Map(); // channelId -> array of deleted messages
    this.editedMessages = new Map(); // messageId -> array of edit history
    
    this.setupListeners();
  }
  
  setupListeners() {
    // Listen for deleted messages
    this.client.on('messageDelete', async (message) => {
      if (message.author?.bot && !this.config.includeBots) return;
      if (this.config.excludedChannels.includes(message.channel.id)) return;
      if (message.content?.length === 0 && message.attachments.size === 0) return;
      
      await this.handleDeletedMessage(message);
    });
    
    // Listen for edited messages if enabled
    if (this.config.trackEdits) {
      this.client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (oldMessage.author?.bot && !this.config.includeBots) return;
        if (this.config.excludedChannels.includes(oldMessage.channel.id)) return;
        if (oldMessage.content === newMessage.content) return;
        
        await this.handleEditedMessage(oldMessage, newMessage);
      });
    }
    
    // Clean up old messages periodically
    setInterval(() => this.cleanupOldMessages(), 60000); // Every minute
  }
  
  async handleDeletedMessage(message) {
    const channelId = message.channel.id;
    
    // Get or create array for this channel
    if (!this.deletedMessages.has(channelId)) {
      this.deletedMessages.set(channelId, []);
    }
    
    const channelDeleted = this.deletedMessages.get(channelId);
    
    // Create snipe data
    const snipeData = {
      id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        tag: message.author.tag,
        avatar: message.author.displayAvatarURL({ dynamic: true })
      },
      attachments: Array.from(message.attachments.values()).map(att => ({
        name: att.name,
        url: att.url,
        size: att.size,
        contentType: att.contentType,
        spoiler: att.spoiler
      })),
      embeds: message.embeds.map(embed => embed.toJSON()),
      timestamp: message.createdTimestamp,
      deletedAt: Date.now(),
      channel: {
        id: message.channel.id,
        name: message.channel.name
      }
    };
    
    // Add to beginning of array
    channelDeleted.unshift(snipeData);
    
    // Keep only configured number of messages
    if (channelDeleted.length > this.config.maxSnipesPerChannel) {
      channelDeleted.pop();
    }
    
    // Log if enabled
    if (this.config.logDeleted && this.config.logChannel) {
      await this.logDeletedMessage(message);
    }
  }
  
  async handleEditedMessage(oldMessage, newMessage) {
    const messageId = oldMessage.id;
    
    // Get or create edit history for this message
    if (!this.editedMessages.has(messageId)) {
      this.editedMessages.set(messageId, []);
    }
    
    const editHistory = this.editedMessages.get(messageId);
    
    // Add old version to history
    editHistory.push({
      content: oldMessage.content,
      editedAt: Date.now()
    });
    
    // Keep only last few edits
    if (editHistory.length > 5) {
      editHistory.shift();
    }
  }
  
  async getSnipes(channelId, count = 1) {
    const channelDeleted = this.deletedMessages.get(channelId) || [];
    return channelDeleted.slice(0, Math.min(count, this.config.maxSnipesPerChannel));
  }
  
  async getEditHistory(messageId) {
    return this.editedMessages.get(messageId) || [];
  }
  
  clearSnipes(channelId = null) {
    if (channelId) {
      this.deletedMessages.delete(channelId);
    } else {
      this.deletedMessages.clear();
    }
  }
  
  clearChannelSnipes(channelId) {
    this.deletedMessages.delete(channelId);
    
    // Also clear edit history for messages in this channel
    for (const [messageId, history] of this.editedMessages.entries()) {
      // We'd need to track channel info in edit history to properly clear this
      // For now, we'll leave edit history intact
    }
  }
  
  cleanupOldMessages() {
    const maxAge = this.config.messageExpiry * 1000; // Convert to milliseconds
    const now = Date.now();
    
    // Clean deleted messages
    for (const [channelId, messages] of this.deletedMessages.entries()) {
      const filtered = messages.filter(msg => now - msg.deletedAt < maxAge);
      
      if (filtered.length === 0) {
        this.deletedMessages.delete(channelId);
      } else if (filtered.length < messages.length) {
        this.deletedMessages.set(channelId, filtered);
      }
    }
    
    // Clean edit history
    const editMaxAge = 3600000; // 1 hour for edit history
    for (const [messageId, history] of this.editedMessages.entries()) {
      const filtered = history.filter(edit => now - edit.editedAt < editMaxAge);
      
      if (filtered.length === 0) {
        this.editedMessages.delete(messageId);
      } else if (filtered.length < history.length) {
        this.editedMessages.set(messageId, filtered);
      }
    }
  }
  
  async createSnipeEmbed(snipeData, index = 0, total = 1) {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: snipeData.author.tag,
        iconURL: snipeData.author.avatar
      })
      .setFooter({ 
        text: `Deleted ${this.getTimeAgo(snipeData.deletedAt)} | Message ${index + 1}/${total}` 
      })
      .setTimestamp(snipeData.timestamp)
      .setColor(this.config.embedColor);
    
    // Add content
    if (snipeData.content) {
      embed.setDescription(snipeData.content.slice(0, 4000));
    }
    
    // Add attachments info
    if (snipeData.attachments.length > 0) {
      const attachmentList = snipeData.attachments.map(att => {
        const sizeInMB = (att.size / 1024 / 1024).toFixed(2);
        return `• [${att.name}](${att.url}) (${sizeInMB} MB)`;
      }).join('\n');
      
      embed.addFields({
        name: `Attachments (${snipeData.attachments.length})`,
        value: attachmentList.slice(0, 1024),
        inline: false
      });
      
      // Add first image as embed image
      const imageAttachment = snipeData.attachments.find(att => 
        att.contentType?.startsWith('image/')
      );
      if (imageAttachment) {
        embed.setImage(imageAttachment.url);
      }
    }
    
    // Add embeds count
    if (snipeData.embeds.length > 0) {
      embed.addFields({
        name: 'Embeds',
        value: `Message contained ${snipeData.embeds.length} embed(s)`,
        inline: false
      });
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
  
  async logDeletedMessage(message) {
    const logChannelId = this.config.logChannel;
    if (!logChannelId) return;
    
    const logChannel = this.client.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle('🗑️ Message Deleted')
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL({ dynamic: true })
      })
      .addFields(
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Author', value: `<@${message.author.id}>`, inline: true },
        { name: 'Message ID', value: message.id, inline: true }
      )
      .setColor(0xff0000)
      .setTimestamp();
    
    if (message.content) {
      embed.setDescription(message.content.slice(0, 2000));
    }
    
    if (message.attachments.size > 0) {
      embed.addFields({
        name: 'Attachments',
        value: `${message.attachments.size} attachment(s)`,
        inline: false
      });
    }
    
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  
  hasPermission(member, command) {
    // Check if user has moderation permissions for clearsnipes
    if (command === 'clearsnipes' || command === 'cs') {
      return member.permissions.has('ManageMessages') || 
             this.config.moderatorRoles.some(roleId => member.roles.cache.has(roleId));
    }
    
    // Regular snipe is available to everyone (unless configured otherwise)
    return !this.config.requirePermission || 
           member.permissions.has('ManageMessages') ||
           this.config.allowedRoles.some(roleId => member.roles.cache.has(roleId));
  }
  
  getStats() {
    let totalSniped = 0;
    for (const messages of this.deletedMessages.values()) {
      totalSniped += messages.length;
    }
    
    return {
      totalChannels: this.deletedMessages.size,
      totalMessages: totalSniped,
      editHistoryCount: this.editedMessages.size
    };
  }
}