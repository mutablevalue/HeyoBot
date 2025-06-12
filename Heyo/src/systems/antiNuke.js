// src/systems/antiNuke.js
import { PermissionFlagsBits, AuditLogEvent } from 'discord.js';

export default class AntiNuke {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = null; // Set by index.js
    this.config = this.configLoader.get('antiNuke') || {};
    
    // Existing tracking
    this.tracker = new Map();
    this.suspiciousUsers = new Map();
    this.highAlert = false;
    this.originalLimits = null;
    
    // Enhanced raid detection
    this.raidTracking = {
      // Track actions across all users in short time windows
      globalActions: new Map(), // actionType -> [{userId, timestamp, details}]
      
      // Track patterns
      patterns: {
        coordinated: new Map(), // pattern -> [{userId, timestamp, action}]
        similarity: new Map(), // Track similar actions
      },
      
      // Raid detection state
      activeRaids: new Map(), // guildId -> raid details
      
      // User relationships (possible alt accounts)
      userRelations: new Map() // userId -> Set of related userIds
    };
    
    // Content moderation tracking
    this.contentTracking = {
      messageHistory: new Map(),
      joinHistory: new Map(),
    };
    
    // Raid mode state
    this.raidMode = {
      enabled: false,
      triggeredAt: null,
      triggeredBy: null
    };
    
    // Enhanced stats
    this.stats = {
      actionsBlocked: 0,
      raidsDetected: 0,
      coordinatedAttacksDetected: 0,
      contentViolations: {
        massMentions: 0,
        massEmojis: 0,
        capsSpam: 0,
        duplicates: 0
      }
    };
    
    // Multi-user raid detection config
    this.multiUserConfig = {
      enabled: this.config.multiUserDetection?.enabled ?? true,
      
      // Time windows for pattern detection
      coordinationWindow: this.config.multiUserDetection?.coordinationWindow || 10000, // 10 seconds
      patternWindow: this.config.multiUserDetection?.patternWindow || 30000, // 30 seconds
      
      // Thresholds
      minUsersForRaid: this.config.multiUserDetection?.minUsersForRaid || 3,
      similarActionThreshold: this.config.multiUserDetection?.similarActionThreshold || 5,
      
      // Action weights for severity calculation
      actionWeights: {
        bans: 10,
        kicks: 8,
        channelDelete: 9,
        roleDelete: 9,
        channelCreate: 6,
        roleCreate: 6,
        messages: 3,
        reactions: 2,
        massMention: 7,
        ...this.config.multiUserDetection?.actionWeights
      }
    };
    
    this.setupEventListeners();
    
    // Setup content monitoring if enabled
    if (this.config.contentModeration?.enabled) {
      this.setupContentMonitoring();
    }
    
    // Start pattern analysis interval
    setInterval(() => this.analyzePatterns(), 5000); // Every 5 seconds
  }

  setupEventListeners() {
    // Ban tracking with multi-user detection
    this.client.on('guildBanAdd', async (ban) => {
      const executor = await this.getExecutor(ban.guild, AuditLogEvent.MemberBanAdd);
      if (!executor) return;
      
      // Track globally for pattern detection
      this.trackGlobalAction('bans', executor.id, ban.guild.id, {
        targetId: ban.user.id,
        targetTag: ban.user.tag
      });
      
      const violation = this.track(executor.id, 'bans', {
        targetId: ban.user.id,
        targetTag: ban.user.tag,
        guildId: ban.guild.id
      });
      
      if (violation) {
        await this.handleViolation(ban.guild, executor, 'bans', violation);
      }
    });

    // Kick tracking with multi-user detection
    this.client.on('guildMemberRemove', async (member) => {
      const executor = await this.getExecutor(member.guild, AuditLogEvent.MemberKick);
      if (!executor) return;
      
      // Track globally for pattern detection
      this.trackGlobalAction('kicks', executor.id, member.guild.id, {
        targetId: member.id,
        targetTag: member.user.tag
      });
      
      const violation = this.track(executor.id, 'kicks', {
        targetId: member.id,
        targetTag: member.user.tag,
        guildId: member.guild.id
      });
      
      if (violation) {
        await this.handleViolation(member.guild, executor, 'kicks', violation);
      }
    });

    // Channel creation/deletion with multi-user detection
    this.client.on('channelCreate', async (channel) => {
      const executor = await this.getExecutor(channel.guild, AuditLogEvent.ChannelCreate);
      if (!executor) return;
      
      this.trackGlobalAction('channelCreate', executor.id, channel.guild.id, {
        channelId: channel.id,
        channelName: channel.name
      });
      
      const violation = this.track(executor.id, 'channelCreate', {
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guild.id
      });
      
      if (violation) {
        await this.handleViolation(channel.guild, executor, 'channelCreate', violation);
      }
    });

    this.client.on('channelDelete', async (channel) => {
      const executor = await this.getExecutor(channel.guild, AuditLogEvent.ChannelDelete);
      if (!executor) return;
      
      this.trackGlobalAction('channelDelete', executor.id, channel.guild.id, {
        channelName: channel.name
      });
      
      const violation = this.track(executor.id, 'channelDelete', {
        channelName: channel.name,
        guildId: channel.guild.id
      });
      
      if (violation) {
        await this.handleViolation(channel.guild, executor, 'channelDelete', violation);
      }
    });

    // Role creation/deletion with multi-user detection
    this.client.on('roleCreate', async (role) => {
      const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleCreate);
      if (!executor) return;
      
      this.trackGlobalAction('roleCreate', executor.id, role.guild.id, {
        roleId: role.id,
        roleName: role.name
      });
      
      const violation = this.track(executor.id, 'roleCreate', {
        roleId: role.id,
        roleName: role.name,
        guildId: role.guild.id
      });
      
      if (violation) {
        await this.handleViolation(role.guild, executor, 'roleCreate', violation);
      }
    });

    this.client.on('roleDelete', async (role) => {
      const executor = await this.getExecutor(role.guild, AuditLogEvent.RoleDelete);
      if (!executor) return;
      
      this.trackGlobalAction('roleDelete', executor.id, role.guild.id, {
        roleName: role.name
      });
      
      const violation = this.track(executor.id, 'roleDelete', {
        roleName: role.name,
        guildId: role.guild.id
      });
      
      if (violation) {
        await this.handleViolation(role.guild, executor, 'roleDelete', violation);
      }
    });

    // Command usage tracking
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      
      const violation = this.track(interaction.user.id, 'commands', {
        commandName: interaction.commandName,
        guildId: interaction.guild?.id
      });
      
      if (violation) {
        await interaction.reply({
          content: 'You are using commands too quickly. Please slow down.',
          ephemeral: true
        });
      }
    });
  }

  trackGlobalAction(actionType, userId, guildId, details) {
    if (!this.multiUserConfig.enabled) return;
    
    const timestamp = Date.now();
    
    // Initialize action tracking
    if (!this.raidTracking.globalActions.has(actionType)) {
      this.raidTracking.globalActions.set(actionType, []);
    }
    
    const actions = this.raidTracking.globalActions.get(actionType);
    actions.push({
      userId,
      guildId,
      timestamp,
      details
    });
    
    // Clean old entries
    const cutoff = timestamp - this.multiUserConfig.patternWindow;
    const filtered = actions.filter(a => a.timestamp > cutoff);
    this.raidTracking.globalActions.set(actionType, filtered);
    
    // Check for coordinated attacks
    this.checkCoordinatedAttack(guildId);
  }

  checkCoordinatedAttack(guildId) {
    const now = Date.now();
    const coordWindow = this.multiUserConfig.coordinationWindow;
    const patternWindow = this.multiUserConfig.patternWindow;
    
    // Collect all recent actions for this guild
    const guildActions = [];
    for (const [actionType, actions] of this.raidTracking.globalActions) {
      const recentActions = actions.filter(a => 
        a.guildId === guildId && 
        a.timestamp > now - patternWindow
      );
      
      recentActions.forEach(action => {
        guildActions.push({
          ...action,
          type: actionType,
          weight: this.multiUserConfig.actionWeights[actionType] || 1
        });
      });
    }
    
    // Group actions by time windows
    const timeWindows = new Map();
    guildActions.forEach(action => {
      const window = Math.floor(action.timestamp / coordWindow);
      if (!timeWindows.has(window)) {
        timeWindows.set(window, []);
      }
      timeWindows.get(window).push(action);
    });
    
    // Check each time window for suspicious activity
    for (const [window, actions] of timeWindows) {
      const uniqueUsers = new Set(actions.map(a => a.userId));
      const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
      
      // Detect coordinated attack patterns
      if (uniqueUsers.size >= this.multiUserConfig.minUsersForRaid) {
        // Multiple users acting in coordination
        this.handleCoordinatedRaid(guildId, Array.from(uniqueUsers), actions);
      } else if (totalWeight >= 20) {
        // High severity actions even with fewer users
        this.handleHighSeverityRaid(guildId, Array.from(uniqueUsers), actions);
      }
      
      // Check for similar action patterns (possible alts)
      this.detectSimilarPatterns(actions);
    }
  }

  detectSimilarPatterns(actions) {
    // Group actions by type and details
    const patterns = new Map();
    
    actions.forEach(action => {
      const patternKey = `${action.type}:${JSON.stringify(action.details)}`;
      if (!patterns.has(patternKey)) {
        patterns.set(patternKey, []);
      }
      patterns.get(patternKey).push(action);
    });
    
    // Check for similar patterns from different users
    for (const [pattern, similarActions] of patterns) {
      const users = new Set(similarActions.map(a => a.userId));
      
      if (users.size >= 2) {
        // Multiple users performing identical actions
        this.trackUserRelation(Array.from(users));
      }
    }
  }

  trackUserRelation(userIds) {
    // Track potential relationships between users (alts, coordinated accounts)
    userIds.forEach(userId => {
      if (!this.raidTracking.userRelations.has(userId)) {
        this.raidTracking.userRelations.set(userId, new Set());
      }
      
      const relations = this.raidTracking.userRelations.get(userId);
      userIds.forEach(relatedId => {
        if (relatedId !== userId) {
          relations.add(relatedId);
        }
      });
    });
  }

  async handleCoordinatedRaid(guildId, userIds, actions) {
    console.log(`[AntiNuke] COORDINATED RAID DETECTED in guild ${guildId}`);
    console.log(`[AntiNuke] Involved users: ${userIds.join(', ')}`);
    
    this.stats.coordinatedAttacksDetected++;
    
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    
    // Immediately trigger raid mode
    await this.triggerRaidMode(guild, `Coordinated attack by ${userIds.length} users`);
    
    // Process each attacker
    for (const userId of userIds) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      
      // Skip if whitelisted
      if (this.isWhitelisted(userId)) continue;
      
      try {
        // Ban all coordinated attackers
        if (member.bannable) {
          await member.ban({ 
            reason: `AntiNuke: Coordinated raid participant` 
          });
          console.log(`[AntiNuke] Banned raid participant: ${userId}`);
        } else {
          // If can't ban, remove all roles
          const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
          if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove, 'AntiNuke: Coordinated raid participant');
          }
        }
      } catch (error) {
        console.error(`[AntiNuke] Failed to punish raid participant ${userId}:`, error);
      }
    }
    
    // Log the coordinated attack
    await this.logCoordinatedAttack(guild, userIds, actions);
  }

  async handleHighSeverityRaid(guildId, userIds, actions) {
    console.log(`[AntiNuke] HIGH SEVERITY RAID in guild ${guildId}`);
    
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    
    // Set high alert mode
    this.setHighAlert(true);
    
    // Process high severity users
    for (const userId of userIds) {
      this.trackSuspiciousUser(userId, {
        reason: 'High severity actions',
        severity: 'critical',
        actions: actions.filter(a => a.userId === userId)
      });
    }
    
    // If severity is extreme, trigger raid mode
    const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight >= 30) {
      await this.triggerRaidMode(guild, 'High severity attack detected');
    }
  }

  async logCoordinatedAttack(guild, userIds, actions) {
    const actionSummary = {};
    actions.forEach(action => {
      actionSummary[action.type] = (actionSummary[action.type] || 0) + 1;
    });
    
    const fields = [
      { 
        name: 'Attackers', 
        value: userIds.map(id => `<@${id}>`).join('\n').slice(0, 1024),
        inline: false
      },
      {
        name: 'Actions Summary',
        value: Object.entries(actionSummary)
          .map(([type, count]) => `**${type}**: ${count}`)
          .join('\n'),
        inline: false
      },
      {
        name: 'Total Actions',
        value: `${actions.length}`,
        inline: true
      },
      {
        name: 'Unique Attackers',
        value: `${userIds.length}`,
        inline: true
      }
    ];
    
    await this.logToAdminChannel({
      title: '🚨 COORDINATED RAID DETECTED',
      description: 'Multiple users are attacking the server in coordination',
      fields
    });
  }

  analyzePatterns() {
    // Clean old tracking data
    const now = Date.now();
    const patternWindow = this.multiUserConfig.patternWindow;
    
    // Clean global actions
    for (const [actionType, actions] of this.raidTracking.globalActions) {
      const filtered = actions.filter(a => a.timestamp > now - patternWindow);
      if (filtered.length === 0) {
        this.raidTracking.globalActions.delete(actionType);
      } else {
        this.raidTracking.globalActions.set(actionType, filtered);
      }
    }
    
    // Analyze ongoing raids
    for (const [guildId, raid] of this.raidTracking.activeRaids) {
      if (now - raid.startTime > 600000) { // 10 minutes
        this.raidTracking.activeRaids.delete(guildId);
      }
    }
  }

  async getExecutor(guild, auditType) {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 1,
        type: auditType
      });
      
      const auditEntry = auditLogs.entries.first();
      if (!auditEntry || Date.now() - auditEntry.createdTimestamp > 5000) return null;
      
      // Skip bot actions if it's our bot
      if (auditEntry.executor.id === this.client.user.id) return null;
      
      return auditEntry.executor;
    } catch (error) {
      console.error('[AntiNuke] Error fetching audit logs:', error);
      return null;
    }
  }

  track(userId, action, metadata = {}) {
    // Skip if user is whitelisted
    if (this.isWhitelisted(userId)) return null;
    
    // Check if user is suspicious and apply stricter limits
    let limit = this.config.limits[action];
    if (this.isSuspicious(userId) && limit?.maxActions) {
      limit = {
        ...limit,
        maxActions: Math.max(1, Math.floor(limit.maxActions / 2))
      };
    }
    
    // Apply even stricter limits if in high alert or raid mode
    if ((this.highAlert || this.raidMode.enabled) && limit?.maxActions) {
      limit = {
        ...limit,
        maxActions: Math.max(1, Math.floor(limit.maxActions / 3))
      };
    }
    
    if (!limit) return null;
    
    const now = Date.now();
    
    // Initialize user tracking
    if (!this.tracker.has(userId)) {
      this.tracker.set(userId, {});
    }
    
    const userTracker = this.tracker.get(userId);
    
    if (!userTracker[action]) {
      userTracker[action] = {
        count: 0,
        firstAction: now,
        lastAction: now,
        metadata: []
      };
    }
    
    const actionTracker = userTracker[action];
    
    // Check if time window has passed
    if (now - actionTracker.firstAction > limit.timeWindowSeconds * 1000) {
      // Reset tracking
      actionTracker.count = 0;
      actionTracker.firstAction = now;
      actionTracker.metadata = [];
    }
    
    actionTracker.count++;
    actionTracker.lastAction = now;
    actionTracker.metadata.push({ ...metadata, timestamp: now });
    
    // Check for violation
    if (actionTracker.count > limit.maxActions) {
      this.stats.actionsBlocked++;
      return {
        userId,
        action,
        count: actionTracker.count,
        limit: limit.maxActions,
        timeWindow: limit.timeWindowSeconds,
        metadata: actionTracker.metadata
      };
    }
    
    return null;
  }

  setupContentMonitoring() {
    // Message content monitoring with multi-user tracking
    this.client.on('messageCreate', async (message) => {
      if (!this.config.contentModeration?.enabled) return;
      if (message.author.bot) return;
      if (!message.guild) return;
      
      // Skip if user is whitelisted
      if (this.isWhitelisted(message.author.id)) return;
      
      // Skip if user has exempt role
      if (message.member?.roles.cache.some(role => 
        this.config.contentModeration.exemptRoles?.includes(role.id)
      )) return;
      
      await this.checkMessageContent(message);
    });
    
    // Anti-raid join monitoring with pattern detection
    if (this.config.contentModeration?.antiRaid?.enabled) {
      this.client.on('guildMemberAdd', async (member) => {
        await this.checkJoinRate(member);
      });
    }
  }

  async checkMessageContent(message) {
    const violations = [];
    const config = this.config.contentModeration;
    
    // Mass mention check
    if (config.massMention?.enabled) {
      const mentions = message.mentions.users.size + message.mentions.roles.size;
      if (mentions >= config.massMention.threshold) {
        violations.push({
          type: 'massMention',
          severity: 'high',
          details: `${mentions} mentions`
        });
        this.stats.contentViolations.massMentions++;
        
        // Track for coordinated spam
        this.trackGlobalAction('massMention', message.author.id, message.guild.id, {
          mentions,
          channelId: message.channel.id
        });
      }
    }
    
    // Mass emoji check
    if (config.massEmoji?.enabled) {
      const emojiCount = (message.content.match(/<a?:\w+:\d+>|[\u{1F300}-\u{1F9FF}]/gu) || []).length;
      if (emojiCount >= config.massEmoji.threshold) {
        violations.push({
          type: 'massEmoji',
          severity: 'low',
          details: `${emojiCount} emojis`
        });
        this.stats.contentViolations.massEmojis++;
      }
    }
    
    // Caps spam check
    if (config.capsSpam?.enabled && message.content.length >= config.capsSpam.minLength) {
      const upperCount = (message.content.match(/[A-Z]/g) || []).length;
      const letterCount = (message.content.match(/[a-zA-Z]/g) || []).length;
      if (letterCount > 0) {
        const capsPercentage = (upperCount / letterCount) * 100;
        if (capsPercentage >= config.capsSpam.percentage) {
          violations.push({
            type: 'capsSpam',
            severity: 'low',
            details: `${Math.round(capsPercentage)}% caps`
          });
          this.stats.contentViolations.capsSpam++;
        }
      }
    }
    
    // Duplicate message check with multi-user tracking
    if (config.duplicateMessages?.enabled) {
      const isDuplicate = await this.checkDuplicateMessage(message);
      if (isDuplicate) {
        violations.push({
          type: 'duplicate',
          severity: 'medium',
          details: 'Duplicate message'
        });
        this.stats.contentViolations.duplicates++;
        
        // Check if multiple users are spamming same content
        await this.checkCoordinatedSpam(message);
      }
    }
    
    // Handle violations
    if (violations.length > 0) {
      await this.handleContentViolations(message, violations);
    }
    
    // Update message history
    this.updateMessageHistory(message);
  }

  async checkCoordinatedSpam(message) {
    const recentMessages = [];
    const now = Date.now();
    const checkWindow = 30000; // 30 seconds
    
    // Collect recent messages from all users
    for (const [userId, history] of this.contentTracking.messageHistory) {
      const recent = history.filter(msg => 
        now - msg.timestamp < checkWindow &&
        msg.content === message.content
      );
      
      recent.forEach(msg => {
        recentMessages.push({
          userId,
          ...msg
        });
      });
    }
    
    // Check if multiple users are sending same message
    const uniqueUsers = new Set(recentMessages.map(msg => msg.userId));
    if (uniqueUsers.size >= 3) {
      // Coordinated spam detected
      console.log(`[AntiNuke] Coordinated spam detected: ${uniqueUsers.size} users`);
      
      const guild = message.guild;
      await this.handleCoordinatedRaid(
        guild.id,
        Array.from(uniqueUsers),
        recentMessages.map(msg => ({
          type: 'spam',
          userId: msg.userId,
          timestamp: msg.timestamp,
          weight: 5,
          details: { content: msg.content.slice(0, 100) }
        }))
      );
    }
  }

  checkDuplicateMessage(message) {
    const userId = message.author.id;
    const history = this.contentTracking.messageHistory.get(userId) || [];
    const config = this.config.contentModeration.duplicateMessages;
    const now = Date.now();
    
    // Check recent messages for duplicates
    const recentMessages = history.filter(
      msg => now - msg.timestamp < config.timeWindow
    );
    
    const duplicates = recentMessages.filter(
      msg => msg.content === message.content
    );
    
    return duplicates.length >= config.threshold - 1;
  }

  updateMessageHistory(message) {
    const userId = message.author.id;
    const history = this.contentTracking.messageHistory.get(userId) || [];
    
    history.push({
      content: message.content,
      timestamp: Date.now(),
      channelId: message.channel.id
    });
    
    // Keep only last 20 messages
    if (history.length > 20) {
      history.shift();
    }
    
    this.contentTracking.messageHistory.set(userId, history);
  }

  async checkJoinRate(member) {
    const config = this.config.contentModeration.antiRaid;
    const guildId = member.guild.id;
    const now = Date.now();
    
    // Initialize join history for guild
    if (!this.contentTracking.joinHistory.has(guildId)) {
      this.contentTracking.joinHistory.set(guildId, []);
    }
    
    const joins = this.contentTracking.joinHistory.get(guildId);
    joins.push({
      userId: member.id,
      timestamp: now,
      username: member.user.username,
      accountAge: now - member.user.createdTimestamp
    });
    
    // Filter recent joins
    const recentJoins = joins.filter(
      join => now - join.timestamp < config.timeWindow
    );
    
    // Update the array with only recent joins
    this.contentTracking.joinHistory.set(guildId, recentJoins);
    
    // Check for suspicious patterns
    const suspiciousPatterns = this.analyzeJoinPatterns(recentJoins);
    
    // Check if raid threshold is met
    if (recentJoins.length >= config.joinThreshold || suspiciousPatterns.detected) {
      await this.triggerRaidMode(
        member.guild, 
        suspiciousPatterns.reason || 'Mass joins detected'
      );
    }
  }

  analyzeJoinPatterns(joins) {
    // Check for suspicious patterns in joins
    const patterns = {
      detected: false,
      reason: null
    };
    
    // Check for very new accounts
    const newAccounts = joins.filter(join => join.accountAge < 86400000); // 1 day
    if (newAccounts.length >= 3) {
      patterns.detected = true;
      patterns.reason = `${newAccounts.length} brand new accounts joining`;
    }
    
    // Check for similar usernames
    const usernames = joins.map(j => j.username.toLowerCase());
    const similarNames = this.findSimilarStrings(usernames);
    if (similarNames.length >= 3) {
      patterns.detected = true;
      patterns.reason = 'Multiple accounts with similar usernames joining';
    }
    
    return patterns;
  }

  findSimilarStrings(strings) {
    const similar = [];
    
    for (let i = 0; i < strings.length; i++) {
      for (let j = i + 1; j < strings.length; j++) {
        const similarity = this.calculateSimilarity(strings[i], strings[j]);
        if (similarity > 0.7) {
          similar.push([strings[i], strings[j]]);
        }
      }
    }
    
    return similar;
  }

  calculateSimilarity(str1, str2) {
    // Simple similarity calculation
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  getEditDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async handleContentViolations(message, violations) {
    // Delete message if needed
    const deleteViolations = violations.filter(v => 
      this.config.contentModeration[v.type]?.action === 'delete'
    );
    
    if (deleteViolations.length > 0) {
      try {
        await message.delete();
      } catch (error) {
        console.error('[AntiNuke] Failed to delete message:', error);
      }
    }
    
    // Apply punishment for severe violations
    const severeViolations = violations.filter(v => v.severity === 'high');
    if (severeViolations.length > 0) {
      const timeoutDuration = this.config.contentModeration.timeoutDuration || 300000; // 5 minutes default
      try {
        await message.member.timeout(timeoutDuration, `AntiNuke: ${severeViolations.map(v => v.type).join(', ')}`);
      } catch (error) {
        console.error('[AntiNuke] Failed to timeout member:', error);
      }
    }
    
    // Log the action
    await this.logContentViolation(message, violations);
  }

  async triggerRaidMode(guild, reason) {
    if (this.raidMode.enabled) return;
    
    console.log(`[AntiNuke] Raid mode triggered in ${guild.name}: ${reason}`);
    
    this.raidMode = {
      enabled: true,
      triggeredAt: Date.now(),
      triggeredBy: reason
    };
    
    this.stats.raidsDetected++;
    
    // Record active raid
    this.raidTracking.activeRaids.set(guild.id, {
      startTime: Date.now(),
      reason,
      actionsBlocked: 0
    });
    
    // Apply lockdown
    if (this.config.contentModeration.antiRaid.lockdownEnabled) {
      await this.lockdownServer(guild);
    }
    
    // Log the raid
    await this.logToAdminChannel({
      title: '🚨 RAID MODE ACTIVATED',
      description: `Raid mode has been activated.\nReason: ${reason}`,
      fields: [
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Time', value: new Date().toLocaleString(), inline: true }
      ]
    });
    
    // Auto-disable raid mode after 30 minutes
    setTimeout(() => {
      if (this.raidMode.enabled) {
        this.disableRaidMode(guild);
      }
    }, 30 * 60 * 1000);
  }

  async disableRaidMode(guild) {
    this.raidMode.enabled = false;
    
    // Remove from active raids
    this.raidTracking.activeRaids.delete(guild.id);
    
    // Restore permissions
    try {
      const everyoneRole = guild.roles.everyone;
      await everyoneRole.setPermissions(
        everyoneRole.permissions.add([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.Connect
        ]),
        'AntiNuke: Raid mode disabled'
      );
    } catch (error) {
      console.error('[AntiNuke] Failed to restore permissions:', error);
    }
    
    await this.logToAdminChannel({
      title: 'Raid Mode Disabled',
      description: 'Server has been restored to normal operation.'
    });
  }

  async lockdownServer(guild) {
    try {
      const everyoneRole = guild.roles.everyone;
      await everyoneRole.setPermissions(
        everyoneRole.permissions.remove([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak
        ]),
        'AntiNuke: Raid lockdown'
      );
    } catch (error) {
      console.error('[AntiNuke] Failed to lockdown server:', error);
    }
  }

  async logContentViolation(message, violations) {
    const logChannel = this.config.abuseLogChannel || this.config.adminLogChannel;
    if (!logChannel) return;
    
    const channel = message.guild.channels.cache.get(logChannel);
    if (!channel?.isTextBased()) return;
    
    const fields = [
      { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Violations', value: violations.map(v => `• **${v.type}**: ${v.details}`).join('\n') }
    ];
    
    if (message.content) {
      fields.push({ 
        name: 'Message Content', 
        value: message.content.slice(0, 1024) 
      });
    }
    
    const embed = this.embedLoader.createEmbed({
      title: 'Content Violation Detected',
      description: `User ${message.author} violated content rules`,
      formatDescription: false,
      fields
    });
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[AntiNuke] Failed to log content violation:', error);
    }
  }

  async handleViolation(guild, user, action, violation) {
    console.log(`[AntiNuke] Violation detected: ${user.tag} - ${action} (${violation.count}/${violation.limit})`);
    
    // Get member
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    // Check if user has related accounts (potential alts)
    const relatedUsers = this.raidTracking.userRelations.get(user.id);
    if (relatedUsers && relatedUsers.size > 0) {
      console.log(`[AntiNuke] User has ${relatedUsers.size} related accounts`);
      
      // Process related accounts too
      for (const relatedId of relatedUsers) {
        const relatedMember = await guild.members.fetch(relatedId).catch(() => null);
        if (relatedMember && relatedMember.bannable) {
          await relatedMember.ban({ reason: 'AntiNuke: Related to violating account' });
        }
      }
    }
    
    // Apply punishment based on action type
    let punishment = 'None';
    
    try {
      switch (action) {
        case 'bans':
        case 'kicks':
          if (member.bannable) {
            await member.ban({ reason: `AntiNuke: Excessive ${action}` });
            punishment = 'Banned';
          }
          break;
          
        case 'channelCreate':
        case 'channelDelete':
        case 'roleCreate':
        case 'roleDelete':
          // Remove all roles except @everyone
          const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
          if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove, `AntiNuke: Excessive ${action}`);
            punishment = 'Roles Removed';
          }
          
          // If it's channel/role deletion, ban them
          if (action.includes('Delete') && member.bannable) {
            await member.ban({ reason: `AntiNuke: ${action}` });
            punishment = 'Banned';
          }
          break;
          
        case 'commands':
          // Timeout for 5 minutes
          if (member.moderatable) {
            await member.timeout(5 * 60 * 1000, `AntiNuke: Command spam`);
            punishment = 'Timed Out';
          }
          break;
      }
    } catch (error) {
      console.error('[AntiNuke] Error applying punishment:', error);
    }
    
    // Log the violation
    await this.logViolation(guild, user, action, violation, punishment);
  }

  async logViolation(guild, user, action, violation, punishment) {
    await this.logToAdminChannel({
      title: 'AntiNuke Violation Detected',
      description: `User ${user.tag} exceeded ${action} limit`,
      fields: [
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Action', value: action, inline: true },
        { name: 'Count', value: `${violation.count}/${violation.limit}`, inline: true },
        { name: 'Time Window', value: `${violation.timeWindow}s`, inline: true },
        { name: 'Punishment', value: punishment, inline: true },
        { name: 'Guild', value: guild.name, inline: true }
      ]
    });
    
    // Also log to abuse channel if different
    if (this.config.abuseLogChannel && this.config.abuseLogChannel !== this.config.adminLogChannel) {
      const abuseChannel = guild.channels.cache.get(this.config.abuseLogChannel);
      if (abuseChannel?.isTextBased()) {
        const embed = this.embedLoader.createEmbed({
          title: 'Suspicious Activity',
          description: `${user.tag} may be attempting to nuke the server`,
          formatDescription: false,
          fields: [
            { name: 'Action', value: action, inline: true },
            { name: 'Count', value: `${violation.count}`, inline: true }
          ]
        });
        
        await abuseChannel.send({ embeds: [embed] });
      }
    }
  }

  async logToAdminChannel(embedData) {
    if (!this.config.adminLogChannel) return;
    
    for (const guild of this.client.guilds.cache.values()) {
      const channel = guild.channels.cache.get(this.config.adminLogChannel);
      if (channel?.isTextBased()) {
        const embed = this.embedLoader.system('AntiNuke', embedData.description, {
          fields: embedData.fields
        });
        
        try {
          await channel.send({ embeds: [embed] });
        } catch (error) {
          console.error('[AntiNuke] Error sending log:', error);
        }
      }
    }
  }

  isWhitelisted(userId) {
    return this.config.whitelist?.users?.includes(userId) || false;
  }

  isRoleWhitelisted(roleId) {
    return this.config.whitelist?.roles?.includes(roleId) || false;
  }

  addToWhitelist(type, id) {
    if (!this.config.whitelist) {
      this.config.whitelist = { users: [], roles: [] };
    }
    
    if (type === 'user' && !this.config.whitelist.users.includes(id)) {
      this.config.whitelist.users.push(id);
      return true;
    } else if (type === 'role' && !this.config.whitelist.roles.includes(id)) {
      this.config.whitelist.roles.push(id);
      return true;
    }
    
    return false;
  }

  removeFromWhitelist(type, id) {
    if (!this.config.whitelist) return false;
    
    if (type === 'user') {
      const index = this.config.whitelist.users.indexOf(id);
      if (index > -1) {
        this.config.whitelist.users.splice(index, 1);
        return true;
      }
    } else if (type === 'role') {
      const index = this.config.whitelist.roles.indexOf(id);
      if (index > -1) {
        this.config.whitelist.roles.splice(index, 1);
        return true;
      }
    }
    
    return false;
  }

  setHighAlert(enabled) {
    if (enabled && !this.highAlert) {
      // Store original limits
      this.originalLimits = JSON.parse(JSON.stringify(this.config.limits));
      
      // Reduce all thresholds by 50% during high alert
      for (const [action, limit] of Object.entries(this.config.limits)) {
        if (limit.maxActions) {
          this.config.limits[action].maxActions = Math.max(1, Math.floor(limit.maxActions / 2));
        }
      }
      
      this.highAlert = true;
      console.log('[AntiNuke] High alert mode enabled - thresholds reduced');
      
      // Log to admin channel
      this.logToAdminChannel({
        title: 'High Alert Mode',
        description: 'AntiNuke thresholds have been reduced due to detected raid activity.'
      });
    } else if (!enabled && this.highAlert && this.originalLimits) {
      // Restore original limits
      this.config.limits = this.originalLimits;
      this.originalLimits = null;
      this.highAlert = false;
      
      console.log('[AntiNuke] High alert mode disabled - thresholds restored');
      
      // Log to admin channel
      this.logToAdminChannel({
        title: 'High Alert Mode',
        description: 'AntiNuke thresholds have been restored to normal.'
      });
    }
  }

  trackSuspiciousUser(userId, report) {
    const userData = this.suspiciousUsers.get(userId) || {
      reports: [],
      lastReport: 0
    };
    
    userData.reports.push({
      ...report,
      timestamp: Date.now()
    });
    userData.lastReport = Date.now();
    
    // Keep only last 10 reports
    if (userData.reports.length > 10) {
      userData.reports.shift();
    }
    
    this.suspiciousUsers.set(userId, userData);
    
    // Clean up old reports (older than 24 hours)
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [uid, data] of this.suspiciousUsers) {
      if (data.lastReport < dayAgo) {
        this.suspiciousUsers.delete(uid);
      }
    }
  }

  isSuspicious(userId) {
    const userData = this.suspiciousUsers.get(userId);
    if (!userData) return false;
    
    // User is suspicious if they have recent reports
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return userData.lastReport > fiveMinutesAgo;
  }

  async saveConfig() {
    this.configLoader.set('antiNuke', this.config);
    return this.configLoader.save();
  }

  getStats() {
    const baseStats = {
      trackedActions: {},
      trackedUsers: this.tracker.size
    };
    
    // Count tracked actions
    for (const [, userData] of this.tracker) {
      for (const [action, data] of Object.entries(userData)) {
        if (action !== 'warnings') {
          baseStats.trackedActions[action] = (baseStats.trackedActions[action] || 0) + data.count;
        }
      }
    }
    
    return {
      ...baseStats,
      highAlert: this.highAlert,
      suspiciousUsers: this.suspiciousUsers.size,
      stats: this.stats,
      multiUserDetection: {
        enabled: this.multiUserConfig.enabled,
        activeRaids: this.raidTracking.activeRaids.size,
        relatedAccounts: this.raidTracking.userRelations.size,
        globalActionsTracked: Array.from(this.raidTracking.globalActions.keys())
      },
      contentModeration: {
        enabled: this.config.contentModeration?.enabled || false,
        violations: this.stats.contentViolations,
        raidMode: this.raidMode,
        trackedMessages: this.contentTracking.messageHistory.size,
        trackedGuilds: this.contentTracking.joinHistory.size
      }
    };
  }

  cleanup() {
    const now = Date.now();
    
    // Clean old message history
    for (const [userId, history] of this.contentTracking.messageHistory) {
      const filtered = history.filter(msg => 
        now - msg.timestamp < 300000 // Keep 5 minutes
      );
      
      if (filtered.length === 0) {
        this.contentTracking.messageHistory.delete(userId);
      } else {
        this.contentTracking.messageHistory.set(userId, filtered);
      }
    }
    
    // Clean old join history
    for (const [guildId, joins] of this.contentTracking.joinHistory) {
      const filtered = joins.filter(join => 
        now - join.timestamp < 300000 // Keep 5 minutes
      );
      
      if (filtered.length === 0) {
        this.contentTracking.joinHistory.delete(guildId);
      } else {
        this.contentTracking.joinHistory.set(guildId, filtered);
      }
    }
  }
}