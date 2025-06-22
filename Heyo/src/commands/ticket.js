// src/commands/ticket.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';

let ticketSystem = null;

export function setTicketSystem(system) {
  ticketSystem = system;
}

export const ticketData = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage ticket system')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('Action to perform')
      .setRequired(true)
      .addChoices(
        { name: 'Setup System', value: 'setup' },
        { name: 'Create Panel', value: 'panel' },
        { name: 'Add Category', value: 'add_category' },
        { name: 'Remove Category', value: 'remove_category' },
        { name: 'List Categories', value: 'list_categories' },
        { name: 'Settings', value: 'settings' },
        { name: 'View Config', value: 'config' },
        { name: 'View Stats', value: 'stats' },
        { name: 'Enable/Disable', value: 'toggle' },
        { name: 'Close Ticket', value: 'close' },
        { name: 'Add User', value: 'add_user' },
        { name: 'Remove User', value: 'remove_user' }
      )
  )
  // Setup options
  .addChannelOption(option =>
    option
      .setName('category')
      .setDescription('Category where ticket channels will be created')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName('log_channel')
      .setDescription('Channel for ticket logs')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName('panel_channel')
      .setDescription('Channel to send the panel to')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  // Category options
  .addStringOption(option =>
    option
      .setName('category_id')
      .setDescription('Category ID (e.g., support, report)')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('category_name')
      .setDescription('Category display name')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('category_desc')
      .setDescription('Category description')
      .setRequired(false)
  )
  .addRoleOption(option =>
    option
      .setName('support_role')
      .setDescription('Role that can manage tickets in this category')
      .setRequired(false)
  )
  // Panel options
  .addStringOption(option =>
    option
      .setName('panel_type')
      .setDescription('Panel interaction type')
      .setRequired(false)
      .addChoices(
        { name: 'Button', value: 'button' },
        { name: 'Emoji Reaction', value: 'emoji' }
      )
  )
  .addStringOption(option =>
    option
      .setName('emoji')
      .setDescription('Emoji for reaction panel (default: 🎫)')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('panel_title')
      .setDescription('Panel embed title')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('panel_description')
      .setDescription('Panel embed description')
      .setRequired(false)
  )
  // Settings options
  .addIntegerOption(option =>
    option
      .setName('max_tickets')
      .setDescription('Maximum tickets per user (1-10)')
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('enabled')
      .setDescription('Enable or disable the system')
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('dm_transcripts')
      .setDescription('DM transcripts to ticket creators')
      .setRequired(false)
  )
  // User management options
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to add/remove from ticket')
      .setRequired(false)
  )
  // Close options
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for closing')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!ticketSystem) {
    return interaction.reply({ 
      content: interaction.client.embedLoader.format('Ticket system not loaded.', 'message'), 
      ephemeral: true 
    });
  }

  const action = interaction.options.getString('action');

  switch (action) {
    case 'setup':
      return executeSetup(interaction);
    case 'panel':
      return executePanel(interaction);
    case 'add_category':
      return executeAddCategory(interaction);
    case 'remove_category':
      return executeRemoveCategory(interaction);
    case 'list_categories':
      return executeListCategories(interaction);
    case 'settings':
      return executeSettings(interaction);
    case 'config':
      return executeConfig(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'toggle':
      return executeToggle(interaction);
    case 'close':
      return executeClose(interaction);
    case 'add_user':
      return executeAddUser(interaction);
    case 'remove_user':
      return executeRemoveUser(interaction);
  }
}

async function executeSetup(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Only administrators can setup the ticket system.', 'message'),
      ephemeral: true
    });
  }

  const category = interaction.options.getChannel('category');
  const logChannel = interaction.options.getChannel('log_channel');

  if (!category || !logChannel) {
    return interaction.reply({
      content: 'Please use `action: Setup System` with both `category` and `log_channel` options.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    // Initialize basic config
    if (!ticketSystem.config.categories) {
      ticketSystem.config.categories = [];
    }

    ticketSystem.config.defaultCategoryId = category.id;
    ticketSystem.config.logChannel = logChannel.id;
    ticketSystem.config.enabled = true;

    await ticketSystem.saveConfig();

    const embed = interaction.client.embedLoader.createEmbed({
      title: 'Ticket System',
      description: 'Basic ticket system setup completed! System is now enabled.',
      fields: [
        { name: 'Ticket Category', value: `${category}`, inline: true },
        { name: 'Log Channel', value: `${logChannel}`, inline: true },
        { name: 'Status', value: 'Enabled', inline: true }
      ],
      footer: 'Use action: Add Category to add ticket categories'
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Setup] Error:', error);
    await interaction.editReply({
      content: interaction.client.embedLoader.format('Failed to setup ticket system.', 'message')
    });
  }
}

async function executePanel(interaction) {
  const channel = interaction.options.getChannel('panel_channel');
  const panelType = interaction.options.getString('panel_type') || 'button';
  const emoji = interaction.options.getString('emoji') || '🎫';
  const title = interaction.options.getString('panel_title');
  const description = interaction.options.getString('panel_description');

  if (!channel) {
    return interaction.reply({
      content: 'Please use `action: Create Panel` with `panel_channel` option.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Make sure ticket system has embed loader
    if (!ticketSystem.embedLoader && interaction.client.embedLoader) {
      ticketSystem.setEmbedLoader(interaction.client.embedLoader);
    }

    if (!ticketSystem.config.categories || ticketSystem.config.categories.length === 0) {
      return interaction.editReply({
        content: interaction.client.embedLoader.format('No ticket categories configured. Use `action: Add Category` first.', 'message')
      });
    }

    const options = {
      type: panelType,
      emoji: emoji
    };
    
    // Add custom embed content if provided
    if (title) options.title = title;
    if (description) options.description = description;
    
    // Use createTicketPanel method which handles all the logic
    const message = await ticketSystem.createTicketPanel(channel, options);

    const responseEmbed = interaction.client.embedLoader.createEmbed({
      description: `Successfully created ${panelType} ticket panel in ${channel}`,
      fields: [
        { name: 'Panel Type', value: panelType === 'emoji' ? `Emoji Reaction (${emoji})` : 'Button/Menu', inline: true },
        { name: 'Message ID', value: message.id, inline: true }
      ]
    });

    await interaction.editReply({ embeds: [responseEmbed] });
  } catch (error) {
    console.error('[Ticket Panel] Error creating panel:', error);
    await interaction.editReply({
      content: interaction.client.embedLoader.format(`Failed to create ticket panel: ${error.message}`, 'message')
    });
  }
}

async function executeAddCategory(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Only administrators can add categories.', 'message'),
      ephemeral: true
    });
  }

  const id = interaction.options.getString('category_id');
  const name = interaction.options.getString('category_name');
  const description = interaction.options.getString('category_desc');
  const supportRole = interaction.options.getRole('support_role');

  if (!id || !name || !description || !supportRole) {
    return interaction.reply({
      content: 'Please provide all required options: `category_id`, `category_name`, `category_desc`, and `support_role`.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const categoryId = id.toLowerCase().replace(/\s+/g, '-');
    
    // Check if exists
    const existing = ticketSystem.config.categories.find(c => c.id === categoryId);
    if (existing) {
      return interaction.editReply({
        content: interaction.client.embedLoader.format(`A category with ID \`${categoryId}\` already exists.`, 'message')
      });
    }

    const newCategory = {
      id: categoryId,
      name,
      description,
      supportRole: supportRole.id,
      categoryId: ticketSystem.config.defaultCategoryId,
      welcomeMessage: `Welcome to your ${name} ticket! A member of <@&${supportRole.id}> will assist you shortly.`
    };

    ticketSystem.config.categories.push(newCategory);
    await ticketSystem.saveConfig();

    const embed = interaction.client.embedLoader.createEmbed({
      title: 'Ticket System',
      description: 'Successfully added new ticket category!',
      fields: [
        { name: 'ID', value: `\`${categoryId}\``, inline: true },
        { name: 'Name', value: name, inline: true },
        { name: 'Support Role', value: `${supportRole}`, inline: true },
        { name: 'Description', value: description, inline: false }
      ]
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Category] Error adding category:', error);
    await interaction.editReply({
      content: interaction.client.embedLoader.format('Failed to add ticket category.', 'message')
    });
  }
}

async function executeRemoveCategory(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Only administrators can remove categories.', 'message'),
      ephemeral: true
    });
  }

  const id = interaction.options.getString('category_id');
  if (!id) {
    return interaction.reply({
      content: 'Please provide `category_id` to remove.',
      ephemeral: true
    });
  }

  const category = ticketSystem.config.categories.find(c => c.id === id);
  if (!category) {
    return interaction.reply({
      content: interaction.client.embedLoader.format(`Category with ID \`${id}\` not found.`, 'message'),
      ephemeral: true
    });
  }

  // Remove category
  const index = ticketSystem.config.categories.findIndex(c => c.id === id);
  ticketSystem.config.categories.splice(index, 1);
  await ticketSystem.saveConfig();

  const embed = interaction.client.embedLoader.createEmbed({
    description: `Successfully removed category **${category.name}**.`
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeListCategories(interaction) {
  const categories = ticketSystem.config.categories || [];

  if (categories.length === 0) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('No ticket categories configured.', 'message'),
      ephemeral: true
    });
  }

  const embed = interaction.client.embedLoader.createEmbed({
    title: 'Ticket System',
    description: `Total categories: ${categories.length}`
  });

  for (const cat of categories) {
    embed.addFields({
      name: cat.name,
      value: `ID: \`${cat.id}\`\nDescription: ${cat.description}\nSupport Role: <@&${cat.supportRole}>`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeSettings(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Only administrators can change settings.', 'message'),
      ephemeral: true
    });
  }

  const maxTickets = interaction.options.getInteger('max_tickets');
  const dmTranscripts = interaction.options.getBoolean('dm_transcripts');

  await interaction.deferReply();

  try {
    const changes = [];

    if (maxTickets !== null) {
      ticketSystem.config.maxTicketsPerUser = maxTickets;
      changes.push(`Max tickets per user: **${maxTickets}**`);
    }

    if (dmTranscripts !== null) {
      ticketSystem.config.dmTranscripts = dmTranscripts;
      changes.push(`DM transcripts: **${dmTranscripts ? 'Enabled' : 'Disabled'}**`);
    }

    if (changes.length === 0) {
      return interaction.editReply({
        content: interaction.client.embedLoader.format('No settings were provided.', 'message')
      });
    }

    await ticketSystem.saveConfig();

    const embed = interaction.client.embedLoader.createEmbed({
      title: 'Ticket System',
      description: 'Successfully updated settings:',
      fields: [{
        name: 'Changes',
        value: changes.join('\n')
      }]
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Settings] Error updating:', error);
    await interaction.editReply({
      content: interaction.client.embedLoader.format('Failed to update settings.', 'message')
    });
  }
}

async function executeConfig(interaction) {
  const config = ticketSystem.config;

  const fields = [
    { name: 'Status', value: config.enabled ? 'Enabled' : 'Disabled', inline: true },
    { name: 'Max Tickets/User', value: `${config.maxTicketsPerUser}`, inline: true },
    { name: 'Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : 'Not set', inline: true },
    { name: 'Default Category', value: config.defaultCategoryId ? `<#${config.defaultCategoryId}>` : 'Not set', inline: true },
    { name: 'DM Transcripts', value: config.dmTranscripts ? 'Yes' : 'No', inline: true },
    { name: 'Active Panels', value: `${ticketSystem.ticketPanels.size}`, inline: true }
  ];

  if (config.categories && config.categories.length > 0) {
    const categoryList = config.categories.map(cat => 
      `**${cat.name}** (\`${cat.id}\`)`
    ).join('\n');

    fields.push({
      name: `Categories (${config.categories.length})`,
      value: categoryList.length > 1024 ? categoryList.substring(0, 1021) + '...' : categoryList,
      inline: false
    });
  }

  const stats = ticketSystem.getStats();
  fields.push({
    name: 'Statistics',
    value: `Total Created: **${stats.totalTickets}**\nTotal Closed: **${stats.totalClosed}**\nActive Now: **${stats.activeTickets}**`,
    inline: false
  });

  const embed = interaction.client.embedLoader.createEmbed({
    title: 'Ticket System',
    description: 'Current Configuration',
    fields: fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeToggle(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Only administrators can toggle the system.', 'message'),
      ephemeral: true
    });
  }

  const enabled = interaction.options.getBoolean('enabled');
  if (enabled === null) {
    return interaction.reply({
      content: 'Please provide the `enabled` option (true/false).',
      ephemeral: true
    });
  }

  ticketSystem.config.enabled = enabled;
  await ticketSystem.saveConfig();

  if (enabled) {
    ticketSystem.setupEventListeners();
    if (ticketSystem.config.autoCloseInactiveDays > 0) {
      ticketSystem.setupInactiveCheck();
    }
  }

  const embed = interaction.client.embedLoader.createEmbed({
    description: enabled ? 
      'The ticket system is now active. Users can create tickets.' : 
      'The ticket system has been disabled. Users cannot create new tickets.'
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeStats(interaction) {
  const stats = ticketSystem.getStats();

  const fields = [
    { name: 'Total Tickets Created', value: `${stats.totalTickets}`, inline: true },
    { name: 'Total Closed', value: `${stats.totalClosed}`, inline: true },
    { name: 'Currently Active', value: `${stats.activeTickets}`, inline: true }
  ];

  const breakdown = [];
  for (const [id, data] of Object.entries(stats.categoriesBreakdown)) {
    breakdown.push(`**${data.name}**: ${data.active} active`);
  }

  if (breakdown.length > 0) {
    fields.push({
      name: 'Category Breakdown',
      value: breakdown.join('\n'),
      inline: false
    });
  }

  const embed = interaction.client.embedLoader.createEmbed({
    title: 'Ticket System',
    description: 'Statistics',
    fields: fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeClose(interaction) {
  const reason = interaction.options.getString('reason') || 'Closed by staff';

  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('This is not a valid ticket channel.', 'message'),
      ephemeral: true
    });
  }

  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canClose = interaction.user.id === ticket.userId ||
                  interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                  (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canClose) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('You do not have permission to close this ticket.', 'message'),
      ephemeral: true
    });
  }

  const closeButton = {
    customId: 'ticket_close',
    user: interaction.user,
    channel: interaction.channel,
    reply: interaction.reply.bind(interaction),
    deferReply: interaction.deferReply.bind(interaction),
    editReply: interaction.editReply.bind(interaction),
    member: interaction.member,
    guild: interaction.guild,
    client: interaction.client
  };

  await ticketSystem.handleClose(closeButton, ticket);
}

async function executeAddUser(interaction) {
  const user = interaction.options.getUser('user');
  if (!user) {
    return interaction.reply({
      content: 'Please provide the `user` option.',
      ephemeral: true
    });
  }

  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('This command can only be used in a ticket channel.', 'message'),
      ephemeral: true
    });
  }

  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canManage = interaction.user.id === ticket.userId ||
                   interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                   (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canManage) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('You do not have permission to manage this ticket.', 'message'),
      ephemeral: true
    });
  }

  try {
    await interaction.channel.permissionOverwrites.create(user.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      EmbedLinks: true,
      ReadMessageHistory: true
    });

    if (!ticket.participants.includes(user.id)) {
      ticket.participants.push(user.id);
      ticketSystem.saveTicketData();
    }

    await interaction.reply({
      content: interaction.client.embedLoader.format(`Added ${user} to the ticket.`, 'message')
    });
  } catch (error) {
    console.error('[Ticket Add] Error adding user:', error);
    await interaction.reply({
      content: interaction.client.embedLoader.format('Failed to add user to ticket.', 'message'),
      ephemeral: true
    });
  }
}

async function executeRemoveUser(interaction) {
  const user = interaction.options.getUser('user');
  if (!user) {
    return interaction.reply({
      content: 'Please provide the `user` option.',
      ephemeral: true
    });
  }

  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('This command can only be used in a ticket channel.', 'message'),
      ephemeral: true
    });
  }

  if (user.id === ticket.userId) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('Cannot remove the ticket owner.', 'message'),
      ephemeral: true
    });
  }

  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canManage = interaction.user.id === ticket.userId ||
                   interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                   (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canManage) {
    return interaction.reply({
      content: interaction.client.embedLoader.format('You do not have permission to manage this ticket.', 'message'),
      ephemeral: true
    });
  }

  try {
    await interaction.channel.permissionOverwrites.delete(user.id);

    const index = ticket.participants.indexOf(user.id);
    if (index > -1) {
      ticket.participants.splice(index, 1);
      ticketSystem.saveTicketData();
    }

    await interaction.reply({
      content: interaction.client.embedLoader.format(`Removed ${user} from the ticket.`, 'message')
    });
  } catch (error) {
    console.error('[Ticket Remove] Error removing user:', error);
    await interaction.reply({
      content: interaction.client.embedLoader.format('Failed to remove user from ticket.', 'message'),
      ephemeral: true
    });
  }
}

// Export
export default { data: ticketData, execute };
export const commands = [
  { data: ticketData, execute }
];