// src/systems/linkProtection.js
import { PermissionFlagsBits } from 'discord.js';

export class LinkProtection {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load link protection config
    const linkConfig = this.configLoader.get('linkProtection') || {};
    this.config = {
      enabled: linkConfig.enabled ?? true,
      // URL patterns to detect
      patterns: linkConfig.patterns || [
        /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
        /discord\.gg\/[a-zA-Z0-9]+/gi,
        /discordapp\.com\/invite\/[a-zA-Z0-9]+/gi
      ],
      // Who is allowed to post links
      allowed: {
        // Users who can always post links
        users: linkConfig.allowed?.users || [],
        // Roles that can post links
        roles: linkConfig.allowed?.roles || [],
        // The specific link permission role from moderation system
        useLinkPermRole: linkConfig.allowed?.useLinkPermRole ?? true
      },
      // Channels where link protection is disabled
      exemptChannels: linkConfig.exemptChannels || [],
      // Log channel for deleted links
      logChannel: linkConfig.logChannel || null,
      // Delete message options
      deleteMessage: linkConfig.deleteMessage ?? true,
      // Warning message
      warningMessage: linkConfig.warningMessage || '❌ You do not have permission to send links in this channel.',
      // Send warning as ephemeral reply
      ephemeralWarning: linkConfig.ephemeralWarning ?? true
    };

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Check if a message contains links
   * @param {string} content 
   * @returns {boolean}
   */
  containsLinks(content) {
    return this.config.patterns.some(pattern => {
      if (typeof pattern === 'string') {
        return new RegExp(pattern, 'gi').test(content);
      }
      return pattern.test(content);
    });
  }

  /**
   * Check if a member can send links
   * @param {import("discord.js").GuildMember} member 
   * @param {import("discord.js").Channel} channel 
   * @returns {boolean}
   */
  canSendLinks(member, channel) {
    // Server owner can always send links
    if (member.id === member.guild.ownerId) return true;

    // Discord admins can always send links
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    // Check exempt channels
    if (this.config.exemptChannels.includes(channel.id)) return true;

    // Check allowed users
    if (this.config.allowed.users.includes(member.id)) return true;

    // Check allowed roles
    const hasAllowedRole = member.roles.cache.some(role => 
      this.config.allowed.roles.includes(role.id)
    );
    if (hasAllowedRole) return true;

    // Check for link permission role from moderation system
    if (this.config.allowed.useLinkPermRole) {
      const modConfig = this.configLoader.get('moderation');
      const linkPermRoleId = modConfig?.permRoles?.link;
      if (linkPermRoleId && member.roles.cache.has(linkPermRoleId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Log link deletion
   * @param {import("discord.js").Message} message 
   */
  async logDeletion(message) {
    if (!this.config.logChannel) return;

    const logChannel = message.guild.channels.cache.get(this.config.logChannel);
    if (!logChannel?.isTextBased()) return;

    const embed = {
      title: '🔗 Link Deleted',
      color: 0xff0000,
      fields: [
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Content', value: message.content.substring(0, 1024) || 'No content', inline: false }
      ],
      timestamp: new Date().toISOString()
    };

    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[LinkProtection] Failed to log deletion:', error);
    }
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    if (!this.config.enabled) return;

    this.client.on('messageCreate', async (message) => {
      // Ignore bots and DMs
      if (message.author.bot || !message.guild) return;

      // Check if message contains links
      if (!this.containsLinks(message.content)) return;

      // Check if member can send links
      if (this.canSendLinks(message.member, message.channel)) return;

      // Delete the message
      if (this.config.deleteMessage) {
        try {
          await message.delete();
          await this.logDeletion(message);
        } catch (error) {
          console.error('[LinkProtection] Failed to delete message:', error);
        }
      }

      // Send warning message
      if (this.config.warningMessage) {
        try {
          if (this.config.ephemeralWarning && message.interaction) {
            // If it's from an interaction, reply ephemerally
            await message.interaction.reply({
              content: this.config.warningMessage,
              ephemeral: true
            });
          } else {
            // Otherwise, send a regular message that auto-deletes
            const warning = await message.channel.send(this.config.warningMessage);
            setTimeout(() => warning.delete().catch(() => {}), 5000);
          }
        } catch (error) {
          console.error('[LinkProtection] Failed to send warning:', error);
        }
      }
    });

    // Also monitor message updates
    this.client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (!newMessage.guild || newMessage.author.bot) return;
      
      // Check if the edit added links
      if (!this.containsLinks(oldMessage.content) && this.containsLinks(newMessage.content)) {
        if (!this.canSendLinks(newMessage.member, newMessage.channel)) {
          if (this.config.deleteMessage) {
            try {
              await newMessage.delete();
              await this.logDeletion(newMessage);
            } catch (error) {
              console.error('[LinkProtection] Failed to delete edited message:', error);
            }
          }
        }
      }
    });
  }

  /**
   * Add a user to the allowed list
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async addAllowedUser(userId) {
    if (!this.config.allowed.users.includes(userId)) {
      this.config.allowed.users.push(userId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a user from the allowed list
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async removeAllowedUser(userId) {
    const index = this.config.allowed.users.indexOf(userId);
    if (index > -1) {
      this.config.allowed.users.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Add a role to the allowed list
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async addAllowedRole(roleId) {
    if (!this.config.allowed.roles.includes(roleId)) {
      this.config.allowed.roles.push(roleId);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a role from the allowed list
   * @param {string} roleId 
   * @returns {Promise<boolean>}
   */
  async removeAllowedRole(roleId) {
    const index = this.config.allowed.roles.indexOf(roleId);
    if (index > -1) {
      this.config.allowed.roles.splice(index, 1);
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('linkProtection', this.config);
    await this.configLoader.save();
  }
}