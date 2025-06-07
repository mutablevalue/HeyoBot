// src/systems/welcomeSystem.js
import { EmbedBuilder, ChannelType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WelcomeSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load welcome config
    const welcomeConfig = this.configLoader.get('welcome') || {};
    this.config = {
      enabled: welcomeConfig.enabled ?? false,
      channel: welcomeConfig.channel || null,
      message: welcomeConfig.message || {
        title: 'Welcome!',
        description: 'Welcome {user} to **{server}**!\n\nYou are member #{memberCount}',
        color: 0x00ff00,
        thumbnail: true,
        footer: 'Enjoy your stay!',
        timestamp: true
      },
      dmEnabled: welcomeConfig.dmEnabled ?? false,
      dmMessage: welcomeConfig.dmMessage || {
        title: 'Welcome to {server}!',
        description: 'Welcome {user}! We\'re glad to have you here.',
        color: 0x00ff00,
        footer: 'Have a great time!',
        timestamp: true
      },
      roleOnJoin: welcomeConfig.roleOnJoin || null,
      pingUser: welcomeConfig.pingUser ?? false,
      deleteAfter: welcomeConfig.deleteAfter || null // seconds to delete welcome message after
    };

    // Stats tracking
    this.stats = {
      welcomesSent: 0,
      dmsSent: 0,
      errors: 0
    };

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('welcome', {
      enabled: this.config.enabled,
      channel: this.config.channel,
      message: this.config.message,
      dmEnabled: this.config.dmEnabled,
      dmMessage: this.config.dmMessage,
      roleOnJoin: this.config.roleOnJoin,
      pingUser: this.config.pingUser,
      deleteAfter: this.config.deleteAfter
    });
    return this.configLoader.save();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.client.on('guildMemberAdd', async (member) => {
      if (!this.config.enabled) return;
      if (member.user.bot) return; // Skip bots

      try {
        // Auto role
        if (this.config.roleOnJoin) {
          try {
            const role = member.guild.roles.cache.get(this.config.roleOnJoin);
            if (role) {
              await member.roles.add(role, 'Auto role on join');
            }
          } catch (error) {
            console.error('[WelcomeSystem] Error adding auto role:', error);
          }
        }

        // Send welcome message to channel
        if (this.config.channel) {
          await this.sendWelcomeMessage(member);
        }

        // Send DM if enabled
        if (this.config.dmEnabled) {
          await this.sendWelcomeDM(member);
        }
      } catch (error) {
        console.error('[WelcomeSystem] Error handling member join:', error);
        this.stats.errors++;
      }
    });
  }

  /**
   * Send welcome message to channel
   * @param {import("discord.js").GuildMember} member 
   */
  async sendWelcomeMessage(member) {
    const channel = member.guild.channels.cache.get(this.config.channel);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    try {
      const embed = this.createWelcomeEmbed(member, this.config.message);
      
      const content = this.config.pingUser ? `${member}` : undefined;
      const message = await channel.send({ content, embeds: [embed] });

      this.stats.welcomesSent++;

      // Delete after specified time
      if (this.config.deleteAfter && this.config.deleteAfter > 0) {
        setTimeout(() => {
          message.delete().catch(() => {});
        }, this.config.deleteAfter * 1000);
      }
    } catch (error) {
      console.error('[WelcomeSystem] Error sending welcome message:', error);
      this.stats.errors++;
    }
  }

  /**
   * Send welcome DM
   * @param {import("discord.js").GuildMember} member 
   */
  async sendWelcomeDM(member) {
    try {
      const embed = this.createWelcomeEmbed(member, this.config.dmMessage);
      await member.send({ embeds: [embed] });
      this.stats.dmsSent++;
    } catch (error) {
      // User might have DMs disabled
      console.error('[WelcomeSystem] Error sending welcome DM:', error);
    }
  }

  /**
   * Create welcome embed
   * @param {import("discord.js").GuildMember} member 
   * @param {Object} messageConfig 
   * @returns {EmbedBuilder}
   */
  createWelcomeEmbed(member, messageConfig) {
    const embed = new EmbedBuilder();

    // Replace placeholders
    const replacePlaceholders = (text) => {
      if (!text) return text;
      return text
        .replace(/{user}/g, member.user.username)
        .replace(/{user\.mention}/g, `<@${member.user.id}>`)
        .replace(/{user\.tag}/g, member.user.tag)
        .replace(/{user\.id}/g, member.user.id)
        .replace(/{server}/g, member.guild.name)
        .replace(/{memberCount}/g, member.guild.memberCount);
    };

    if (messageConfig.title) {
      embed.setTitle(replacePlaceholders(messageConfig.title));
    }

    if (messageConfig.description) {
      embed.setDescription(replacePlaceholders(messageConfig.description));
    }

    if (messageConfig.color) {
      embed.setColor(messageConfig.color);
    }

    if (messageConfig.thumbnail) {
      embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }));
    }

    if (messageConfig.footer) {
      embed.setFooter({ text: replacePlaceholders(messageConfig.footer) });
    }

    if (messageConfig.timestamp) {
      embed.setTimestamp();
    }

    // Add fields if any
    if (messageConfig.fields) {
      const fields = messageConfig.fields.map(field => ({
        name: replacePlaceholders(field.name),
        value: replacePlaceholders(field.value),
        inline: field.inline ?? false
      }));
      embed.addFields(fields);
    }

    // Add image if specified
    if (messageConfig.image) {
      embed.setImage(messageConfig.image);
    }

    return embed;
  }

  /**
   * Enable welcome system
   */
  async enable() {
    this.config.enabled = true;
    await this.saveConfig();
    return true;
  }

  /**
   * Disable welcome system
   */
  async disable() {
    this.config.enabled = false;
    await this.saveConfig();
    return true;
  }

  /**
   * Set welcome channel
   * @param {string} channelId 
   */
  async setChannel(channelId) {
    this.config.channel = channelId;
    await this.saveConfig();
    return true;
  }

  /**
   * Set welcome message
   * @param {Object} messageConfig 
   */
  async setMessage(messageConfig) {
    this.config.message = { ...this.config.message, ...messageConfig };
    await this.saveConfig();
    return true;
  }

  /**
   * Set DM message
   * @param {Object} messageConfig 
   */
  async setDMMessage(messageConfig) {
    this.config.dmMessage = { ...this.config.dmMessage, ...messageConfig };
    await this.saveConfig();
    return true;
  }

  /**
   * Set auto role
   * @param {string} roleId 
   */
  async setAutoRole(roleId) {
    this.config.roleOnJoin = roleId;
    await this.saveConfig();
    return true;
  }

  /**
   * Get welcome system statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      channel: this.config.channel,
      dmEnabled: this.config.dmEnabled,
      stats: { ...this.stats }
    };
  }
}