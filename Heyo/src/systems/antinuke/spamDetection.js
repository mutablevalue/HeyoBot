// src/systems/antiNuke/spamDetection.js - Spam detection module
export default class SpamDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Spam tracking
    this.messageSpamTracking = new Map(); // userId -> timestamp array
    this.globalSpamPattern = new Map(); // guildId -> { users: Set, startTime: number }
    this.contentTracking = new Map(); // userId-guildId -> message history
  }
  
  /**
   * Check if a message is spam
   */
  async checkMessage(message) {
    const spamDetected = await this.checkMessageSpam(message);
    
    if (spamDetected) {
      await this.handleSpam(message);
    }
    
    // Also check for duplicate messages
    await this.checkDuplicateMessages(message);
  }
  
  /**
   * Check message spam rate
   */
  async checkMessageSpam(message) {
    const spamConfig = this.config.messageSpam;
    if (!spamConfig?.enabled) return false;
    
    const userId = message.author.id;
    const guildId = message.guild.id;
    const now = Date.now();
    
    // Initialize tracking
    if (!this.messageSpamTracking.has(userId)) {
      this.messageSpamTracking.set(userId, []);
    }
    
    const timestamps = this.messageSpamTracking.get(userId);
    timestamps.push(now);
    
    // Clean old timestamps
    const timeWindow = spamConfig.timeWindow || 10000;
    const recentMessages = timestamps.filter(ts => now - ts < timeWindow);
    this.messageSpamTracking.set(userId, recentMessages);
    
    // Check if spam threshold exceeded
    const maxMessages = spamConfig.maxMessages || 10;
    if (recentMessages.length >= maxMessages) {
      this.antiNuke.stats.contentViolations.messageSpam++;
      
      // Track for global spam pattern
      if (!this.globalSpamPattern.has(guildId)) {
        this.globalSpamPattern.set(guildId, {
          users: new Set(),
          startTime: now
        });
      }
      
      const globalPattern = this.globalSpamPattern.get(guildId);
      globalPattern.users.add(userId);
      
      // Check if this is a coordinated spam attack
      if (globalPattern.users.size >= (spamConfig.raidThreshold || 3) && 
          now - globalPattern.startTime < 30000) {
        await this.antiNuke.triggerRaidMode(message.guild, 
          `Coordinated spam attack detected: ${globalPattern.users.size} users spamming`);
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Check for duplicate messages
   */
  async checkDuplicateMessages(message) {
    const config = this.config.contentModeration?.duplicateMessages;
    if (!config?.enabled) return false;
    
    const key = `${message.author.id}-${message.guild.id}`;
    if (!this.contentTracking.has(key)) {
      this.contentTracking.set(key, []);
    }
    
    const userMessages = this.contentTracking.get(key);
    const now = Date.now();
    
    // Clean old messages
    const recentMessages = userMessages.filter(m => now - m.timestamp < config.timeWindow);
    
    // Check for duplicates
    const duplicates = recentMessages.filter(m => m.content === message.content).length;
    if (duplicates >= config.threshold - 1) {
      this.antiNuke.stats.contentViolations.duplicates++;
      
      // Handle duplicate violation
      await this.handleContentViolation(message, 'duplicate', config.action);
      return true;
    }
    
    // Add current message
    recentMessages.push({
      content: message.content,
      timestamp: now
    });
    this.contentTracking.set(key, recentMessages);
    
    return false;
  }
  
  /**
   * Handle spam detection
   */
  async handleSpam(message) {
    try {
      if (message.deletable) {
        await message.delete();
      }
      
      if (message.member && message.member.moderatable) {
        const spamConfig = this.config.messageSpam;
        const action = spamConfig.action || 'timeout';
        
        switch (action) {
          case 'timeout':
            const timeoutDuration = spamConfig.timeoutDuration || 300000;
            await message.member.timeout(timeoutDuration, 'AntiNuke: Message spam');
            this.antiNuke.logSecurity(message.guild, 'Spammer Timed Out', 
              `${message.author.tag} timed out for ${timeoutDuration/1000}s for spam`);
            break;
            
          case 'kick':
            await message.member.kick('AntiNuke: Message spam');
            this.antiNuke.logSecurity(message.guild, 'Spammer Kicked', 
              `${message.author.tag} kicked for spam`);
            break;
            
          case 'ban':
            await message.member.ban({ reason: 'AntiNuke: Message spam' });
            this.antiNuke.logSecurity(message.guild, 'Spammer Banned', 
              `${message.author.tag} banned for spam`);
            break;
        }
      }
    } catch (error) {
      console.error('[SpamDetection] Error handling spam:', error);
    }
  }
  
  /**
   * Handle content violations
   */
  async handleContentViolation(message, violationType, action) {
    try {
      if (action === 'delete') {
        await message.delete();
      } else if (action === 'timeout' && message.member.moderatable) {
        await message.delete();
        const timeoutDuration = this.config.contentModeration?.timeoutDuration;
        if (timeoutDuration) {
          await message.member.timeout(
            timeoutDuration,
            `AntiNuke: ${violationType} violation`
          );
        }
      } else if (action === 'warn') {
        const warningKey = `${message.channel.id}-${violationType}`;
        const now = Date.now();
        const lastWarning = this.antiNuke.warningCooldowns.get(warningKey);
        
        if (!this.antiNuke.cooldownConfig.warningCooldown || !lastWarning || 
            (now - lastWarning) > this.antiNuke.cooldownConfig.warningCooldown) {
          if (this.antiNuke.cooldownConfig.warningCooldown) {
            this.antiNuke.warningCooldowns.set(warningKey, now);
          }
          
          await message.reply({
            content: `Warning: Your message violates our ${violationType} policy.`,
            allowedMentions: { repliedUser: true }
          }).catch(() => {});
        }
      }
      
      this.antiNuke.logAbuse(message.guild, violationType, message.author);
    } catch (error) {
      if (error.code !== 50013 && error.code !== 10008) {
        console.error('[SpamDetection] Error handling content violation:', error);
      }
    }
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const spamMaxAge = 60000; // 1 minute
    
    // Clean spam tracking
    for (const [userId, timestamps] of this.messageSpamTracking) {
      const valid = timestamps.filter(ts => now - ts < spamMaxAge);
      if (valid.length === 0) {
        this.messageSpamTracking.delete(userId);
      } else {
        this.messageSpamTracking.set(userId, valid);
      }
    }
    
    // Clean global spam patterns
    for (const [guildId, pattern] of this.globalSpamPattern) {
      if (now - pattern.startTime > 300000) { // 5 minutes
        this.globalSpamPattern.delete(guildId);
      }
    }
    
    // Clean content tracking
    const maxAge = this.config.maxTrackingAge;
    if (maxAge) {
      for (const [key, messages] of this.contentTracking) {
        const valid = messages.filter(m => now - m.timestamp < maxAge);
        if (valid.length === 0) {
          this.contentTracking.delete(key);
        } else {
          this.contentTracking.set(key, valid);
        }
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.messageSpam?.enabled ?? false,
      tracking: this.messageSpamTracking.size,
      globalPatterns: this.globalSpamPattern.size
    };
  }
}