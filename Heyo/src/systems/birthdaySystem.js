// src/systems/birthdaySystem.js
import { Events } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BirthdaySystem {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('birthday');
    this.embedLoader = null;
    
    this.dataPath = path.join(__dirname, '..', '..', 'data', this.config.dataFile);
    this.birthdays = new Map();
    this.announcedToday = new Set();
    this.messageTrackedToday = new Set();
    this.guilds = new Map(); // Guild-specific settings
    
    if (this.config.enabled) {
      this.loadData();
      this.setupEventListeners();
      this.startDailyCheck();
    }
  }
  
  async loadData() {
    try {
      const data = await fs.readFile(this.dataPath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Convert to Map structure
      for (const [userId, birthdayData] of Object.entries(parsed.birthdays || {})) {
        this.birthdays.set(userId, birthdayData);
      }
      
      // Load guild settings
      if (parsed.guilds) {
        for (const [guildId, settings] of Object.entries(parsed.guilds)) {
          this.guilds.set(guildId, settings);
        }
      }
      
      // Load today's tracked data
      const today = this.getTodayDateString();
      if (parsed.announcedDates && parsed.announcedDates[today]) {
        parsed.announcedDates[today].forEach(userId => this.announcedToday.add(userId));
      }
      
      // Load stats
      if (parsed.stats) {
        this.config.stats = { ...this.config.stats, ...parsed.stats };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[Birthday] Error loading data:', error);
      }
    }
  }
  
  async saveData() {
    try {
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Convert Maps to objects for JSON
      const data = {
        birthdays: {},
        guilds: {},
        announcedDates: {},
        stats: this.config.stats
      };
      
      for (const [userId, birthdayData] of this.birthdays) {
        data.birthdays[userId] = birthdayData;
      }
      
      for (const [guildId, settings] of this.guilds) {
        data.guilds[guildId] = settings;
      }
      
      // Save today's announced birthdays
      const today = this.getTodayDateString();
      data.announcedDates[today] = Array.from(this.announcedToday);
      
      await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[Birthday] Error saving data:', error);
    }
  }
  
  setupEventListeners() {
    // Listen for first message of the day from birthday users
    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guild) return;
      if (message.author.bot) return;
      
      // Skip if already tracked today
      if (this.messageTrackedToday.has(message.author.id)) return;
      
      // Check if it's the user's birthday
      const birthdayData = this.birthdays.get(message.author.id);
      if (!birthdayData) return;
      
      const today = new Date();
      const birthDate = new Date(birthdayData.date);
      
      if (today.getMonth() === birthDate.getMonth() && today.getDate() === birthDate.getDate()) {
        // It's their birthday!
        this.messageTrackedToday.add(message.author.id);
        
        const guildSettings = this.guilds.get(message.guild.id) || {};
        const channelId = guildSettings.announcementChannel || this.config.announcementChannel;
        
        if (channelId) {
          const channel = message.guild.channels.cache.get(channelId);
          if (channel?.isTextBased()) {
            const messageText = this.config.messages.firstMessage
              .replace('{user}', `<@${message.author.id}>`);
            
            const embed = this.embedLoader.createEmbed({
              description: messageText,
              color: 0xFF69B4 // Pink color for birthdays
            });
            
            try {
              await channel.send({ embeds: [embed] });
            } catch (error) {
              console.error('[Birthday] Failed to send birthday message:', error);
            }
          }
        }
      }
    });
  }
  
  startDailyCheck() {
    // Schedule daily birthday check
    const [hour, minute] = this.config.checkTime.split(':');
    
    cron.schedule(`${minute} ${hour} * * *`, async () => {
      console.log('[Birthday] Running daily birthday check...');
      await this.checkBirthdays();
    });
    
    // Also run cleanup at midnight
    cron.schedule('0 0 * * *', () => {
      this.announcedToday.clear();
      this.messageTrackedToday.clear();
      this.config.stats.birthdaysToday = 0;
      this.saveData();
    });
  }
  
  async checkBirthdays() {
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    
    for (const [userId, birthdayData] of this.birthdays) {
      if (this.announcedToday.has(userId)) continue;
      
      const birthDate = new Date(birthdayData.date);
      if (birthDate.getMonth() === todayMonth && birthDate.getDate() === todayDate) {
        // Process birthday for all guilds
        for (const guild of this.client.guilds.cache.values()) {
          await this.processBirthday(userId, guild, birthdayData);
        }
        
        this.announcedToday.add(userId);
        this.config.stats.birthdaysToday++;
      }
    }
    
    // Remove birthday roles from yesterday's birthdays
    if (this.config.removeRoleAfterDay && this.config.birthdayRole) {
      await this.removeOldBirthdayRoles();
    }
    
    await this.saveData();
  }
  
  async processBirthday(userId, guild, birthdayData) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    
    const guildSettings = this.guilds.get(guild.id) || {};
    const channelId = guildSettings.announcementChannel || this.config.announcementChannel;
    
    // Send announcement
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel?.isTextBased()) {
        const message = this.config.messages.announcement.replace('{user}', `<@${userId}>`);
        const embed = this.embedLoader.createEmbed({
          description: message
        });
        
        try {
          await channel.send({ embeds: [embed] });
        } catch (error) {
          console.error('[Birthday] Failed to send announcement:', error);
        }
      }
    }
    
    // Add birthday role
    const roleId = guildSettings.birthdayRole || this.config.birthdayRole;
    if (roleId) {
      try {
        await member.roles.add(roleId, 'Birthday!');
      } catch (error) {
        console.error('[Birthday] Failed to add birthday role:', error);
      }
    }
    
    // Send DM
    if (this.config.dmUser && !birthdayData.dmSent) {
      try {
        const user = await this.client.users.fetch(userId);
        const embed = this.embedLoader.createEmbed({
          description: this.config.messages.dm,
          color: 0xFF69B4
        });
        await user.send({ embeds: [embed] });
        
        // Mark DM as sent
        birthdayData.dmSent = true;
      } catch (error) {
        console.error('[Birthday] Failed to DM user:', error);
      }
    }
    
    this.config.stats.totalBirthdays++;
  }
  
  async removeOldBirthdayRoles() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayMonth = yesterday.getMonth();
    const yesterdayDate = yesterday.getDate();
    
    for (const [userId, birthdayData] of this.birthdays) {
      const birthDate = new Date(birthdayData.date);
      if (birthDate.getMonth() === yesterdayMonth && birthDate.getDate() === yesterdayDate) {
        // Remove birthday role from all guilds
        for (const guild of this.client.guilds.cache.values()) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;
          
          const guildSettings = this.guilds.get(guild.id) || {};
          const roleId = guildSettings.birthdayRole || this.config.birthdayRole;
          
          if (roleId && member.roles.cache.has(roleId)) {
            try {
              await member.roles.remove(roleId, 'Birthday ended');
            } catch (error) {
              console.error('[Birthday] Failed to remove birthday role:', error);
            }
          }
        }
        
        // Reset DM sent flag
        birthdayData.dmSent = false;
      }
    }
  }
  
  async setBirthday(userId, dateString) {
    // Validate date format (MM/DD/YYYY or MM-DD-YYYY)
    const dateRegex = /^(0[1-9]|1[0-2])[-\/](0[1-9]|[12][0-9]|3[01])[-\/](\d{4})$/;
    if (!dateRegex.test(dateString)) {
      throw new Error('Invalid date format. Use MM/DD/YYYY or MM-DD-YYYY');
    }
    
    // Parse date
    const [month, day, year] = dateString.split(/[-\/]/);
    const birthDate = new Date(year, month - 1, day);
    
    // Validate date
    if (isNaN(birthDate.getTime())) {
      throw new Error('Invalid date');
    }
    
    // Check age restrictions
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const dayDiff = today.getDate() - birthDate.getDate();
    
    const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
    
    if (actualAge < this.config.minimumAge) {
      throw new Error(`You must be at least ${this.config.minimumAge} years old`);
    }
    
    if (actualAge > this.config.maximumAge) {
      throw new Error(`Invalid age (maximum ${this.config.maximumAge})`);
    }
    
    // Save birthday (removed past birthday check)
    this.birthdays.set(userId, {
      date: birthDate.toISOString(),
      setAt: Date.now(),
      dmSent: false
    });
    
    await this.saveData();
    
    // Check if it's their birthday today
    if (birthDate.getMonth() === today.getMonth() && birthDate.getDate() === today.getDate()) {
      return { isToday: true, date: birthDate };
    }
    
    return { isToday: false, date: birthDate };
  }
  
  getBirthday(userId) {
    const data = this.birthdays.get(userId);
    if (!data) return null;
    
    return {
      date: new Date(data.date),
      setAt: data.setAt
    };
  }
  
  removeBirthday(userId) {
    const removed = this.birthdays.delete(userId);
    if (removed) {
      this.saveData();
    }
    return removed;
  }
  
  async setupGuild(guildId, settings) {
    this.guilds.set(guildId, {
      announcementChannel: settings.announcementChannel || null,
      birthdayRole: settings.birthdayRole || null,
      setupAt: Date.now()
    });
    
    await this.saveData();
  }
  
  getGuildSettings(guildId) {
    return this.guilds.get(guildId) || null;
  }
  
  getTodayDateString() {
    const today = new Date();
    return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  }
  
  getUpcomingBirthdays(days = 7, specificUserId = null) {
    const upcoming = [];
    const today = new Date();
    
    for (const [userId, data] of this.birthdays) {
      // If specific user requested, only include that user
      if (specificUserId && userId !== specificUserId) continue;
      
      const birthDate = new Date(data.date);
      const thisYearBirthday = new Date(
        today.getFullYear(),
        birthDate.getMonth(),
        birthDate.getDate()
      );
      
      // If birthday has passed this year, check next year
      if (thisYearBirthday < today) {
        thisYearBirthday.setFullYear(thisYearBirthday.getFullYear() + 1);
      }
      
      const daysUntil = Math.ceil((thisYearBirthday - today) / (1000 * 60 * 60 * 24));
      
      // Include all birthdays if no day limit, or if within day limit
      if (!specificUserId && daysUntil > days) continue;
      
      upcoming.push({
        userId,
        date: thisYearBirthday,
        daysUntil
      });
    }
    
    // Sort by days until birthday
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
    
    return upcoming;
  }
  
  getStats() {
    return {
      totalBirthdays: this.birthdays.size,
      birthdaysToday: this.config.stats.birthdaysToday,
      totalCelebrated: this.config.stats.totalBirthdays,
      guildsSetup: this.guilds.size
    };
  }
}