// src/systems/skullboardSystem.js
import { 
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SkullboardSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('skullboard');
    
    if (!this.config.enabled) {
      console.log('[SkullboardSystem] System is disabled in config');
      return;
    }
    
    this.skullboardMessages = new Map(); // messageId -> skullboard data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    
    this.loadData();
    this.setupListeners();
  }
  
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        // Load skullboard messages
        if (data.messages) {
          Object.entries(data.messages).forEach(([messageId, messageData]) => {
            this.skullboardMessages.set(messageId, messageData);
          });
        }
        
        console.log(`[SkullboardSystem] Loaded ${this.skullboardMessages.size} skullboard entries`);
      }
    } catch (error) {
      console.error('[SkullboardSystem] Error loading data:', error);
    }
  }
  
  saveData() {
    try {
      const data = {
        messages: Object.fromEntries(this.skullboardMessages),
        lastUpdated: Date.now()
      };
      
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[SkullboardSystem] Error saving data:', error);
    }
  }
  
  setupListeners() {
    // Listen for reactions
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      await this.handleReaction(reaction, user, 'add');
    });
    
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      await this.handleReaction(reaction, user, 'remove');
    });
    
    // Listen for message deletions
    this.client.on('messageDelete', async (message) => {
      await this.handleMessageDelete(message);
    });
  }
  
  async handleReaction(reaction, user, type) {
    // Ensure reaction is fully fetched
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        console.error('[SkullboardSystem] Error fetching reaction:', error);
        return;
      }
    }
    
    // Check if it's the configured emoji
    const emojiName = reaction.emoji.name;
    const emojiId = reaction.emoji.id;
    const emojiString = emojiId ? `<:${emojiName}:${emojiId}>` : emojiName;
    
    if (emojiString !== this.config.emoji && emojiName !== this.config.emoji) {
      return;
    }
    
    const message = reaction.message;
    const guildConfig = this.config.guilds[message.guild.id];
    
    if (!guildConfig || !guildConfig.channelId) {
      return; // Skullboard not set up for this guild
    }
    
    // Check if message is from skullboard channel (avoid recursion)
    if (message.channel.id === guildConfig.channelId) {
      return;
    }
    
    // Check excluded channels
    if (this.config.excludedChannels.includes(message.channel.id)) {
      return;
    }
    
    // Check self-star if disabled
    if (!this.config.allowSelfStar && message.author.id === user.id && type === 'add') {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    
    const reactionCount = reaction.count;
    const threshold = guildConfig.threshold || this.config.defaultThreshold;
    
    if (reactionCount >= threshold) {
      await this.addToSkullboard(message, reactionCount, guildConfig);
    } else if (type === 'remove') {
      // Check if we need to update or remove from skullboard
      await this.updateSkullboard(message, reactionCount, guildConfig);
    }
  }
  
  async addToSkullboard(message, reactionCount, guildConfig) {
    const skullboardChannel = this.client.channels.cache.get(guildConfig.channelId);
    if (!skullboardChannel || !skullboardChannel.isTextBased()) return;
    
    // Check if already on skullboard
    const existingData = this.skullboardMessages.get(message.id);
    if (existingData) {
      // Update existing
      await this.updateSkullboardMessage(existingData, reactionCount, skullboardChannel);
      return;
    }
    
    // Create skullboard embed
    const embed = await this.createSkullboardEmbed(message, reactionCount);
    if (!embed) return;
    
    try {
      const skullboardMsg = await skullboardChannel.send({ embeds: [embed] });
      
      // Store data
      const skullboardData = {
        originalMessageId: message.id,
        skullboardMessageId: skullboardMsg.id,
        authorId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild.id,
        reactionCount: reactionCount,
        timestamp: Date.now()
      };
      
      this.skullboardMessages.set(message.id, skullboardData);
      this.saveData();
      
      // Log if enabled
      if (this.config.logChannel) {
        await this.logSkullboardAction('add', message, reactionCount);
      }
      
    } catch (error) {
      console.error('[SkullboardSystem] Error adding to skullboard:', error);
    }
  }
  
  async updateSkullboard(message, reactionCount, guildConfig) {
    const existingData = this.skullboardMessages.get(message.id);
    if (!existingData) return;
    
    const threshold = guildConfig.threshold || this.config.defaultThreshold;
    const skullboardChannel = this.client.channels.cache.get(guildConfig.channelId);
    
    if (!skullboardChannel || !skullboardChannel.isTextBased()) return;
    
    if (reactionCount < threshold && this.config.removeOnBelowThreshold) {
      // Remove from skullboard
      try {
        const skullboardMsg = await skullboardChannel.messages.fetch(existingData.skullboardMessageId);
        await skullboardMsg.delete();
        
        this.skullboardMessages.delete(message.id);
        this.saveData();
        
        if (this.config.logChannel) {
          await this.logSkullboardAction('remove', message, reactionCount);
        }
      } catch (error) {
        console.error('[SkullboardSystem] Error removing from skullboard:', error);
      }
    } else {
      // Update reaction count
      await this.updateSkullboardMessage(existingData, reactionCount, skullboardChannel);
    }
  }
  
  async updateSkullboardMessage(skullboardData, newCount, skullboardChannel) {
    try {
      const skullboardMsg = await skullboardChannel.messages.fetch(skullboardData.skullboardMessageId);
      const originalMsg = await this.client.channels.cache.get(skullboardData.channelId)
        ?.messages.fetch(skullboardData.originalMessageId);
      
      if (!originalMsg) return;
      
      const embed = await this.createSkullboardEmbed(originalMsg, newCount);
      if (!embed) return;
      
      await skullboardMsg.edit({ embeds: [embed] });
      
      // Update stored count
      skullboardData.reactionCount = newCount;
      this.saveData();
      
    } catch (error) {
      console.error('[SkullboardSystem] Error updating skullboard message:', error);
    }
  }
  
  async createSkullboardEmbed(message, reactionCount) {
    const emoji = this.config.emoji;
    const stars = this.getStarRating(reactionCount);
    
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL({ dynamic: true })
      })
      .setColor(this.getColorForCount(reactionCount))
      .setTimestamp(message.createdAt)
      .setFooter({ text: `${emoji} ${reactionCount} | ${message.id}` });
    
    // Add title with star rating
    embed.setTitle(`${stars} ${emoji} ${reactionCount}`);
    
    // Add content
    if (message.content) {
      embed.setDescription(message.content.slice(0, 2000));
    }
    
    // Add link to original
    embed.addFields({
      name: 'Source',
      value: `[Jump to message](${message.url})`,
      inline: false
    });
    
    // Add first attachment if image
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment.contentType?.startsWith('image/')) {
        embed.setImage(attachment.url);
      } else {
        embed.addFields({
          name: 'Attachment',
          value: `[${attachment.name}](${attachment.url})`,
          inline: false
        });
      }
    }
    
    // Add first embed's image if exists
    if (message.embeds.length > 0 && message.embeds[0].image) {
      embed.setImage(message.embeds[0].image.url);
    }
    
    return embed;
  }
  
  getStarRating(count) {
    if (count >= 20) return '⭐⭐⭐⭐⭐';
    if (count >= 15) return '⭐⭐⭐⭐';
    if (count >= 10) return '⭐⭐⭐';
    if (count >= 5) return '⭐⭐';
    return '⭐';
  }
  
  getColorForCount(count) {
    if (count >= 20) return 0xffac33; // Gold
    if (count >= 15) return 0xffd700; // Bright gold
    if (count >= 10) return 0xffed4e; // Light gold
    if (count >= 5) return 0xfff5a6; // Pale gold
    return 0xffffff; // White
  }
  
  async handleMessageDelete(message) {
    const skullboardData = this.skullboardMessages.get(message.id);
    if (!skullboardData) return;
    
    // Remove from skullboard if configured
    if (this.config.removeOnMessageDelete) {
      const guildConfig = this.config.guilds[message.guild.id];
      if (!guildConfig) return;
      
      const skullboardChannel = this.client.channels.cache.get(guildConfig.channelId);
      if (!skullboardChannel || !skullboardChannel.isTextBased()) return;
      
      try {
        const skullboardMsg = await skullboardChannel.messages.fetch(skullboardData.skullboardMessageId);
        await skullboardMsg.delete();
        
        this.skullboardMessages.delete(message.id);
        this.saveData();
        
        if (this.config.logChannel) {
          await this.logSkullboardAction('delete', message, skullboardData.reactionCount);
        }
      } catch (error) {
        console.error('[SkullboardSystem] Error handling message delete:', error);
      }
    }
  }
  
  async setupSkullboard(guild, channelId, threshold) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error('Invalid channel');
      }
      
      // Update config
      if (!this.config.guilds) this.config.guilds = {};
      
      this.config.guilds[guild.id] = {
        channelId: channelId,
        threshold: threshold || this.config.defaultThreshold
      };
      
      this.configLoader.set(`skullboard.guilds.${guild.id}`, this.config.guilds[guild.id]);
      await this.configLoader.save();
      
      return true;
    } catch (error) {
      console.error('[SkullboardSystem] Error setting up skullboard:', error);
      return false;
    }
  }
  
  async logSkullboardAction(action, message, count) {
    const logChannelId = this.config.logChannel;
    if (!logChannelId) return;
    
    const logChannel = this.client.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle(`Skullboard ${action.charAt(0).toUpperCase() + action.slice(1)}`)
      .setDescription(`Message ${action} skullboard`)
      .addFields(
        { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: `${this.config.emoji} Count`, value: count.toString(), inline: true }
      )
      .setColor(action === 'add' ? 0x00ff00 : action === 'remove' ? 0xff0000 : 0xffa500)
      .setTimestamp();
    
    if (message.content) {
      embed.addFields({
        name: 'Content Preview',
        value: message.content.slice(0, 100) + (message.content.length > 100 ? '...' : ''),
        inline: false
      });
    }
    
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  
  getStats(guildId) {
    const guildMessages = Array.from(this.skullboardMessages.values())
      .filter(msg => msg.guildId === guildId);
    
    const topMessages = guildMessages
      .sort((a, b) => b.reactionCount - a.reactionCount)
      .slice(0, 10);
    
    return {
      total: guildMessages.length,
      topMessages: topMessages,
      config: this.config.guilds[guildId] || null
    };
  }
}