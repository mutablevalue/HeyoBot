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
    
    const filterConfig = this.configLoader.get('filter') || {};
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
      
      logChannel: filterConfig.logChannel || null,
      enableLogging: filterConfig.enableLogging ?? true
    };

    // Filter data - LIGHTWEIGHT: Only store what's absolutely necessary
    this.filteredWords = new Set();
    
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
   * Load filter data from file (only custom words)
   */
  loadFilterData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.customWords) {
          this.config.wordFilter.customWords = data.customWords;
        }
        
        console.log(`[FilterSystem] Loaded filter data`);
      }
    } catch (error) {
      console.error('[FilterSystem] Error loading filter data:', error);
    }
  }

  /**
   * Save filter data to file (only custom words)
   */
  saveFilterData() {
    try {
      const data = {
        customWords: this.config.wordFilter.customWords
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
      if (newMessage.author?.bot || !newMessage.guild) return;
      
      // Use centralized permission check
      if (this.moderationSystem?.isGloballyExempt(newMessage.member)) return;
      
      // Check edited message content
      if (this.config.wordFilter.enabled) {
        await this.checkMessageContent(newMessage);
      }
    });
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
    
    if (hasImage && this.config.imageFilter.action === 'delete') {
      // Simplified - just warn about images in non-NSFW channels
      // In production, you'd use a proper NSFW detection service
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
    // Use global exemption first
    if (this.moderationSystem?.isGloballyExempt(message.member)) return true;
    
    const config = type === 'word' ? this.config.wordFilter : this.config.imageFilter;
    
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
          const warning = await message.channel.send({
            content: `${message.author} ${this.config.wordFilter.warningMessage}`,
            allowedMentions: { users: [message.author.id] }
          });
          setTimeout(() => warning.delete().catch(() => {}), 5000);
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
          const notice = await message.channel.send({
            content: `${message.author} has been timed out for using prohibited words.`,
            allowedMentions: { users: [] }
          });
          setTimeout(() => notice.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('[FilterSystem] Error timing out user:', error);
        }
        break;
    }
  }

  /**
   * Log filter violation
   */
  async logViolation(message, filterType, details) {
    if (!this.config.logChannel || !this.embedLoader) return;
    
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
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[FilterSystem] Failed to log violation:', error);
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
   * Get filter statistics (simplified)
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
        enabled: this.config.imageFilter.enabled
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