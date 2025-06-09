// src/systems/giveawaySystem.js
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class GiveawaySystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get giveaway config from config loader
    this.config = this.configLoader.get('giveaway');
    
    // Validate config
    if (!this.config) {
      throw new Error('[GiveawaySystem] Giveaway configuration not found in config.yaml');
    }
    
    // Active giveaways
    this.activeGiveaways = new Map(); // messageId -> giveaway data
    this.endTimers = new Map(); // giveawayId -> timeout
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadGiveawayData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
      this.scheduleGiveaways();
    }
  }

  /**
   * Load giveaway data from file
   */
  loadGiveawayData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.activeGiveaways) {
          for (const [messageId, giveaway] of Object.entries(data.activeGiveaways)) {
            this.activeGiveaways.set(messageId, giveaway);
          }
        }
        
        console.log(`[GiveawaySystem] Loaded ${this.activeGiveaways.size} active giveaways`);
      }
    } catch (error) {
      console.error('[GiveawaySystem] Error loading giveaway data:', error);
    }
  }

  /**
   * Save giveaway data to file
   */
  saveGiveawayData() {
    try {
      const data = {
        activeGiveaways: Object.fromEntries(this.activeGiveaways),
        stats: {
          totalGiveaways: this.config.stats?.totalGiveaways || 0,
          totalWinners: this.config.stats?.totalWinners || 0,
          totalParticipants: this.config.stats?.totalParticipants || 0
        }
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[GiveawaySystem] Error saving giveaway data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Handle button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      
      if (interaction.customId.startsWith('giveaway_')) {
        await this.handleButtonInteraction(interaction);
      }
    });

    // Clean up on message delete
    this.client.on('messageDelete', (message) => {
      const giveaway = this.activeGiveaways.get(message.id);
      if (giveaway) {
        this.cancelGiveaway(message.id, 'Message deleted');
      }
    });
  }

  /**
   * Schedule all active giveaways
   */
  scheduleGiveaways() {
    const now = Date.now();
    
    for (const [messageId, giveaway] of this.activeGiveaways) {
      if (giveaway.status === 'active') {
        const endTime = new Date(giveaway.endTime).getTime();
        const timeLeft = endTime - now;
        
        if (timeLeft > 0) {
          this.scheduleEnd(giveaway, timeLeft);
        } else {
          // Giveaway should have ended
          this.endGiveaway(messageId);
        }
      }
    }
  }

  /**
   * Create a giveaway
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async createGiveaway(options) {
    const {
      channelId,
      prize,
      duration,
      winnerCount = 1,
      hostId,
      requirements = {},
      bonusEntries = [],
      description = null,
      thumbnailUrl = null,
      embedColor = this.config.embedColor
    } = options;

    const channel = this.client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Invalid channel');
    }

    // Generate giveaway ID
    this.config.stats = this.config.stats || { totalGiveaways: 0 };
    this.config.stats.totalGiveaways++;
    const giveawayId = `gw_${Date.now()}_${this.config.stats.totalGiveaways}`;
    
    // Calculate end time
    const endTime = new Date(Date.now() + duration);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`${description ? description + '\n\n' : ''}**Prize:** ${prize}\n**Winners:** ${winnerCount}\n**Ends:** <t:${Math.floor(endTime.getTime() / 1000)}:R>`)
      .setColor(embedColor)
      .setTimestamp(endTime)
      .setFooter({ text: `${winnerCount} winner${winnerCount > 1 ? 's' : ''} | Ends at` });

    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    // Add requirements field if any
    if (Object.keys(requirements).length > 0) {
      const reqText = [];
      if (requirements.minMessages) reqText.push(`• ${requirements.minMessages}+ messages`);
      if (requirements.minVoiceTime) reqText.push(`• ${requirements.minVoiceTime} minutes in voice`);
      if (requirements.requiredRoles?.length > 0) {
        reqText.push(`• Required roles: ${requirements.requiredRoles.map(r => `<@&${r}>`).join(', ')}`);
      }
      if (requirements.blacklistRoles?.length > 0) {
        reqText.push(`• Cannot have: ${requirements.blacklistRoles.map(r => `<@&${r}>`).join(', ')}`);
      }
      if (requirements.minAccountAge) {
        reqText.push(`• Account age: ${requirements.minAccountAge} days`);
      }
      if (requirements.minServerTime) {
        reqText.push(`• Server member for: ${requirements.minServerTime} days`);
      }
      
      if (reqText.length > 0) {
        embed.addFields({
          name: '📋 Requirements',
          value: reqText.join('\n'),
          inline: false
        });
      }
    }

    // Add bonus entries field if any
    if (bonusEntries.length > 0) {
      const bonusText = bonusEntries.map(b => 
        `• <@&${b.roleId}>: ${b.entries}x entries`
      ).join('\n');
      
      embed.addFields({
        name: '🎯 Bonus Entries',
        value: bonusText,
        inline: false
      });
    }

    // Add host field
    if (hostId) {
      embed.addFields({
        name: 'Hosted by',
        value: `<@${hostId}>`,
        inline: true
      });
    }

    // Create button
    const button = new ButtonBuilder()
      .setCustomId('giveaway_enter')
      .setLabel('Enter Giveaway')
      .setEmoji(this.config.enterEmoji)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    // Send message
    const message = await channel.send({
      embeds: [embed],
      components: [row]
    });

    // Create giveaway data
    const giveawayData = {
      id: giveawayId,
      messageId: message.id,
      channelId: channelId,
      guildId: channel.guild.id,
      prize: prize,
      winnerCount: winnerCount,
      hostId: hostId,
      requirements: requirements,
      bonusEntries: bonusEntries,
      participants: [],
      winners: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      endTime: endTime.toISOString(),
      ended: false
    };

    // Save giveaway
    this.activeGiveaways.set(message.id, giveawayData);
    this.saveGiveawayData();

    // Schedule end
    this.scheduleEnd(giveawayData, duration);

    // Log creation
    if (this.config.enableLogging) {
      await this.logAction(channel.guild, {
        action: 'Giveaway Created',
        giveaway: giveawayData,
        host: hostId ? `<@${hostId}>` : 'System'
      });
    }

    return { message, giveaway: giveawayData };
  }

  /**
   * Schedule giveaway end
   * @param {Object} giveaway
   * @param {number} delay
   */
  scheduleEnd(giveaway, delay) {
    // Clear existing timer if any
    const existingTimer = this.endTimers.get(giveaway.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.endGiveaway(giveaway.messageId);
    }, delay);

    this.endTimers.set(giveaway.id, timer);
  }

  /**
   * Handle button interaction
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async handleButtonInteraction(interaction) {
    const giveaway = this.activeGiveaways.get(interaction.message.id);
    if (!giveaway) {
      return interaction.reply({
        content: '❌ This giveaway is no longer active.',
        ephemeral: true
      });
    }

    const action = interaction.customId.split('_')[1];

    if (action === 'enter') {
      await this.handleEnter(interaction, giveaway);
    } else if (action === 'reroll') {
      await this.handleReroll(interaction, giveaway);
    }
  }

  /**
   * Handle giveaway entry
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} giveaway
   */
  async handleEnter(interaction, giveaway) {
    const userId = interaction.user.id;

    // Check if already entered
    if (giveaway.participants.includes(userId)) {
      // Remove entry
      giveaway.participants = giveaway.participants.filter(id => id !== userId);
      this.saveGiveawayData();
      
      return interaction.reply({
        content: '❌ You have left the giveaway.',
        ephemeral: true
      });
    }

    // Check requirements
    const eligible = await this.checkRequirements(interaction.member, giveaway);
    if (!eligible.allowed) {
      return interaction.reply({
        content: `❌ You do not meet the requirements:\n${eligible.reasons.join('\n')}`,
        ephemeral: true
      });
    }

    // Add participant
    giveaway.participants.push(userId);
    
    // Add bonus entries
    const bonusMultiplier = this.getBonusMultiplier(interaction.member, giveaway.bonusEntries);
    for (let i = 1; i < bonusMultiplier; i++) {
      giveaway.participants.push(userId);
    }
    
    this.config.stats = this.config.stats || {};
    this.config.stats.totalParticipants = (this.config.stats.totalParticipants || 0) + 1;
    
    this.saveGiveawayData();

    // Update button with participant count
    await this.updateGiveawayMessage(giveaway);

    await interaction.reply({
      content: `✅ You have entered the giveaway!${bonusMultiplier > 1 ? ` (${bonusMultiplier}x entries)` : ''}`,
      ephemeral: true
    });
  }

  /**
   * Check if member meets requirements
   * @param {import("discord.js").GuildMember} member
   * @param {Object} giveaway
   * @returns {Promise<{allowed: boolean, reasons: string[]}>}
   */
  async checkRequirements(member, giveaway) {
    const reasons = [];
    const requirements = giveaway.requirements;

    // Check required roles
    if (requirements.requiredRoles?.length > 0) {
      const hasRequired = requirements.requiredRoles.some(roleId => 
        member.roles.cache.has(roleId)
      );
      if (!hasRequired) {
        reasons.push('Missing required role(s)');
      }
    }

    // Check blacklist roles
    if (requirements.blacklistRoles?.length > 0) {
      const hasBlacklisted = requirements.blacklistRoles.some(roleId => 
        member.roles.cache.has(roleId)
      );
      if (hasBlacklisted) {
        reasons.push('You have a blacklisted role');
      }
    }

    // Check account age
    if (requirements.minAccountAge) {
      const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
      if (accountAge < requirements.minAccountAge) {
        reasons.push(`Account must be at least ${requirements.minAccountAge} days old`);
      }
    }

    // Check server time
    if (requirements.minServerTime) {
      const serverTime = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
      if (serverTime < requirements.minServerTime) {
        reasons.push(`Must be in server for at least ${requirements.minServerTime} days`);
      }
    }

    // Check messages (would need leaderboard system integration)
    if (requirements.minMessages) {
      // This would require integration with leaderboard system
      reasons.push(`Message requirement check not implemented`);
    }

    // Check voice time (would need leaderboard system integration)
    if (requirements.minVoiceTime) {
      // This would require integration with leaderboard system
      reasons.push(`Voice time requirement check not implemented`);
    }

    return {
      allowed: reasons.length === 0,
      reasons
    };
  }

  /**
   * Get bonus multiplier for member
   * @param {import("discord.js").GuildMember} member
   * @param {Array} bonusEntries
   * @returns {number}
   */
  getBonusMultiplier(member, bonusEntries) {
    let multiplier = 1;

    for (const bonus of bonusEntries) {
      if (member.roles.cache.has(bonus.roleId)) {
        multiplier = Math.max(multiplier, bonus.entries);
      }
    }

    return multiplier;
  }

  /**
   * Update giveaway message
   * @param {Object} giveaway
   */
  async updateGiveawayMessage(giveaway) {
    try {
      const channel = this.client.channels.cache.get(giveaway.channelId);
      const message = await channel?.messages.fetch(giveaway.messageId);
      if (!message) return;

      const uniqueParticipants = new Set(giveaway.participants).size;
      
      // Update button
      const button = new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel(`Enter Giveaway (${uniqueParticipants})`)
        .setEmoji(this.config.enterEmoji)
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await message.edit({ components: [row] });
    } catch (error) {
      console.error('[GiveawaySystem] Error updating message:', error);
    }
  }

  /**
   * End a giveaway
   * @param {string} messageId
   */
  async endGiveaway(messageId) {
    const giveaway = this.activeGiveaways.get(messageId);
    if (!giveaway || giveaway.ended) return;

    giveaway.ended = true;
    giveaway.status = 'ended';
    giveaway.endedAt = new Date().toISOString();

    try {
      const channel = this.client.channels.cache.get(giveaway.channelId);
      const message = await channel?.messages.fetch(messageId);
      if (!message) return;

      // Select winners
      const winners = this.selectWinners(giveaway);
      giveaway.winners = winners;

      // Update stats
      this.config.stats = this.config.stats || {};
      this.config.stats.totalWinners = (this.config.stats.totalWinners || 0) + winners.length;

      // Update embed
      const embed = EmbedBuilder.from(message.embeds[0]);
      
      if (winners.length > 0) {
        embed.setTitle('🎉 GIVEAWAY ENDED 🎉')
          .setColor(0x00ff00)
          .addFields({
            name: '🏆 Winner' + (winners.length > 1 ? 's' : ''),
            value: winners.map(id => `<@${id}>`).join('\n'),
            inline: false
          });

        // Create reroll button
        const button = new ButtonBuilder()
          .setCustomId('giveaway_reroll')
          .setLabel('Reroll')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(button);

        await message.edit({ embeds: [embed], components: [row] });

        // Send winner announcement
        await channel.send({
          content: `Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`
        });

        // DM winners if enabled
        if (this.config.dmWinners) {
          for (const winnerId of winners) {
            await this.dmWinner(winnerId, giveaway);
          }
        }
      } else {
        embed.setTitle('🎉 GIVEAWAY ENDED 🎉')
          .setColor(0xff0000)
          .setDescription(`**Prize:** ${giveaway.prize}\n\nNo valid participants.`);

        await message.edit({ embeds: [embed], components: [] });
      }

      // Log end
      if (this.config.enableLogging) {
        await this.logAction(channel.guild, {
          action: 'Giveaway Ended',
          giveaway: giveaway,
          winners: winners.map(id => `<@${id}>`).join(', ') || 'None'
        });
      }
    } catch (error) {
      console.error('[GiveawaySystem] Error ending giveaway:', error);
    }

    this.saveGiveawayData();

    // Clear timer
    const timer = this.endTimers.get(giveaway.id);
    if (timer) {
      clearTimeout(timer);
      this.endTimers.delete(giveaway.id);
    }
  }

  /**
   * Select winners from participants
   * @param {Object} giveaway
   * @returns {Array<string>}
   */
  selectWinners(giveaway) {
    const participants = [...giveaway.participants];
    if (participants.length === 0) return [];

    const winners = new Set();
    const winnerCount = Math.min(giveaway.winnerCount, new Set(participants).size);

    while (winners.size < winnerCount) {
      const randomIndex = Math.floor(Math.random() * participants.length);
      const winner = participants[randomIndex];
      winners.add(winner);
      
      // Remove all entries of this winner to avoid duplicate wins
      for (let i = participants.length - 1; i >= 0; i--) {
        if (participants[i] === winner) {
          participants.splice(i, 1);
        }
      }
    }

    return Array.from(winners);
  }

  /**
   * Handle reroll
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} giveaway
   */
  async handleReroll(interaction, giveaway) {
    // Check permissions
    const canReroll = interaction.member.permissions.has('ManageGuildExpressions') ||
                     interaction.user.id === giveaway.hostId;

    if (!canReroll) {
      return interaction.reply({
        content: '❌ You do not have permission to reroll this giveaway.',
        ephemeral: true
      });
    }

    // Filter out previous winners
    const eligibleParticipants = giveaway.participants.filter(id => 
      !giveaway.winners.includes(id)
    );

    if (eligibleParticipants.length === 0) {
      return interaction.reply({
        content: '❌ No eligible participants left for reroll.',
        ephemeral: true
      });
    }

    // Select new winner
    const newWinners = this.selectWinners({
      ...giveaway,
      participants: eligibleParticipants,
      winnerCount: 1
    });

    if (newWinners.length === 0) {
      return interaction.reply({
        content: '❌ Could not select a new winner.',
        ephemeral: true
      });
    }

    // Add to winners
    giveaway.winners.push(...newWinners);
    this.saveGiveawayData();

    await interaction.reply({
      content: `🎉 Reroll winner: ${newWinners.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`
    });

    // DM new winner if enabled
    if (this.config.dmWinners) {
      for (const winnerId of newWinners) {
        await this.dmWinner(winnerId, giveaway);
      }
    }

    // Log reroll
    if (this.config.enableLogging) {
      await this.logAction(interaction.guild, {
        action: 'Giveaway Rerolled',
        giveaway: giveaway,
        newWinners: newWinners.map(id => `<@${id}>`).join(', '),
        rerolledBy: interaction.user
      });
    }
  }

  /**
   * DM winner
   * @param {string} winnerId
   * @param {Object} giveaway
   */
  async dmWinner(winnerId, giveaway) {
    try {
      const user = await this.client.users.fetch(winnerId);
      const guild = this.client.guilds.cache.get(giveaway.guildId);

      const embed = new EmbedBuilder()
        .setTitle('🎉 Congratulations! You Won!')
        .setDescription(`You won the giveaway in **${guild.name}**!`)
        .addFields(
          { name: 'Prize', value: giveaway.prize, inline: true },
          { name: 'Hosted by', value: giveaway.hostId ? `<@${giveaway.hostId}>` : 'System', inline: true }
        )
        .setColor(0xffd700)
        .setTimestamp();

      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error(`[GiveawaySystem] Failed to DM winner ${winnerId}:`, error);
    }
  }

  /**
   * Cancel a giveaway
   * @param {string} messageId
   * @param {string} reason
   */
  async cancelGiveaway(messageId, reason = 'Cancelled by administrator') {
    const giveaway = this.activeGiveaways.get(messageId);
    if (!giveaway) return;

    giveaway.status = 'cancelled';
    giveaway.cancelledAt = new Date().toISOString();
    giveaway.cancelReason = reason;

    try {
      const channel = this.client.channels.cache.get(giveaway.channelId);
      const message = await channel?.messages.fetch(messageId);
      
      if (message) {
        const embed = EmbedBuilder.from(message.embeds[0])
          .setTitle('❌ GIVEAWAY CANCELLED')
          .setColor(0xff0000)
          .setDescription(`This giveaway has been cancelled.\n\n**Reason:** ${reason}`);

        await message.edit({ embeds: [embed], components: [] });
      }
    } catch (error) {
      console.error('[GiveawaySystem] Error cancelling giveaway:', error);
    }

    // Clear timer
    const timer = this.endTimers.get(giveaway.id);
    if (timer) {
      clearTimeout(timer);
      this.endTimers.delete(giveaway.id);
    }

    this.activeGiveaways.delete(messageId);
    this.saveGiveawayData();

    // Log cancellation
    if (this.config.enableLogging) {
      const guild = this.client.guilds.cache.get(giveaway.guildId);
      await this.logAction(guild, {
        action: 'Giveaway Cancelled',
        giveaway: giveaway,
        reason: reason
      });
    }
  }

  /**
   * Log action
   * @param {import("discord.js").Guild} guild
   * @param {Object} data
   */
  async logAction(guild, data) {
    if (!this.config.enableLogging || !this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`Giveaway System: ${data.action}`)
      .setColor(
        data.action.includes('Created') ? 0x00ff00 :
        data.action.includes('Ended') ? 0xffd700 :
        data.action.includes('Cancelled') ? 0xff0000 :
        0x0099ff
      )
      .setTimestamp();

    if (data.giveaway) {
      embed.addFields(
        { name: 'Prize', value: data.giveaway.prize, inline: true },
        { name: 'Winners', value: `${data.giveaway.winnerCount}`, inline: true }
      );
    }

    if (data.host) {
      embed.addFields({ name: 'Host', value: data.host, inline: true });
    }

    if (data.winners) {
      embed.addFields({ name: 'Winners', value: data.winners || 'None', inline: false });
    }

    if (data.newWinners) {
      embed.addFields({ name: 'New Winners', value: data.newWinners, inline: false });
    }

    if (data.rerolledBy) {
      embed.addFields({ 
        name: 'Rerolled By', 
        value: `${data.rerolledBy.tag} (${data.rerolledBy.id})`, 
        inline: true 
      });
    }

    if (data.reason) {
      embed.addFields({ name: 'Reason', value: data.reason, inline: false });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[GiveawaySystem] Failed to log action:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      activeGiveaways: this.activeGiveaways.size,
      stats: this.config.stats || {
        totalGiveaways: 0,
        totalWinners: 0,
        totalParticipants: 0
      }
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('giveaway', this.config);
    return this.configLoader.save();
  }
}