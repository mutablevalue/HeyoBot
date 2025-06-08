// src/systems/leaderboardSystem.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class LeaderboardSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load leaderboard config
    const leaderboardConfig = this.configLoader.get('leaderboard') || {};
    this.config = {
      enabled: leaderboardConfig.enabled ?? true,
      trackMessages: leaderboardConfig.trackMessages ?? true,
      trackVoice: leaderboardConfig.trackVoice ?? true,
      dataFile: leaderboardConfig.dataFile || 'leaderboard_data.json',
      resetSchedule: leaderboardConfig.resetSchedule || {
        weekly: 'Monday', // Day of week to reset
        monthly: 1, // Day of month to reset
      },
      minimumVCTime: leaderboardConfig.minimumVCTime || 60, // Minimum seconds in VC to count
      excludedChannels: leaderboardConfig.excludedChannels || [], // Channel IDs to exclude
      excludedRoles: leaderboardConfig.excludedRoles || [], // Role IDs to exclude from tracking
      trackBots: leaderboardConfig.trackBots ?? false
    };

    // Data storage
    this.data = {
      messages: {
        lifetime: new Map(),
        monthly: new Map(),
        weekly: new Map()
      },
      voice: {
        lifetime: new Map(),
        monthly: new Map(),
        weekly: new Map()
      },
      lastReset: {
        weekly: new Date().toISOString(),
        monthly: new Date().toISOString()
      }
    };

    // Voice state tracking
    this.voiceStates = new Map(); // userId -> { channelId, joinTime }
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
      this.startResetScheduler();
    }

    // Save data periodically
    setInterval(() => this.saveData(), 60000); // Save every minute
  }

  /**
   * Load leaderboard data from file
   */
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const rawData = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        // Convert arrays back to Maps
        ['messages', 'voice'].forEach(type => {
          ['lifetime', 'monthly', 'weekly'].forEach(period => {
            this.data[type][period] = new Map(rawData[type][period]);
          });
        });
        
        this.data.lastReset = rawData.lastReset || this.data.lastReset;
        
        console.log(`[LeaderboardSystem] Loaded leaderboard data`);
      }
    } catch (error) {
      console.error('[LeaderboardSystem] Error loading data:', error);
    }
  }

  /**
   * Save leaderboard data to file
   */
  saveData() {
    try {
      const dataToSave = {
        messages: {},
        voice: {},
        lastReset: this.data.lastReset
      };

      // Convert Maps to arrays for JSON
      ['messages', 'voice'].forEach(type => {
        ['lifetime', 'monthly', 'weekly'].forEach(period => {
          dataToSave[type][period] = Array.from(this.data[type][period].entries());
        });
      });

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
      console.error('[LeaderboardSystem] Error saving data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Track messages
    if (this.config.trackMessages) {
      this.client.on('messageCreate', async (message) => {
        if (!this.shouldTrackUser(message.member)) return;
        if (this.config.excludedChannels.includes(message.channel.id)) return;
        
        this.incrementMessageCount(message.author.id, message.guild.id);
      });
    }

    // Track voice state changes
    if (this.config.trackVoice) {
      this.client.on('voiceStateUpdate', async (oldState, newState) => {
        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
          if (!this.shouldTrackUser(newState.member)) return;
          if (this.config.excludedChannels.includes(newState.channelId)) return;
          
          this.voiceStates.set(newState.member.id, {
            channelId: newState.channelId,
            joinTime: Date.now(),
            guildId: newState.guild.id
          });
        }
        // User left a voice channel
        else if (oldState.channelId && !newState.channelId) {
          const voiceData = this.voiceStates.get(oldState.member.id);
          if (voiceData) {
            const duration = Math.floor((Date.now() - voiceData.joinTime) / 1000); // in seconds
            
            if (duration >= this.config.minimumVCTime) {
              this.addVoiceTime(oldState.member.id, oldState.guild.id, duration);
            }
            
            this.voiceStates.delete(oldState.member.id);
          }
        }
        // User switched channels
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
          const voiceData = this.voiceStates.get(newState.member.id);
          if (voiceData) {
            const duration = Math.floor((Date.now() - voiceData.joinTime) / 1000);
            
            if (duration >= this.config.minimumVCTime) {
              this.addVoiceTime(newState.member.id, newState.guild.id, duration);
            }
            
            // Reset join time for new channel
            voiceData.channelId = newState.channelId;
            voiceData.joinTime = Date.now();
          }
        }
      });
    }

    // Clean up voice states on bot restart
    this.client.once('ready', () => {
      // Track currently connected users
      for (const guild of this.client.guilds.cache.values()) {
        for (const [memberId, voiceState] of guild.voiceStates.cache) {
          if (voiceState.channelId && this.shouldTrackUser(voiceState.member)) {
            if (!this.config.excludedChannels.includes(voiceState.channelId)) {
              this.voiceStates.set(memberId, {
                channelId: voiceState.channelId,
                joinTime: Date.now(),
                guildId: guild.id
              });
            }
          }
        }
      }
    });
  }

  /**
   * Check if user should be tracked
   * @param {import("discord.js").GuildMember} member 
   * @returns {boolean}
   */
  shouldTrackUser(member) {
    if (!member) return false;
    if (!this.config.trackBots && member.user.bot) return false;
    if (member.roles.cache.some(role => this.config.excludedRoles.includes(role.id))) return false;
    return true;
  }

  /**
   * Increment message count for a user
   * @param {string} userId 
   * @param {string} guildId 
   */
  incrementMessageCount(userId, guildId) {
    const key = `${guildId}-${userId}`;
    
    ['lifetime', 'monthly', 'weekly'].forEach(period => {
      const current = this.data.messages[period].get(key) || 0;
      this.data.messages[period].set(key, current + 1);
    });
  }

  /**
   * Add voice time for a user
   * @param {string} userId 
   * @param {string} guildId 
   * @param {number} seconds 
   */
  addVoiceTime(userId, guildId, seconds) {
    const key = `${guildId}-${userId}`;
    
    ['lifetime', 'monthly', 'weekly'].forEach(period => {
      const current = this.data.voice[period].get(key) || 0;
      this.data.voice[period].set(key, current + seconds);
    });
  }

  /**
   * Get leaderboard data
   * @param {string} guildId 
   * @param {string} type - 'messages' or 'voice'
   * @param {string} period - 'lifetime', 'monthly', or 'weekly'
   * @param {number} limit 
   * @returns {Array<{userId: string, value: number}>}
   */
  async getLeaderboard(guildId, type, period, limit = 10) {
    const data = this.data[type][period];
    const guildEntries = [];

    // Filter by guild and sort
    for (const [key, value] of data.entries()) {
      if (key.startsWith(`${guildId}-`)) {
        const userId = key.split('-')[1];
        guildEntries.push({ userId, value });
      }
    }

    // Sort by value (descending)
    guildEntries.sort((a, b) => b.value - a.value);

    // Return top entries
    return guildEntries.slice(0, limit);
  }

  /**
   * Get user stats
   * @param {string} userId 
   * @param {string} guildId 
   * @returns {Object}
   */
  getUserStats(userId, guildId) {
    const key = `${guildId}-${userId}`;
    
    return {
      messages: {
        lifetime: this.data.messages.lifetime.get(key) || 0,
        monthly: this.data.messages.monthly.get(key) || 0,
        weekly: this.data.messages.weekly.get(key) || 0
      },
      voice: {
        lifetime: this.data.voice.lifetime.get(key) || 0,
        monthly: this.data.voice.monthly.get(key) || 0,
        weekly: this.data.voice.weekly.get(key) || 0
      }
    };
  }

  /**
   * Reset period data
   * @param {string} period - 'weekly' or 'monthly'
   */
  resetPeriod(period) {
    console.log(`[LeaderboardSystem] Resetting ${period} leaderboard data`);
    
    this.data.messages[period].clear();
    this.data.voice[period].clear();
    this.data.lastReset[period] = new Date().toISOString();
    
    this.saveData();
  }

  /**
   * Start the reset scheduler
   */
  startResetScheduler() {
    // Check every hour if reset is needed
    setInterval(() => {
      const now = new Date();
      
      // Weekly reset
      if (now.getDay() === this.getDayNumber(this.config.resetSchedule.weekly)) {
        const lastWeeklyReset = new Date(this.data.lastReset.weekly);
        if (now - lastWeeklyReset > 7 * 24 * 60 * 60 * 1000 - 3600000) { // 7 days minus 1 hour buffer
          this.resetPeriod('weekly');
        }
      }
      
      // Monthly reset
      if (now.getDate() === this.config.resetSchedule.monthly) {
        const lastMonthlyReset = new Date(this.data.lastReset.monthly);
        if (now - lastMonthlyReset > 28 * 24 * 60 * 60 * 1000) { // At least 28 days
          this.resetPeriod('monthly');
        }
      }
    }, 3600000); // Check every hour
  }

  /**
   * Convert day name to number
   * @param {string} dayName 
   * @returns {number}
   */
  getDayNumber(dayName) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days.indexOf(dayName) || 1;
  }

  /**
   * Format seconds to readable time
   * @param {number} seconds 
   * @returns {string}
   */
  static formatTime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.length > 0 ? parts.join(' ') : '0m';
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('leaderboard', {
      enabled: this.config.enabled,
      trackMessages: this.config.trackMessages,
      trackVoice: this.config.trackVoice,
      dataFile: this.config.dataFile,
      resetSchedule: this.config.resetSchedule,
      minimumVCTime: this.config.minimumVCTime,
      excludedChannels: this.config.excludedChannels,
      excludedRoles: this.config.excludedRoles,
      trackBots: this.config.trackBots
    });
    return this.configLoader.save();
  }

  /**
   * Get current voice sessions
   */
  getCurrentVoiceSessions() {
    const sessions = [];
    for (const [userId, data] of this.voiceStates.entries()) {
      const duration = Math.floor((Date.now() - data.joinTime) / 1000);
      sessions.push({
        userId,
        guildId: data.guildId,
        channelId: data.channelId,
        duration
      });
    }
    return sessions;
  }
}