// src/systems/antiNuke/selfbotDetection.js - Selfbot detection module
export default class SelfbotDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Tracking
    this.deletedMessages = new Map(); // userId -> { messageId, content, timestamp }[]
    this.userMessageHistory = new Map(); // userId -> recent message data
    this.commandPatternTracking = new Map(); // userId -> command pattern data
  }
  
  /**
   * Check message for selfbot patterns
   */
  async checkMessage(message) {
    // Track message history
    this.trackMessageHistory(message);
    
    // Detect patterns
    const detection = this.detectPatterns(message);
    if (detection) {
      await this.handleDetection(message, detection);
    }
  }
  
  /**
   * Track message history
   */
  trackMessageHistory(message) {
    const userId = message.author.id;
    
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, {});
    }
    
    const history = this.userMessageHistory.get(userId);
    history.lastMessage = {
      content: message.content,
      timestamp: Date.now()
    };
  }
  
  /**
   * Detect selfbot patterns
   */
  detectPatterns(message) {
    const selfbotConfig = this.config.selfbotDetection;
    if (!selfbotConfig?.enabled) return null;
    
    const userId = message.author.id;
    const content = message.content.toLowerCase().trim();
    
    // REMOVED: Direct command pattern detection
    // We only want to detect when "something happens" like deletion
    
    // Check for user-sent embeds (immediate red flag)
    if (message.embeds.length > 0 && !message.webhookId && !message.author.bot) {
      return {
        type: 'embed',
        pattern: 'user-sent embed'
      };
    }
    
    // Check for quick delete patterns
    const userHistory = this.userMessageHistory.get(userId);
    if (userHistory && userHistory.lastDelete) {
      const timeSinceDelete = Date.now() - userHistory.lastDelete;
      if (timeSinceDelete < 3000) {
        return {
          type: 'quick-replace',
          pattern: 'deleted message and sent new one quickly'
        };
      }
    }
    
    // Check for rapid formatting changes
    if (userHistory && userHistory.lastMessage) {
      const lastContent = userHistory.lastMessage.content;
      const timeDiff = Date.now() - userHistory.lastMessage.timestamp;
      
      if (timeDiff < 5000 && this.hasUnusualFormatting(content) && !this.hasUnusualFormatting(lastContent)) {
        return {
          type: 'format-change',
          pattern: 'rapid formatting change detected'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Check for unusual formatting
   */
  hasUnusualFormatting(content) {
    return /```|`|\*\*|__|~~|\|\||>>> |> /.test(content) || 
           /[\u200B-\u200F\u2060-\u206F]/.test(content);
  }
  
  /**
   * Track deleted messages
   */
  trackDeletedMessage(message) {
    if (!message.author || message.author.bot) return;
    
    const userId = message.author.id;
    
    if (!this.deletedMessages.has(userId)) {
      this.deletedMessages.set(userId, []);
    }
    
    const deletions = this.deletedMessages.get(userId);
    deletions.push({
      messageId: message.id,
      content: message.content,
      timestamp: Date.now()
    });
    
    // Keep only recent deletions
    const recentDeletions = deletions.filter(d => Date.now() - d.timestamp < 30000);
    this.deletedMessages.set(userId, recentDeletions);
    
    // Update user history
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, {});
    }
    
    const history = this.userMessageHistory.get(userId);
    history.lastDelete = Date.now();
    
    // Check for selfbot command patterns in deleted messages
    const selfbotConfig = this.config.selfbotDetection;
    if (selfbotConfig?.enabled && selfbotConfig.detectDeletedCommands) {
      const content = message.content.toLowerCase();
      for (const prefix of selfbotConfig.prefixes || []) {
        if (content.startsWith(prefix)) {
          // Check if it's a command
          const command = content.slice(prefix.length).split(' ')[0];
          if (selfbotConfig.commands.includes(command)) {
            this.handleDetection(message, {
              type: 'deleted-command',
              pattern: `deleted command starting with ${prefix}`
            });
            break;
          }
        }
      }
    }
  }
  
  /**
   * Handle selfbot detection
   */
  async handleDetection(message, detection) {
    const userId = message.author.id;
    const selfbotConfig = this.config.selfbotDetection;
    if (!selfbotConfig) return;
    
    // Prevent duplicate detections
    const detectionKey = `${userId}-${detection.type}-${Date.now()}`;
    if (this.recentDetections && this.recentDetections.has(detectionKey)) {
      return;
    }
    
    if (!this.recentDetections) {
      this.recentDetections = new Map();
    }
    this.recentDetections.set(detectionKey, true);
    
    // Clean up old detection keys after 5 seconds
    setTimeout(() => {
      this.recentDetections.delete(detectionKey);
    }, 5000);
    
    this.antiNuke.stats.contentViolations.selfbotsDetected++;
    
    const action = selfbotConfig.action;
    if (!action) return;
    
    const member = message.member || await message.guild.members.fetch(userId).catch(() => null);
    if (!member || !member.moderatable) return;
    
    // Delete the message if it exists and is configured
    if (selfbotConfig.deleteMessages !== false && message.deletable && detection.type !== 'deleted-command') {
      try {
        await message.delete();
      } catch (error) {
        // Message might already be deleted
      }
    }
    
    try {
      // Force nickname if configured
      if (selfbotConfig.forcedNickname) {
        try {
          await member.setNickname(selfbotConfig.forcedNickname, 'AntiNuke: Selfbot detected');
        } catch (error) {
          // Ignore if we can't change nickname
        }
      }
      
      // Send warning message if configured
      let warningMessage = null;
      if (selfbotConfig.message && message.channel && message.guild) {
        try {
          // For deleted commands, we need to use the guild to find a channel
          const channel = detection.type === 'deleted-command' && !message.channel.id
            ? message.guild.channels.cache.get(message.channelId) || message.channel
            : message.channel;
            
          if (channel) {
            warningMessage = await channel.send(selfbotConfig.message
              .replace('{user}', `<@${userId}>`)
              .replace('{pattern}', detection.pattern));
          }
        } catch (error) {
          console.error('[SelfbotDetection] Error sending warning:', error);
        }
      }
      
      // Take action
      switch (action) {
        case 'ban':
          await member.ban({ reason: 'AntiNuke: Selfbot detected' });
          this.antiNuke.logSecurity(message.guild, 'Selfbot Banned', 
            `User: ${member.user.tag} (${member.id})\n` +
            `Pattern: ${detection.pattern}`);
          break;
          
        case 'kick':
          await member.kick('AntiNuke: Selfbot detected');
          this.antiNuke.logSecurity(message.guild, 'Selfbot Kicked', 
            `User: ${member.user.tag} (${member.id})\n` +
            `Pattern: ${detection.pattern}`);
          break;
          
        case 'timeout':
          const timeoutDuration = selfbotConfig.timeoutDuration;
          if (!timeoutDuration) return;
          
          await member.timeout(timeoutDuration, 'AntiNuke: Selfbot detected');
          this.antiNuke.logSecurity(message.guild, 'Selfbot Timed Out', 
            `User: ${member.user.tag} (${member.id})\n` +
            `Pattern: ${detection.pattern}\n` +
            `Duration: ${timeoutDuration/1000}s`);
          break;
          
        case 'warn':
          this.antiNuke.logSecurity(message.guild, 'Selfbot Warning', 
            `User: ${member.user.tag} (${member.id})\n` +
            `Pattern: ${detection.pattern}`);
          break;
      }
      
      // Delete warning message after delay if configured
      if (warningMessage && selfbotConfig.deleteWarningAfter) {
        setTimeout(() => {
          warningMessage.delete().catch(() => {});
        }, selfbotConfig.deleteWarningAfter);
      }
    } catch (error) {
      console.error('[SelfbotDetection] Error handling selfbot:', error);
    }
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    
    // Clean deleted messages tracking
    for (const [userId, deletions] of this.deletedMessages) {
      const valid = deletions.filter(d => now - d.timestamp < 30000);
      if (valid.length === 0) {
        this.deletedMessages.delete(userId);
      } else {
        this.deletedMessages.set(userId, valid);
      }
    }
    
    // Clean user message history
    for (const [userId, history] of this.userMessageHistory) {
      if (history.lastMessage && now - history.lastMessage.timestamp > 300000) {
        delete history.lastMessage;
      }
      if (history.lastDelete && now - history.lastDelete > 300000) {
        delete history.lastDelete;
      }
      if (Object.keys(history).length === 0) {
        this.userMessageHistory.delete(userId);
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.selfbotDetection?.enabled ?? false,
      detected: this.antiNuke.stats.contentViolations.selfbotsDetected
    };
  }
}