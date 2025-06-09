// src/systems/ticketSystem.js
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TicketSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get ticket config from config loader
    this.config = this.configLoader.get('ticketSystem');
    
    // Validate config
    if (!this.config) {
      throw new Error('[TicketSystem] Ticket configuration not found in config.yaml');
    }
    
    // Active tickets tracking
    this.activeTickets = new Map(); // channelId -> ticket data
    this.userTickets = new Map(); // userId -> Set of channelIds
    this.ticketPanels = new Map(); // messageId -> panel data
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadTicketData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Load ticket data from file
   */
  loadTicketData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        // Restore active tickets
        if (data.activeTickets) {
          this.activeTickets = new Map(Object.entries(data.activeTickets));
        }
        
        // Restore user tickets
        if (data.userTickets) {
          for (const [userId, tickets] of Object.entries(data.userTickets)) {
            this.userTickets.set(userId, new Set(tickets));
          }
        }
        
        // Restore ticket panels
        if (data.ticketPanels) {
          this.ticketPanels = new Map(Object.entries(data.ticketPanels));
        }
        
        console.log(`[TicketSystem] Loaded ${this.activeTickets.size} active tickets`);
      }
    } catch (error) {
      console.error('[TicketSystem] Error loading ticket data:', error);
    }
  }

  /**
   * Save ticket data to file
   */
  saveTicketData() {
    try {
      const data = {
        activeTickets: Object.fromEntries(this.activeTickets),
        userTickets: Object.fromEntries(
          Array.from(this.userTickets.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        ticketPanels: Object.fromEntries(this.ticketPanels),
        stats: {
          totalTickets: this.config.stats?.totalTickets || 0,
          totalClosed: this.config.stats?.totalClosed || 0,
          averageResponseTime: this.config.stats?.averageResponseTime || 0
        }
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[TicketSystem] Error saving ticket data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      
      // Handle ticket creation
      if (interaction.customId.startsWith('ticket_create_')) {
        await this.handleTicketCreate(interaction);
      }
      
      // Handle ticket actions
      else if (interaction.customId.startsWith('ticket_')) {
        await this.handleTicketAction(interaction);
      }
    });

    // Clean up on channel delete
    this.client.on('channelDelete', (channel) => {
      if (this.activeTickets.has(channel.id)) {
        this.closeTicket(channel.id, null, 'Channel deleted');
      }
    });
  }

  /**
   * Create a ticket panel
   * @param {import("discord.js").TextChannel} channel
   * @param {Object} options
   * @returns {Promise<import("discord.js").Message>}
   */
  async createTicketPanel(channel, options = {}) {
    const categories = options.categories || this.config.categories;
    
    const embed = new EmbedBuilder()
      .setTitle(options.title || this.config.panelEmbed.title)
      .setDescription(options.description || this.config.panelEmbed.description)
      .setColor(options.color || this.config.panelEmbed.color)
      .setFooter({ text: options.footer || this.config.panelEmbed.footer });

    const components = [];

    if (categories.length > 1) {
      // Create category select menu
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_create_category')
        .setPlaceholder('Select a ticket category')
        .addOptions(
          categories.map(cat => ({
            label: cat.name,
            description: cat.description,
            value: cat.id,
            emoji: cat.emoji
          }))
        );
      
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    } else {
      // Single category - just a button
      const button = new ButtonBuilder()
        .setCustomId(`ticket_create_${categories[0].id}`)
        .setLabel(options.buttonLabel || this.config.panelEmbed.buttonLabel)
        .setEmoji(options.buttonEmoji || this.config.panelEmbed.buttonEmoji)
        .setStyle(ButtonStyle.Primary);
      
      components.push(new ActionRowBuilder().addComponents(button));
    }

    const message = await channel.send({
      embeds: [embed],
      components
    });

    // Save panel data
    this.ticketPanels.set(message.id, {
      channelId: channel.id,
      categories: categories.map(c => c.id),
      createdAt: new Date().toISOString()
    });
    
    this.saveTicketData();
    
    return message;
  }

  /**
   * Handle ticket creation
   * @param {import("discord.js").ButtonInteraction|import("discord.js").StringSelectMenuInteraction} interaction
   */
  async handleTicketCreate(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Get category
    let categoryId;
    if (interaction.isStringSelectMenu()) {
      categoryId = interaction.values[0];
    } else {
      categoryId = interaction.customId.split('_')[2];
    }

    const category = this.config.categories.find(c => c.id === categoryId);
    if (!category) {
      return interaction.editReply({
        content: '❌ Invalid ticket category.'
      });
    }

    // Check user ticket limit
    const userTickets = this.userTickets.get(interaction.user.id) || new Set();
    const activeUserTickets = Array.from(userTickets).filter(id => 
      this.activeTickets.has(id)
    );

    if (activeUserTickets.length >= this.config.maxTicketsPerUser) {
      return interaction.editReply({
        content: `❌ You already have ${this.config.maxTicketsPerUser} open ticket(s). Please close one before creating another.`
      });
    }

    // Check cooldown
    const lastTicket = Array.from(this.activeTickets.values())
      .filter(t => t.userId === interaction.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (lastTicket) {
      const timeSince = Date.now() - new Date(lastTicket.createdAt).getTime();
      if (timeSince < this.config.cooldown) {
        const timeLeft = Math.ceil((this.config.cooldown - timeSince) / 1000);
        return interaction.editReply({
          content: `❌ Please wait ${timeLeft} seconds before creating another ticket.`
        });
      }
    }

    // Create ticket
    try {
      const ticket = await this.createTicket(interaction.guild, interaction.user, category);
      
      await interaction.editReply({
        content: `✅ Your ticket has been created: ${ticket.channel}`,
        ephemeral: true
      });
    } catch (error) {
      console.error('[TicketSystem] Error creating ticket:', error);
      await interaction.editReply({
        content: '❌ Failed to create ticket. Please try again later.'
      });
    }
  }

  /**
   * Create a ticket
   * @param {import("discord.js").Guild} guild
   * @param {import("discord.js").User} user
   * @param {Object} category
   * @returns {Promise<Object>}
   */
  async createTicket(guild, user, category) {
    // Generate ticket number
    this.config.stats = this.config.stats || { totalTickets: 0 };
    this.config.stats.totalTickets++;
    const ticketNumber = String(this.config.stats.totalTickets).padStart(4, '0');
    
    // Create channel name
    const channelName = this.config.channelNameFormat
      .replace('{number}', ticketNumber)
      .replace('{username}', user.username)
      .replace('{category}', category.name.toLowerCase().replace(/\s+/g, '-'));

    // Create channel
    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText,
      topic: `Ticket by ${user.tag} | Category: ${category.name}`,
      reason: `Ticket created by ${user.tag}`,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory
          ]
        },
        {
          id: this.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
        }
      ]
    };

    // Add support role permissions
    if (category.supportRole) {
      channelOptions.permissionOverwrites.push({
        id: category.supportRole,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    // Set parent category
    if (category.categoryId) {
      channelOptions.parent = category.categoryId;
    }

    const channel = await guild.channels.create(channelOptions);

    // Create ticket data
    const ticketData = {
      id: ticketNumber,
      channelId: channel.id,
      guildId: guild.id,
      userId: user.id,
      category: category.id,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null,
      closeReason: null,
      claimed: false,
      claimedBy: null,
      participants: [user.id]
    };

    // Save ticket data
    this.activeTickets.set(channel.id, ticketData);
    
    const userTicketSet = this.userTickets.get(user.id) || new Set();
    userTicketSet.add(channel.id);
    this.userTickets.set(user.id, userTicketSet);
    
    this.saveTicketData();

    // Send welcome message
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketNumber}`)
      .setDescription(category.welcomeMessage || this.config.welcomeMessage)
      .setColor(category.color || 0x0099ff)
      .addFields(
        { name: 'Category', value: category.name, inline: true },
        { name: 'Created by', value: `${user}`, inline: true }
      )
      .setTimestamp();

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close Ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('Claim Ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary)
      );

    await channel.send({
      content: category.supportRole ? `<@&${category.supportRole}> ${user}` : `${user}`,
      embeds: [welcomeEmbed],
      components: [actionRow]
    });

    // Log ticket creation
    if (this.config.enableLogging && this.config.logChannel) {
      await this.logAction(guild, {
        action: 'Ticket Created',
        ticket: ticketData,
        user: user,
        category: category.name
      });
    }

    return { channel, ticket: ticketData };
  }

  /**
   * Handle ticket actions
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async handleTicketAction(interaction) {
    const ticket = this.activeTickets.get(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({
        content: '❌ This is not a valid ticket channel.',
        ephemeral: true
      });
    }

    const action = interaction.customId.split('_')[1];

    switch (action) {
      case 'close':
        await this.handleClose(interaction, ticket);
        break;
      case 'claim':
        await this.handleClaim(interaction, ticket);
        break;
      case 'delete':
        await this.handleDelete(interaction, ticket);
        break;
      case 'transcript':
        await this.handleTranscript(interaction, ticket);
        break;
    }
  }

  /**
   * Handle ticket close
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} ticket
   */
  async handleClose(interaction, ticket) {
    // Check permissions
    const category = this.config.categories.find(c => c.id === ticket.category);
    const canClose = interaction.user.id === ticket.userId ||
                    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                    (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

    if (!canClose) {
      return interaction.reply({
        content: '❌ You do not have permission to close this ticket.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    // Update ticket status
    ticket.status = 'closed';
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = interaction.user.id;

    // Update channel permissions
    await interaction.channel.permissionOverwrites.edit(ticket.userId, {
      SendMessages: false
    });

    // Create closed embed
    const closedEmbed = new EmbedBuilder()
      .setTitle('🔒 Ticket Closed')
      .setDescription(`This ticket has been closed by ${interaction.user}.`)
      .setColor(0xff0000)
      .setTimestamp();

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_delete')
          .setLabel('Delete Ticket')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ticket_transcript')
          .setLabel('Save Transcript')
          .setEmoji('📄')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({
      embeds: [closedEmbed],
      components: [actionRow]
    });

    // Schedule auto-delete
    if (this.config.autoDelete.enabled) {
      setTimeout(() => {
        if (this.activeTickets.has(interaction.channel.id)) {
          this.deleteTicket(interaction.channel.id);
        }
      }, this.config.autoDelete.timeout);
    }

    this.saveTicketData();

    // Log action
    if (this.config.enableLogging) {
      await this.logAction(interaction.guild, {
        action: 'Ticket Closed',
        ticket: ticket,
        closedBy: interaction.user
      });
    }
  }

  /**
   * Handle ticket claim
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} ticket
   */
  async handleClaim(interaction, ticket) {
    // Check if user is support
    const category = this.config.categories.find(c => c.id === ticket.category);
    const canClaim = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                    (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

    if (!canClaim) {
      return interaction.reply({
        content: '❌ You do not have permission to claim tickets.',
        ephemeral: true
      });
    }

    if (ticket.claimed) {
      return interaction.reply({
        content: `❌ This ticket is already claimed by <@${ticket.claimedBy}>.`,
        ephemeral: true
      });
    }

    // Claim ticket
    ticket.claimed = true;
    ticket.claimedBy = interaction.user.id;
    this.saveTicketData();

    await interaction.reply({
      content: `🎫 ${interaction.user} has claimed this ticket.`
    });

    // Log action
    if (this.config.enableLogging) {
      await this.logAction(interaction.guild, {
        action: 'Ticket Claimed',
        ticket: ticket,
        claimedBy: interaction.user
      });
    }
  }

  /**
   * Handle ticket delete
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} ticket
   */
  async handleDelete(interaction, ticket) {
    // Check permissions
    const canDelete = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (!canDelete) {
      return interaction.reply({
        content: '❌ You do not have permission to delete tickets.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: '🗑️ Deleting ticket in 5 seconds...'
    });

    setTimeout(async () => {
      await this.deleteTicket(interaction.channel.id);
    }, 5000);
  }

  /**
   * Handle transcript save
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {Object} ticket
   */
  async handleTranscript(interaction, ticket) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const transcript = await this.generateTranscript(interaction.channel);
      
      // Save to transcript channel if configured
      if (this.config.transcriptChannel) {
        const transcriptChannel = interaction.guild.channels.cache.get(this.config.transcriptChannel);
        if (transcriptChannel) {
          const embed = new EmbedBuilder()
            .setTitle(`Transcript - Ticket #${ticket.id}`)
            .setDescription(`Ticket created by <@${ticket.userId}>`)
            .addFields(
              { name: 'Category', value: ticket.category, inline: true },
              { name: 'Created', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:F>`, inline: true },
              { name: 'Closed', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            )
            .setColor(0x0099ff)
            .setTimestamp();

          await transcriptChannel.send({
            embeds: [embed],
            files: [{
              attachment: Buffer.from(transcript),
              name: `transcript-${ticket.id}.txt`
            }]
          });
        }
      }

      await interaction.editReply({
        content: '✅ Transcript saved!',
        files: [{
          attachment: Buffer.from(transcript),
          name: `transcript-${ticket.id}.txt`
        }]
      });
    } catch (error) {
      console.error('[TicketSystem] Error generating transcript:', error);
      await interaction.editReply({
        content: '❌ Failed to generate transcript.'
      });
    }
  }

  /**
   * Generate ticket transcript
   * @param {import("discord.js").TextChannel} channel
   * @returns {Promise<string>}
   */
  async generateTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = [];
    
    transcript.push(`Ticket Transcript - ${channel.name}`);
    transcript.push(`Generated at: ${new Date().toISOString()}`);
    transcript.push('=' .repeat(50));
    transcript.push('');

    // Sort messages oldest first
    const sortedMessages = Array.from(messages.values()).reverse();

    for (const message of sortedMessages) {
      const timestamp = message.createdAt.toISOString();
      const author = `${message.author.tag} (${message.author.id})`;
      const content = message.content || '[No content]';
      
      transcript.push(`[${timestamp}] ${author}`);
      transcript.push(content);
      
      if (message.attachments.size > 0) {
        transcript.push('Attachments:');
        message.attachments.forEach(att => {
          transcript.push(`  - ${att.name} (${att.url})`);
        });
      }
      
      transcript.push('');
    }

    return transcript.join('\n');
  }

  /**
   * Delete a ticket
   * @param {string} channelId
   */
  async deleteTicket(channelId) {
    const ticket = this.activeTickets.get(channelId);
    if (!ticket) return;

    try {
      const channel = this.client.channels.cache.get(channelId);
      if (channel) {
        await channel.delete('Ticket deleted');
      }
    } catch (error) {
      console.error('[TicketSystem] Error deleting ticket channel:', error);
    }

    // Clean up data
    this.activeTickets.delete(channelId);
    const userTickets = this.userTickets.get(ticket.userId);
    if (userTickets) {
      userTickets.delete(channelId);
      if (userTickets.size === 0) {
        this.userTickets.delete(ticket.userId);
      }
    }

    // Update stats
    this.config.stats = this.config.stats || {};
    this.config.stats.totalClosed = (this.config.stats.totalClosed || 0) + 1;

    this.saveTicketData();
  }

  /**
   * Close a ticket
   * @param {string} channelId
   * @param {string} closedBy
   * @param {string} reason
   */
  closeTicket(channelId, closedBy, reason) {
    const ticket = this.activeTickets.get(channelId);
    if (!ticket) return;

    ticket.status = 'closed';
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = closedBy;
    ticket.closeReason = reason;

    this.saveTicketData();
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
      .setTitle(`Ticket System: ${data.action}`)
      .setColor(data.action.includes('Created') ? 0x00ff00 : 
                data.action.includes('Closed') ? 0xff0000 : 0x0099ff)
      .setTimestamp();

    if (data.ticket) {
      embed.addFields(
        { name: 'Ticket', value: `#${data.ticket.id}`, inline: true },
        { name: 'Channel', value: `<#${data.ticket.channelId}>`, inline: true }
      );
    }

    if (data.user) {
      embed.addFields({
        name: 'User',
        value: `${data.user.tag} (${data.user.id})`,
        inline: true
      });
    }

    if (data.category) {
      embed.addFields({
        name: 'Category',
        value: data.category,
        inline: true
      });
    }

    if (data.closedBy) {
      embed.addFields({
        name: 'Closed By',
        value: `${data.closedBy.tag} (${data.closedBy.id})`,
        inline: true
      });
    }

    if (data.claimedBy) {
      embed.addFields({
        name: 'Claimed By',
        value: `${data.claimedBy.tag} (${data.claimedBy.id})`,
        inline: true
      });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[TicketSystem] Failed to log action:', error);
    }
  }

  /**
   * Get ticket statistics
   */
  getStats() {
    const stats = this.config.stats || {};
    
    return {
      totalTickets: stats.totalTickets || 0,
      totalClosed: stats.totalClosed || 0,
      activeTickets: this.activeTickets.size,
      averageResponseTime: stats.averageResponseTime || 0,
      categoriesBreakdown: this.getCategoriesBreakdown()
    };
  }

  /**
   * Get categories breakdown
   */
  getCategoriesBreakdown() {
    const breakdown = {};
    
    for (const category of this.config.categories) {
      breakdown[category.id] = {
        name: category.name,
        active: 0,
        total: 0
      };
    }

    for (const ticket of this.activeTickets.values()) {
      if (breakdown[ticket.category]) {
        breakdown[ticket.category].active++;
        breakdown[ticket.category].total++;
      }
    }

    return breakdown;
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('ticketSystem', this.config);
    return this.configLoader.save();
  }
}