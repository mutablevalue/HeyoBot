// src/systems/antinuke/moderation/linkProtection.js
export default class LinkProtection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.client = antiNuke.client;
    this.configLoader = antiNuke.fullConfig;
    
    // Warning tracking to prevent spam
    this.warningsSent = new Map(); // channelId -> lastWarningTime
    this.userWarnings = new Map(); // userId -> { count, lastWarning }
    this.logCooldowns = new Map(); // userId -> lastLogTime
    
    const linkConfig = this.configLoader.get('linkProtection') || {};
    this.config = {
      enabled: linkConfig.enabled ?? true,
      patterns: linkConfig.patterns || [],
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
      gifServices: linkConfig.gifServices || []
    };
    
    // Get cooldown settings from config
    this.cooldownConfig = {
      warningCooldown: linkConfig.warningCooldown,
      userViolationWindow: linkConfig.userViolationWindow,
      userViolationThreshold: linkConfig.userViolationThreshold,
      logCooldown: linkConfig.logCooldown,
      warningDeleteAfter: linkConfig.warningDeleteAfter
    };
    
    // Cleanup interval - only if configured
    if (linkConfig.cleanupInterval) {
      setInterval(() => this.cleanup(), linkConfig.cleanupInterval);
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    if (!this.config.enabled) return;
    
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;
      
      // Skip if no patterns configured
      if (!this.config.patterns || this.config.patterns.length === 0) return;
      
      const urls = this.extractUrls(message.content);
      if (urls.length === 0) return;
      
      // Categorize URLs
      const gifFileUrls = urls.filter(url => url.toLowerCase().includes('.gif'));
      const gifServiceUrls = this.config.allowGifServices ? urls.filter(url => !url.toLowerCase().includes('.gif') && this.isGifServiceUrl(url)) : [];
      const blockedUrls = urls.filter(url => !url.toLowerCase().includes('.gif') && (!this.config.allowGifServices || !this.isGifServiceUrl(url)));
      
      // If all URLs are allowed (whitelisted or GIF services), return
      if (blockedUrls.length === 0) {
        return;
      }
      
      // Check if user has permission to send non-whitelisted links
      if (this.canSendLinks(message.member, message.channel)) return;
      
      // DELETE MESSAGE INSTANTLY if configured
      if (this.config.deleteMessage) {
        try {
          await message.delete(); // INSTANT DELETE - NO DELAY
          const allowedUrls = [...gifFileUrls, ...gifServiceUrls];
          await this.logDeletion(message, blockedUrls, allowedUrls);
        } catch (error) {
          console.error('[LinkProtection] Failed to delete message:', error);
        }
      }
      
      // Send warning if configured (rate limited to prevent spam)
      await this.sendWarning(message);
    });
    
    this.client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (!newMessage.guild || newMessage.author?.bot) return;
      
      // Skip if no patterns configured
      if (!this.config.patterns || this.config.patterns.length === 0) return;
      
      const oldUrls = this.extractUrls(oldMessage.content || '');
      const newUrls = this.extractUrls(newMessage.content);
      
      // Check if new links were added
      const addedUrls = newUrls.filter(url => !oldUrls.includes(url));
      
      if (addedUrls.length === 0) return;
      
      // Filter out .gif files and GIF service URLs
      const blockedUrls = addedUrls.filter(url => {
        if (url.toLowerCase().includes('.gif')) return false;
        if (this.config.allowGifServices && this.isGifServiceUrl(url)) return false;
        return true;
      });
      
      if (blockedUrls.length === 0) return; // All new URLs are allowed
      
      if (!this.canSendLinks(newMessage.member, newMessage.channel)) {
        // DELETE EDITED MESSAGE INSTANTLY if it contains new blocked links
        if (this.config.deleteMessage) {
          try {
            await newMessage.delete(); // INSTANT DELETE - NO DELAY
            const gifFileUrls = addedUrls.filter(url => url.toLowerCase().includes('.gif'));
            const gifUrls = this.config.allowGifServices ? addedUrls.filter(url => !url.toLowerCase().includes('.gif') && this.isGifServiceUrl(url)) : [];
            const allowedUrls = [...gifFileUrls, ...gifUrls];
            await this.logDeletion(newMessage, blockedUrls, allowedUrls);
          } catch (error) {
            console.error('[LinkProtection] Failed to delete edited message:', error);
          }
        }
      }
    });
  }
  
  /**
   * Check if a URL is from an allowed GIF service
   */
  isGifServiceUrl(url) {
    if (!this.config.allowGifServices) return false;
    if (!this.config.gifServices || this.config.gifServices.length === 0) return false;
    
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
    if (!this.config.patterns || this.config.patterns.length === 0) return urls;
    
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
   * Check if a member can send links
   */
  canSendLinks(member, channel) {
    // Check if user has elevated permissions (moderator or higher)
    const permLevel = this.antiNuke.permissions.getPermissionLevel(member);
    // Moderator level (1) or higher can always send links
    if (permLevel >= 1) return true;
    
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
   * Send warning message
   */
  async sendWarning(message) {
    if (!this.config.warningMessage) return;
    
    const now = Date.now();
    const channelLastWarning = this.warningsSent.get(message.channel.id);
    
    // Only send warning if cooldown passed in this channel
    if (!this.cooldownConfig.warningCooldown || !channelLastWarning || (now - channelLastWarning) > this.cooldownConfig.warningCooldown) {
      // Check user warnings
      const userWarning = this.userWarnings.get(message.author.id) || { count: 0, lastWarning: 0 };
      
      // If user has less than threshold warnings in the window, send warning
      const shouldWarn = !this.cooldownConfig.userViolationThreshold ||
                       !this.cooldownConfig.userViolationWindow ||
                       userWarning.count < this.cooldownConfig.userViolationThreshold ||
                       (now - userWarning.lastWarning) > this.cooldownConfig.userViolationWindow;
      
      if (shouldWarn) {
        if (this.cooldownConfig.warningCooldown) {
          this.warningsSent.set(message.channel.id, now);
        }
        
        // Update user warnings
        if (this.cooldownConfig.userViolationWindow && (now - userWarning.lastWarning) > this.cooldownConfig.userViolationWindow) {
          userWarning.count = 1;
        } else {
          userWarning.count++;
        }
        userWarning.lastWarning = now;
        this.userWarnings.set(message.author.id, userWarning);
        
        try {
          const embedLoader = this.antiNuke.embedLoader;
          const formattedWarning = embedLoader ?
            embedLoader.format(this.config.warningMessage, 'message') :
            this.config.warningMessage;
          
          const warning = await message.channel.send(formattedWarning);
          if (this.cooldownConfig.warningDeleteAfter) {
            setTimeout(() => warning.delete().catch(() => {}), this.cooldownConfig.warningDeleteAfter);
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013) {
            console.error('[LinkProtection] Failed to send warning:', error);
          }
        }
      }
    }
  }
  
  /**
   * Log link deletion
   */
  async logDeletion(message, blockedUrls, allowedUrls) {
    if (!this.config.logChannel) return;
    
    // Check if we should log for this user
    if (this.cooldownConfig.logCooldown) {
      const now = Date.now();
      const lastLog = this.logCooldowns.get(message.author.id);
      if (lastLog && (now - lastLog) < this.cooldownConfig.logCooldown) return;
      
      this.logCooldowns.set(message.author.id, now);
    }
    
    const logChannel = message.guild.channels.cache.get(this.config.logChannel);
    if (!logChannel?.isTextBased()) return;
    
    const fields = [
      { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Blocked URLs', value: blockedUrls.join('\n').substring(0, 1024) || 'No URLs detected', inline: false },
    ];
    
    if (allowedUrls.length > 0) {
      fields.push({
        name: 'Allowed URLs (.gif/Services)',
        value: allowedUrls.join('\n').substring(0, 1024),
        inline: false
      });
    }
    
    fields.push({ name: 'Content', value: message.content.substring(0, 1024) || 'No content', inline: false });
    
    const embedLoader = this.antiNuke.embedLoader;
    const embed = embedLoader ?
      embedLoader.createEmbed({
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
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    
    // Clean warning cooldowns
    if (this.cooldownConfig.warningCooldown) {
      for (const [channelId, timestamp] of this.warningsSent) {
        if (now - timestamp > this.cooldownConfig.warningCooldown * 2) {
          this.warningsSent.delete(channelId);
        }
      }
    }
    
    // Clean user warnings
    if (this.cooldownConfig.userViolationWindow) {
      for (const [userId, data] of this.userWarnings) {
        if (now - data.lastWarning > this.cooldownConfig.userViolationWindow * 2) {
          this.userWarnings.delete(userId);
        }
      }
    }
    
    // Clean log cooldowns
    if (this.cooldownConfig.logCooldown) {
      for (const [userId, timestamp] of this.logCooldowns) {
        if (now - timestamp > this.cooldownConfig.logCooldown) {
          this.logCooldowns.delete(userId);
        }
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      patternsConfigured: this.config.patterns.length,
      exemptChannels: this.config.exemptChannels.length,
      allowedUsers: this.config.allowed.users.length,
      allowedRoles: this.config.allowed.roles.length,
      gifServicesEnabled: this.config.allowGifServices,
      gifServices: this.config.gifServices.length,
      activeWarnings: this.userWarnings.size,
      warningCooldowns: this.warningsSent.size
    };
  }
}