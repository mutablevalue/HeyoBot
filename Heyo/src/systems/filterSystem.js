// src/systems/filterSystem.js
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FilterSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Reference to moderation system (will be set by index.js)
    this.moderationSystem = null;
    this.embedLoader = null;
    
    // Warning and log tracking to prevent spam
    this.warningCooldowns = new Map(); // channelId + type -> lastWarningTime
    this.userWarnings = new Map(); // userId -> { count, lastWarning }
    this.logCooldowns = new Map(); // userId + type -> lastLogTime
    
    const filterConfig = this.configLoader.get('filter') || {};
    
    // Get cooldown settings from config
    this.cooldownConfig = {
      warningCooldown: filterConfig.warningCooldown,
      userViolationWindow: filterConfig.userViolationWindow,
      userViolationThreshold: filterConfig.userViolationThreshold,
      logCooldown: filterConfig.logCooldown,
      cleanupInterval: filterConfig.cleanupInterval,
      warningDeleteAfter: filterConfig.warningDeleteAfter
    };
    
    this.config = {
      enabled: filterConfig.enabled ?? true,
      dataFile: filterConfig.dataFile || 'filter_data.json',
      
      wordFilter: {
        enabled: filterConfig.wordFilter?.enabled ?? true,
        defaultWords: filterConfig.wordFilter?.defaultWords || [],
        customWords: filterConfig.wordFilter?.customWords || [],
        exemptRoles: filterConfig.wordFilter?.exemptRoles || [],
        exemptChannels: filterConfig.wordFilter?.exemptChannels || [],
        action: filterConfig.wordFilter?.action || 'delete',
        timeoutDuration: filterConfig.wordFilter?.timeoutDuration || 300,
        warningMessage: filterConfig.wordFilter?.warningMessage || 'Your message contains prohibited words.',
        caseSensitive: filterConfig.wordFilter?.caseSensitive ?? false,
        checkVariations: filterConfig.wordFilter?.checkVariations ?? true
      },
      
      imageFilter: {
        enabled: filterConfig.imageFilter?.enabled ?? false,
        exemptRoles: filterConfig.imageFilter?.exemptRoles || [],
        exemptChannels: filterConfig.imageFilter?.exemptChannels || [],
        nsfwChannels: filterConfig.imageFilter?.nsfwChannels || [],
        action: filterConfig.imageFilter?.action || 'delete',
        warningMessage: filterConfig.imageFilter?.warningMessage || 'Your image appears to contain NSFW content.'
      },
      
      largeMessageFilter: {
        enabled: filterConfig.largeMessageFilter?.enabled ?? false,
        maxLength: filterConfig.largeMessageFilter?.maxLength || 2000,
        exemptRoles: filterConfig.largeMessageFilter?.exemptRoles || [],
        exemptChannels: filterConfig.largeMessageFilter?.exemptChannels || [],
        action: filterConfig.largeMessageFilter?.action || 'delete',
        warningMessage: filterConfig.largeMessageFilter?.warningMessage || 'Your message is too long. Maximum allowed length is {maxLength} characters.',
        splitMessage: filterConfig.largeMessageFilter?.splitMessage ?? false,
        // NEW: Space detection settings
        detectSpaceAbuse: filterConfig.largeMessageFilter?.detectSpaceAbuse ?? true,
        maxConsecutiveSpaces: filterConfig.largeMessageFilter?.maxConsecutiveSpaces || 5,
        maxWhitespaceRatio: filterConfig.largeMessageFilter?.maxWhitespaceRatio || 0.5, // 50% of message
        spaceAbuseMessage: filterConfig.largeMessageFilter?.spaceAbuseMessage || 'Your message contains excessive spacing.'
      },
      
      logChannel: filterConfig.logChannel || null,
      enableLogging: filterConfig.enableLogging ?? true
    };

    // Filter data - LIGHTWEIGHT: Only store what's absolutely necessary
    this.filteredWords = new Set();
    
    // Statistics
    this.stats = {
      wordFiltered: 0,
      imageFiltered: 0,
      largeMessageFiltered: 0,
      spaceAbuseFiltered: 0
    };
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadFilterData();
    
    // Initialize word list
    this.initializeWordList();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
    
    // Cleanup interval if configured
    if (this.cooldownConfig.cleanupInterval) {
      setInterval(() => this.cleanup(), this.cooldownConfig.cleanupInterval);
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
   * Load filter data from file (only custom words and stats)
   */
  loadFilterData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.customWords) {
          this.config.wordFilter.customWords = data.customWords;
        }
        
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }
        
        console.log(`[FilterSystem] Loaded filter data`);
      }
    } catch (error) {
      console.error('[FilterSystem] Error loading filter data:', error);
    }
  }

  /**
   * Save filter data to file (only custom words and stats)
   */
  saveFilterData() {
    try {
      const data = {
        customWords: this.config.wordFilter.customWords,
        stats: this.stats
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[FilterSystem] Error saving filter data:', error);
    }
  }

  /**
   * Initialize word list
   */
  initializeWordList() {
    this.filteredWords.clear();
    
    // Add default words
    for (const word of this.config.wordFilter.defaultWords) {
      this.filteredWords.add(word.toLowerCase());
    }
    
    // Add custom words
    for (const word of this.config.wordFilter.customWords) {
      this.filteredWords.add(word.toLowerCase());
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;
      
      // Use centralized permission check if moderation system is available
      if (this.moderationSystem?.isGloballyExempt(message.member)) return;
      
      // Check large message filter FIRST (including space abuse)
      if (this.config.largeMessageFilter.enabled) {
        const largeMessageHandled = await this.checkMessageLength(message);
        if (largeMessageHandled) return; // If message was deleted for being too long/spaced, skip other checks
      }
      
      // Check word filter
      if (this.config.wordFilter.enabled) {
        await this.checkMessageContent(message);
      }
      
      // Check image filter (simplified - no actual NSFW detection)
      if (this.config.imageFilter.enabled && message.attachments.size > 0) {
        await this.checkMessageAttachments(message);
      }
    });

    this.client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (!newMessage.guild || newMessage.author?.bot) return;
      
      // Use centralized permission check
      if (this.moderationSystem?.isGloballyExempt(newMessage.member)) return;
      
      // Check large message filter
      if (this.config.largeMessageFilter.enabled) {
        const largeMessageHandled = await this.checkMessageLength(newMessage);
        if (largeMessageHandled) return;
      }
      
      // Check edited message content
      if (this.config.wordFilter.enabled) {
        await this.checkMessageContent(newMessage);
      }
    });
  }

  /**
   * Should send warning helper
   */
  shouldSendWarning(channelId, userId, type) {
    const now = Date.now();
    const warningKey = `${channelId}-${type}`;
    const lastChannelWarning = this.warningCooldowns.get(warningKey);
    
    // Check channel cooldown
    if (this.cooldownConfig.warningCooldown && lastChannelWarning && (now - lastChannelWarning) < this.cooldownConfig.warningCooldown) {
      return false;
    }
    
    // Check user warnings
    const userWarning = this.userWarnings.get(userId) || { count: 0, lastWarning: 0 };
    
    // Reset count if window passed
    if (this.cooldownConfig.userViolationWindow && (now - userWarning.lastWarning) > this.cooldownConfig.userViolationWindow) {
      userWarning.count = 0;
    }
    
    // Don't warn if user exceeded threshold
    if (this.cooldownConfig.userViolationThreshold && userWarning.count >= this.cooldownConfig.userViolationThreshold) {
      return false;
    }
    
    // Update tracking
    if (this.cooldownConfig.warningCooldown) {
      this.warningCooldowns.set(warningKey, now);
    }
    userWarning.count++;
    userWarning.lastWarning = now;
    this.userWarnings.set(userId, userWarning);
    
    return true;
  }

  /**
   * Check message length and space abuse
   */
  async checkMessageLength(message) {
    // Check exemptions
    if (this.isExempt(message, 'largeMessage')) return false;
    
    // Check for space abuse first
    if (this.config.largeMessageFilter.detectSpaceAbuse) {
      const spaceAbuse = this.detectSpaceAbuse(message.content);
      if (spaceAbuse) {
        await this.handleSpaceAbuseViolation(message, spaceAbuse);
        
        // Log violation if enabled
        if (this.config.enableLogging) {
          await this.logViolation(message, 'Space Abuse Filter', spaceAbuse.reason);
        }
        
        this.stats.spaceAbuseFiltered++;
        this.saveFilterData();
        
        return true; // Message was handled
      }
    }
    
    // Check regular length
    if (message.content.length > this.config.largeMessageFilter.maxLength) {
      // Handle large message violation
      await this.handleLargeMessageViolation(message);
      
      // Log violation if enabled
      if (this.config.enableLogging) {
        await this.logViolation(message, 'Large Message Filter', 
          `Message length: ${message.content.length} characters (max: ${this.config.largeMessageFilter.maxLength})`);
      }
      
      this.stats.largeMessageFiltered++;
      this.saveFilterData();
      
      return true; // Message was handled
    }
    
    return false; // Message was not too large
  }

  /**
   * Detect space abuse in message
   */
  detectSpaceAbuse(content) {
    // Check for consecutive spaces
    const consecutiveSpaceRegex = new RegExp(`\\s{${this.config.largeMessageFilter.maxConsecutiveSpaces + 1},}`, 'g');
    const hasConsecutiveSpaces = consecutiveSpaceRegex.test(content);
    
    if (hasConsecutiveSpaces) {
      const matches = content.match(consecutiveSpaceRegex);
      const largestGap = Math.max(...matches.map(m => m.length));
      return {
        type: 'consecutive_spaces',
        reason: `Message contains ${largestGap} consecutive spaces (max allowed: ${this.config.largeMessageFilter.maxConsecutiveSpaces})`
      };
    }
    
    // Check whitespace ratio
    const whitespaceCount = (content.match(/\s/g) || []).length;
    const totalLength = content.length;
    const whitespaceRatio = totalLength > 0 ? whitespaceCount / totalLength : 0;
    
    if (whitespaceRatio > this.config.largeMessageFilter.maxWhitespaceRatio) {
      return {
        type: 'whitespace_ratio',
        reason: `Message is ${Math.round(whitespaceRatio * 100)}% whitespace (max allowed: ${Math.round(this.config.largeMessageFilter.maxWhitespaceRatio * 100)}%)`
      };
    }
    
    // Check for Unicode space characters abuse
    const unicodeSpaces = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
    const unicodeSpaceMatches = content.match(unicodeSpaces);
    if (unicodeSpaceMatches && unicodeSpaceMatches.length > 10) {
      return {
        type: 'unicode_spaces',
        reason: `Message contains ${unicodeSpaceMatches.length} special space characters`
      };
    }
    
    // Check for messages that are mostly newlines
    const newlineCount = (content.match(/\n/g) || []).length;
    if (newlineCount > 10) {
      return {
        type: 'excessive_newlines',
        reason: `Message contains ${newlineCount} newlines`
      };
    }
    
    return null;
  }

  /**
   * Handle space abuse violation
   */
  async handleSpaceAbuseViolation(message, spaceAbuse) {
    const config = this.config.largeMessageFilter;
    
    try {
      await message.delete();
      
      // Check if we should send a warning
      if (this.shouldSendWarning(message.channel.id, message.author.id, 'spaceAbuse')) {
        const warning = await message.channel.send({
          content: `${message.author} ${config.spaceAbuseMessage}`,
          allowedMentions: { users: [message.author.id] }
        });
        if (this.cooldownConfig.warningDeleteAfter) {
          setTimeout(() => warning.delete().catch(() => {}), this.cooldownConfig.warningDeleteAfter);
        }
      }
    } catch (error) {
      // Silently fail if rate limited
      if (error.code !== 50013 && error.code !== 10008) {
        console.error('[FilterSystem] Error handling space abuse:', error);
      }
    }
  }

  /**
   * Handle large message violation
   */
  async handleLargeMessageViolation(message) {
    const config = this.config.largeMessageFilter;
    
    switch (config.action) {
      case 'delete':
        try {
          await message.delete();
          
          // Check if we should send a warning
          if (this.shouldSendWarning(message.channel.id, message.author.id, 'largeMessage')) {
            const warning = await message.channel.send({
              content: `${message.author} ${config.warningMessage.replace('{maxLength}', config.maxLength)}`,
              allowedMentions: { users: [message.author.id] }
            });
            if (this.cooldownConfig.warningDeleteAfter) {
              setTimeout(() => warning.delete().catch(() => {}), this.cooldownConfig.warningDeleteAfter);
            }
            
            // If split message is enabled, send a truncated version
            if (config.splitMessage) {
              const truncated = message.content.substring(0, config.maxLength - 50) + '... [Message truncated]';
              await message.channel.send({
                content: `${message.author}: ${truncated}`,
                allowedMentions: { users: [] }
              });
            }
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error handling large message:', error);
          }
        }
        break;
        
      case 'warn':
        try {
          if (this.shouldSendWarning(message.channel.id, message.author.id, 'largeMessage')) {
            await message.reply({
              content: config.warningMessage.replace('{maxLength}', config.maxLength),
              allowedMentions: { repliedUser: true }
            });
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error warning user:', error);
          }
        }
        break;
        
      case 'truncate':
        try {
          await message.delete();
          const truncated = message.content.substring(0, config.maxLength);
          await message.channel.send({
            content: `${message.author}: ${truncated}`,
            allowedMentions: { users: [] }
          });
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error truncating message:', error);
          }
        }
        break;
    }
  }

  /**
   * Check message content for filtered words
   */
  async checkMessageContent(message) {
    // Check exemptions
    if (this.isExempt(message, 'word')) return;
    
    const detectedWords = this.detectFilteredWords(message.content);
    
    if (detectedWords.length > 0) {
      // Take action
      await this.handleWordFilterViolation(message, detectedWords);
      
      // Log violation if enabled
      if (this.config.enableLogging) {
        await this.logViolation(message, 'Word Filter', detectedWords.join(', '));
      }
      
      this.stats.wordFiltered++;
      this.saveFilterData();
    }
  }

  /**
   * Check message attachments (simplified)
   */
  async checkMessageAttachments(message) {
    // Check exemptions
    if (this.isExempt(message, 'image')) return;
    
    // Check if in NSFW channel
    if (this.config.imageFilter.nsfwChannels.includes(message.channel.id)) return;
    
    // For now, just check if it's an image
    const hasImage = message.attachments.some(att => att.contentType?.startsWith('image/'));
    
    if (hasImage) {
      this.stats.imageFiltered++;
      this.saveFilterData();
      // In production, you'd use a proper NSFW detection service here
    }
  }

  /**
   * Detect filtered words in text
   */
  detectFilteredWords(text) {
    const detectedWords = [];
    const checkText = this.config.wordFilter.caseSensitive ? text : text.toLowerCase();
    
    for (const word of this.filteredWords) {
      if (this.config.wordFilter.checkVariations) {
        // Check for variations
        const variations = this.generateWordVariations(word);
        
        for (const variation of variations) {
          if (checkText.includes(variation)) {
            detectedWords.push(word);
            break;
          }
        }
      } else {
        // Simple check
        if (checkText.includes(word)) {
          detectedWords.push(word);
        }
      }
    }
    
    return [...new Set(detectedWords)];
  }

  /**
   * Generate word variations for detection (simplified)
   */
  generateWordVariations(word) {
    const variations = [word];
    
    // Add spaced version
    variations.push(word.split('').join(' '));
    variations.push(word.split('').join('.'));
    
    // Simple l33t replacements
    const l33tMap = {
      'a': '4', 'e': '3', 'i': '1', 'o': '0', 's': '5'
    };
    
    let l33tWord = word;
    for (const [letter, replacement] of Object.entries(l33tMap)) {
      l33tWord = l33tWord.replace(new RegExp(letter, 'g'), replacement);
    }
    if (l33tWord !== word) variations.push(l33tWord);
    
    return variations;
  }

  /**
   * Check if message is exempt from filtering
   */
  isExempt(message, type) {
    // Use global exemption first (if moderator or higher)
    if (this.moderationSystem) {
      const member = message.member || message.author;
      // Check if user has moderator permissions or higher (permission level 1+)
      if (member && member.guild) {
        try {
          const mockMember = {
            id: member.id,
            guild: member.guild,
            roles: member.roles || { cache: new Map() }
          };
          // Get permission level if permission system is available
          const modConfig = this.configLoader.get('moderation');
          if (modConfig?.ownerBypass && member.id === member.guild.ownerId) {
            return true;
          }
        } catch (error) {
          // Continue with normal exemption checks
        }
      }
    }
    
    let config;
    switch (type) {
      case 'word':
        config = this.config.wordFilter;
        break;
      case 'image':
        config = this.config.imageFilter;
        break;
      case 'largeMessage':
        config = this.config.largeMessageFilter;
        break;
      default:
        return false;
    }
    
    // Check exempt channels
    if (config.exemptChannels.includes(message.channel.id)) return true;
    
    // Check exempt roles
    return message.member.roles.cache.some(role => config.exemptRoles.includes(role.id));
  }

  /**
   * Handle word filter violation
   */
  async handleWordFilterViolation(message, detectedWords) {
    switch (this.config.wordFilter.action) {
      case 'delete':
        try {
          await message.delete();
          
          // Check if we should send a warning
          if (this.shouldSendWarning(message.channel.id, message.author.id, 'wordFilter')) {
            const warning = await message.channel.send({
              content: `${message.author} ${this.config.wordFilter.warningMessage}`,
              allowedMentions: { users: [message.author.id] }
            });
            if (this.cooldownConfig.warningDeleteAfter) {
              setTimeout(() => warning.delete().catch(() => {}), this.cooldownConfig.warningDeleteAfter);
            }
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error deleting message:', error);
          }
        }
        break;
        
      case 'warn':
        try {
          if (this.shouldSendWarning(message.channel.id, message.author.id, 'wordFilter')) {
            await message.reply({
              content: this.config.wordFilter.warningMessage,
              allowedMentions: { repliedUser: true }
            });
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error warning user:', error);
          }
        }
        break;
        
      case 'timeout':
        try {
          await message.delete();
          await message.member.timeout(
            this.config.wordFilter.timeoutDuration * 1000,
            `Word filter violation: ${detectedWords.join(', ')}`
          );
          
          // Only send notification if we haven't warned recently
          if (this.shouldSendWarning(message.channel.id, message.author.id, 'wordFilter')) {
            const notice = await message.channel.send({
              content: `${message.author} has been timed out for using prohibited words.`,
              allowedMentions: { users: [] }
            });
            if (this.cooldownConfig.warningDeleteAfter) {
              setTimeout(() => notice.delete().catch(() => {}), this.cooldownConfig.warningDeleteAfter);
            }
          }
        } catch (error) {
          // Silently fail if rate limited
          if (error.code !== 50013 && error.code !== 10008) {
            console.error('[FilterSystem] Error timing out user:', error);
          }
        }
        break;
    }
  }

  /**
   * Log filter violation
   */
  async logViolation(message, filterType, details) {
    if (!this.config.logChannel || !this.embedLoader) return;
    
    // Check log cooldown
    const logKey = `${message.author.id}-${filterType}`;
    const now = Date.now();
    const lastLog = this.logCooldowns.get(logKey);
    
    if (this.cooldownConfig.logCooldown && lastLog && (now - lastLog) < this.cooldownConfig.logCooldown) return;
    
    if (this.cooldownConfig.logCooldown) {
      this.logCooldowns.set(logKey, now);
    }
    
    const channel = message.guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = this.embedLoader.createEmbed({
      title: 'Filter System',
      description: 'Violation detected',
      fields: [
        { name: 'Type', value: filterType, inline: true },
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Details', value: details, inline: false }
      ]
    });
    
    if (filterType === 'Word Filter' && message.content) {
      // Censor the message content
      let censoredContent = message.content;
      for (const word of this.filteredWords) {
        const regex = new RegExp(word, 'gi');
        censoredContent = censoredContent.replace(regex, '*'.repeat(word.length));
      }
      embed.addFields({ name: 'Message', value: censoredContent.slice(0, 1024), inline: false });
    } else if (filterType === 'Large Message Filter' || filterType === 'Space Abuse Filter') {
      // Show a preview with visible spaces
      const preview = message.content
        .replace(/ /g, '·') // Replace spaces with middle dots
        .replace(/\n/g, '↵\n') // Show newlines
        .slice(0, 500);
      embed.addFields({ 
        name: 'Message Preview (spaces shown as ·)', 
        value: preview + (message.content.length > 500 ? '...' : ''), 
        inline: false 
      });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      // Silently fail if rate limited
      if (error.code !== 50013) {
        console.error('[FilterSystem] Failed to log violation:', error);
      }
    }
  }

  /**
   * Add word to filter
   */
  addFilteredWord(word) {
    const lowerWord = word.toLowerCase();
    if (this.filteredWords.has(lowerWord)) return false;
    
    this.filteredWords.add(lowerWord);
    this.config.wordFilter.customWords.push(lowerWord);
    this.saveFilterData();
    return true;
  }

  /**
   * Remove word from filter
   */
  removeFilteredWord(word) {
    const lowerWord = word.toLowerCase();
    
    // Check if it's a default word
    if (this.config.wordFilter.defaultWords.includes(lowerWord)) {
      return false; // Can't remove default words
    }
    
    if (!this.filteredWords.has(lowerWord)) return false;
    
    this.filteredWords.delete(lowerWord);
    const index = this.config.wordFilter.customWords.indexOf(lowerWord);
    if (index > -1) {
      this.config.wordFilter.customWords.splice(index, 1);
    }
    this.saveFilterData();
    return true;
  }

  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    
    // Clean warning cooldowns
    if (this.cooldownConfig.warningCooldown) {
      for (const [key, timestamp] of this.warningCooldowns) {
        if (now - timestamp > this.cooldownConfig.warningCooldown * 2) {
          this.warningCooldowns.delete(key);
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
      for (const [key, timestamp] of this.logCooldowns) {
        if (now - timestamp > this.cooldownConfig.logCooldown * 2) {
          this.logCooldowns.delete(key);
        }
      }
    }
  }

  /**
   * Get filter statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      wordFilter: {
        enabled: this.config.wordFilter.enabled,
        totalWords: this.filteredWords.size,
        customWords: this.config.wordFilter.customWords.length,
        violations: this.stats.wordFiltered
      },
      imageFilter: {
        enabled: this.config.imageFilter.enabled,
        violations: this.stats.imageFiltered
      },
      largeMessageFilter: {
        enabled: this.config.largeMessageFilter.enabled,
        maxLength: this.config.largeMessageFilter.maxLength,
        violations: this.stats.largeMessageFiltered,
        spaceAbuseDetection: this.config.largeMessageFilter.detectSpaceAbuse,
        spaceAbuseViolations: this.stats.spaceAbuseFiltered
      },
      activeCooldowns: {
        warnings: this.warningCooldowns.size,
        users: this.userWarnings.size,
        logs: this.logCooldowns.size
      }
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('filter', this.config);
    return this.configLoader.save();
  }
}