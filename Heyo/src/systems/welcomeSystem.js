// src/systems/welcomeSystem.js
import { ChannelType } from 'discord.js';
import { EmbedLoader } from '../utils/embedLoader.js';

export class WelcomeSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = new EmbedLoader(configLoader);
    
    // Load welcome config - no defaults
    const welcomeConfig = this.configLoader.get('welcome');
    if (!welcomeConfig) {
      console.error('[WelcomeSystem] No welcome configuration found');
      return;
    }
    
    this.config = welcomeConfig;

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('welcome', this.config);
    return this.configLoader.save();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.client.on('guildMemberAdd', async (member) => {
      if (!this.config.enabled) return;
      if (member.user.bot) return;

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
      }
    });
  }

  /**
   * Get member's join position
   * @param {import("discord.js").GuildMember} member 
   * @returns {Promise<number>}
   */
  async getMemberNumber(member) {
    try {
      // Fetch all members
      const members = await member.guild.members.fetch();
      
      // Sort by join date and filter out bots
      const sortedMembers = Array.from(members.values())
        .filter(m => !m.user.bot)
        .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
      
      // Find the position (1-indexed)
      const position = sortedMembers.findIndex(m => m.id === member.id) + 1;
      
      return position || member.guild.memberCount;
    } catch (error) {
      console.error('[WelcomeSystem] Error getting member number:', error);
      return member.guild.memberCount;
    }
  }

  /**
   * Send welcome message to channel
   * @param {import("discord.js").GuildMember} member 
   */
  async sendWelcomeMessage(member) {
    const channel = member.guild.channels.cache.get(this.config.channel);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    try {
      // Get member number
      const memberNumber = await this.getMemberNumber(member);
      
      const description = this.replacePlaceholders(this.config.message?.description || '', member, memberNumber);
      
      // Create embed without title
      const embedConfig = {
        description: description,
        formatDescription: false // Don't double-format welcome messages
      };
      
      // Copy other embed properties except title
      if (this.config.message?.color) embedConfig.color = this.config.message.color;
      if (this.config.message?.thumbnail) embedConfig.thumbnail = this.config.message.thumbnail;
      if (this.config.message?.footer) embedConfig.footer = this.config.message.footer;
      if (this.config.message?.timestamp) embedConfig.timestamp = this.config.message.timestamp;
      
      const embed = this.embedLoader.createEmbed(embedConfig);
      
      // Only ping if explicitly enabled
      const content = this.config.pingUser ? `${member}` : undefined;
      const message = await channel.send({ content, embeds: [embed] });

      // Delete after specified time
      if (this.config.deleteAfter && this.config.deleteAfter > 0) {
        setTimeout(() => {
          message.delete().catch(() => {});
        }, this.config.deleteAfter * 1000);
      }
    } catch (error) {
      console.error('[WelcomeSystem] Error sending welcome message:', error);
    }
  }

  /**
   * Send welcome DM
   * @param {import("discord.js").GuildMember} member 
   */
  async sendWelcomeDM(member) {
    try {
      const memberNumber = await this.getMemberNumber(member);
      const description = this.replacePlaceholders(this.config.dmMessage?.description || '', member, memberNumber);
      const embed = this.embedLoader.createEmbed({
        description: description,
        formatDescription: false
      });
      await member.send({ embeds: [embed] });
    } catch (error) {
      console.error('[WelcomeSystem] Error sending welcome DM:', error);
    }
  }

  /**
   * Replace placeholders in text
   * @param {string} text 
   * @param {import("discord.js").GuildMember} member 
   * @param {number} memberNumber
   * @returns {string}
   */
  replacePlaceholders(text, member, memberNumber) {
    if (!text) return text;
    
    return text
      .replace(/{user}/g, member.user.username)
      .replace(/{user\.mention}/g, `<@${member.user.id}>`)
      .replace(/{user\.tag}/g, member.user.tag)
      .replace(/{user\.id}/g, member.user.id)
      .replace(/{server}/g, member.guild.name)
      .replace(/{memberCount}/g, member.guild.memberCount)
      .replace(/{memberNumber}/g, memberNumber || member.guild.memberCount);
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
    if (!this.config.message) this.config.message = {};
    this.config.message = { ...this.config.message, ...messageConfig };
    await this.saveConfig();
    return true;
  }

  /**
   * Set DM message
   * @param {Object} messageConfig 
   */
  async setDMMessage(messageConfig) {
    if (!this.config.dmMessage) this.config.dmMessage = {};
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
   * Get welcome system configuration
   */
  getConfig() {
    return {
      enabled: this.config.enabled,
      channel: this.config.channel,
      dmEnabled: this.config.dmEnabled,
      autoRole: this.config.roleOnJoin,
      pingUser: this.config.pingUser,
      deleteAfter: this.config.deleteAfter
    };
  }

  /**
   * Create preview embed
   * @param {import("discord.js").GuildMember} member 
   * @param {Object} messageConfig 
   * @returns {Promise<import("discord.js").EmbedBuilder>}
   */
  async createPreviewEmbed(member, messageConfig) {
    const memberNumber = await this.getMemberNumber(member);
    const description = this.replacePlaceholders(messageConfig?.description || '', member, memberNumber);
    return this.embedLoader.createEmbed({
      description: description,
      formatDescription: false
    });
  }
}