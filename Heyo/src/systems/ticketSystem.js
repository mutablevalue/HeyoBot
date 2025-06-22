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
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = null;
    
    // Get ticket config from config loader
    this.config = this.configLoader.get('ticketSystem') || {};
    
    // Active tickets tracking
    this.activeTickets = new Map(); // channelId -> ticket data
    this.userTickets = new Map(); // userId -> Set of channelIds
    this.ticketPanels = new Map(); // messageId -> panel data
    
    // Reaction queue for processing
    this.reactionQueue = [];
    this.processingQueue = false;
    
    // Store interval reference for cleanup
    this.inactiveCheckInterval = null;
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile || 'tickets.json');
    this.loadTicketData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
      
      // Setup inactive ticket checking
      if (this.config.autoCloseInactiveDays > 0) {
        this.setupInactiveCheck();
      }
    }
  }

  /**
   * Set embed loader reference
   */
  setEmbedLoader(embedLoader) {
    this.embedLoader = embedLoader;
  }

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
        
        // Restore stats
        if (data.stats) {
          this.config.stats = { ...this.config.stats, ...data.stats };
        }
        
        console.log(`[TicketSystem] Loaded ${this.activeTickets.size} active tickets`);
      }
    } catch (error) {
      console.error('[TicketSystem] Error loading ticket data:', error);
    }
  }

  saveTicketData() {
    try {
      const data = {
        activeTickets: Object.fromEntries(this.activeTickets),
        userTickets: Object.fromEntries(
          Array.from(this.userTickets.entries()).map(([k, v]) => [k, Array.from(v)])
        ),
        ticketPanels: Object.fromEntries(this.ticketPanels),
        stats: this.config.stats
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

  setupEventListeners() {
    // Listen for button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      
      // Handle ticket creation
      if (interaction.customId === 'ticket_create_category' || interaction.customId.startsWith('ticket_create_')) {
        await this.handleTicketCreate(interaction);
      }
      
      // Handle ticket actions
      else if (interaction.customId.startsWith('ticket_')) {
        await this.handleTicketAction(interaction);
      }
    });

    // Listen for reactions for emoji panels
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      // Handle partial reactions
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          console.error('[TicketSystem] Error fetching reaction:', error);
          return;
        }
      }
      
      // Check if this is a ticket panel
      const panel = this.ticketPanels.get(reaction.message.id);
      if (!panel || panel.type !== 'emoji') return;
      
      // Check if it's the correct emoji
      if (reaction.emoji.toString() !== panel.emoji) {
        // Remove incorrect reactions
        await reaction.users.remove(user.id).catch(() => {});
        return;
      }
      
      // Add to queue
      this.reactionQueue.push({
        reaction,
        user,
        panel,
        timestamp: Date.now()
      });
      
      // Process queue
      this.processReactionQueue();
    });

    // Clean up on channel delete
    this.client.on('channelDelete', (channel) => {
      if (this.activeTickets.has(channel.id)) {
        this.closeTicket(channel.id, null, 'Channel deleted');
      }
    });
  }

  /**
   * Process reaction queue
   */
  async processReactionQueue() {
    if (this.processingQueue || this.reactionQueue.length === 0) return;
    
    this.processingQueue = true;
    
    while (this.reactionQueue.length > 0) {
      const item = this.reactionQueue.shift();
      
      try {
        // Remove the reaction immediately
        await item.reaction.users.remove(item.user.id).catch(() => {});
        
        // Process ticket creation
        await this.handleEmojiTicketCreate(item.reaction, item.user, item.panel);
        
        // Small delay to prevent rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('[TicketSystem] Error processing reaction:', error);
      }
    }
    
    this.processingQueue = false;
  }

  /**
   * Handle emoji ticket creation
   */
  async handleEmojiTicketCreate(reaction, user, panel) {
    try {
      // Check if embed loader is set
      if (!this.embedLoader) {
        console.error('[TicketSystem] Embed loader not initialized for emoji ticket creation');
        return;
      }

      // Check if system is properly configured
      if (!this.config.categories || this.config.categories.length === 0) {
        try {
          await user.send({
            content: this.embedLoader.format('Ticket system is not properly configured. Please contact an administrator.', 'message')
          });
        } catch (error) {
          console.error('[TicketSystem] Could not DM user:', error);
        }
        return;
      }

      // Check if max active tickets reached
      if (this.config.maxActiveTickets && this.activeTickets.size >= this.config.maxActiveTickets) {
        try {
          await user.send({
            content: this.embedLoader.format('The ticket system has reached its maximum capacity. Please try again later.', 'message')
          });
        } catch (error) {
          console.error('[TicketSystem] Could not DM user:', error);
        }
        return;
      }

      // Get guild and member
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      // Check user ticket limit
      const userTickets = this.userTickets.get(user.id) || new Set();
      const activeUserTickets = Array.from(userTickets).filter(id => 
        this.activeTickets.has(id)
      );

      if (activeUserTickets.length >= this.config.maxTicketsPerUser) {
        try {
          await user.send({
            content: this.embedLoader.format(
              this.config.messages.maxTicketsReached.replace('{max}', this.config.maxTicketsPerUser),
              'message'
            )
          });
        } catch (error) {
          console.error('[TicketSystem] Could not DM user:', error);
        }
        return;
      }

      // Check cooldown
      const lastTicket = Array.from(this.activeTickets.values())
        .filter(t => t.userId === user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

      if (lastTicket) {
        const timeSince = Date.now() - new Date(lastTicket.createdAt).getTime();
        if (timeSince < this.config.cooldown) {
          const timeLeft = Math.ceil((this.config.cooldown - timeSince) / 1000);
          try {
            await user.send({
              content: this.embedLoader.format(
                this.config.messages.cooldownActive.replace('{time}', timeLeft),
                'message'
              )
            });
          } catch (error) {
            console.error('[TicketSystem] Could not DM user:', error);
          }
          return;
        }
      }

      // Get category (use specified or first available)
      let category;
      if (panel.categoryId) {
        category = this.config.categories.find(c => c.id === panel.categoryId);
      } else if (panel.categories && panel.categories.length === 1) {
        category = this.config.categories.find(c => c.id === panel.categories[0]);
      } else {
        category = this.config.categories[0];
      }

      if (!category) {
        console.error('[TicketSystem] No valid category found for ticket creation');
        return;
      }

      // Create ticket
      const ticket = await this.createTicket(guild, user, category);
      
      // Send DM notification
      try {
        await user.send({
          content: this.embedLoader.format(
            this.config.messages.ticketCreated.replace('{channel}', ticket.channel),
            'message'
          )
        });
      } catch (error) {
        console.error('[TicketSystem] Could not DM user:', error);
      }
    } catch (error) {
      console.error('[TicketSystem] Error creating ticket from emoji:', error);
      try {
        await user.send({
          content: this.embedLoader.format(this.config.messages.errorCreating, 'message')
        });
      } catch (dmError) {
        console.error('[TicketSystem] Could not DM user:', dmError);
      }
    }
  }

  setupInactiveCheck() {
    // Clear any existing interval
    if (this.inactiveCheckInterval) {
      clearInterval(this.inactiveCheckInterval);
    }

    // Check every 6 hours
    this.inactiveCheckInterval = setInterval(async () => {
      const now = Date.now();
      const maxInactiveMs = this.config.autoCloseInactiveDays * 24 * 60 * 60 * 1000;

      for (const [channelId, ticket] of this.activeTickets) {
        if (ticket.status === 'closed') continue;

        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            await this.deleteTicket(channelId);
            continue;
          }

          // Get last message time
          const messages = await channel.messages.fetch({ limit: 1 });
          const lastMessage = messages.first();
          const lastActivity = lastMessage ? lastMessage.createdTimestamp : new Date(ticket.createdAt).getTime();

          if (now - lastActivity > maxInactiveMs) {
            // Close inactive ticket
            await this.closeTicket(channelId, this.client.user.id, 'Inactivity');
            
            // Send notification
            if (this.embedLoader) {
              const inactiveEmbed = this.embedLoader.createEmbed({
                description: `This ticket has been automatically closed after ${this.config.autoCloseInactiveDays} days of inactivity.`
              });

              await channel.send({ embeds: [inactiveEmbed] });
            }

            // Schedule deletion
            if (this.config.autoDelete.enabled) {
              setTimeout(() => {
                this.deleteTicket(channelId);
              }, this.config.autoDelete.timeout);
            }
          }
        } catch (error) {
          console.error('[TicketSystem] Error checking inactive ticket:', error);
        }
      }
    }, 6 * 60 * 60 * 1000); // 6 hours
  }

  async createTicketPanel(channel, options = {}) {
    const categories = options.categories || this.config.categories;
    
    if (!categories || categories.length === 0) {
      throw new Error('No ticket categories configured');
    }

    if (!this.embedLoader) {
      throw new Error('Embed loader not initialized. Please ensure setEmbedLoader() is called during bot initialization.');
    }

    // Create embed with custom or default content
    const embedOptions = {
      formatDescription: false
    };

    if (options.title) embedOptions.title = options.title;
    if (options.description) embedOptions.description = options.description;
    if (options.footer) embedOptions.footer = options.footer;
    if (options.color) embedOptions.color = options.color;

    // If no custom content provided, use defaults
    if (!embedOptions.title && !embedOptions.description) {
      embedOptions.title = this.config.panelEmbed.title;
      embedOptions.description = this.config.panelEmbed.description;
      embedOptions.footer = this.config.panelEmbed.footer;
    }

    const embed = this.embedLoader.createEmbed(embedOptions);

    let message;
    const panelType = options.type || 'button';
    
    if (panelType === 'emoji') {
      const emoji = options.emoji || '🎫';
      
      // Send message without components for emoji reaction
      message = await channel.send({ embeds: [embed] });
      
      // Add reaction
      await message.react(emoji);
      
      // Save panel data with emoji type
      this.ticketPanels.set(message.id, {
        channelId: channel.id,
        type: 'emoji',
        emoji: emoji,
        categories: categories.map(c => c.id),
        categoryId: categories.length === 1 ? categories[0].id : null,
        createdAt: new Date().toISOString()
      });
    } else {
      // Create button/select menu panel
      const components = [];
      
      if (categories.length > 1) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_create_category')
          .setPlaceholder('Select a ticket category')
          .addOptions(
            categories.map(cat => ({
              label: cat.name,
              description: cat.description,
              value: cat.id
            }))
          );
        
        components.push(new ActionRowBuilder().addComponents(selectMenu));
      } else {
        const button = new ButtonBuilder()
          .setCustomId(`ticket_create_${categories[0].id}`)
          .setLabel(options.buttonLabel || this.config.panelEmbed.buttonLabel)
          .setStyle(ButtonStyle.Primary);
        
        if (options.buttonEmoji) {
          button.setEmoji(options.buttonEmoji);
        }
        
        components.push(new ActionRowBuilder().addComponents(button));
      }
      
      message = await channel.send({ embeds: [embed], components });
      
      // Save panel data with button type
      this.ticketPanels.set(message.id, {
        channelId: channel.id,
        type: 'button',
        categories: categories.map(c => c.id),
        createdAt: new Date().toISOString()
      });
    }

    this.saveTicketData();
    
    return message;
  }

  async handleTicketCreate(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Check if embed loader is set
    if (!this.embedLoader) {
      return interaction.editReply({
        content: 'System error: Embed loader not initialized. Please contact an administrator.'
      });
    }

    // Check if system is properly configured
    if (!this.config.categories || this.config.categories.length === 0) {
      return interaction.editReply({
        content: this.embedLoader.format('Ticket system is not properly configured. Please contact an administrator.', 'message')
      });
    }

    // Check if max active tickets reached
    if (this.config.maxActiveTickets && this.activeTickets.size >= this.config.maxActiveTickets) {
      return interaction.editReply({
        content: this.embedLoader.format('The ticket system has reached its maximum capacity. Please try again later.', 'message')
      });
    }

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
        content: this.embedLoader.format('Invalid ticket category.', 'message')
      });
    }

    // Check user ticket limit
    const userTickets = this.userTickets.get(interaction.user.id) || new Set();
    const activeUserTickets = Array.from(userTickets).filter(id => 
      this.activeTickets.has(id)
    );

    if (activeUserTickets.length >= this.config.maxTicketsPerUser) {
      return interaction.editReply({
        content: this.embedLoader.format(
          this.config.messages.maxTicketsReached.replace('{max}', this.config.maxTicketsPerUser),
          'message'
        )
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
          content: this.embedLoader.format(
            this.config.messages.cooldownActive.replace('{time}', timeLeft),
            'message'
          )
        });
      }
    }

    // Create ticket
    try {
      const ticket = await this.createTicket(interaction.guild, interaction.user, category);
      
      await interaction.editReply({
        content: this.embedLoader.format(
          this.config.messages.ticketCreated.replace('{channel}', ticket.channel),
          'message'
        )
      });
    } catch (error) {
      console.error('[TicketSystem] Error creating ticket:', error);
      await interaction.editReply({
        content: this.embedLoader.format(this.config.messages.errorCreating, 'message')
      });
    }
  }

  async createTicket(guild, user, category) {
    // Generate ticket number
    this.config.stats.totalTickets++;
    const ticketNumber = String(this.config.stats.totalTickets).padStart(4, '0');
    
    // Create channel name
    const channelName = this.config.channelNameFormat
      .replace('{number}', ticketNumber)
      .replace('{username}', user.username.toLowerCase().replace(/[^a-z0-9-]/g, ''))
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
      const role = guild.roles.cache.get(category.supportRole);
      if (role) {
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
    }

    // Set parent category
    const parentCategory = category.categoryId || this.config.defaultCategoryId;
    if (parentCategory) {
      const categoryChannel = guild.channels.cache.get(parentCategory);
      if (categoryChannel && categoryChannel.type === ChannelType.GuildCategory) {
        channelOptions.parent = parentCategory;
      }
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
    if (this.embedLoader) {
      const welcomeEmbed = this.embedLoader.createEmbed({
        title: 'Ticket System',
        description: category.welcomeMessage || this.config.welcomeMessage,
        fields: [
          { name: 'Category', value: category.name, inline: true },
          { name: 'Created by', value: `${user}`, inline: true }
        ],
        formatDescription: false
      });

      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel(this.config.buttons.close.label)
            .setStyle(ButtonStyle[this.config.buttons.close.style]),
          new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel(this.config.buttons.claim.label)
            .setStyle(ButtonStyle[this.config.buttons.claim.style])
        );

      const pingContent = [];
      if (this.config.notifications.pingSupport && category.supportRole) {
        pingContent.push(`<@&${category.supportRole}>`);
      }
      if (this.config.notifications.pingUser) {
        pingContent.push(`${user}`);
      }

      await channel.send({
        content: pingContent.join(' ') || null,
        embeds: [welcomeEmbed],
        components: [actionRow]
      });
    }

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

  async handleTicketAction(interaction) {
    // Skip setup-related buttons
    if (interaction.customId.startsWith('ticket_confirm_delete_') || 
        interaction.customId === 'ticket_cancel_delete') {
      return;
    }

    // Check if interaction has a channel (it should for button interactions in channels)
    if (!interaction.channel) {
      return interaction.reply({
        content: this.embedLoader.format('Invalid interaction context.', 'message'),
        ephemeral: true
      });
    }

    const ticket = this.activeTickets.get(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({
        content: this.embedLoader.format('This is not a valid ticket channel.', 'message'),
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

  async handleClose(interaction, ticket) {
    // Check permissions
    const category = this.config.categories.find(c => c.id === ticket.category);
    const canClose = (this.config.closeOwnTicket && interaction.user.id === ticket.userId) ||
                    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                    (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

    if (!canClose) {
      return interaction.reply({
        content: this.embedLoader.format(
          this.config.messages.noPermission.replace('{action}', 'close'),
          'message'
        ),
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
    const closedEmbed = this.embedLoader.createEmbed({
      description: this.config.messages.ticketClosed.replace('{user}', interaction.user)
    });

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_delete')
          .setLabel(this.config.buttons.delete.label)
          .setStyle(ButtonStyle[this.config.buttons.delete.style]),
        new ButtonBuilder()
          .setCustomId('ticket_transcript')
          .setLabel(this.config.buttons.transcript.label)
          .setStyle(ButtonStyle[this.config.buttons.transcript.style])
      );

    await interaction.editReply({
      embeds: [closedEmbed],
      components: [actionRow]
    });

    // Schedule auto-delete
    if (this.config.autoDelete.enabled) {
      const channelId = interaction.channel.id;
      setTimeout(async () => {
        if (this.activeTickets.has(channelId)) {
          await this.deleteTicket(channelId);
        }
      }, this.config.autoDelete.timeout);
    }

    this.saveTicketData();

    // Log action
    if (this.config.enableLogging && this.config.logActions.includes('close')) {
      await this.logAction(interaction.guild, {
        action: 'Ticket Closed',
        ticket: ticket,
        closedBy: interaction.user
      });
    }
  }

  async handleClaim(interaction, ticket) {
    // Check if user is support
    const category = this.config.categories.find(c => c.id === ticket.category);
    const canClaim = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                    (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

    if (!canClaim) {
      return interaction.reply({
        content: this.embedLoader.format(
          this.config.messages.noPermission.replace('{action}', 'claim'),
          'message'
        ),
        ephemeral: true
      });
    }

    if (ticket.claimed) {
      return interaction.reply({
        content: this.embedLoader.format(
          `This ticket is already claimed by <@${ticket.claimedBy}>.`,
          'message'
        ),
        ephemeral: true
      });
    }

    // Claim ticket
    ticket.claimed = true;
    ticket.claimedBy = interaction.user.id;
    this.saveTicketData();

    const message = this.config.messages.ticketClaimed.replace('{user}', interaction.user);
    await interaction.reply({
      content: this.embedLoader.format(message, 'message')
    });

    // Log action
    if (this.config.enableLogging && this.config.logActions.includes('claim')) {
      await this.logAction(interaction.guild, {
        action: 'Ticket Claimed',
        ticket: ticket,
        claimedBy: interaction.user
      });
    }
  }

  async handleDelete(interaction, ticket) {
    // Check permissions
    const canDelete = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (!canDelete) {
      return interaction.reply({
        content: this.embedLoader.format(
          this.config.messages.noPermission.replace('{action}', 'delete'),
          'message'
        ),
        ephemeral: true
      });
    }

    const deleteDelay = 5; // seconds
    const channelId = interaction.channel.id; // Capture channel ID before timeout
    
    await interaction.reply({
      content: this.embedLoader.format(
        this.config.messages.ticketDeleting.replace('{seconds}', deleteDelay),
        'message'
      )
    });

    setTimeout(async () => {
      await this.deleteTicket(channelId);
    }, deleteDelay * 1000);
  }

  async handleTranscript(interaction, ticket) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const transcript = await this.generateTranscript(interaction.channel);
      
      // Save to transcript channel if configured
      if (this.config.transcriptChannel) {
        const transcriptChannel = interaction.guild.channels.cache.get(this.config.transcriptChannel);
        if (transcriptChannel && this.embedLoader) {
          const embed = this.embedLoader.createEmbed({
            title: 'Ticket System',
            description: `Ticket created by <@${ticket.userId}>`,
            fields: [
              { name: 'Category', value: this.config.categories.find(c => c.id === ticket.category)?.name || ticket.category, inline: true },
              { name: 'Created', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:F>`, inline: true },
              { name: 'Closed', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
            ]
          });

          await transcriptChannel.send({
            embeds: [embed],
            files: [{
              attachment: Buffer.from(transcript),
              name: `transcript-${ticket.id}.txt`
            }]
          });
        }
      }

      // DM transcript if enabled
      if (this.config.dmTranscripts) {
        try {
          const user = await this.client.users.fetch(ticket.userId);
          await user.send({
            content: this.embedLoader.format(`Here is the transcript of your ticket #${ticket.id}:`, 'message'),
            files: [{
              attachment: Buffer.from(transcript),
              name: `transcript-${ticket.id}.txt`
            }]
          });
        } catch (error) {
          console.error('[TicketSystem] Failed to DM transcript:', error);
        }
      }

      await interaction.editReply({
        content: this.embedLoader.format(this.config.messages.transcriptSaved, 'message'),
        files: [{
          attachment: Buffer.from(transcript),
          name: `transcript-${ticket.id}.txt`
        }]
      });
    } catch (error) {
      console.error('[TicketSystem] Error generating transcript:', error);
      await interaction.editReply({
        content: this.embedLoader.format(this.config.messages.errorTranscript, 'message')
      });
    }
  }

  async generateTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: Math.min(this.config.transcriptMessageLimit, 100) });
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
    this.config.stats.totalClosed = (this.config.stats.totalClosed || 0) + 1;

    this.saveTicketData();
  }

  closeTicket(channelId, closedBy, reason) {
    const ticket = this.activeTickets.get(channelId);
    if (!ticket) return;

    ticket.status = 'closed';
    ticket.closedAt = new Date().toISOString();
    ticket.closedBy = closedBy;
    ticket.closeReason = reason;

    this.saveTicketData();
  }

  async logAction(guild, data) {
    if (!this.config.enableLogging || !this.config.logChannel || !this.embedLoader) return;

    // Check if this action should be logged
    const actionType = data.action.toLowerCase().replace(/ticket\s+/i, '').replace(/\s+/g, '_');
    if (this.config.logActions && !this.config.logActions.some(a => actionType.includes(a))) {
      return;
    }

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const fields = [];

    if (data.ticket) {
      fields.push(
        { name: 'Ticket', value: `#${data.ticket.id}`, inline: true },
        { name: 'Channel', value: `<#${data.ticket.channelId}>`, inline: true }
      );
    }

    if (data.user) {
      fields.push({
        name: 'User',
        value: `${data.user.tag} (${data.user.id})`,
        inline: true
      });
    }

    if (data.category) {
      fields.push({
        name: 'Category',
        value: data.category,
        inline: true
      });
    }

    if (data.closedBy) {
      fields.push({
        name: 'Closed By',
        value: `${data.closedBy.tag} (${data.closedBy.id})`,
        inline: true
      });
    }

    if (data.claimedBy) {
      fields.push({
        name: 'Claimed By',
        value: `${data.claimedBy.tag} (${data.claimedBy.id})`,
        inline: true
      });
    }

    const embed = this.embedLoader.createEmbed({
      title: 'Ticket System',
      description: data.action,
      fields: fields
    });

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[TicketSystem] Failed to log action:', error);
    }
  }

  getStats() {
    const stats = this.config.stats || {};
    
    return {
      totalTickets: stats.totalTickets || 0,
      totalClosed: stats.totalClosed || 0,
      activeTickets: this.activeTickets.size,
      categoriesBreakdown: this.getCategoriesBreakdown()
    };
  }

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
   * Clean up resources
   */
  cleanup() {
    if (this.inactiveCheckInterval) {
      clearInterval(this.inactiveCheckInterval);
      this.inactiveCheckInterval = null;
    }
  }

  async saveConfig() {
    this.configLoader.set('ticketSystem', this.config);
    return this.configLoader.save();
  }
}