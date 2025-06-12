// src/systems/afkManager.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AfkManager {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = null; // Set by index.js
    
    // Load AFK config
    const afkConfig = this.configLoader.get('afk') || {};
    this.config = {
      enabled: afkConfig.enabled,
      dataFile: afkConfig.dataFile,
      removeOnMessage: afkConfig.removeOnMessage,
      mentionResponse: {
        showTimestamp: afkConfig.mentionResponse?.showTimestamp,
        showReason: afkConfig.mentionResponse?.showReason
      }
    };

    // Load AFK data
    this.afkMap = new Map();
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadAfkData();

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Load AFK data from file
   */
  loadAfkData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        for (const [userId, afkData] of Object.entries(data)) {
          this.afkMap.set(userId, afkData);
        }
        console.log(`[AfkManager] Loaded ${this.afkMap.size} AFK entries`);
      }
    } catch (error) {
      console.error('[AfkManager] Error loading AFK data:', error);
    }
  }

  /**
   * Save AFK data to file
   */
  saveAfkData() {
    try {
      const data = Object.fromEntries(this.afkMap);
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[AfkManager] Error saving AFK data:', error);
    }
  }

  /**
   * Set a user as AFK
   * @param {string} userId 
   * @param {string} reason 
   */
  setAfk(userId, reason = 'AFK') {
    this.afkMap.set(userId, {
      reason,
      timestamp: Date.now()
    });
    this.saveAfkData();
  }

  /**
   * Remove AFK status
   * @param {string} userId 
   * @returns {Object|null} AFK data if user was AFK
   */
  removeAfk(userId) {
    const afkData = this.afkMap.get(userId);
    if (afkData) {
      this.afkMap.delete(userId);
      this.saveAfkData();
      return afkData;
    }
    return null;
  }

  /**
   * Check if user is AFK
   * @param {string} userId 
   * @returns {Object|null}
   */
  getAfk(userId) {
    return this.afkMap.get(userId) || null;
  }

  /**
   * Format duration
   * @param {number} ms 
   * @returns {string}
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours % 24 > 0) parts.push(`${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`);
    if (seconds % 60 > 0 || parts.length === 0) {
      parts.push(`${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`);
    }

    return parts.slice(0, 2).join(' and ');
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    if (!this.config.enabled) return;

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      // Check if author is returning from AFK
      if (this.config.removeOnMessage && this.afkMap.has(message.author.id)) {
        const afkData = this.removeAfk(message.author.id);
        const duration = Date.now() - afkData.timestamp;

        const embed = this.embedLoader.createEmbed({
          description: `Welcome back <@${message.author.id}>! You were away for **${this.formatDuration(duration)}**.`
        });

        try {
          await message.reply({ embeds: [embed] });
        } catch (error) {
          console.error('[AfkManager] Error sending welcome back message:', error);
        }
      }

      // Check mentions
      for (const user of message.mentions.users.values()) {
        const afkData = this.getAfk(user.id);
        if (afkData) {
          let description = `<@${user.id}> is currently AFK`;
          
          if (this.config.mentionResponse.showReason) {
            description += `: **${afkData.reason}**`;
          }

          if (this.config.mentionResponse.showTimestamp) {
            const duration = Date.now() - afkData.timestamp;
            description += `\nAway for: ${this.formatDuration(duration)}`;
          }

          const embed = this.embedLoader.createEmbed({ description });

          try {
            await message.reply({ embeds: [embed] });
          } catch (error) {
            console.error('[AfkManager] Error sending AFK notification:', error);
          }
        }
      }
    });
  }

  /**
   * Get AFK statistics
   */
  getStats() {
    const stats = {
      totalAfk: this.afkMap.size,
      longestAfk: null,
      afkUsers: []
    };

    let longestDuration = 0;
    const now = Date.now();

    for (const [userId, data] of this.afkMap) {
      const duration = now - data.timestamp;
      stats.afkUsers.push({
        userId,
        reason: data.reason,
        duration: this.formatDuration(duration)
      });

      if (duration > longestDuration) {
        longestDuration = duration;
        stats.longestAfk = {
          userId,
          duration: this.formatDuration(duration)
        };
      }
    }

    return stats;
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('afk', this.config);
    await this.configLoader.save();
  }
}