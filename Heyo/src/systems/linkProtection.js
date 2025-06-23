// src/systems/linkProtection.js
export class LinkProtection {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Reference to moderation system (will be set by index.js)
    this.moderationSystem = null;
    
    // Reference to embed loader (will be set by index.js)
    this.embedLoader = null;
    
    // Reference to unified permission system
    this.permissionSystem = null;
    
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
      ephemeralWarning: linkConfig.ephemeralWarning ?? true,
      // GIF service settings
      allowGifServices: linkConfig.allowGifServices ?? true,
      gifServices: linkConfig.gifServices || [
        'tenor.com',
        'giphy.com',
        'gfycat.com',
        'imgur.com',
        'media.giphy.com',
        'media.tenor.com',
        'media0.giphy.com',
        'media1.giphy.com', 
        'media2.giphy.com',
        'media3.giphy.com',
        'media4.giphy.com',
        'c.tenor.com',
        'thumbs.gfycat.com',
        'giant.gfycat.com',
        'i.giphy.com',
        'i.imgur.com'
      ]
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
   * Set unified permission system reference
   */
  setPermissionSystem(permissionSystem) {
    this.permissionSystem = permissionSystem;
  }

  /**
   * Check if a URL is from an allowed GIF service
   * IMPROVED: Better URL parsing and domain checking
   */
  isGifServiceUrl(url) {
    if (!this.config.allowGifServices) return false;
    
    try {
      // Parse the URL to extract the hostname
      const urlObj = new URL(url.toLowerCase());
      const hostname = urlObj.hostname;
      
      // Check if the hostname matches any of our allowed GIF services
      return this.config.gifServices.some(service => {
        const serviceLower = service.toLowerCase();
        // Check exact match or subdomain match
        return hostname === serviceLower || 
               hostname.endsWith('.' + serviceLower) ||
               (serviceLower.includes('.') && hostname === serviceLower);
      });
    } catch (e) {
      // If URL parsing fails, fall back to simple string checking
      const urlLower = url.toLowerCase();
      return this.config.gifServices.some(service => {
        // Ensure we're checking the domain part of the URL
        return urlLower.includes('//' + service.toLowerCase() + '/') ||
               urlLower.includes('//' + service.toLowerCase());
      });
    }
  }

  /**
   * Extract URLs from content
   */
  extractUrls(content) {
    const urls = [];
    this.config.patterns.forEach(pattern => {
      const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
      const matches = content.matchAll(regex);
      for (const match of matches) {
        urls.push(match[0]);
      }
    });
    return urls;
  }

  /**
   * Check if a message contains non-GIF links
   */
  containsNonGifLinks(content) {
    const urls = this.extractUrls(content);
    
    // If no URLs found, return false
    if (urls.length === 0) return false;
    
    // If GIF services are allowed, check if all URLs are from GIF services
    if (this.config.allowGifServices) {
      const nonGifUrls = urls.filter(url => !this.isGifServiceUrl(url));
      return nonGifUrls.length > 0;
    }
    
    // If GIF services are not allowed, any URL is considered a violation
    return urls.length > 0;
  }

  /**
   * Check if a member can send links
   */
  canSendLinks(member, channel) {
    // Check if user has elevated permissions (moderator or higher)
    if (this.permissionSystem) {
      const permLevel = this.permissionSystem.getPermissionLevel(member);
      // Moderator level (1) or higher can always send links
      if (permLevel >= 1) return true;
    }
    
    // Check exempt channels
    if (this.config.exemptChannels.includes(channel.id)) return true;
    
    // Check allowed users
    if (this.config.allowed.users.includes(member.id)) return true;
    
    // Check allowed roles
    if (member.roles.cache.some(role => this.config.allowed.roles.includes(role.id))) return true;
    
    // Check link permission role from moderation config
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
   */
  async logDeletion(message, blockedUrls) {
    if (!this.config.logChannel) return;

    const logChannel = message.guild.channels.cache.get(this.config.logChannel);
    if (!logChannel?.isTextBased()) return;

    // Show which URLs were blocked and which were allowed
    const allUrls = this.extractUrls(message.content);
    const allowedGifUrls = allUrls.filter(url => this.isGifServiceUrl(url));

    const fields = [
      { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Blocked URLs', value: blockedUrls.join('\n').substring(0, 1024) || 'No URLs detected', inline: false },
    ];

    if (allowedGifUrls.length > 0) {
      fields.push({ 
        name: 'Allowed GIF URLs', 
        value: allowedGifUrls.join('\n').substring(0, 1024), 
        inline: false 
      });
    }

    fields.push({ name: 'Content', value: message.content.substring(0, 1024) || 'No content', inline: false });

    const embed = this.embedLoader ? 
      this.embedLoader.createEmbed({
        title: 'Link Protection',
        description: 'Non-allowed links deleted',
        fields: fields
      }) :
      {
        title: 'Link Protection',
        description: 'Non-allowed links deleted',
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

      const urls = this.extractUrls(message.content);
      if (urls.length === 0) return;

      // Debug logging for GIF detection
      if (this.config.allowGifServices) {
        console.log('[LinkProtection] URLs found:', urls);
        urls.forEach(url => {
          console.log(`[LinkProtection] URL: ${url} - Is GIF service: ${this.isGifServiceUrl(url)}`);
        });
      }

      // Filter out allowed GIF service URLs
      const blockedUrls = this.config.allowGifServices 
        ? urls.filter(url => !this.isGifServiceUrl(url))
        : urls;

      if (blockedUrls.length === 0) {
        console.log('[LinkProtection] All URLs are from allowed GIF services, allowing message');
        return; // All URLs are from allowed GIF services
      }

      if (this.canSendLinks(message.member, message.channel)) return;

      // Only delete and warn, NO TIMEOUT
      if (this.config.deleteMessage) {
        try {
          await message.delete();
          await this.logDeletion(message, blockedUrls);
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
      
      const oldUrls = this.extractUrls(oldMessage.content || '');
      const newUrls = this.extractUrls(newMessage.content);
      
      // Check if new links were added
      const addedUrls = newUrls.filter(url => !oldUrls.includes(url));
      
      if (addedUrls.length === 0) return;
      
      // Filter out allowed GIF service URLs
      const blockedUrls = this.config.allowGifServices 
        ? addedUrls.filter(url => !this.isGifServiceUrl(url))
        : addedUrls;
      
      if (blockedUrls.length === 0) return; // All new URLs are from allowed GIF services
      
      if (!this.canSendLinks(newMessage.member, newMessage.channel)) {
        if (this.config.deleteMessage) {
          try {
            await newMessage.delete();
            await this.logDeletion(newMessage, blockedUrls);
          } catch (error) {
            console.error('[LinkProtection] Failed to delete edited message:', error);
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
   * Add a GIF service domain
   */
  async addGifService(domain) {
    if (!this.config.gifServices.includes(domain.toLowerCase())) {
      this.config.gifServices.push(domain.toLowerCase());
      await this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Remove a GIF service domain
   */
  async removeGifService(domain) {
    const index = this.config.gifServices.indexOf(domain.toLowerCase());
    if (index > -1) {
      this.config.gifServices.splice(index, 1);
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