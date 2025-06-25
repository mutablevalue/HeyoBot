// src/systems/antinuke/spamDetection.js - Simplified with integrated detection
export default class SpamDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Unified tracking
    this.userMessageTracking = new Map(); // userId -> { messages: [], messageFrequency: Map() }
    this.activeSpamSessions = new Map(); // guildId -> spam session data
    this.processingUsers = new Set(); // Track users being processed
    
    // Message queue for bulk operations
    this.messageQueue = new Map(); // guildId -> Set of message IDs
    this.bulkDeleteTimer = new Map(); // guildId -> timeout ID
  }
  
  /**
   * Check if a message is spam - MAIN ENTRY POINT
   */
  async checkMessage(message) {
    // Skip if already processing this user
    if (this.processingUsers.has(message.author.id)) return;
    
    // Check if user should bypass spam detection
    if (await this.shouldBypassSpamDetection(message)) return;
    
    console.log(`[SpamDetection] Checking message from ${message.author.tag}: "${message.content.substring(0, 50)}..."`);
    
    // Track the message
    this.trackMessage(message);
    
    // Check if user is spamming
    const spamData = this.analyzeSpam(message);
    
    if (spamData.isSpam) {
      console.log(`[SpamDetection] SPAM DETECTED - User: ${message.author.tag}, Reason: ${spamData.reason}`);
      
      // Add to processing set
      this.processingUsers.add(message.author.id);
      
      // Queue message for deletion
      this.queueMessageDeletion(message);
      
      // Add to spam session
      this.addToSpamSession(message, spamData);
      
      // Check if we should process the session
      const session = this.activeSpamSessions.get(message.guild.id);
      if (session && this.shouldProcessSession(session)) {
        await this.processSpamSession(message.guild, session);
      }
      
      // Remove from processing set
      this.processingUsers.delete(message.author.id);
    }
  }
  
  /**
   * Track a message
   */
  trackMessage(message) {
    const userId = message.author.id;
    const now = Date.now();
    
    if (!this.userMessageTracking.has(userId)) {
      this.userMessageTracking.set(userId, {
        messages: [],
        messageFrequency: new Map()
      });
    }
    
    const tracking = this.userMessageTracking.get(userId);
    
    // Add to messages array
    tracking.messages.push({
      id: message.id,
      content: message.content,
      timestamp: now,
      channel: message.channel.id,
      mentions: message.mentions.users.size + message.mentions.roles.size
    });
    
    // Track message frequency
    const content = message.content.toLowerCase().trim();
    if (!tracking.messageFrequency.has(content)) {
      tracking.messageFrequency.set(content, []);
    }
    tracking.messageFrequency.get(content).push(now);
    
    // Clean old data
    const maxAge = this.config.messageSpam?.trackingMaxAge || 45000;
    tracking.messages = tracking.messages.filter(m => now - m.timestamp < maxAge);
    
    // Clean frequency tracking
    for (const [msg, timestamps] of tracking.messageFrequency) {
      const valid = timestamps.filter(ts => now - ts < maxAge);
      if (valid.length === 0) {
        tracking.messageFrequency.delete(msg);
      } else {
        tracking.messageFrequency.set(msg, valid);
      }
    }
  }
  
  /**
   * Analyze if user is spamming
   */
  analyzeSpam(message) {
    const userId = message.author.id;
    const tracking = this.userMessageTracking.get(userId);
    if (!tracking) return { isSpam: false };
    
    const now = Date.now();
    const config = this.config.messageSpam;
    
    // 1. Rate spam check (X messages in Y time)
    const timeWindow = config.timeWindow || 10000;
    const recentMessages = tracking.messages.filter(m => now - m.timestamp < timeWindow);
    if (recentMessages.length >= (config.maxMessages || 5)) {
      return { 
        isSpam: true, 
        reason: `${recentMessages.length} messages in ${timeWindow/1000}s`,
        type: 'rate'
      };
    }
    
    // 2. Frequency check (same message 3 times in 5 seconds)
    for (const [content, timestamps] of tracking.messageFrequency) {
      const recentOccurrences = timestamps.filter(ts => now - ts < 5000);
      if (recentOccurrences.length >= 3) {
        return { 
          isSpam: true, 
          reason: `"${content}" sent ${recentOccurrences.length} times in 5s`,
          type: 'frequency'
        };
      }
    }
    
    // 3. Duplicate check (3 identical messages in 30s)
    const duplicateWindow = this.config.contentModeration?.duplicateMessages?.timeWindow || 30000;
    const duplicateThreshold = this.config.contentModeration?.duplicateMessages?.threshold || 3;
    for (const [content, timestamps] of tracking.messageFrequency) {
      const duplicates = timestamps.filter(ts => now - ts < duplicateWindow);
      if (duplicates.length >= duplicateThreshold) {
        return { 
          isSpam: true, 
          reason: `${duplicates.length} duplicate messages in ${duplicateWindow/1000}s`,
          type: 'duplicate'
        };
      }
    }
    
    // 4. Mention spam check
    const mentionWindow = 10000; // 10 seconds
    const recentMentions = tracking.messages
      .filter(m => now - m.timestamp < mentionWindow)
      .reduce((sum, m) => sum + m.mentions, 0);
    
    if (recentMentions >= 5) {
      return { 
        isSpam: true, 
        reason: `${recentMentions} mentions in ${mentionWindow/1000}s`,
        type: 'mention'
      };
    }
    
    // Single message with too many mentions
    if (message.mentions.users.size + message.mentions.roles.size >= 3) {
      return { 
        isSpam: true, 
        reason: `${message.mentions.users.size + message.mentions.roles.size} mentions in one message`,
        type: 'mention'
      };
    }
    
    return { isSpam: false };
  }
  
  /**
   * Check if user should bypass spam detection
   */
  async shouldBypassSpamDetection(message) {
    // Check if member exists
    if (!message.member) return false;
    
    // Check if whitelisted
    if (this.antiNuke.isMemberWhitelisted(message.member)) {
      return true;
    }
    
    // Check if AntiNuke admin
    if (this.antiNuke.isMemberAntiNukeAdmin(message.member)) {
      return true;
    }
    
    // Check if server owner (with bypass enabled)
    if (this.antiNuke.fullConfig.get('moderation.ownerBypass') && 
        message.member.id === message.guild.ownerId) {
      return true;
    }
    
    // Check if bot owner
    const botOwnerConfig = this.antiNuke.fullConfig.get('moderation.permissions.botOwner');
    if (botOwnerConfig?.users?.includes(message.author.id)) {
      return true;
    }
    
    // Check permission level (Administrator or higher)
    const permLevel = this.antiNuke.getPermissionLevel(message.member);
    if (permLevel >= this.antiNuke.permissions.LEVELS.ADMINISTRATOR) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Add spam detection to active session
   */
  addToSpamSession(message, spamData) {
    const guildId = message.guild.id;
    const now = Date.now();
    
    if (!this.activeSpamSessions.has(guildId)) {
      console.log(`[SpamDetection] Creating new spam session for guild ${message.guild.name}`);
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
    const maxSessionAge = this.config.messageSpam?.sessionProcessDelay || 2000;
    const maxInactivity = this.config.messageSpam?.sessionInactivityTimeout || 2000;
    
    return sessionAge >= maxSessionAge || inactivity >= maxInactivity;
  }
  
  /**
   * Process a spam session - determine if raid and take action
   */
  async processSpamSession(guild, session) {
    console.log(`[SpamDetection] Detection started - ${session.spammers.size} user(s) detected`);
    
    // Remove session immediately to prevent reprocessing
    this.activeSpamSessions.delete(guild.id);
    
    // Analyze if this is a raid
    const raidAnalysis = this.analyzeRaidPattern(session);
    
    // Determine timeout durations based on raid vs single spammer
    const spamConfig = this.config.messageSpam;
    let timeoutDuration;
    let actionReason;
    
    if (raidAnalysis.isRaid) {
      timeoutDuration = spamConfig.raidTimeoutDuration || 300000; // 5 minutes default
      actionReason = `AntiNuke: Raid spam detected (${raidAnalysis.reason})`;
      this.antiNuke.stats.contentViolations.raidsDetected++;
      console.log(`[SpamDetection] RAID CONFIRMED - ${raidAnalysis.reason}`);
    } else {
      timeoutDuration = spamConfig.singleSpammerTimeout || 300000; // 5 minutes default
      actionReason = 'AntiNuke: Message spam';
      console.log(`[SpamDetection] Single spammer confirmed`);
    }
    
    // STEP 1: Timeout/punish all spammers FIRST
    console.log(`[SpamDetection] Users timed out - Starting punishments...`);
    const punishmentResults = await this.punishSpammers(
      guild, 
      session.spammers, 
      timeoutDuration, 
      actionReason,
      raidAnalysis.isRaid
    );
    
    const successCount = punishmentResults.filter(r => r.success).length;
    console.log(`[SpamDetection] Users timed out - ${successCount}/${session.spammers.size} users punished`);
    
    // STEP 2: Delete all messages AFTER punishments
    console.log(`[SpamDetection] Deleting messages - ${session.messages.length} messages queued`);
    await this.deleteSpamMessages(guild, session.messages);
    console.log(`[SpamDetection] Messages deleted - Cleanup complete`);
    
    // Log the action
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
   * Queue message for bulk deletion
   */
  queueMessageDeletion(message) {
    const guildId = message.guild.id;
    
    if (!this.messageQueue.has(guildId)) {
      this.messageQueue.set(guildId, new Set());
    }
    
    this.messageQueue.get(guildId).add(message);
    
    // Clear existing timer
    if (this.bulkDeleteTimer.has(guildId)) {
      clearTimeout(this.bulkDeleteTimer.get(guildId));
    }
    
    // Set new timer for bulk delete
    const bulkDeleteDelay = this.config.messageSpam?.bulkDeleteDelay || 100; // ms
    const timer = setTimeout(() => {
      this.executeBulkDelete(guildId);
    }, bulkDeleteDelay);
    
    this.bulkDeleteTimer.set(guildId, timer);
  }
  
  /**
   * Execute bulk delete for queued messages
   */
  async executeBulkDelete(guildId) {
    const messages = this.messageQueue.get(guildId);
    if (!messages || messages.size === 0) return;
    
    // Group messages by channel
    const channelGroups = new Map();
    for (const msg of messages) {
      if (!channelGroups.has(msg.channel.id)) {
        channelGroups.set(msg.channel.id, []);
      }
      channelGroups.get(msg.channel.id).push(msg);
    }
    
    // Delete messages in parallel for each channel
    const deletePromises = [];
    
    for (const [channelId, channelMessages] of channelGroups) {
      const channel = this.antiNuke.client.channels.cache.get(channelId);
      if (!channel) continue;
      
      // Discord allows bulk delete of up to 100 messages
      const chunks = this.chunkArray(channelMessages, 100);
      
      for (const chunk of chunks) {
        deletePromises.push(
          channel.bulkDelete(chunk, true).catch(err => {
            console.error(`[SpamDetection] Bulk delete error in ${channelId}:`, err);
            // Fallback to individual deletes
            return Promise.allSettled(
              chunk.map(msg => msg.delete().catch(() => {}))
            );
          })
        );
      }
    }
    
    // Execute all deletes in parallel
    await Promise.allSettled(deletePromises);
    
    // Clear the queue
    this.messageQueue.delete(guildId);
    this.bulkDeleteTimer.delete(guildId);
  }
  
  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
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
    const similarContentThreshold = this.config.messageSpam?.raidSimilarityThreshold || 0.5;
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
    
    // Check timing patterns
    const timingWindow = this.config.messageSpam?.raidTimingWindow || 10000;
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
              // NO NICKNAME CHANGES FOR SPAM - Only timeout/kick/ban
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
   * Check if a user is currently being tracked for spam
   */
  isTrackingUser(userId) {
    // Check if user is in any active spam session
    for (const [guildId, session] of this.activeSpamSessions) {
      if (session.spammers.has(userId)) {
        return true;
      }
    }
    
    // Check if user has recent activity
    if (this.userMessageTracking.has(userId)) {
      const tracking = this.userMessageTracking.get(userId);
      const now = Date.now();
      const hasRecentMessages = tracking.messages.some(m => now - m.timestamp < 5000);
      return hasRecentMessages;
    }
    
    return false;
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.config.messageSpam?.trackingMaxAge || 45000;
    
    // Clean user tracking
    for (const [userId, tracking] of this.userMessageTracking) {
      // Clean messages
      tracking.messages = tracking.messages.filter(m => now - m.timestamp < maxAge);
      
      // Clean frequency tracking
      for (const [content, timestamps] of tracking.messageFrequency) {
        const valid = timestamps.filter(ts => now - ts < maxAge);
        if (valid.length === 0) {
          tracking.messageFrequency.delete(content);
        } else {
          tracking.messageFrequency.set(content, valid);
        }
      }
      
      // Remove user if no data
      if (tracking.messages.length === 0 && tracking.messageFrequency.size === 0) {
        this.userMessageTracking.delete(userId);
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
      tracking: this.userMessageTracking.size,
      activeSessions: this.activeSpamSessions.size
    };
  }
}