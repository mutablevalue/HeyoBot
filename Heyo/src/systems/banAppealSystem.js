// src/systems/banAppealSystem.js
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BanAppealSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Load ban appeal config
    const appealConfig = this.configLoader.get('banAppeal') || {};
    this.config = {
      enabled: appealConfig.enabled ?? true,
      dataFile: appealConfig.dataFile || 'ban_appeals.json',
      
      // Appeal settings
      appealChannel: appealConfig.appealChannel || null, // Channel to send appeals to
      dmMessage: appealConfig.dmMessage || {
        enabled: true,
        delay: appealConfig.dmMessage?.delay || 5000, // 5 seconds delay after ban
        content: appealConfig.dmMessage?.content || 'You have been banned from **{server}**. If you believe this was a mistake, you can submit an appeal.',
        embedTitle: appealConfig.dmMessage?.embedTitle || 'Ban Appeal',
        embedDescription: appealConfig.dmMessage?.embedDescription || 'Click the button below to submit a ban appeal. Please be honest and provide as much detail as possible.',
        embedColor: appealConfig.dmMessage?.embedColor || 0xff0000,
        buttonLabel: appealConfig.dmMessage?.buttonLabel || 'Submit Appeal',
        buttonEmoji: appealConfig.dmMessage?.buttonEmoji || '📝'
      },
      
      // Appeal form fields
      appealForm: appealConfig.appealForm || {
        reasonField: {
          label: 'Why were you banned?',
          placeholder: 'Please explain what led to your ban',
          style: 'paragraph',
          minLength: 20,
          maxLength: 500,
          required: true
        },
        explanationField: {
          label: 'Why should you be unbanned?',
          placeholder: 'Explain why you deserve a second chance',
          style: 'paragraph',
          minLength: 50,
          maxLength: 1000,
          required: true
        },
        changesField: {
          label: 'What will you do differently?',
          placeholder: 'How will you ensure this doesn\'t happen again?',
          style: 'paragraph',
          minLength: 30,
          maxLength: 500,
          required: true
        },
        additionalField: {
          label: 'Additional information',
          placeholder: 'Any other information you\'d like to add (optional)',
          style: 'paragraph',
          minLength: 0,
          maxLength: 500,
          required: false
        }
      },
      
      // Cooldowns
      appealCooldown: appealConfig.appealCooldown || 604800000, // 7 days in ms
      maxAppeals: appealConfig.maxAppeals || 3, // Max appeals per user
      
      // Notifications
      notifyRole: appealConfig.notifyRole || null, // Role to ping for new appeals
      
      // Auto responses
      autoResponses: {
        submitted: appealConfig.autoResponses?.submitted || 'Your appeal has been submitted successfully. You will be notified when a decision is made.',
        cooldown: appealConfig.autoResponses?.cooldown || 'You must wait {time} before submitting another appeal.',
        maxReached: appealConfig.autoResponses?.maxReached || 'You have reached the maximum number of appeals allowed.',
        error: appealConfig.autoResponses?.error || 'An error occurred while submitting your appeal. Please try again later.'
      },
      
      // Logging
      logChannel: appealConfig.logChannel || null,
      enableLogging: appealConfig.enableLogging ?? true
    };

    // Appeal tracking
    this.appeals = new Map(); // userId -> appeal data
    this.pendingAppeals = new Map(); // messageId -> appeal data
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadAppealData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Load appeal data from file
   */
  loadAppealData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.appeals = new Map(Object.entries(data.appeals || {}));
        console.log(`[BanAppealSystem] Loaded ${this.appeals.size} user appeal records`);
      }
    } catch (error) {
      console.error('[BanAppealSystem] Error loading appeal data:', error);
    }
  }

  /**
   * Save appeal data to file
   */
  saveAppealData() {
    try {
      const data = {
        appeals: Object.fromEntries(this.appeals)
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[BanAppealSystem] Error saving appeal data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for guild bans
    this.client.on('guildBanAdd', async (ban) => {
      if (!this.config.dmMessage.enabled) return;
      
      // Wait a bit before sending DM
      setTimeout(async () => {
        await this.sendBanAppealDM(ban);
      }, this.config.dmMessage.delay);
    });
  }

  /**
   * Send ban appeal DM to user
   * @param {import("discord.js").GuildBan} ban
   */
  async sendBanAppealDM(ban) {
    try {
      const embed = new EmbedBuilder()
        .setTitle(this.config.dmMessage.embedTitle)
        .setDescription(
          this.config.dmMessage.content.replace('{server}', ban.guild.name) + '\n\n' +
          this.config.dmMessage.embedDescription
        )
        .setColor(this.config.dmMessage.embedColor)
        .setFooter({ text: ban.guild.name, iconURL: ban.guild.iconURL() })
        .setTimestamp();

      const button = new ButtonBuilder()
        .setCustomId(`appeal_start_${ban.guild.id}_${ban.user.id}`)
        .setLabel(this.config.dmMessage.buttonLabel)
        .setEmoji(this.config.dmMessage.buttonEmoji)
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await ban.user.send({
        embeds: [embed],
        components: [row]
      });

      // Log DM sent
      if (this.config.enableLogging) {
        await this.logAction(ban.guild, {
          action: 'Appeal DM Sent',
          user: ban.user,
          reason: ban.reason || 'No reason provided'
        });
      }
    } catch (error) {
      console.error(`[BanAppealSystem] Failed to DM ${ban.user.tag}:`, error);
      
      // Log failure
      if (this.config.enableLogging) {
        await this.logAction(ban.guild, {
          action: 'Appeal DM Failed',
          user: ban.user,
          error: 'Could not send DM (user may have DMs disabled)'
        });
      }
    }
  }

  /**
   * Handle button interactions
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async handleButtonInteraction(interaction) {
    if (!interaction.customId.startsWith('appeal_')) return;

    const [, action, ...params] = interaction.customId.split('_');

    switch (action) {
      case 'start':
        await this.handleAppealStart(interaction, params);
        break;
      case 'approve':
        await this.handleAppealDecision(interaction, 'approved', params);
        break;
      case 'deny':
        await this.handleAppealDecision(interaction, 'denied', params);
        break;
    }
  }

  /**
   * Handle appeal start button
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {string[]} params
   */
  async handleAppealStart(interaction, params) {
    const [guildId, userId] = params;
    
    // Check if user can submit appeal
    const canSubmit = await this.canSubmitAppeal(userId, guildId);
    
    if (!canSubmit.allowed) {
      return interaction.reply({
        content: canSubmit.reason,
        ephemeral: true
      });
    }

    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(`appeal_modal_${guildId}_${userId}`)
      .setTitle('Ban Appeal Form');

    // Add form fields
    const fields = [];
    
    // Reason field
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel(this.config.appealForm.reasonField.label)
      .setPlaceholder(this.config.appealForm.reasonField.placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(this.config.appealForm.reasonField.minLength)
      .setMaxLength(this.config.appealForm.reasonField.maxLength)
      .setRequired(this.config.appealForm.reasonField.required);
    
    fields.push(new ActionRowBuilder().addComponents(reasonInput));

    // Explanation field
    const explanationInput = new TextInputBuilder()
      .setCustomId('explanation')
      .setLabel(this.config.appealForm.explanationField.label)
      .setPlaceholder(this.config.appealForm.explanationField.placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(this.config.appealForm.explanationField.minLength)
      .setMaxLength(this.config.appealForm.explanationField.maxLength)
      .setRequired(this.config.appealForm.explanationField.required);
    
    fields.push(new ActionRowBuilder().addComponents(explanationInput));

    // Changes field
    const changesInput = new TextInputBuilder()
      .setCustomId('changes')
      .setLabel(this.config.appealForm.changesField.label)
      .setPlaceholder(this.config.appealForm.changesField.placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(this.config.appealForm.changesField.minLength)
      .setMaxLength(this.config.appealForm.changesField.maxLength)
      .setRequired(this.config.appealForm.changesField.required);
    
    fields.push(new ActionRowBuilder().addComponents(changesInput));

    // Additional field
    const additionalInput = new TextInputBuilder()
      .setCustomId('additional')
      .setLabel(this.config.appealForm.additionalField.label)
      .setPlaceholder(this.config.appealForm.additionalField.placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(this.config.appealForm.additionalField.minLength)
      .setMaxLength(this.config.appealForm.additionalField.maxLength)
      .setRequired(this.config.appealForm.additionalField.required);
    
    fields.push(new ActionRowBuilder().addComponents(additionalInput));

    modal.addComponents(...fields);

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submission
   * @param {import("discord.js").ModalSubmitInteraction} interaction
   */
  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith('appeal_modal_')) return;

    const [, , guildId, userId] = interaction.customId.split('_');

    await interaction.deferReply({ ephemeral: true });

    try {
      // Get form data
      const appealData = {
        userId: userId,
        guildId: guildId,
        username: interaction.user.username,
        userTag: interaction.user.tag,
        reason: interaction.fields.getTextInputValue('reason'),
        explanation: interaction.fields.getTextInputValue('explanation'),
        changes: interaction.fields.getTextInputValue('changes'),
        additional: interaction.fields.getTextInputValue('additional') || 'None',
        submittedAt: new Date().toISOString(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null
      };

      // Submit appeal
      const result = await this.submitAppeal(appealData);

      if (result.success) {
        await interaction.editReply({
          content: this.config.autoResponses.submitted
        });
      } else {
        await interaction.editReply({
          content: this.config.autoResponses.error
        });
      }
    } catch (error) {
      console.error('[BanAppealSystem] Error handling modal submit:', error);
      await interaction.editReply({
        content: this.config.autoResponses.error
      });
    }
  }

  /**
   * Check if user can submit appeal
   * @param {string} userId
   * @param {string} guildId
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async canSubmitAppeal(userId, guildId) {
    const userAppeals = this.appeals.get(userId) || {};
    const guildAppeals = userAppeals[guildId] || [];

    // Check max appeals
    if (guildAppeals.length >= this.config.maxAppeals) {
      return {
        allowed: false,
        reason: this.config.autoResponses.maxReached
      };
    }

    // Check cooldown
    if (guildAppeals.length > 0) {
      const lastAppeal = guildAppeals[guildAppeals.length - 1];
      const timeSinceLastAppeal = Date.now() - new Date(lastAppeal.submittedAt).getTime();
      
      if (timeSinceLastAppeal < this.config.appealCooldown) {
        const timeLeft = this.config.appealCooldown - timeSinceLastAppeal;
        const days = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
        
        return {
          allowed: false,
          reason: this.config.autoResponses.cooldown.replace('{time}', `${days} day${days > 1 ? 's' : ''}`)
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Submit appeal
   * @param {Object} appealData
   * @returns {Promise<{success: boolean}>}
   */
  async submitAppeal(appealData) {
    try {
      // Save appeal
      const userAppeals = this.appeals.get(appealData.userId) || {};
      const guildAppeals = userAppeals[appealData.guildId] || [];
      
      guildAppeals.push(appealData);
      userAppeals[appealData.guildId] = guildAppeals;
      this.appeals.set(appealData.userId, userAppeals);
      
      this.saveAppealData();

      // Send to appeal channel
      const guild = this.client.guilds.cache.get(appealData.guildId);
      if (!guild || !this.config.appealChannel) {
        return { success: false };
      }

      const channel = guild.channels.cache.get(this.config.appealChannel);
      if (!channel?.isTextBased()) {
        return { success: false };
      }

      // Create appeal embed
      const embed = new EmbedBuilder()
        .setTitle('📝 New Ban Appeal')
        .setDescription(`Appeal from **${appealData.userTag}** (${appealData.userId})`)
        .setColor(0x0099ff)
        .addFields(
          { name: 'Why were you banned?', value: appealData.reason, inline: false },
          { name: 'Why should you be unbanned?', value: appealData.explanation, inline: false },
          { name: 'What will you do differently?', value: appealData.changes, inline: false },
          { name: 'Additional Information', value: appealData.additional, inline: false },
          { name: 'Submitted', value: `<t:${Math.floor(new Date(appealData.submittedAt).getTime() / 1000)}:F>`, inline: true },
          { name: 'Appeal #', value: `${guildAppeals.length}/${this.config.maxAppeals}`, inline: true }
        )
        .setTimestamp();

      // Add decision buttons
      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`appeal_approve_${appealData.userId}_${Date.now()}`)
            .setLabel('Approve')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`appeal_deny_${appealData.userId}_${Date.now()}`)
            .setLabel('Deny')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
        );

      const message = await channel.send({
        content: this.config.notifyRole ? `<@&${this.config.notifyRole}>` : undefined,
        embeds: [embed],
        components: [buttons]
      });

      // Track pending appeal
      this.pendingAppeals.set(message.id, appealData);

      // Log appeal submission
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Appeal Submitted',
          userId: appealData.userId,
          appealNumber: guildAppeals.length
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[BanAppealSystem] Error submitting appeal:', error);
      return { success: false };
    }
  }

  /**
   * Handle appeal decision
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {string} decision
   * @param {string[]} params
   */
  async handleAppealDecision(interaction, decision, params) {
    const [userId] = params;
    
    // Check permissions
    if (!interaction.member.permissions.has('BanMembers')) {
      return interaction.reply({
        content: '❌ You need Ban Members permission to review appeals.',
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    try {
      const appealData = this.pendingAppeals.get(interaction.message.id);
      if (!appealData) {
        return interaction.followUp({
          content: '❌ Appeal data not found.',
          ephemeral: true
        });
      }

      // Update appeal status
      const userAppeals = this.appeals.get(userId) || {};
      const guildAppeals = userAppeals[appealData.guildId] || [];
      const appeal = guildAppeals.find(a => a.submittedAt === appealData.submittedAt);
      
      if (appeal) {
        appeal.status = decision;
        appeal.reviewedBy = interaction.user.id;
        appeal.reviewedAt = new Date().toISOString();
        this.saveAppealData();
      }

      // Update embed
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(decision === 'approved' ? 0x00ff00 : 0xff0000)
        .addFields(
          { name: 'Status', value: decision === 'approved' ? '✅ Approved' : '❌ Denied', inline: true },
          { name: 'Reviewed By', value: `${interaction.user.tag}`, inline: true },
          { name: 'Reviewed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        );

      await interaction.message.edit({
        embeds: [embed],
        components: [] // Remove buttons
      });

      // Handle approval
      if (decision === 'approved') {
        try {
          const guild = interaction.guild;
          await guild.bans.remove(userId, `Appeal approved by ${interaction.user.tag}`);
          
          // Notify user
          try {
            const user = await this.client.users.fetch(userId);
            await user.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('✅ Appeal Approved')
                  .setDescription(`Your ban appeal for **${guild.name}** has been approved! You can now rejoin the server.`)
                  .setColor(0x00ff00)
                  .setTimestamp()
              ]
            });
          } catch (error) {
            console.error('[BanAppealSystem] Could not DM user about approval:', error);
          }
        } catch (error) {
          await interaction.followUp({
            content: `⚠️ Appeal marked as approved but could not unban user: ${error.message}`,
            ephemeral: true
          });
        }
      } else {
        // Notify user of denial
        try {
          const user = await this.client.users.fetch(userId);
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('❌ Appeal Denied')
                .setDescription(`Your ban appeal for **${interaction.guild.name}** has been denied. You may submit another appeal after the cooldown period.`)
                .setColor(0xff0000)
                .setTimestamp()
            ]
          });
        } catch (error) {
          console.error('[BanAppealSystem] Could not DM user about denial:', error);
        }
      }

      // Clean up pending appeal
      this.pendingAppeals.delete(interaction.message.id);

      // Log decision
      if (this.config.enableLogging) {
        await this.logAction(interaction.guild, {
          action: `Appeal ${decision}`,
          userId: userId,
          moderator: interaction.user
        });
      }
    } catch (error) {
      console.error('[BanAppealSystem] Error handling appeal decision:', error);
      await interaction.followUp({
        content: '❌ An error occurred while processing the appeal.',
        ephemeral: true
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
      .setTitle(`Ban Appeal System: ${data.action}`)
      .setColor(data.action.includes('Approved') ? 0x00ff00 : data.action.includes('Denied') ? 0xff0000 : 0x0099ff)
      .setTimestamp();

    if (data.user) {
      embed.addFields({
        name: 'User',
        value: `${data.user.tag} (${data.user.id})`,
        inline: true
      });
    } else if (data.userId) {
      embed.addFields({
        name: 'User ID',
        value: data.userId,
        inline: true
      });
    }

    if (data.moderator) {
      embed.addFields({
        name: 'Moderator',
        value: `${data.moderator.tag} (${data.moderator.id})`,
        inline: true
      });
    }

    if (data.reason) {
      embed.addFields({
        name: 'Ban Reason',
        value: data.reason,
        inline: false
      });
    }

    if (data.appealNumber) {
      embed.addFields({
        name: 'Appeal Number',
        value: `${data.appealNumber}`,
        inline: true
      });
    }

    if (data.error) {
      embed.addFields({
        name: 'Error',
        value: data.error,
        inline: false
      });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[BanAppealSystem] Failed to log action:', error);
    }
  }

  /**
   * Get user appeals
   * @param {string} userId
   * @param {string} guildId
   * @returns {Array}
   */
  getUserAppeals(userId, guildId) {
    const userAppeals = this.appeals.get(userId) || {};
    return userAppeals[guildId] || [];
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('banAppeal', this.config);
    return this.configLoader.save();
  }
}