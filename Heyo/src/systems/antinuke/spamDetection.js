// src/systems/antinuke/spamDetection.js - Enhanced spam detection with raid similarity detection
export default class SpamDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Spam tracking
    this.messageSpamTracking = new Map(); // userId -> timestamp array
    this.messageContentTracking = new Map(); // guildId -> { userId -> recent messages }
    this.activeSpamSessions = new Map(); // guildId -> spam session data
  }
  
  /**
   * Check if a message is spam - MAIN ENTRY POINT
   */
  async checkMessage(message) {
    const spamData = await this.detectSpam(message);
    if (!spamData) return;
    
    // Add to active spam session
    this.addToSpamSession(message, spamData);
    
    // Check if we should process this spam session
    const session = this.activeSpamSessions.get(message.guild.id);
    if (session && this.shouldProcessSession(session)) {
      await this.processSpamSession(message.guild, session);
    }
  }
  
  /**
   * Detect if message is spam
   */
  async detectSpam(message) {
    const spamConfig = this.config.messageSpam;
    if (!spamConfig?.enabled) return null;
    
    const userId = message.author.id;
    const now = Date.now();
    
    // Track message content for similarity detection
    this.trackMessageContent(message);
    
    // Check rate-based spam
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
    const maxMessages = spamConfig.maxMessages || 5;
    if (recentMessages.length >= maxMessages) {
      return {
        type: 'rate',
        userId,
        messageCount: recentMessages.length
      };
    }
    
    // Check duplicate content spam
    const duplicateData = this.checkDuplicateSpam(message);
    if (duplicateData) {
      return duplicateData;
    }
    
    return null;
  }
  
  /**
   * Track message content for similarity detection
   */
  trackMessageContent(message) {
    const guildId = message.guild.id;
    
    if (!this.messageContentTracking.has(guildId)) {
      this.messageContentTracking.set(guildId, new Map());
    }
    
    const guildTracking = this.messageContentTracking.get(guildId);
    if (!guildTracking.has(message.author.id)) {
      guildTracking.set(message.author.id, []);
    }
    
    const userMessages = guildTracking.get(message.author.id);
    const now = Date.now();
    
    // Keep only recent messages
    const maxAge = this.config.messageSpam?.contentTrackingWindow || 30000;
    const recentMessages = userMessages.filter(m => now - m.timestamp < maxAge);
    
    // Add current message
    recentMessages.push({
      id: message.id,
      content: message.content,
      mentions: Array.from(message.mentions.users.keys()),
      timestamp: now,
      channel: message.channel.id
    });
    
    // Limit stored messages per user
    const maxTracked = this.config.messageSpam?.maxTrackedMessages || 50;
    if (recentMessages.length > maxTracked) {
      recentMessages.splice(0, recentMessages.length - maxTracked);
    }
    
    guildTracking.set(message.author.id, recentMessages);
  }
  
  /**
   * Check for duplicate content spam
   */
  checkDuplicateSpam(message) {
    const config = this.config.contentModeration?.duplicateMessages;
    if (!config?.enabled) return null;
    
    const guildTracking = this.messageContentTracking.get(message.guild.id);
    if (!guildTracking) return null;
    
    const userMessages = guildTracking.get(message.author.id) || [];
    const now = Date.now();
    
    // Count duplicates in time window
    const duplicates = userMessages.filter(m => 
      m.content === message.content && 
      now - m.timestamp < config.timeWindow
    ).length;
    
    if (duplicates >= config.threshold - 1) {
      return {
        type: 'duplicate',
        userId: message.author.id,
        duplicateCount: duplicates + 1
      };
    }
    
    return null;
  }
  
  /**
   * Add spam detection to active session
   */
  addToSpamSession(message, spamData) {
    const guildId = message.guild.id;
    const now = Date.now();
    
    if (!this.activeSpamSessions.has(guildId)) {
      this.activeSpamSessions.set(guildId, {
        startTime: now,
        lastActivity: now,
        spammers: new Map(),
        messages: []
      });
    }
    
    const session = this.activeSpamSessions.get(guildId);
    session.lastActivity = now;
    
    // Add spammer data
    if (!session.spammers.has(message.author.id)) {
      session.spammers.set(message.author.id, {
        messages: [],
        detectionType: spamData.type,
        firstDetection: now
      });
    }
    
    const spammerData = session.spammers.get(message.author.id);
    spammerData.messages.push({
      id: message.id,
      content: message.content,
      channel: message.channel,
      mentions: Array.from(message.mentions.users.keys())
    });
    
    // Add to global message list
    session.messages.push(message);
  }
  
  /**
   * Check if we should process the spam session
   */
  shouldProcessSession(session) {
    const now = Date.now();
    const sessionAge = now - session.startTime;
    const inactivity = now - session.lastActivity;
    
    // Process if session is old enough or inactive
    const maxSessionAge = this.config.messageSpam?.sessionProcessDelay || 1000; // 1 second
    const maxInactivity = this.config.messageSpam?.sessionInactivityTimeout || 2000; // 2 seconds
    
    return sessionAge >= maxSessionAge || inactivity >= maxInactivity;
  }
  
  /**
   * Process a spam session - determine if raid and take action
   */
  async processSpamSession(guild, session) {
    // Remove session immediately to prevent reprocessing
    this.activeSpamSessions.delete(guild.id);
    
    // Analyze if this is a raid
    const raidAnalysis = this.analyzeRaidPattern(session);
    
    // Determine timeout durations based on raid vs single spammer
    const spamConfig = this.config.messageSpam;
    let timeoutDuration;
    let actionReason;
    
    if (raidAnalysis.isRaid) {
      timeoutDuration = spamConfig.raidTimeoutDuration || 3600000; // 1 hour default
      actionReason = `AntiNuke: Raid spam detected (${raidAnalysis.reason})`;
      this.antiNuke.stats.contentViolations.raidsDetected++;
    } else {
      timeoutDuration = spamConfig.singleSpammerTimeout || 300000; // 5 minutes default
      actionReason = 'AntiNuke: Message spam';
    }
    
    // STEP 1: Timeout/punish all spammers FIRST
    const punishmentResults = await this.punishSpammers(
      guild, 
      session.spammers, 
      timeoutDuration, 
      actionReason,
      raidAnalysis.isRaid
    );
    
    // STEP 2: Delete all messages AFTER punishments
    await this.deleteSpamMessages(guild, session.messages);
    
    // Log the action
    const successCount = punishmentResults.filter(r => r.success).length;
    if (raidAnalysis.isRaid) {
      this.antiNuke.logSecurity(guild, 'Raid Spam Neutralized', 
        `${successCount}/${session.spammers.size} raiders punished\n` +
        `Raid type: ${raidAnalysis.reason}\n` +
        `Messages deleted: ${session.messages.length}\n` +
        `Timeout duration: ${timeoutDuration/1000}s`);
      
      // Trigger raid mode if configured
      if (spamConfig.autoRaidMode && successCount >= (spamConfig.autoRaidModeThreshold || 3)) {
        await this.antiNuke.triggerRaidMode(guild, 
          `Message spam raid: ${successCount} users neutralized (${raidAnalysis.reason})`);
      }
    } else {
      const spammerId = Array.from(session.spammers.keys())[0];
      const spammer = guild.members.cache.get(spammerId);
      this.antiNuke.logSecurity(guild, 'Spammer Neutralized', 
        `User: ${spammer?.user.tag || 'Unknown'} (${spammerId})\n` +
        `Messages deleted: ${session.messages.length}\n` +
        `Timeout duration: ${timeoutDuration/1000}s`);
    }
    
    // Update stats
    this.antiNuke.stats.contentViolations.messageSpam += session.spammers.size;
  }
  
  /**
   * Analyze if spam session is a raid
   */
  analyzeRaidPattern(session) {
    const spammerCount = session.spammers.size;
    const minRaidSize = this.config.messageSpam?.minRaidSize || 2;
    
    if (spammerCount < minRaidSize) {
      return { isRaid: false };
    }
    
    // Check for similar content patterns
    const contentPatterns = new Map();
    const mentionPatterns = new Map();
    
    for (const [userId, data] of session.spammers) {
      for (const msg of data.messages) {
        // Track exact content matches
        const contentKey = msg.content.toLowerCase().trim();
        if (!contentPatterns.has(contentKey)) {
          contentPatterns.set(contentKey, new Set());
        }
        contentPatterns.get(contentKey).add(userId);
        
        // Track mention patterns
        const mentionKey = msg.mentions.sort().join(',');
        if (mentionKey && !mentionPatterns.has(mentionKey)) {
          mentionPatterns.set(mentionKey, new Set());
        }
        if (mentionKey) {
          mentionPatterns.get(mentionKey).add(userId);
        }
      }
    }
    
    // Check for coordinated patterns
    const similarContentThreshold = this.config.messageSpam?.raidSimilarityThreshold || 0.5; // 50% of raiders
    const requiredSimilarUsers = Math.ceil(spammerCount * similarContentThreshold);
    
    // Check exact content matches
    for (const [content, users] of contentPatterns) {
      if (users.size >= requiredSimilarUsers) {
        return { 
          isRaid: true, 
          reason: `${users.size} users sending identical messages` 
        };
      }
    }
    
    // Check mention patterns
    for (const [mentions, users] of mentionPatterns) {
      if (users.size >= requiredSimilarUsers) {
        return { 
          isRaid: true, 
          reason: `${users.size} users with identical mention patterns` 
        };
      }
    }
    
    // Check timing patterns - all started within a short window
    const timingWindow = this.config.messageSpam?.raidTimingWindow || 5000; // 5 seconds
    const firstDetection = Math.min(...Array.from(session.spammers.values()).map(d => d.firstDetection));
    const lastDetection = Math.max(...Array.from(session.spammers.values()).map(d => d.firstDetection));
    
    if (lastDetection - firstDetection <= timingWindow) {
      return { 
        isRaid: true, 
        reason: `${spammerCount} users started spamming within ${timingWindow/1000}s` 
      };
    }
    
    return { isRaid: false };
  }
  
  /**
   * Punish all spammers
   */
  async punishSpammers(guild, spammers, timeoutDuration, reason, isRaid) {
    const action = isRaid 
      ? (this.config.messageSpam?.raidAction || 'timeout')
      : (this.config.messageSpam?.spamAction || 'timeout');
    
    const punishmentPromises = [];
    
    for (const [userId, data] of spammers) {
      punishmentPromises.push(
        guild.members.fetch(userId)
          .then(async member => {
            if (!member || !member.moderatable) {
              return { success: false, userId, error: 'Not moderatable' };
            }
            
            try {
              switch (action) {
                case 'timeout':
                  await member.timeout(timeoutDuration, reason);
                  return { success: true, userId, action: 'timeout' };
                  
                case 'kick':
                  await member.kick(reason);
                  return { success: true, userId, action: 'kick' };
                  
                case 'ban':
                  await member.ban({ reason });
                  return { success: true, userId, action: 'ban' };
                  
                default:
                  return { success: false, userId, error: 'Unknown action' };
              }
            } catch (error) {
              return { success: false, userId, error: error.message };
            }
          })
          .catch(error => ({ success: false, userId, error: error.message }))
      );
    }
    
    return await Promise.all(punishmentPromises);
  }
  
  /**
   * Delete spam messages in bulk
   */
  async deleteSpamMessages(guild, messages) {
    // Group messages by channel
    const channelGroups = new Map();
    
    for (const message of messages) {
      if (!channelGroups.has(message.channel.id)) {
        channelGroups.set(message.channel.id, []);
      }
      channelGroups.get(message.channel.id).push(message);
    }
    
    // Delete messages in each channel
    const deletePromises = [];
    
    for (const [channelId, channelMessages] of channelGroups) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      
      // Split into chunks of 100 (Discord limit)
      for (let i = 0; i < channelMessages.length; i += 100) {
        const chunk = channelMessages.slice(i, i + 100);
        
        deletePromises.push(
          channel.bulkDelete(chunk, true)
            .catch(err => {
              console.error(`[SpamDetection] Bulk delete error:`, err);
              // Fallback to individual deletes
              return Promise.allSettled(
                chunk.map(msg => msg.delete().catch(() => {}))
              );
            })
        );
      }
    }
    
    await Promise.all(deletePromises);
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.config.messageSpam?.trackingMaxAge || 60000;
    
    // Clean spam tracking
    for (const [userId, timestamps] of this.messageSpamTracking) {
      const valid = timestamps.filter(ts => now - ts < maxAge);
      if (valid.length === 0) {
        this.messageSpamTracking.delete(userId);
      } else {
        this.messageSpamTracking.set(userId, valid);
      }
    }
    
    // Clean content tracking
    for (const [guildId, guildTracking] of this.messageContentTracking) {
      for (const [userId, messages] of guildTracking) {
        const valid = messages.filter(m => now - m.timestamp < maxAge);
        if (valid.length === 0) {
          guildTracking.delete(userId);
        } else {
          guildTracking.set(userId, valid);
        }
      }
      if (guildTracking.size === 0) {
        this.messageContentTracking.delete(guildId);
      }
    }
    
    // Clean old spam sessions
    for (const [guildId, session] of this.activeSpamSessions) {
      if (now - session.lastActivity > maxAge) {
        this.activeSpamSessions.delete(guildId);
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
      contentTracking: this.messageContentTracking.size,
      activeSessions: this.activeSpamSessions.size
    };
  }
}