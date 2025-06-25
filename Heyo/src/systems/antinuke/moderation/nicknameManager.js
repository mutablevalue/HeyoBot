// src/systems/antinuke/moderation/nicknameManager.js
import { Events } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class NicknameManager {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.client = antiNuke.client;
    this.config = antiNuke.fullConfig.get('moderation');
    
    // Tracking
    this.forcedNicknames = new Map();
    
    this.loadForcedNicknames();
  }
  
  /**
   * Force a nickname on a user
   * @param {string} guildId 
   * @param {string} userId 
   * @param {string} nickname 
   */
  async forceNickname(guildId, userId, nickname) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;
      
      const member = await guild.members.fetch(userId);
      if (!member) return false;
      
      // Set the nickname
      await member.setNickname(nickname, 'Forced nickname by moderation');
      
      // Track it
      this.forcedNicknames.set(userId, {
        nickname,
        guildId,
        timestamp: Date.now()
      });
      
      await this.saveForcedNicknames();
      return true;
    } catch (error) {
      console.error('[NicknameManager] Error forcing nickname:', error);
      return false;
    }
  }
  
  /**
   * Remove forced nickname
   * @param {string} guildId 
   * @param {string} userId 
   */
  async removeForcedNickname(guildId, userId) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return false;
      
      const member = await guild.members.fetch(userId);
      if (!member) return false;
      
      // Remove nickname
      await member.setNickname(null, 'Removed forced nickname');
      
      // Remove from tracking
      this.forcedNicknames.delete(userId);
      
      await this.saveForcedNicknames();
      return true;
    } catch (error) {
      console.error('[NicknameManager] Error removing forced nickname:', error);
      return false;
    }
  }
  
  /**
   * Get forced nickname for a user
   * @param {string} userId 
   */
  getForcedNickname(userId) {
    const data = this.forcedNicknames.get(userId);
    return data ? data.nickname : null;
  }
  
  /**
   * Check if user has forced nickname
   * @param {string} userId 
   * @returns {boolean}
   */
  hasForcedNickname(userId) {
    return this.forcedNicknames.has(userId);
  }
  
  /**
   * Load forced nicknames from file
   */
  async loadForcedNicknames() {
    try {
      const dataFile = this.config.forcedNicknames?.dataFile;
      if (!dataFile) return;
      
      const filePath = path.join(__dirname, '../../../data', dataFile);
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.forcedNicknames = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[NicknameManager] Error loading forced nicknames:', error);
      }
    }
  }
  
  /**
   * Save forced nicknames to file
   */
  async saveForcedNicknames() {
    try {
      const dataFile = this.config.forcedNicknames?.dataFile;
      if (!dataFile) return;
      
      const dirPath = path.join(__dirname, '../../../data');
      await fs.mkdir(dirPath, { recursive: true });
      
      const filePath = path.join(dirPath, dataFile);
      const data = Object.fromEntries(this.forcedNicknames);
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[NicknameManager] Error saving forced nicknames:', error);
    }
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Monitor nickname changes for forced nicknames
    if (this.config.forcedNicknames?.checkInterval) {
      setInterval(() => {
        this.checkForcedNicknames();
      }, this.config.forcedNicknames.checkInterval);
    }
    
    // Monitor member updates
    this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
      // Check if nickname was changed
      if (oldMember.nickname !== newMember.nickname) {
        const forcedData = this.forcedNicknames.get(newMember.id);
        if (forcedData && forcedData.guildId === newMember.guild.id) {
          // Check if the new nickname is different from forced
          if (newMember.nickname !== forcedData.nickname) {
            // Restore forced nickname
            await newMember.setNickname(forcedData.nickname, 'Restoring forced nickname');
          }
        }
      }
    });
    
    // Clean up when members leave
    this.client.on(Events.GuildMemberRemove, async (member) => {
      if (this.forcedNicknames.has(member.id)) {
        this.forcedNicknames.delete(member.id);
        await this.saveForcedNicknames();
      }
    });
  }
  
  /**
   * Check and restore forced nicknames
   */
  async checkForcedNicknames() {
    for (const [userId, data] of this.forcedNicknames) {
      try {
        const guild = this.client.guilds.cache.get(data.guildId);
        if (!guild) continue;
        
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          // Member not in guild, remove from tracking
          this.forcedNicknames.delete(userId);
          continue;
        }
        
        if (member.nickname !== data.nickname) {
          await member.setNickname(data.nickname, 'Restoring forced nickname');
        }
      } catch (error) {
        console.error(`[NicknameManager] Error checking forced nickname for ${userId}:`, error);
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      forcedNicknames: this.forcedNicknames.size
    };
  }
}