// src/systems/eventHostingSystem.js
import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class EventHostingSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   * @param {import("./leaderboardSystem.js").LeaderboardSystem} leaderboardSystem
   */
  constructor(client, configLoader, leaderboardSystem) {
    this.client = client;
    this.configLoader = configLoader;
    this.leaderboardSystem = leaderboardSystem;
    
    // Load event config
    const eventConfig = this.configLoader.get('events') || {};
    this.config = {
      enabled: eventConfig.enabled ?? true,
      dataFile: eventConfig.dataFile || 'events_data.json',
      announcementChannel: eventConfig.announcementChannel || null,
      logChannel: eventConfig.logChannel || null,
      pingRole: eventConfig.pingRole || null,
      dmWinners: eventConfig.dmWinners ?? true,
      activeEvents: eventConfig.activeEvents || []
    };

    // Active events tracking
    this.activeEvents = new Map(); // eventId -> event data
    this.eventHistory = [];
    
    // Load event data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadEventData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }

    // Event types
    this.eventTypes = {
      'last_to_leave_vc': {
        name: 'Last to Leave VC',
        description: 'Last person to leave the voice channel wins!',
        handler: this.handleLastToLeaveVC.bind(this)
      },
      'message_milestone': {
        name: 'Message Milestone',
        description: 'First to reach X messages wins!',
        handler: this.handleMessageMilestone.bind(this)
      },
      'vc_milestone': {
        name: 'Voice Time Milestone',
        description: 'First to spend X hours in voice wins!',
        handler: this.handleVCMilestone.bind(this)
      },
      'be_online': {
        name: 'Be Online',
        description: 'Be online at a specific time to win!',
        handler: this.handleBeOnline.bind(this)
      }
    };
  }

  /**
   * Load event data from file
   */
  loadEventData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.eventHistory = data.history || [];
        
        // Restore active events
        if (data.activeEvents) {
          for (const event of data.activeEvents) {
            this.activeEvents.set(event.id, event);
          }
        }
        
        console.log(`[EventHostingSystem] Loaded ${this.activeEvents.size} active events`);
      }
    } catch (error) {
      console.error('[EventHostingSystem] Error loading event data:', error);
    }
  }

  /**
   * Save event data to file
   */
  saveEventData() {
    try {
      const data = {
        activeEvents: Array.from(this.activeEvents.values()),
        history: this.eventHistory.slice(-100) // Keep last 100 events
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[EventHostingSystem] Error saving event data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Voice state updates for last to leave
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      // Check last to leave events
      for (const [eventId, event] of this.activeEvents) {
        if (event.type === 'last_to_leave_vc' && event.status === 'active') {
          await this.eventTypes[event.type].handler(event, oldState, newState);
        }
      }
    });

    // Message events
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      
      // Check message milestone events
      for (const [eventId, event] of this.activeEvents) {
        if (event.type === 'message_milestone' && event.status === 'active') {
          await this.eventTypes[event.type].handler(event, message);
        }
      }
    });

    // Periodic checks for timed events
    setInterval(() => {
      this.checkTimedEvents();
    }, 60000); // Check every minute
  }

  /**
   * Create a new event
   * @param {Object} eventData 
   * @returns {string} eventId
   */
  async createEvent(eventData) {
    const eventId = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const event = {
      id: eventId,
      type: eventData.type,
      name: eventData.name || this.eventTypes[eventData.type]?.name || 'Unknown Event',
      description: eventData.description || this.eventTypes[eventData.type]?.description,
      guildId: eventData.guildId,
      channelId: eventData.channelId || null,
      createdBy: eventData.createdBy,
      createdAt: new Date().toISOString(),
      startTime: eventData.startTime || new Date().toISOString(),
      endTime: eventData.endTime || null,
      status: 'pending',
      requirements: eventData.requirements || {},
      rewards: eventData.rewards || [],
      participants: [],
      winners: [],
      data: eventData.data || {}
    };

    this.activeEvents.set(eventId, event);
    this.saveEventData();

    // Announce event if channel is set
    if (this.config.announcementChannel) {
      await this.announceEvent(event);
    }

    // Start event if it's immediate
    if (!eventData.startTime || new Date(eventData.startTime) <= new Date()) {
      await this.startEvent(eventId);
    }

    return eventId;
  }

  /**
   * Start an event
   * @param {string} eventId 
   */
  async startEvent(eventId) {
    const event = this.activeEvents.get(eventId);
    if (!event || event.status !== 'pending') return;

    event.status = 'active';
    event.startedAt = new Date().toISOString();

    // Initialize event-specific data
    switch (event.type) {
      case 'last_to_leave_vc':
        if (event.channelId) {
          const guild = this.client.guilds.cache.get(event.guildId);
          const channel = guild?.channels.cache.get(event.channelId);
          if (channel?.members) {
            event.data.participants = Array.from(channel.members.keys());
            event.data.originalCount = channel.members.size;
          }
        }
        break;
      case 'message_milestone':
        event.data.startCounts = new Map();
        break;
      case 'vc_milestone':
        event.data.startTimes = new Map();
        break;
    }

    this.saveEventData();

    // Log event start
    await this.logEvent(event, 'Event Started');
  }

  /**
   * End an event
   * @param {string} eventId 
   * @param {Array<string>} winnerIds 
   */
  async endEvent(eventId, winnerIds = []) {
    const event = this.activeEvents.get(eventId);
    if (!event) return;

    event.status = 'completed';
    event.endedAt = new Date().toISOString();
    event.winners = winnerIds;

    // Move to history
    this.eventHistory.push(event);
    this.activeEvents.delete(eventId);
    this.saveEventData();

    // Announce winners
    if (winnerIds.length > 0) {
      await this.announceWinners(event, winnerIds);
      
      // DM winners their rewards
      if (this.config.dmWinners) {
        for (const winnerId of winnerIds) {
          await this.dmWinner(winnerId, event);
        }
      }
    }

    // Log event end
    await this.logEvent(event, 'Event Ended');
  }

  /**
   * Cancel an event
   * @param {string} eventId 
   * @param {string} reason 
   */
  async cancelEvent(eventId, reason = 'Event cancelled by administrator') {
    const event = this.activeEvents.get(eventId);
    if (!event) return;

    event.status = 'cancelled';
    event.cancelledAt = new Date().toISOString();
    event.cancelReason = reason;

    // Move to history
    this.eventHistory.push(event);
    this.activeEvents.delete(eventId);
    this.saveEventData();

    // Announce cancellation
    if (this.config.announcementChannel) {
      const channel = this.client.channels.cache.get(this.config.announcementChannel);
      if (channel) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Event Cancelled')
          .setDescription(`**${event.name}** has been cancelled.`)
          .addFields({ name: 'Reason', value: reason })
          .setColor(0xff0000)
          .setTimestamp();
        
        await channel.send({ embeds: [embed] });
      }
    }

    // Log cancellation
    await this.logEvent(event, 'Event Cancelled');
  }

  /**
   * Check if user meets event requirements
   * @param {string} userId 
   * @param {string} guildId 
   * @param {Object} requirements 
   * @returns {Promise<{eligible: boolean, reasons: string[]}>}
   */
  async checkRequirements(userId, guildId, requirements) {
    const reasons = [];
    let eligible = true;

    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        return { eligible: false, reasons: ['Guild not found'] };
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return { eligible: false, reasons: ['Member not found'] };
      }

      // Check message count requirement
      if (requirements.minMessages) {
        const stats = this.leaderboardSystem.getUserStats(userId, guildId);
        if (stats.messages.lifetime < requirements.minMessages) {
          eligible = false;
          reasons.push(`Need at least ${requirements.minMessages} messages (have ${stats.messages.lifetime})`);
        }
      }

      // Check voice time requirement
      if (requirements.minVoiceTime) {
        const stats = this.leaderboardSystem.getUserStats(userId, guildId);
        if (stats.voice.lifetime < requirements.minVoiceTime) {
          eligible = false;
          reasons.push(`Need at least ${LeaderboardSystem.formatTime(requirements.minVoiceTime)} in voice (have ${LeaderboardSystem.formatTime(stats.voice.lifetime)})`);
        }
      }

      // Check booster requirement
      if (requirements.mustBeBooster && !member.premiumSince) {
        eligible = false;
        reasons.push('Must be a server booster');
      }

      // Check role requirements
      if (requirements.requiredRoles && requirements.requiredRoles.length > 0) {
        const hasAllRoles = requirements.requiredRoles.every(roleId => 
          member.roles.cache.has(roleId)
        );
        if (!hasAllRoles) {
          eligible = false;
          reasons.push('Missing required roles');
        }
      }

      // Check excluded roles
      if (requirements.excludedRoles && requirements.excludedRoles.length > 0) {
        const hasExcludedRole = requirements.excludedRoles.some(roleId => 
          member.roles.cache.has(roleId)
        );
        if (hasExcludedRole) {
          eligible = false;
          reasons.push('Has excluded role');
        }
      }

      // Check join date requirement
      if (requirements.minDaysInServer) {
        const daysInServer = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
        if (daysInServer < requirements.minDaysInServer) {
          eligible = false;
          reasons.push(`Must be in server for at least ${requirements.minDaysInServer} days (been ${daysInServer} days)`);
        }
      }

    } catch (error) {
      console.error('[EventHostingSystem] Error checking requirements:', error);
      eligible = false;
      reasons.push('Error checking requirements');
    }

    return { eligible, reasons };
  }

  /**
   * Handle last to leave VC event
   */
  async handleLastToLeaveVC(event, oldState, newState) {
    // User left the target channel
    if (oldState.channelId === event.channelId && !newState.channelId) {
      const remainingParticipants = event.data.participants.filter(id => id !== oldState.member.id);
      event.data.participants = remainingParticipants;

      // Check requirements for leaving user
      const requirements = await this.checkRequirements(oldState.member.id, event.guildId, event.requirements);
      if (!requirements.eligible) {
        // User didn't meet requirements, don't count them
        return;
      }

      // Check if we have a winner
      if (remainingParticipants.length === 1) {
        const winnerId = remainingParticipants[0];
        
        // Verify winner meets requirements
        const winnerReq = await this.checkRequirements(winnerId, event.guildId, event.requirements);
        if (winnerReq.eligible) {
          await this.endEvent(event.id, [winnerId]);
        } else {
          // No eligible winners
          await this.endEvent(event.id, []);
        }
      } else if (remainingParticipants.length === 0) {
        // Everyone left, no winner
        await this.endEvent(event.id, []);
      }

      this.saveEventData();
    }
  }

  /**
   * Handle message milestone event
   */
  async handleMessageMilestone(event, message) {
    if (message.guild.id !== event.guildId) return;

    const userId = message.author.id;
    const requirements = await this.checkRequirements(userId, event.guildId, event.requirements);
    if (!requirements.eligible) return;

    // Initialize start count if needed
    if (!event.data.startCounts.has(userId)) {
      const stats = this.leaderboardSystem.getUserStats(userId, event.guildId);
      event.data.startCounts.set(userId, stats.messages.lifetime);
    }

    // Check if milestone reached
    const stats = this.leaderboardSystem.getUserStats(userId, event.guildId);
    const startCount = event.data.startCounts.get(userId);
    const progress = stats.messages.lifetime - startCount;

    if (progress >= event.data.targetMessages) {
      await this.endEvent(event.id, [userId]);
    }
  }

  /**
   * Handle VC milestone event
   */
  async handleVCMilestone(event) {
    // This is checked periodically, not on events
    const guild = this.client.guilds.cache.get(event.guildId);
    if (!guild) return;

    for (const [memberId, voiceState] of guild.voiceStates.cache) {
      if (!voiceState.channelId) continue;

      const requirements = await this.checkRequirements(memberId, event.guildId, event.requirements);
      if (!requirements.eligible) continue;

      const stats = this.leaderboardSystem.getUserStats(memberId, event.guildId);
      
      // Initialize start time if needed
      if (!event.data.startTimes.has(memberId)) {
        event.data.startTimes.set(memberId, stats.voice.lifetime);
      }

      const startTime = event.data.startTimes.get(memberId);
      const progress = stats.voice.lifetime - startTime;

      if (progress >= event.data.targetSeconds) {
        await this.endEvent(event.id, [memberId]);
        break;
      }
    }
  }

  /**
   * Handle be online event
   */
  async handleBeOnline(event) {
    if (new Date() < new Date(event.data.targetTime)) return;

    const guild = this.client.guilds.cache.get(event.guildId);
    if (!guild) return;

    const eligibleMembers = [];

    for (const member of guild.members.cache.values()) {
      if (member.presence?.status !== 'offline') {
        const requirements = await this.checkRequirements(member.id, event.guildId, event.requirements);
        if (requirements.eligible) {
          eligibleMembers.push(member.id);
        }
      }
    }

    // Pick random winner from eligible members
    if (eligibleMembers.length > 0) {
      const winnerId = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
      await this.endEvent(event.id, [winnerId]);
    } else {
      await this.endEvent(event.id, []);
    }
  }

  /**
   * Check timed events
   */
  async checkTimedEvents() {
    const now = new Date();

    for (const [eventId, event] of this.activeEvents) {
      // Start pending events
      if (event.status === 'pending' && event.startTime && new Date(event.startTime) <= now) {
        await this.startEvent(eventId);
      }

      // End timed events
      if (event.status === 'active' && event.endTime && new Date(event.endTime) <= now) {
        await this.endEvent(eventId, []);
      }

      // Check specific event types
      if (event.status === 'active') {
        switch (event.type) {
          case 'vc_milestone':
            await this.handleVCMilestone(event);
            break;
          case 'be_online':
            await this.handleBeOnline(event);
            break;
        }
      }
    }
  }

  /**
   * Announce event
   * @param {Object} event 
   */
  async announceEvent(event) {
    const channel = this.client.channels.cache.get(this.config.announcementChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(`🎉 New Event: ${event.name}`)
      .setDescription(event.description)
      .setColor(0x00ff00)
      .setTimestamp();

    // Add requirements if any
    if (Object.keys(event.requirements).length > 0) {
      const reqText = [];
      if (event.requirements.minMessages) reqText.push(`• ${event.requirements.minMessages}+ messages`);
      if (event.requirements.minVoiceTime) reqText.push(`• ${LeaderboardSystem.formatTime(event.requirements.minVoiceTime)} in voice`);
      if (event.requirements.mustBeBooster) reqText.push('• Must be a server booster');
      if (event.requirements.minDaysInServer) reqText.push(`• ${event.requirements.minDaysInServer}+ days in server`);
      
      if (reqText.length > 0) {
        embed.addFields({ name: 'Requirements', value: reqText.join('\n') });
      }
    }

    // Add rewards
    if (event.rewards.length > 0) {
      embed.addFields({ 
        name: 'Rewards', 
        value: event.rewards.map((r, i) => `${i + 1}. ${r}`).join('\n') 
      });
    }

    // Add timing info
    if (event.startTime && new Date(event.startTime) > new Date()) {
      embed.addFields({ 
        name: 'Starts', 
        value: `<t:${Math.floor(new Date(event.startTime).getTime() / 1000)}:R>`,
        inline: true
      });
    }

    if (event.endTime) {
      embed.addFields({ 
        name: 'Ends', 
        value: `<t:${Math.floor(new Date(event.endTime).getTime() / 1000)}:R>`,
        inline: true
      });
    }

    const message = { embeds: [embed] };
    
    // Add ping if configured
    if (this.config.pingRole) {
      message.content = `<@&${this.config.pingRole}>`;
    }

    await channel.send(message);
  }

  /**
   * Announce winners
   * @param {Object} event 
   * @param {Array<string>} winnerIds 
   */
  async announceWinners(event, winnerIds) {
    const channel = this.client.channels.cache.get(this.config.announcementChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Event Completed: ${event.name}`)
      .setDescription(`Congratulations to the winner${winnerIds.length > 1 ? 's' : ''}!`)
      .setColor(0xffd700)
      .setTimestamp();

    // Add winners
    const winnerText = winnerIds.map((id, i) => `${i + 1}. <@${id}>`).join('\n');
    embed.addFields({ name: 'Winner' + (winnerIds.length > 1 ? 's' : ''), value: winnerText });

    // Add duration
    if (event.startedAt) {
      const duration = new Date(event.endedAt) - new Date(event.startedAt);
      embed.addFields({ 
        name: 'Duration', 
        value: LeaderboardSystem.formatTime(Math.floor(duration / 1000))
      });
    }

    await channel.send({ embeds: [embed] });
  }

  /**
   * DM winner their rewards
   * @param {string} userId 
   * @param {Object} event 
   */
  async dmWinner(userId, event) {
    try {
      const user = await this.client.users.fetch(userId);
      if (!user) return;

      const embed = new EmbedBuilder()
        .setTitle('🎉 Congratulations! You Won!')
        .setDescription(`You won the **${event.name}** event!`)
        .setColor(0xffd700)
        .setTimestamp();

      if (event.rewards.length > 0) {
        embed.addFields({ 
          name: 'Your Rewards', 
          value: event.rewards.map((r, i) => `${i + 1}. ${r}`).join('\n') 
        });
      }

      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error(`[EventHostingSystem] Failed to DM winner ${userId}:`, error);
    }
  }

  /**
   * Log event action
   * @param {Object} event 
   * @param {string} action 
   */
  async logEvent(event, action) {
    if (!this.config.logChannel) return;

    const channel = this.client.channels.cache.get(this.config.logChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(`Event Log: ${action}`)
      .setDescription(`**${event.name}** (${event.id})`)
      .addFields(
        { name: 'Type', value: event.type, inline: true },
        { name: 'Status', value: event.status, inline: true },
        { name: 'Created By', value: `<@${event.createdBy}>`, inline: true }
      )
      .setColor(0x0099ff)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  /**
   * Get active events
   */
  getActiveEvents() {
    return Array.from(this.activeEvents.values());
  }

  /**
   * Get event by ID
   * @param {string} eventId 
   */
  getEvent(eventId) {
    return this.activeEvents.get(eventId) || 
           this.eventHistory.find(e => e.id === eventId);
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('events', {
      enabled: this.config.enabled,
      dataFile: this.config.dataFile,
      announcementChannel: this.config.announcementChannel,
      logChannel: this.config.logChannel,
      pingRole: this.config.pingRole,
      dmWinners: this.config.dmWinners
    });
    return this.configLoader.save();
  }
}