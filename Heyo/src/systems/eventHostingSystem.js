// src/systems/eventHostingSystem.js
import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
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
      activeEvents: eventConfig.activeEvents || [],
      enableLogging: eventConfig.enableLogging ?? true // Optional logging
    };

    // Active events tracking
    this.activeEvents = new Map(); // eventId -> event data
    this.eventHistory = [];
    
    // Last to leave VC tracking
    this.lastToLeaveTracking = new Map(); // eventId -> { participants: Map<userId, joinTime> }
    
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

    // Special handling for last to leave VC
    if (event.type === 'last_to_leave_vc') {
      // Create the voice channel
      const vcResult = await this.createLastToLeaveVC(event);
      if (!vcResult.success) {
        throw new Error(vcResult.error);
      }
      event.channelId = vcResult.channel.id;
      event.data.duration = eventData.data?.duration || 3600; // Default 1 hour
      event.data.countdownDuration = eventData.data?.countdownDuration || 300; // Default 5 minutes
    }

    this.activeEvents.set(eventId, event);
    this.saveEventData();

    // Announce event if channel is set
    if (this.config.announcementChannel) {
      await this.announceEvent(event);
    }

    // Schedule event start if it has a future start time
    if (event.startTime && new Date(event.startTime) > new Date()) {
      const delay = new Date(event.startTime).getTime() - Date.now();
      setTimeout(() => this.startEvent(eventId), delay);
    } else {
      await this.startEvent(eventId);
    }

    return eventId;
  }

  /**
   * Create voice channel for last to leave event
   * @param {Object} event
   * @returns {Promise<{success: boolean, channel?: VoiceChannel, error?: string}>}
   */
  async createLastToLeaveVC(event) {
    try {
      const guild = this.client.guilds.cache.get(event.guildId);
      if (!guild) {
        return { success: false, error: 'Guild not found' };
      }

      const channelOptions = {
        name: `🏆 ${event.name}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.Connect] // Locked initially
          }
        ],
        reason: `Last to Leave VC event created by ${guild.members.cache.get(event.createdBy)?.user.tag}`
      };

      const channel = await guild.channels.create(channelOptions);
      return { success: true, channel };
    } catch (error) {
      console.error('[EventHostingSystem] Error creating VC:', error);
      return { success: false, error: error.message };
    }
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
        await this.startLastToLeaveVC(event);
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
    if (this.config.enableLogging) {
      await this.logEvent(event, 'Event Started');
    }
  }

  /**
   * Start last to leave VC event
   * @param {Object} event
   */
  async startLastToLeaveVC(event) {
    const guild = this.client.guilds.cache.get(event.guildId);
    const channel = guild?.channels.cache.get(event.channelId);
    if (!channel) return;

    // Unlock the channel
    await channel.permissionOverwrites.edit(guild.id, {
      Connect: null // Remove the deny, allowing connection
    });

    // Initialize tracking
    this.lastToLeaveTracking.set(event.id, {
      participants: new Map(),
      lastLeft: null,
      vcClosed: false
    });

    // Set up countdown timer
    setTimeout(async () => {
      await this.startLastToLeaveCountdown(event);
    }, event.data.countdownDuration * 1000);

    // Announce channel is open
    if (this.config.announcementChannel) {
      const announcementChannel = guild.channels.cache.get(this.config.announcementChannel);
      if (announcementChannel) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 Last to Leave VC is NOW OPEN!')
          .setDescription(`Join ${channel} now!\nChannel closes in ${event.data.countdownDuration / 60} minutes!`)
          .setColor(0x00ff00)
          .setTimestamp();

        await announcementChannel.send({ embeds: [embed] });
      }
    }
  }

  /**
   * Start countdown for last to leave VC
   * @param {Object} event
   */
  async startLastToLeaveCountdown(event) {
    const guild = this.client.guilds.cache.get(event.guildId);
    const channel = guild?.channels.cache.get(event.channelId);
    if (!channel) return;

    // Lock the channel
    await channel.permissionOverwrites.edit(guild.id, {
      Connect: false // Deny new connections
    });

    const tracking = this.lastToLeaveTracking.get(event.id);
    if (tracking) {
      tracking.vcClosed = true;
    }

    // Announce channel is closed
    if (this.config.announcementChannel) {
      const announcementChannel = guild.channels.cache.get(this.config.announcementChannel);
      if (announcementChannel) {
        const embed = new EmbedBuilder()
          .setTitle('🔒 Last to Leave VC is CLOSED!')
          .setDescription(`No new members can join ${channel}.\nStay in the channel to win!`)
          .setColor(0xff0000)
          .setTimestamp();

        await announcementChannel.send({ embeds: [embed] });
      }
    }

    // Schedule event end after duration
    setTimeout(async () => {
      await this.endLastToLeaveVC(event.id);
    }, event.data.duration * 1000);
  }

  /**
   * End last to leave VC event
   * @param {string} eventId
   */
  async endLastToLeaveVC(eventId) {
    const event = this.activeEvents.get(eventId);
    if (!event) return;

    const tracking = this.lastToLeaveTracking.get(eventId);
    if (!tracking) return;

    // Find the last person who left
    let winnerId = tracking.lastLeft;

    // If someone is still in the channel, they win
    const guild = this.client.guilds.cache.get(event.guildId);
    const channel = guild?.channels.cache.get(event.channelId);
    if (channel && channel.members.size > 0) {
      winnerId = channel.members.first().id;
    }

    // Delete the voice channel
    try {
      await channel?.delete('Last to Leave event ended');
    } catch (error) {
      console.error('[EventHostingSystem] Error deleting VC:', error);
    }

    // Clean up tracking
    this.lastToLeaveTracking.delete(eventId);

    // End the event with winner
    await this.endEvent(eventId, winnerId ? [winnerId] : []);
  }

  /**
   * Handle last to leave VC event
   */
  async handleLastToLeaveVC(event, oldState, newState) {
    const tracking = this.lastToLeaveTracking.get(event.id);
    if (!tracking) return;

    // User joined the target channel
    if (newState.channelId === event.channelId && !oldState.channelId) {
      if (!tracking.vcClosed) {
        // Track participant
        tracking.participants.set(newState.member.id, Date.now());
      }
    }

    // User left the target channel
    if (oldState.channelId === event.channelId && newState.channelId !== event.channelId) {
      // Only track if VC is closed and user was a participant
      if (tracking.vcClosed && tracking.participants.has(oldState.member.id)) {
        // Check requirements
        const requirements = await this.checkRequirements(oldState.member.id, event.guildId, event.requirements);
        if (requirements.eligible) {
          tracking.lastLeft = oldState.member.id;
        }
      }
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

        // Add special message for Nitro rewards
        const hasNitro = event.rewards.some(r => r.toLowerCase().includes('nitro'));
        if (hasNitro) {
          embed.addFields({
            name: '🎁 Gift Instructions',
            value: 'A moderator will contact you shortly with your Nitro gift link!'
          });
        }
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
    if (!this.config.enableLogging || !this.config.logChannel) return;

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

  // ... [Include all other existing methods from the original file that weren't modified] ...

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
          reasons.push(`Need at least ${this.leaderboardSystem.constructor.formatTime(requirements.minVoiceTime)} in voice (have ${this.leaderboardSystem.constructor.formatTime(stats.voice.lifetime)})`);
        }
      }

      // Check booster requirement
      if (requirements.mustBeBooster && !member.premiumSince) {
        eligible = false;
        reasons.push('Must be a server booster');
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

    // Clean up last to leave tracking
    if (event.type === 'last_to_leave_vc') {
      this.lastToLeaveTracking.delete(eventId);
      
      // Delete the voice channel
      const guild = this.client.guilds.cache.get(event.guildId);
      const channel = guild?.channels.cache.get(event.channelId);
      if (channel) {
        try {
          await channel.delete('Event cancelled');
        } catch (error) {
          console.error('[EventHostingSystem] Error deleting VC:', error);
        }
      }
    }

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
    if (this.config.enableLogging) {
      await this.logEvent(event, 'Event Cancelled');
    }
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
    if (this.config.enableLogging) {
      await this.logEvent(event, 'Event Ended');
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
      if (event.requirements.minVoiceTime) reqText.push(`• ${this.leaderboardSystem.constructor.formatTime(event.requirements.minVoiceTime)} in voice`);
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
        value: this.leaderboardSystem.constructor.formatTime(Math.floor(duration / 1000))
      });
    }

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
      dmWinners: this.config.dmWinners,
      enableLogging: this.config.enableLogging
    });
    return this.configLoader.save();
  }
}