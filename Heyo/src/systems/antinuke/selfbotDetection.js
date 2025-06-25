// src/systems/antinuke/selfbotDetection.js - Updated to work with spam detection
export default class SelfbotDetection {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.config = antiNuke.config;
    
    // Tracking
    this.deletedMessages = new Map(); // userId -> { messageId, content, timestamp }[]
    this.userMessageHistory = new Map(); // userId -> recent message data
    this.selfbotSessions = new Map(); // guildId -> selfbot session data
  }
  
  /**
   * Check message for selfbot patterns
   */
  async checkMessage(message) {
    // NO BYPASSES FOR SELFBOT DETECTION
    // Even admins, owners, and whitelisted users can be selfbots
    
    // Track message history
    this.trackMessageHistory(message);
    
    // Detect patterns
    const detection = this.detectPatterns(message);
    if (detection) {
      // Add to selfbot session instead of immediate action
      this.addToSelfbotSession(message, detection);
      
      // Check if we should process the session
      const session = this.selfbotSessions.get(message.guild.id);
      if (session && this.shouldProcessSession(session)) {
        await this.processSelfbotSession(message.guild, session);
      }
    }
  }
  
  /**
   * Add detection to selfbot session
   */
  addToSelfbotSession(message, detection) {
    const guildId = message.guild.id;
    const now = Date.now();
    
    if (!this.selfbotSessions.has(guildId)) {
      this.selfbotSessions.set(guildId, {
        startTime: now,
        lastActivity: now,
        detections: new Map(),
        messages: []
      });
    }
    
    const session = this.selfbotSessions.get(guildId);
    session.lastActivity = now;
    
    // Add detection data
    if (!session.detections.has(message.author.id)) {
      session.detections.set(message.author.id, []);
    }
    
    session.detections.get(message.author.id).push({
      type: detection.type,
      pattern: detection.pattern,
      message: message,
      timestamp: now
    });
    
    session.messages.push(message);
  }
  
  /**
   * Check if we should process the selfbot session
   */
  shouldProcessSession(session) {
    const now = Date.now();
    const sessionAge = now - session.startTime;
    const inactivity = now - session.lastActivity;
    
    // Process after delay to catch coordinated selfbot raids
    const processDelay = this.config.selfbotDetection?.sessionProcessDelay || 1000;
    const inactivityTimeout = this.config.selfbotDetection?.sessionInactivityTimeout || 2000;
    
    return sessionAge >= processDelay || inactivity >= inactivityTimeout;
  }
  
  /**
   * Process selfbot session
   */
  async processSelfbotSession(guild, session) {
    // Remove session to prevent reprocessing
    this.selfbotSessions.delete(guild.id);
    
    const selfbotConfig = this.config.selfbotDetection;
    if (!selfbotConfig?.enabled) return;
    
    // Determine if this is a coordinated selfbot attack
    const isCoordinated = session.detections.size >= (selfbotConfig.coordinatedThreshold || 2);
    
    // STEP 1: Take action on all detected selfbots FIRST
    const actionResults = await this.punishSelfbots(guild, session, isCoordinated);
    
    // STEP 2: Delete messages if configured AFTER punishments
    if (selfbotConfig.deleteMessages) {
      await this.deleteSelfbotMessages(guild, session.messages);
    }
    
    // Log the action
    const successCount = actionResults.filter(r => r.success).length;
    
    if (isCoordinated) {
      this.antiNuke.logSecurity(guild, 'Coordinated Selfbot Attack', 
        `${successCount}/${session.detections.size} selfbots neutralized\n` +
        `Messages deleted: ${session.messages.length}`);
    } else {
      for (const [userId, detections] of session.detections) {
        const member = guild.members.cache.get(userId);
        const patterns = [...new Set(detections.map(d => d.pattern))].join(', ');
        
        this.antiNuke.logSecurity(guild, 'Selfbot Detected', 
          `User: ${member?.user.tag || 'Unknown'} (${userId})\n` +
          `Patterns: ${patterns}`);
      }
    }
    
    // Update stats
    this.antiNuke.stats.contentViolations.selfbotsDetected += session.detections.size;
  }
  
  /**
   * Punish detected selfbots
   */
  async punishSelfbots(guild, session, isCoordinated) {
    const selfbotConfig = this.config.selfbotDetection;
    const action = isCoordinated 
      ? (selfbotConfig.coordinatedAction || selfbotConfig.action || 'ban')
      : (selfbotConfig.action || 'timeout');
    
    const punishmentPromises = [];
    
    for (const [userId, detections] of session.detections) {
      punishmentPromises.push(
        guild.members.fetch(userId)
          .then(async member => {
            if (!member || !member.moderatable) {
              return { success: false, userId, error: 'Not moderatable' };
            }
            
            try {
              // Force nickname if configured
              if (selfbotConfig.forcedNickname) {
                await member.setNickname(selfbotConfig.forcedNickname, 'AntiNuke: Selfbot detected')
                  .catch(() => {}); // Ignore nickname errors
              }
              
              // Take action
              switch (action) {
                case 'timeout':
                  const timeoutDuration = isCoordinated
                    ? (selfbotConfig.coordinatedTimeoutDuration || 86400000) // 24h for coordinated
                    : (selfbotConfig.timeoutDuration || 600000); // 10m for single
                  await member.timeout(timeoutDuration, 'AntiNuke: Selfbot detected');
                  return { success: true, userId, action: 'timeout' };
                  
                case 'kick':
                  await member.kick('AntiNuke: Selfbot detected');
                  return { success: true, userId, action: 'kick' };
                  
                case 'ban':
                  await member.ban({ reason: 'AntiNuke: Selfbot detected' });
                  return { success: true, userId, action: 'ban' };
                  
                case 'warn':
                  // Just log, no action
                  return { success: true, userId, action: 'warn' };
                  
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
   * Delete selfbot messages
   */
  async deleteSelfbotMessages(guild, messages) {
    // Group by channel for bulk delete
    const channelGroups = new Map();
    
    for (const message of messages) {
      if (!message.deletable) continue;
      
      if (!channelGroups.has(message.channel.id)) {
        channelGroups.set(message.channel.id, []);
      }
      channelGroups.get(message.channel.id).push(message);
    }
    
    // Delete in bulk
    const deletePromises = [];
    
    for (const [channelId, channelMessages] of channelGroups) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      
      // Split into chunks of 100
      for (let i = 0; i < channelMessages.length; i += 100) {
        const chunk = channelMessages.slice(i, i + 100);
        
        deletePromises.push(
          channel.bulkDelete(chunk, true)
            .catch(() => {
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
  
  // IMPORTANT: Skip simple spam messages to avoid false positives
  
  // Skip if just mentions (like "@user" spam)
  if (content.match(/^(<@!?\d+>\s*)+$/)) {
    return null; // Just mention spam, not selfbot
  }
  
  // Skip if it's a simple short message without formatting
  if (content.length < 30 && 
      !content.includes('`') && 
      !content.includes('*') && 
      !content.includes('_') && 
      !content.includes('~') && 
      !content.includes('|') &&
      !message.embeds.length) {
    return null; // Too simple to be selfbot
  }
  
  // Skip if it's just repeated characters or simple spam
  if (/^(.)\1+$/.test(content) || /^[a-z\s]+$/.test(content)) {
    return null; // Just spam, not selfbot
  }
  
  // Check for user-sent embeds (this IS a selfbot indicator)
  if (message.embeds.length > 0 && !message.webhookId && !message.author.bot) {
    return {
      type: 'embed',
      pattern: 'user-sent embed (selfbot feature)'
    };
  }
  
  // Check for selfbot commands in current message (if enabled)
  if (selfbotConfig.detectCurrentCommands) {
    for (const prefix of selfbotConfig.prefixes || []) {
      if (content.startsWith(prefix)) {
        const command = content.slice(prefix.length).split(' ')[0];
        // Only flag if it's ACTUALLY a selfbot command
        if (selfbotConfig.commands.includes(command) && command.length > 2) {
          return {
            type: 'command',
            pattern: `selfbot command: ${prefix}${command}`
          };
        }
      }
    }
  }
    
    // Check for quick delete patterns (but more strict)
    const userHistory = this.userMessageHistory.get(userId);
    if (userHistory && userHistory.lastDelete) {
      const timeSinceDelete = Date.now() - userHistory.lastDelete;
      const quickDeleteThreshold = selfbotConfig.quickDeleteThreshold || 3000;
      
      // Only flag if they deleted and immediately sent a formatted message
      if (timeSinceDelete < quickDeleteThreshold && this.hasUnusualFormatting(content)) {
        // Check deletion history for manual deletions
        const deletions = this.deletedMessages.get(userId) || [];
        const recentManualDeletions = deletions.filter(d => 
          d.manual && Date.now() - d.timestamp < quickDeleteThreshold
        );
        
        if (recentManualDeletions.length > 0) {
          return {
            type: 'quick-replace',
            pattern: 'deleted message and sent formatted replacement (selfbot behavior)'
          };
        }
      }
    }
    
    // Check for rapid formatting changes (more strict)
    if (userHistory && userHistory.lastMessage) {
      const lastContent = userHistory.lastMessage.content;
      const timeDiff = Date.now() - userHistory.lastMessage.timestamp;
      const formatChangeWindow = selfbotConfig.formatChangeWindow || 5000;
      
      // Only flag if going from normal to heavily formatted
      if (timeDiff < formatChangeWindow && 
          !this.hasUnusualFormatting(lastContent) && 
          this.hasHeavyFormatting(content)) {
        return {
          type: 'format-change',
          pattern: 'rapid change to heavy formatting (selfbot behavior)'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Check for unusual formatting (basic)
   */
  hasUnusualFormatting(content) {
    return /```|`|\*\*|__|~~|\|\||>>> |> /.test(content) || 
           /[\u200B-\u200F\u2060-\u206F]/.test(content);
  }
  
  /**
   * Check for heavy formatting (more strict)
   */
  hasHeavyFormatting(content) {
    // Count formatting elements
    const codeBlocks = (content.match(/```/g) || []).length;
    const inlineCode = (content.match(/`/g) || []).length;
    const bold = (content.match(/\*\*/g) || []).length;
    const underline = (content.match(/__/g) || []).length;
    const strikethrough = (content.match(/~~/g) || []).length;
    const spoilers = (content.match(/\|\|/g) || []).length;
    
    // Heavy formatting = multiple types or excessive use
    const typeCount = [codeBlocks, inlineCode, bold, underline, strikethrough, spoilers]
      .filter(count => count > 0).length;
    const totalFormatting = codeBlocks + inlineCode + bold + underline + strikethrough + spoilers;
    
    return typeCount >= 3 || totalFormatting >= 6;
  }
  
  /**
   * Track deleted messages
   */
  trackDeletedMessage(message) {
    if (!message.author || message.author.bot) return;
    
    // IMPORTANT: Skip if this is a bulk delete or system deletion
    // This prevents false positives when spam detection deletes messages
    if (!message.content || message.system) return;
    
    const userId = message.author.id;
    const now = Date.now();
    
    // Check if this user recently had messages deleted by spam detection
    // If so, skip tracking to prevent false selfbot detection
    if (this.antiNuke.spamDetection) {
      const spamSessions = this.antiNuke.spamDetection.activeSpamSessions;
      for (const [guildId, session] of spamSessions) {
        if (session.spammers.has(userId) && now - session.lastActivity < 5000) {
          // User is being processed for spam, skip selfbot detection
          return;
        }
      }
    }
    
    if (!this.deletedMessages.has(userId)) {
      this.deletedMessages.set(userId, []);
    }
    
    const deletions = this.deletedMessages.get(userId);
    deletions.push({
      messageId: message.id,
      content: message.content,
      timestamp: now,
      manual: true  // Flag as manual deletion
    });
    
    // Keep only recent deletions
    const maxAge = this.config.selfbotDetection?.deletionTrackingWindow || 30000;
    const recentDeletions = deletions.filter(d => now - d.timestamp < maxAge);
    this.deletedMessages.set(userId, recentDeletions);
    
    // Update user history
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, {});
    }
    
    const history = this.userMessageHistory.get(userId);
    history.lastDelete = now;
    
    // Check for selfbot command patterns in deleted messages
    const selfbotConfig = this.config.selfbotDetection;
    if (selfbotConfig?.enabled && selfbotConfig.detectDeletedCommands) {
      const content = message.content.toLowerCase();
      for (const prefix of selfbotConfig.prefixes || []) {
        if (content.startsWith(prefix)) {
          const command = content.slice(prefix.length).split(' ')[0];
          if (selfbotConfig.commands.includes(command)) {
            // Create a fake message object for session handling
            const fakeMessage = {
              ...message,
              guild: message.guild,
              author: message.author,
              member: message.member
            };
            
            this.addToSelfbotSession(fakeMessage, {
              type: 'deleted-command',
              pattern: `deleted selfbot command: ${prefix}${command}`
            });
            
            // Process immediately for deleted commands
            const session = this.selfbotSessions.get(message.guild.id);
            if (session) {
              this.processSelfbotSession(message.guild, session);
            }
            break;
          }
        }
      }
    }
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.config.selfbotDetection?.trackingMaxAge || 300000; // 5 minutes
    
    // Clean deleted messages tracking
    for (const [userId, deletions] of this.deletedMessages) {
      const valid = deletions.filter(d => now - d.timestamp < maxAge);
      if (valid.length === 0) {
        this.deletedMessages.delete(userId);
      } else {
        this.deletedMessages.set(userId, valid);
      }
    }
    
    // Clean user message history
    for (const [userId, history] of this.userMessageHistory) {
      if (history.lastMessage && now - history.lastMessage.timestamp > maxAge) {
        delete history.lastMessage;
      }
      if (history.lastDelete && now - history.lastDelete > maxAge) {
        delete history.lastDelete;
      }
      if (Object.keys(history).length === 0) {
        this.userMessageHistory.delete(userId);
      }
    }
    
    // Clean old selfbot sessions
    for (const [guildId, session] of this.selfbotSessions) {
      if (now - session.lastActivity > maxAge) {
        this.selfbotSessions.delete(guildId);
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.selfbotDetection?.enabled ?? false,
      detected: this.antiNuke.stats.contentViolations.selfbotsDetected,
      activeSessions: this.selfbotSessions.size
    };
  }
}