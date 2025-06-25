// src/systems/antinuke/moderation/loggingHandler.js
export default class LoggingHandler {
  constructor(antiNuke) {
    this.antiNuke = antiNuke;
    this.client = antiNuke.client;
    this.config = antiNuke.fullConfig.get('moderation');
    this.antiNukeConfig = antiNuke.config;
    this.embedLoader = null;
  }
  
  /**
   * Set the embed loader
   */
  setEmbedLoader(loader) {
    this.embedLoader = loader;
  }
  
  /**
   * Log security event (AntiNuke)
   */
  async logSecurityEvent(guild, action, details, context = {}) {
    if (!this.embedLoader || !guild) return;
    
    const logChannel = guild.channels.cache.get(this.antiNukeConfig.adminLogChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: `AntiNuke: ${action}`,
      description: details,
      timestamp: true,
      fields: [
        {
          name: 'High Alert',
          value: context.highAlert ? 'ENABLED' : 'Disabled',
          inline: true
        },
        {
          name: 'Raid Mode',
          value: context.raidMode ? 'ACTIVE' : 'Inactive',
          inline: true
        }
      ]
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      if (error.code !== 50013) {
        console.error('[LoggingHandler] Error logging security event:', error);
      }
    }
  }
  
  /**
   * Log abuse event (Content violations)
   */
  async logAbuseEvent(guild, type, user) {
    if (!this.embedLoader) return;
    
    const logChannel = guild.channels.cache.get(this.antiNukeConfig.abuseLogChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: 'Content Violation Detected',
      description: `**User:** ${user}\n**Type:** ${type}`,
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      if (error.code !== 50013) {
        console.error('[LoggingHandler] Error logging abuse:', error);
      }
    }
  }
  
  /**
   * Log moderation action
   */
  async logModerationAction(guild, actionData) {
    if (!this.embedLoader || !this.config.logChannel) return;
    
    const logChannel = guild.channels.cache.get(this.config.logChannel);
    if (!logChannel) return;
    
    const fields = [
      { name: 'Action', value: actionData.action, inline: true },
      { name: 'Moderator', value: `${actionData.moderator}`, inline: true },
      { name: 'Target', value: actionData.target, inline: true }
    ];
    
    if (actionData.reason) {
      fields.push({ name: 'Reason', value: actionData.reason, inline: false });
    }
    
    if (actionData.additional) {
      fields.push({ name: 'Details', value: actionData.additional, inline: false });
    }
    
    if (actionData.duration) {
      fields.push({ name: 'Duration', value: actionData.duration, inline: true });
    }
    
    const embed = this.embedLoader.createEmbed({
      title: 'Moderation Log',
      formatDescription: false,
      fields,
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[LoggingHandler] Error logging moderation action:', error);
    }
  }
  
  /**
   * Log permission change
   */
  async logPermissionChange(guild, changeData) {
    if (!this.embedLoader || !this.config.logChannel) return;
    
    const logChannel = guild.channels.cache.get(this.config.logChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: 'Permission Update',
      fields: [
        { name: 'Changed By', value: `${changeData.executor}`, inline: true },
        { name: 'Target', value: `${changeData.target}`, inline: true },
        { name: 'Action', value: changeData.action, inline: true },
        { name: 'Permission Level', value: changeData.level || 'N/A', inline: true }
      ],
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[LoggingHandler] Error logging permission change:', error);
    }
  }
  
  /**
   * Log whitelist change
   */
  async logWhitelistChange(guild, changeData) {
    if (!this.embedLoader || !this.antiNukeConfig.adminLogChannel) return;
    
    const logChannel = guild.channels.cache.get(this.antiNukeConfig.adminLogChannel);
    if (!logChannel) return;
    
    const embed = this.embedLoader.createEmbed({
      title: 'Whitelist Update',
      fields: [
        { name: 'Changed By', value: `${changeData.executor}`, inline: true },
        { name: 'Target', value: `${changeData.target}`, inline: true },
        { name: 'Action', value: changeData.action, inline: true },
        { name: 'Type', value: changeData.type || 'User', inline: true }
      ],
      timestamp: true
    });
    
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[LoggingHandler] Error logging whitelist change:', error);
    }
  }
  
  /**
   * Log raid detection
   */
  async logRaidDetection(guild, raidData) {
    if (!this.embedLoader) return;
    
    // Send to both channels for maximum visibility during raids
    const channels = [
      this.antiNukeConfig.adminLogChannel,
      this.antiNukeConfig.abuseLogChannel
    ].filter((id, index, self) => id && self.indexOf(id) === index);
    
    const embed = this.embedLoader.createEmbed({
      title: '🚨 RAID DETECTED 🚨',
      description: `**Type:** ${raidData.type}\n**Details:** ${raidData.details}`,
      fields: [
        { name: 'Users Involved', value: `${raidData.userCount || 'Unknown'}`, inline: true },
        { name: 'Actions Taken', value: raidData.actions || 'Monitoring', inline: true },
        { name: 'Threat Level', value: raidData.threatLevel || 'High', inline: true }
      ],
      timestamp: true,
      color: 0xFF0000 // Red for raids
    });
    
    for (const channelId of channels) {
      try {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          await channel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('[LoggingHandler] Error logging raid detection:', error);
      }
    }
  }
  
  /**
   * Create a unified log entry
   */
  createLogEntry(type, data) {
    return {
      type,
      timestamp: Date.now(),
      guildId: data.guild?.id,
      userId: data.user?.id || data.userId,
      moderatorId: data.moderator?.id || data.moderatorId,
      action: data.action,
      details: data.details || {},
      reason: data.reason
    };
  }
}