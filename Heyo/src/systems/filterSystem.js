// src/systems/filterSystem.js
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FilterSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load filter config
    const filterConfig = this.configLoader.get('filter') || {};
    this.config = {
      enabled: filterConfig.enabled ?? true,
      dataFile: filterConfig.dataFile || 'filter_data.json',
      
      // Word filter settings
      wordFilter: {
        enabled: filterConfig.wordFilter?.enabled ?? true,
        defaultWords: filterConfig.wordFilter?.defaultWords || [
          // Default offensive words (you can add more in config)
          'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kys'
        ],
        customWords: filterConfig.wordFilter?.customWords || [],
        exemptRoles: filterConfig.wordFilter?.exemptRoles || [],
        exemptChannels: filterConfig.wordFilter?.exemptChannels || [],
        action: filterConfig.wordFilter?.action || 'delete', // 'delete', 'warn', 'timeout'
        timeoutDuration: filterConfig.wordFilter?.timeoutDuration || 300, // 5 minutes default
        warningMessage: filterConfig.wordFilter?.warningMessage || '⚠️ Your message contains prohibited words.',
        caseSensitive: filterConfig.wordFilter?.caseSensitive ?? false,
        checkVariations: filterConfig.wordFilter?.checkVariations ?? true // Check l33t speak, spacing
      },
      
      // Image filter settings
      imageFilter: {
        enabled: filterConfig.imageFilter?.enabled ?? false,
        nsfwThreshold: filterConfig.imageFilter?.nsfwThreshold || 0.7, // 0-1, higher = stricter
        exemptRoles: filterConfig.imageFilter?.exemptRoles || [],
        exemptChannels: filterConfig.imageFilter?.exemptChannels || [],
        nsfwChannels: filterConfig.imageFilter?.nsfwChannels || [], // Allow NSFW in these channels
        action: filterConfig.imageFilter?.action || 'delete', // 'delete', 'spoiler', 'warn'
        warningMessage: filterConfig.imageFilter?.warningMessage || '⚠️ Your image appears to contain NSFW content.',
        apiUrl: filterConfig.imageFilter?.apiUrl || null, // Optional external NSFW detection API
        maxFileSize: filterConfig.imageFilter?.maxFileSize || 8388608 // 8MB default
      },
      
      // Logging
      logChannel: filterConfig.logChannel || null,
      enableLogging: filterConfig.enableLogging ?? true,
      
      // Statistics
      trackStats: filterConfig.trackStats ?? true
    };

    // Filter data
    this.filteredWords = new Set();
    this.stats = {
      messagesFiltered: 0,
      imagesFiltered: 0,
      wordsDetected: new Map(),
      userViolations: new Map()
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
  }

  /**
   * Load filter data from file
   */
  loadFilterData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.customWords) {
          this.config.wordFilter.customWords = data.customWords;
        }
        
        if (data.stats) {
          this.stats = {
            messagesFiltered: data.stats.messagesFiltered || 0,
            imagesFiltered: data.stats.imagesFiltered || 0,
            wordsDetected: new Map(Object.entries(data.stats.wordsDetected || {})),
            userViolations: new Map(Object.entries(data.stats.userViolations || {}))
          };
        }
        
        console.log(`[FilterSystem] Loaded filter data`);
      }
    } catch (error) {
      console.error('[FilterSystem] Error loading filter data:', error);
    }
  }

  /**
   * Save filter data to file
   */
  saveFilterData() {
    try {
      const data = {
        customWords: this.config.wordFilter.customWords,
        stats: {
          messagesFiltered: this.stats.messagesFiltered,
          imagesFiltered: this.stats.imagesFiltered,
          wordsDetected: Object.fromEntries(this.stats.wordsDetected),
          userViolations: Object.fromEntries(this.stats.userViolations)
        }
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
      if (message.author.bot) return;
      if (!message.guild) return;
      
      // Check word filter
      if (this.config.wordFilter.enabled) {
        await this.checkMessageContent(message);
      }
      
      // Check image filter
      if (this.config.imageFilter.enabled && message.attachments.size > 0) {
        await this.checkMessageAttachments(message);
      }
    });

    this.client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (newMessage.author?.bot) return;
      if (!newMessage.guild) return;
      
      // Check edited message content
      if (this.config.wordFilter.enabled) {
        await this.checkMessageContent(newMessage);
      }
    });
  }

  /**
   * Check message content for filtered words
   * @param {import("discord.js").Message} message
   */
  async checkMessageContent(message) {
    // Check exemptions
    if (this.isExempt(message, 'word')) return;
    
    const detectedWords = this.detectFilteredWords(message.content);
    
    if (detectedWords.length > 0) {
      // Update stats
      this.stats.messagesFiltered++;
      this.updateUserViolations(message.author.id);
      
      for (const word of detectedWords) {
        this.stats.wordsDetected.set(word, (this.stats.wordsDetected.get(word) || 0) + 1);
      }
      
      // Take action
      await this.handleWordFilterViolation(message, detectedWords);
      
      // Log violation
      if (this.config.enableLogging) {
        await this.logViolation(message, 'Word Filter', detectedWords.join(', '));
      }
      
      this.saveFilterData();
    }
  }

  /**
   * Check message attachments for NSFW content
   * @param {import("discord.js").Message} message
   */
  async checkMessageAttachments(message) {
    // Check exemptions
    if (this.isExempt(message, 'image')) return;
    
    // Check if in NSFW channel
    if (this.config.imageFilter.nsfwChannels.includes(message.channel.id)) return;
    
    for (const attachment of message.attachments.values()) {
      // Check if it's an image
      if (!attachment.contentType?.startsWith('image/')) continue;
      
      // Check file size
      if (attachment.size > this.config.imageFilter.maxFileSize) continue;
      
      try {
        const isNSFW = await this.checkImageNSFW(attachment.url);
        
        if (isNSFW) {
          // Update stats
          this.stats.imagesFiltered++;
          this.updateUserViolations(message.author.id);
          
          // Take action
          await this.handleImageFilterViolation(message);
          
          // Log violation
          if (this.config.enableLogging) {
            await this.logViolation(message, 'Image Filter', 'NSFW content detected');
          }
          
          this.saveFilterData();
          break; // Stop checking other attachments
        }
      } catch (error) {
        console.error('[FilterSystem] Error checking image:', error);
      }
    }
  }

  /**
   * Detect filtered words in text
   * @param {string} text
   * @returns {string[]}
   */
  detectFilteredWords(text) {
    const detectedWords = [];
    const checkText = this.config.wordFilter.caseSensitive ? text : text.toLowerCase();
    
    for (const word of this.filteredWords) {
      if (this.config.wordFilter.checkVariations) {
        // Check for variations (l33t speak, spacing, etc.)
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
    
    return [...new Set(detectedWords)]; // Remove duplicates
  }

  /**
   * Generate word variations for detection
   * @param {string} word
   * @returns {string[]}
   */
  generateWordVariations(word) {
    const variations = [word];
    
    // Add spaced version (n i g g e r)
    variations.push(word.split('').join(' '));
    variations.push(word.split('').join('.'));
    variations.push(word.split('').join('-'));
    
    // Add l33t speak variations
    const l33tMap = {
      'a': ['4', '@'],
      'e': ['3'],
      'i': ['1', '!'],
      'o': ['0'],
      's': ['5', '$'],
      'g': ['9']
    };
    
    // Simple l33t replacements
    let l33tWord = word;
    for (const [letter, replacements] of Object.entries(l33tMap)) {
      for (const replacement of replacements) {
        variations.push(word.replace(new RegExp(letter, 'g'), replacement));
      }
    }
    
    return variations;
  }

  /**
   * Check if image is NSFW
   * @param {string} imageUrl
   * @returns {Promise<boolean>}
   */
  async checkImageNSFW(imageUrl) {
    // If external API is configured, use it
    if (this.config.imageFilter.apiUrl) {
      try {
        const response = await axios.post(this.config.imageFilter.apiUrl, {
          url: imageUrl
        }, {
          timeout: 5000
        });
        
        return response.data.nsfw_score > this.config.imageFilter.nsfwThreshold;
      } catch (error) {
        console.error('[FilterSystem] External NSFW API error:', error);
      }
    }
    
    // Basic heuristic check (very limited)
    // In production, you should use a proper NSFW detection service
    // This is just a placeholder
    return false;
  }

  /**
   * Check if message is exempt from filtering
   * @param {import("discord.js").Message} message
   * @param {string} type - 'word' or 'image'
   * @returns {boolean}
   */
  isExempt(message, type) {
    const config = type === 'word' ? this.config.wordFilter : this.config.imageFilter;
    
    // Check exempt channels
    if (config.exemptChannels.includes(message.channel.id)) return true;
    
    // Check exempt roles
    return message.member.roles.cache.some(role => config.exemptRoles.includes(role.id));
  }

  /**
   * Handle word filter violation
   * @param {import("discord.js").Message} message
   * @param {string[]} detectedWords
   */
  async handleWordFilterViolation(message, detectedWords) {
    switch (this.config.wordFilter.action) {
      case 'delete':
        try {
          await message.delete();
          await message.channel.send({
            content: `${message.author} ${this.config.wordFilter.warningMessage}`,
            allowedMentions: { users: [message.author.id] }
          }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
          });
        } catch (error) {
          console.error('[FilterSystem] Error deleting message:', error);
        }
        break;
        
      case 'warn':
        try {
          await message.reply({
            content: this.config.wordFilter.warningMessage,
            allowedMentions: { repliedUser: true }
          });
        } catch (error) {
          console.error('[FilterSystem] Error warning user:', error);
        }
        break;
        
      case 'timeout':
        try {
          await message.delete();
          await message.member.timeout(
            this.config.wordFilter.timeoutDuration * 1000,
            `Word filter violation: ${detectedWords.join(', ')}`
          );
          await message.channel.send({
            content: `${message.author} has been timed out for using prohibited words.`,
            allowedMentions: { users: [] }
          }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
          });
        } catch (error) {
          console.error('[FilterSystem] Error timing out user:', error);
        }
        break;
    }
  }

  /**
   * Handle image filter violation
   * @param {import("discord.js").Message} message
   */
  async handleImageFilterViolation(message) {
    switch (this.config.imageFilter.action) {
      case 'delete':
        try {
          await message.delete();
          await message.channel.send({
            content: `${message.author} ${this.config.imageFilter.warningMessage}`,
            allowedMentions: { users: [message.author.id] }
          }).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
          });
        } catch (error) {
          console.error('[FilterSystem] Error deleting message:', error);
        }
        break;
        
      case 'spoiler':
        // Can't spoiler existing message, would need to repost
        try {
          await message.reply({
            content: `${this.config.imageFilter.warningMessage}\n*Message has been flagged for review.*`,
            allowedMentions: { repliedUser: true }
          });
        } catch (error) {
          console.error('[FilterSystem] Error spoilering image:', error);
        }
        break;
        
      case 'warn':
        try {
          await message.reply({
            content: this.config.imageFilter.warningMessage,
            allowedMentions: { repliedUser: true }
          });
        } catch (error) {
          console.error('[FilterSystem] Error warning user:', error);
        }
        break;
    }
  }

  /**
   * Update user violation count
   * @param {string} userId
   */
  updateUserViolations(userId) {
    const current = this.stats.userViolations.get(userId) || 0;
    this.stats.userViolations.set(userId, current + 1);
  }

  /**
   * Log filter violation
   * @param {import("discord.js").Message} message
   * @param {string} filterType
   * @param {string} details
   */
  async logViolation(message, filterType, details) {
    if (!this.config.logChannel) return;
    
    const channel = message.guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle(`🚫 ${filterType} Violation`)
      .setColor(0xff0000)
      .addFields(
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Details', value: details, inline: false }
      )
      .setTimestamp();
    
    if (filterType === 'Word Filter' && message.content) {
      // Censor the message content
      let censoredContent = message.content;
      for (const word of this.filteredWords) {
        const regex = new RegExp(word, 'gi');
        censoredContent = censoredContent.replace(regex, '*'.repeat(word.length));
      }
      embed.addFields({ name: 'Message', value: censoredContent.slice(0, 1024), inline: false });
    }
    
    // Add violation count
    const violations = this.stats.userViolations.get(message.author.id) || 0;
    embed.setFooter({ text: `Total violations: ${violations}` });
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[FilterSystem] Failed to log violation:', error);
    }
  }

  /**
   * Add word to filter
   * @param {string} word
   * @returns {boolean}
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
   * @param {string} word
   * @returns {boolean}
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
   * Get filter statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      wordFilter: {
        enabled: this.config.wordFilter.enabled,
        totalWords: this.filteredWords.size,
        customWords: this.config.wordFilter.customWords.length
      },
      imageFilter: {
        enabled: this.config.imageFilter.enabled,
        threshold: this.config.imageFilter.nsfwThreshold
      },
      stats: {
        messagesFiltered: this.stats.messagesFiltered,
        imagesFiltered: this.stats.imagesFiltered,
        topWords: Array.from(this.stats.wordsDetected.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        topViolators: Array.from(this.stats.userViolations.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
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