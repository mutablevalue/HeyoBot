// src/systems/linkProtection.js
export class LinkProtection {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Reference to moderation system (will be set by index.js)
    this.moderationSystem = null;
    
    // Reference to embed loader (will be set by index.js)
    this.embedLoader = null;
    
    const linkConfig = this.configLoader.get('linkProtection') || {};
    this.config = {
      enabled: linkConfig.enabled ?? true,
      patterns: linkConfig.patterns || [
        /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
        /discord\.gg\/[a-zA-Z0-9]+/gi,
        /discordapp\.com\/invite\/[a-zA-Z0-9]+/gi
      ],
      allowed: {
        users: linkConfig.allowed?.users || [],
        roles: linkConfig.allowed?.roles || [],
        useLinkPermRole: linkConfig.allowed?.useLinkPermRole ?? true
      },
      exemptChannels: linkConfig.exemptChannels || [],
      logChannel: linkConfig.logChannel || null,
      deleteMessage: linkConfig.deleteMessage ?? true,
      warningMessage: linkConfig.warningMessage || 'You do not have permission to send links in this channel.',
      ephemeralWarning: linkConfig.ephemeralWarning ?? true
    };

    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Set moderation system reference
   */
  setModerationSystem(moderationSystem) {
    this.moderationSystem = moderationSystem;
  }

  /**
   * Set embed loader reference
   */
  setEmbedLoader(embedLoader) {
    this.embedLoader = embedLoader;
  }

  /**
   * Check if a message contains links
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
   * Check if a member can send links using centralized permissions
   */
  canSendLinks(member, channel) {
    // Use centralized permission check if available
    if (this.moderationSystem) {
      const permCheck = this.moderationSystem.checkGlobalPermission(member, 'send_links', {
        customCheck: (mem) => {
          // Check exempt channels
          if (this.config.exemptChannels.includes(channel.id)) return true;
          
          // Check allowed users
          if (this.config.allowed.users.includes(mem.id)) return true;
          
          // Check allowed roles
          if (mem.roles.cache.some(role => this.config.allowed.roles.includes(role.id))) return true;
          
          // Check link permission role from moderation config
          if (this.config.allowed.useLinkPermRole) {
            const modConfig = this.configLoader.get('moderation');
            const linkPermRoleId = modConfig?.permRoles?.link;
            if (linkPermRoleId && mem.roles.cache.has(linkPermRoleId)) {
              return true;
            }
          }
          
          return false;
        },
        customReason: 'Link permission'
      });
      
      return permCheck.allowed;
    }
    
    // Fallback if moderation system not available
    if (this.config.exemptChannels.includes(channel.id)) return true;
    if (this.config.allowed.users.includes(member.id)) return true;
    if (member.roles.cache.some(role => this.config.allowed.roles.includes(role.id))) return true;
    
    return false;
  }

  /**
   * Log link deletion
   */
  async logDeletion(message) {
    if (!this.config.logChannel) return;

    const logChannel = message.guild.channels.cache.get(this.config.logChannel);
    if (!logChannel?.isTextBased()) return;

    const fields = [
      { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Content', value: message.content.substring(0, 1024) || 'No content', inline: false }
    ];

    const embed = this.embedLoader ? 
      this.embedLoader.createEmbed({
        title: 'Link Protection',
        description: 'Link deleted',
        fields: fields
      }) :
      {
        title: 'Link Protection',
        description: 'Link deleted',
        color: 0x800000,
        fields: fields
      };

    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[LinkProtection] Failed to log deletion:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;

      if (!this.containsLinks(message.content)) return;

      if (this.canSendLinks(message.member, message.channel)) return;

      if (this.config.deleteMessage) {
        try {
          await message.delete();
          await this.logDeletion(message);
        } catch (error) {
          console.error('[LinkProtection] Failed to delete message:', error);
        }
      }

      if (this.config.warningMessage) {
        try {
          const formattedWarning = this.embedLoader ? 
            this.embedLoader.format(this.config.warningMessage, 'message') : 
            this.config.warningMessage;
          
          const warning = await message.channel.send(formattedWarning);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('[LinkProtection] Failed to send warning:', error);
        }
      }
    });

    this.client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (!newMessage.guild || newMessage.author.bot) return;
      
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