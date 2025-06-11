// src/commands/ticket.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
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
  .addSubcommand(subcommand =>
    subcommand
      .setName('setup')
      .setDescription('Setup the ticket system')
      .addChannelOption(option =>
        option
          .setName('category')
          .setDescription('Category where ticket channels will be created')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addChannelOption(option =>
        option
          .setName('log_channel')
          .setDescription('Channel for ticket logs')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption(option =>
        option
          .setName('transcript_channel')
          .setDescription('Channel for ticket transcripts')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('enable')
          .setDescription('Enable the ticket system immediately')
          .setRequired(false)
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('category')
      .setDescription('Manage ticket categories')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a ticket category')
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription('Unique ID for the category (e.g., support, report)')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Display name for the category')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('description')
              .setDescription('Category description')
              .setRequired(true)
          )
          .addRoleOption(option =>
            option
              .setName('support_role')
              .setDescription('Role that can manage tickets in this category')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('emoji')
              .setDescription('Emoji for this category')
              .setRequired(false)
          )
          .addChannelOption(option =>
            option
              .setName('category_channel')
              .setDescription('Specific category channel for these tickets (optional)')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a ticket category')
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription('Category ID to remove')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all ticket categories')
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('settings')
      .setDescription('Configure ticket system settings')
      .addIntegerOption(option =>
        option
          .setName('max_tickets')
          .setDescription('Maximum tickets per user (1-10)')
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('cooldown')
          .setDescription('Cooldown between ticket creation in seconds (0-3600)')
          .setMinValue(0)
          .setMaxValue(3600)
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('auto_delete')
          .setDescription('Auto-delete closed tickets')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('delete_after')
          .setDescription('Delete tickets after X seconds when closed (60-86400)')
          .setMinValue(60)
          .setMaxValue(86400)
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('max_active')
          .setDescription('Maximum active tickets in server (10-500)')
          .setMinValue(10)
          .setMaxValue(500)
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('inactive_days')
          .setDescription('Auto-close inactive tickets after X days (0=disabled, 1-30)')
          .setMinValue(0)
          .setMaxValue(30)
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('dm_transcripts')
          .setDescription('DM transcripts to ticket creators')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('close_own')
          .setDescription('Allow users to close their own tickets')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('messages')
      .setDescription('Customize ticket system messages')
      .addStringOption(option =>
        option
          .setName('panel_title')
          .setDescription('Panel embed title')
          .setMaxLength(256)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('panel_description')
          .setDescription('Panel embed description')
          .setMaxLength(4096)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('panel_footer')
          .setDescription('Panel embed footer')
          .setMaxLength(2048)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('button_label')
          .setDescription('Button label text')
          .setMaxLength(80)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('welcome_message')
          .setDescription('Message sent when ticket is created')
          .setMaxLength(2000)
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('config')
      .setDescription('View current ticket system configuration')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('panel')
      .setDescription('Create a ticket panel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to send the panel to')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('title')
          .setDescription('Panel title (overrides default)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Panel description (overrides default)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('categories')
          .setDescription('Comma-separated category IDs to include (leave empty for all)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add a user to a ticket')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to add')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove a user from a ticket')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('rename')
      .setDescription('Rename the ticket channel')
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('New channel name')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View ticket statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('close')
      .setDescription('Close a ticket')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Ticket channel to close (current channel if not specified)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for closing')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('enable')
      .setDescription('Enable or disable the ticket system')
      .addBooleanOption(option =>
        option
          .setName('enabled')
          .setDescription('Enable or disable')
          .setRequired(true)
      )
  );

export async function execute(interaction) {
  if (!ticketSystem) {
    return interaction.reply({ content: '❌ Ticket system not loaded.', ephemeral: true });
  }

  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'category') {
    return executeCategoryCommands(interaction, subcommand);
  }

  switch (subcommand) {
    case 'setup':
      return executeSetup(interaction);
    case 'settings':
      return executeSettings(interaction);
    case 'messages':
      return executeMessages(interaction);
    case 'config':
      return executeConfig(interaction);
    case 'panel':
      return executePanel(interaction);
    case 'add':
      return executeAdd(interaction);
    case 'remove':
      return executeRemove(interaction);
    case 'rename':
      return executeRename(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'close':
      return executeClose(interaction);
    case 'enable':
      return executeEnable(interaction);
  }
}

async function executeSetup(interaction) {
  // Admin only
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Only administrators can setup the ticket system.',
      ephemeral: true
    });
  }

  const category = interaction.options.getChannel('category');
  const logChannel = interaction.options.getChannel('log_channel');
  const transcriptChannel = interaction.options.getChannel('transcript_channel');
  const enable = interaction.options.getBoolean('enable') ?? false;

  await interaction.deferReply();

  try {
    // Initialize basic config if not exists
    if (!ticketSystem.config.categories) {
      ticketSystem.config.categories = [];
    }

    // Set channels
    ticketSystem.config.defaultCategoryId = category.id;
    ticketSystem.config.logChannel = logChannel.id;
    if (transcriptChannel) {
      ticketSystem.config.transcriptChannel = transcriptChannel.id;
    }

    // Enable system if requested
    if (enable) {
      ticketSystem.config.enabled = true;
    }

    // Set default settings if not present
    ticketSystem.config.maxTicketsPerUser = ticketSystem.config.maxTicketsPerUser || 3;
    ticketSystem.config.cooldown = ticketSystem.config.cooldown || 60000;
    ticketSystem.config.channelNameFormat = ticketSystem.config.channelNameFormat || 'ticket-{number}';
    
    if (!ticketSystem.config.autoDelete) {
      ticketSystem.config.autoDelete = {
        enabled: true,
        timeout: 300000 // 5 minutes
      };
    }

    // Save config
    await ticketSystem.saveConfig();

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket System Setup Complete')
      .setDescription(`Basic ticket system setup completed!${enable ? ' System is now enabled.' : ''}`)
      .setColor(0x00ff00)
      .addFields(
        { name: 'Ticket Category', value: `${category}`, inline: true },
        { name: 'Log Channel', value: `${logChannel}`, inline: true },
        { name: 'Transcript Channel', value: transcriptChannel ? `${transcriptChannel}` : 'Not set', inline: true },
        { name: 'Status', value: enable ? '✅ Enabled' : '❌ Disabled', inline: true }
      )
      .setFooter({ text: 'Use /ticket category add to add ticket categories' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Setup] Error:', error);
    await interaction.editReply({
      content: '❌ Failed to setup ticket system.'
    });
  }
}

async function executeCategoryCommands(interaction, subcommand) {
  // Admin only
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Only administrators can manage ticket categories.',
      ephemeral: true
    });
  }

  switch (subcommand) {
    case 'add':
      return executeCategoryAdd(interaction);
    case 'remove':
      return executeCategoryRemove(interaction);
    case 'list':
      return executeCategoryList(interaction);
  }
}

async function executeCategoryAdd(interaction) {
  const id = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '-');
  const name = interaction.options.getString('name');
  const description = interaction.options.getString('description');
  const supportRole = interaction.options.getRole('support_role');
  const emoji = interaction.options.getString('emoji') || '🎫';
  const categoryChannel = interaction.options.getChannel('category_channel');

  await interaction.deferReply();

  try {
    // Check if category already exists
    const existing = ticketSystem.config.categories.find(c => c.id === id);
    if (existing) {
      return interaction.editReply({
        content: `❌ A category with ID \`${id}\` already exists.`
      });
    }

    // Create new category
    const newCategory = {
      id,
      name,
      description,
      supportRole: supportRole.id,
      emoji,
      categoryId: categoryChannel?.id || ticketSystem.config.defaultCategoryId,
      welcomeMessage: `Welcome to your ${name} ticket! A member of <@&${supportRole.id}> will assist you shortly.`,
      color: 0x0099ff
    };

    ticketSystem.config.categories.push(newCategory);
    await ticketSystem.saveConfig();

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket Category Added')
      .setDescription(`Successfully added new ticket category!`)
      .setColor(0x00ff00)
      .addFields(
        { name: 'ID', value: `\`${id}\``, inline: true },
        { name: 'Name', value: name, inline: true },
        { name: 'Emoji', value: emoji, inline: true },
        { name: 'Description', value: description, inline: false },
        { name: 'Support Role', value: `${supportRole}`, inline: true },
        { name: 'Category Channel', value: categoryChannel ? `${categoryChannel}` : 'Default', inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Category] Error adding category:', error);
    await interaction.editReply({
      content: '❌ Failed to add ticket category.'
    });
  }
}

async function executeCategoryRemove(interaction) {
  const id = interaction.options.getString('id');

  const category = ticketSystem.config.categories.find(c => c.id === id);
  if (!category) {
    return interaction.reply({
      content: `❌ Category with ID \`${id}\` not found.`,
      ephemeral: true
    });
  }

  // Confirm deletion
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Category Deletion')
    .setDescription(`Are you sure you want to delete the **${category.name}** category?`)
    .setColor(0xffff00)
    .addFields(
      { name: 'Category', value: category.name, inline: true },
      { name: 'ID', value: `\`${category.id}\``, inline: true }
    );

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_confirm_delete_${id}`)
        .setLabel('Confirm Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ticket_cancel_delete')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true
  });

  const collector = response.createMessageComponentCollector({ time: 30000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Only the command user can confirm.', ephemeral: true });
    }

    if (i.customId === `ticket_confirm_delete_${id}`) {
      // Remove category
      const index = ticketSystem.config.categories.findIndex(c => c.id === id);
      ticketSystem.config.categories.splice(index, 1);
      await ticketSystem.saveConfig();

      await i.update({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Category Removed')
            .setDescription(`Successfully removed category **${category.name}**.`)
            .setColor(0x00ff00)
        ],
        components: []
      });
    } else {
      await i.update({
        content: 'Cancelled.',
        embeds: [],
        components: []
      });
    }

    collector.stop();
  });

  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.editReply({
        content: 'Command timed out.',
        embeds: [],
        components: []
      });
    }
  });
}

async function executeCategoryList(interaction) {
  const categories = ticketSystem.config.categories || [];

  if (categories.length === 0) {
    return interaction.reply({
      content: '❌ No ticket categories configured.',
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket Categories')
    .setColor(0x0099ff)
    .setDescription(`Total categories: ${categories.length}`)
    .setTimestamp();

  for (const cat of categories) {
    embed.addFields({
      name: `${cat.emoji} ${cat.name}`,
      value: `ID: \`${cat.id}\`\nDescription: ${cat.description}\nSupport Role: <@&${cat.supportRole}>\nCategory: ${cat.categoryId ? `<#${cat.categoryId}>` : 'Default'}`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeSettings(interaction) {
  // Admin only
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Only administrators can change ticket settings.',
      ephemeral: true
    });
  }

  const maxTickets = interaction.options.getInteger('max_tickets');
  const cooldown = interaction.options.getInteger('cooldown');
  const autoDelete = interaction.options.getBoolean('auto_delete');
  const deleteAfter = interaction.options.getInteger('delete_after');
  const maxActive = interaction.options.getInteger('max_active');
  const inactiveDays = interaction.options.getInteger('inactive_days');
  const dmTranscripts = interaction.options.getBoolean('dm_transcripts');
  const closeOwn = interaction.options.getBoolean('close_own');

  await interaction.deferReply();

  try {
    const changes = [];

    if (maxTickets !== null) {
      ticketSystem.config.maxTicketsPerUser = maxTickets;
      changes.push(`Max tickets per user: **${maxTickets}**`);
    }

    if (cooldown !== null) {
      ticketSystem.config.cooldown = cooldown * 1000; // Convert to ms
      changes.push(`Cooldown: **${cooldown} seconds**`);
    }

    if (autoDelete !== null) {
      ticketSystem.config.autoDelete.enabled = autoDelete;
      changes.push(`Auto-delete: **${autoDelete ? 'Enabled' : 'Disabled'}**`);
    }

    if (deleteAfter !== null) {
      ticketSystem.config.autoDelete.timeout = deleteAfter * 1000; // Convert to ms
      changes.push(`Delete after: **${deleteAfter} seconds**`);
    }

    if (maxActive !== null) {
      ticketSystem.config.maxActiveTickets = maxActive;
      changes.push(`Max active tickets: **${maxActive}**`);
    }

    if (inactiveDays !== null) {
      ticketSystem.config.autoCloseInactiveDays = inactiveDays;
      changes.push(`Auto-close after: **${inactiveDays === 0 ? 'Disabled' : `${inactiveDays} days`}**`);
      
      // Restart inactive check if needed
      if (inactiveDays > 0 && ticketSystem.config.enabled) {
        ticketSystem.setupInactiveCheck();
      }
    }

    if (dmTranscripts !== null) {
      ticketSystem.config.dmTranscripts = dmTranscripts;
      changes.push(`DM transcripts: **${dmTranscripts ? 'Enabled' : 'Disabled'}**`);
    }

    if (closeOwn !== null) {
      ticketSystem.config.closeOwnTicket = closeOwn;
      changes.push(`Users can close own tickets: **${closeOwn ? 'Yes' : 'No'}**`);
    }

    if (changes.length === 0) {
      return interaction.editReply({
        content: '❌ No settings were provided.'
      });
    }

    await ticketSystem.saveConfig();

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket Settings Updated')
      .setDescription('Successfully updated ticket system settings:')
      .setColor(0x00ff00)
      .addFields({
        name: 'Changes',
        value: changes.join('\n')
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Settings] Error updating:', error);
    await interaction.editReply({
      content: '❌ Failed to update settings.'
    });
  }
}

async function executeMessages(interaction) {
  // Admin only
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Only administrators can customize messages.',
      ephemeral: true
    });
  }

  const panelTitle = interaction.options.getString('panel_title');
  const panelDescription = interaction.options.getString('panel_description');
  const panelFooter = interaction.options.getString('panel_footer');
  const buttonLabel = interaction.options.getString('button_label');
  const welcomeMessage = interaction.options.getString('welcome_message');

  await interaction.deferReply();

  try {
    const changes = [];

    if (panelTitle !== null) {
      ticketSystem.config.panelEmbed.title = panelTitle;
      changes.push(`Panel title updated`);
    }

    if (panelDescription !== null) {
      ticketSystem.config.panelEmbed.description = panelDescription;
      changes.push(`Panel description updated`);
    }

    if (panelFooter !== null) {
      ticketSystem.config.panelEmbed.footer = panelFooter;
      changes.push(`Panel footer updated`);
    }

    if (buttonLabel !== null) {
      ticketSystem.config.panelEmbed.buttonLabel = buttonLabel;
      changes.push(`Button label updated`);
    }

    if (welcomeMessage !== null) {
      ticketSystem.config.welcomeMessage = welcomeMessage;
      changes.push(`Welcome message updated`);
    }

    if (changes.length === 0) {
      return interaction.editReply({
        content: '❌ No messages were provided to update.'
      });
    }

    await ticketSystem.saveConfig();

    const embed = new EmbedBuilder()
      .setTitle('✅ Messages Updated')
      .setDescription('Successfully updated ticket system messages:')
      .setColor(0x00ff00)
      .addFields({
        name: 'Changes',
        value: changes.join('\n')
      })
      .setTimestamp();

    // Show preview
    const previewEmbed = new EmbedBuilder()
      .setTitle(ticketSystem.config.panelEmbed.title)
      .setDescription(ticketSystem.config.panelEmbed.description)
      .setColor(ticketSystem.config.panelEmbed.color)
      .setFooter({ text: ticketSystem.config.panelEmbed.footer });

    await interaction.editReply({ 
      embeds: [embed, previewEmbed],
      content: '**Preview:**'
    });
  } catch (error) {
    console.error('[Ticket Messages] Error updating:', error);
    await interaction.editReply({
      content: '❌ Failed to update messages.'
    });
  }
}

async function executeConfig(interaction) {
  const config = ticketSystem.config;

  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket System Configuration')
    .setColor(0x0099ff)
    .addFields(
      { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Max Tickets/User', value: `${config.maxTicketsPerUser}`, inline: true },
      { name: 'Cooldown', value: `${config.cooldown / 1000} seconds`, inline: true },
      { name: 'Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : 'Not set', inline: true },
      { name: 'Transcript Channel', value: config.transcriptChannel ? `<#${config.transcriptChannel}>` : 'Not set', inline: true },
      { name: 'Default Category', value: config.defaultCategoryId ? `<#${config.defaultCategoryId}>` : 'Not set', inline: true },
      { name: 'Auto-Delete', value: config.autoDelete?.enabled ? `Yes (${config.autoDelete.timeout / 1000}s)` : 'No', inline: true },
      { name: 'Channel Format', value: `\`${config.channelNameFormat}\``, inline: true },
      { name: 'Max Active Tickets', value: config.maxActiveTickets ? `${config.maxActiveTickets}` : 'Unlimited', inline: true },
      { name: 'Auto-Close Inactive', value: config.autoCloseInactiveDays ? `${config.autoCloseInactiveDays} days` : 'Disabled', inline: true },
      { name: 'DM Transcripts', value: config.dmTranscripts ? 'Yes' : 'No', inline: true },
      { name: 'Users Can Close', value: config.closeOwnTicket ? 'Yes' : 'No', inline: true }
    );

  // Add categories
  if (config.categories && config.categories.length > 0) {
    const categoryList = config.categories.map(cat => 
      `${cat.emoji} **${cat.name}** (\`${cat.id}\`)\n└ Support: <@&${cat.supportRole}>`
    ).join('\n\n');

    embed.addFields({
      name: `Categories (${config.categories.length})`,
      value: categoryList.length > 1024 ? categoryList.substring(0, 1021) + '...' : categoryList,
      inline: false
    });
  } else {
    embed.addFields({
      name: 'Categories',
      value: 'No categories configured',
      inline: false
    });
  }

  // Add stats
  const stats = ticketSystem.getStats();
  embed.addFields({
    name: 'Statistics',
    value: `Total Created: **${stats.totalTickets}**\nTotal Closed: **${stats.totalClosed}**\nActive Now: **${stats.activeTickets}**`,
    inline: false
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeEnable(interaction) {
  // Admin only
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Only administrators can enable/disable the ticket system.',
      ephemeral: true
    });
  }

  const enabled = interaction.options.getBoolean('enabled');

  ticketSystem.config.enabled = enabled;
  await ticketSystem.saveConfig();

  if (enabled) {
    // Setup event listeners if enabling
    ticketSystem.setupEventListeners();
    if (ticketSystem.config.autoCloseInactiveDays > 0) {
      ticketSystem.setupInactiveCheck();
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(enabled ? '✅ Ticket System Enabled' : '❌ Ticket System Disabled')
    .setDescription(enabled ? 
      'The ticket system is now active. Users can create tickets.' : 
      'The ticket system has been disabled. Users cannot create new tickets.')
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executePanel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const categoriesInput = interaction.options.getString('categories');

  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if system is configured
    if (!ticketSystem.config.categories || ticketSystem.config.categories.length === 0) {
      return interaction.editReply({
        content: '❌ No ticket categories configured. Use `/ticket category add` to add categories first.'
      });
    }

    const options = {};
    if (title) options.title = title;
    if (description) options.description = description;

    // Filter categories if specified
    if (categoriesInput) {
      const categoryIds = categoriesInput.split(',').map(id => id.trim());
      const categories = ticketSystem.config.categories.filter(cat => 
        categoryIds.includes(cat.id)
      );
      
      if (categories.length === 0) {
        return interaction.editReply({
          content: '❌ No valid categories found with the specified IDs.'
        });
      }
      
      options.categories = categories;
    }

    const message = await ticketSystem.createTicketPanel(channel, options);

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket Panel Created')
      .setDescription(`Successfully created ticket panel in ${channel}`)
      .setColor(0x00ff00)
      .addFields({
        name: 'Message ID',
        value: message.id,
        inline: true
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Panel] Error creating panel:', error);
    await interaction.editReply({
      content: '❌ Failed to create ticket panel.'
    });
  }
}

async function executeClose(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const reason = interaction.options.getString('reason') || 'Closed by staff';

  // Check if it's a ticket
  const ticket = ticketSystem.activeTickets.get(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: '❌ This is not a valid ticket channel.',
      ephemeral: true
    });
  }

  // Check permissions
  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canClose = interaction.user.id === ticket.userId ||
                  interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                  (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canClose) {
    return interaction.reply({
      content: '❌ You do not have permission to close this ticket.',
      ephemeral: true
    });
  }

  // Trigger close through ticket system
  const closeButton = {
    customId: 'ticket_close',
    user: interaction.user,
    channel: channel,
    reply: interaction.reply.bind(interaction),
    deferReply: interaction.deferReply.bind(interaction),
    editReply: interaction.editReply.bind(interaction),
    member: interaction.member,
    guild: interaction.guild
  };

  await ticketSystem.handleClose(closeButton, ticket);
}

// Keep these functions as they were
async function executeAdd(interaction) {
  const user = interaction.options.getUser('user');
  
  // Check if current channel is a ticket
  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: '❌ This command can only be used in a ticket channel.',
      ephemeral: true
    });
  }

  // Check permissions
  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canManage = interaction.user.id === ticket.userId ||
                   interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                   (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canManage) {
    return interaction.reply({
      content: '❌ You do not have permission to manage this ticket.',
      ephemeral: true
    });
  }

  try {
    // Add user to channel
    await interaction.channel.permissionOverwrites.create(user.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      EmbedLinks: true,
      ReadMessageHistory: true
    });

    // Add to participants
    if (!ticket.participants.includes(user.id)) {
      ticket.participants.push(user.id);
      ticketSystem.saveTicketData();
    }

    await interaction.reply({
      content: `✅ Added ${user} to the ticket.`
    });

    // Log action
    if (ticketSystem.config.enableLogging && ticketSystem.config.logActions.includes('add_user')) {
      await ticketSystem.logAction(interaction.guild, {
        action: 'User Added to Ticket',
        ticket: ticket,
        addedUser: user,
        addedBy: interaction.user
      });
    }
  } catch (error) {
    console.error('[Ticket Add] Error adding user:', error);
    await interaction.reply({
      content: '❌ Failed to add user to ticket.',
      ephemeral: true
    });
  }
}

async function executeRemove(interaction) {
  const user = interaction.options.getUser('user');
  
  // Check if current channel is a ticket
  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: '❌ This command can only be used in a ticket channel.',
      ephemeral: true
    });
  }

  // Can't remove ticket owner
  if (user.id === ticket.userId) {
    return interaction.reply({
      content: '❌ Cannot remove the ticket owner.',
      ephemeral: true
    });
  }

  // Check permissions
  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canManage = interaction.user.id === ticket.userId ||
                   interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                   (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canManage) {
    return interaction.reply({
      content: '❌ You do not have permission to manage this ticket.',
      ephemeral: true
    });
  }

  try {
    // Remove user from channel
    await interaction.channel.permissionOverwrites.delete(user.id);

    // Remove from participants
    const index = ticket.participants.indexOf(user.id);
    if (index > -1) {
      ticket.participants.splice(index, 1);
      ticketSystem.saveTicketData();
    }

    await interaction.reply({
      content: `✅ Removed ${user} from the ticket.`
    });

    // Log action
    if (ticketSystem.config.enableLogging && ticketSystem.config.logActions.includes('remove_user')) {
      await ticketSystem.logAction(interaction.guild, {
        action: 'User Removed from Ticket',
        ticket: ticket,
        removedUser: user,
        removedBy: interaction.user
      });
    }
  } catch (error) {
    console.error('[Ticket Remove] Error removing user:', error);
    await interaction.reply({
      content: '❌ Failed to remove user from ticket.',
      ephemeral: true
    });
  }
}

async function executeRename(interaction) {
  const newName = interaction.options.getString('name');
  
  // Check if current channel is a ticket
  const ticket = ticketSystem.activeTickets.get(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({
      content: '❌ This command can only be used in a ticket channel.',
      ephemeral: true
    });
  }

  // Check permissions
  const category = ticketSystem.config.categories.find(c => c.id === ticket.category);
  const canManage = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) ||
                   (category?.supportRole && interaction.member.roles.cache.has(category.supportRole));

  if (!canManage) {
    return interaction.reply({
      content: '❌ You do not have permission to rename tickets.',
      ephemeral: true
    });
  }

  try {
    await interaction.channel.setName(newName);
    
    await interaction.reply({
      content: `✅ Renamed ticket to: ${newName}`
    });

    // Log action
    if (ticketSystem.config.enableLogging && ticketSystem.config.logActions.includes('rename')) {
      await ticketSystem.logAction(interaction.guild, {
        action: 'Ticket Renamed',
        ticket: ticket,
        oldName: interaction.channel.name,
        newName: newName,
        renamedBy: interaction.user
      });
    }
  } catch (error) {
    console.error('[Ticket Rename] Error renaming channel:', error);
    await interaction.reply({
      content: '❌ Failed to rename ticket.',
      ephemeral: true
    });
  }
}

async function executeStats(interaction) {
  const stats = ticketSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Ticket Statistics')
    .setColor(0x0099ff)
    .addFields(
      { name: 'Total Tickets Created', value: `${stats.totalTickets}`, inline: true },
      { name: 'Total Closed', value: `${stats.totalClosed}`, inline: true },
      { name: 'Currently Active', value: `${stats.activeTickets}`, inline: true }
    )
    .setTimestamp();

  // Add category breakdown
  const breakdown = [];
  for (const [id, data] of Object.entries(stats.categoriesBreakdown)) {
    breakdown.push(`**${data.name}**: ${data.active} active`);
  }

  if (breakdown.length > 0) {
    embed.addFields({
      name: 'Category Breakdown',
      value: breakdown.join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

// Autocomplete handler
export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  
  if (focusedOption.name === 'id' && interaction.options.getSubcommand() === 'remove' && 
      interaction.options.getSubcommandGroup() === 'category') {
    const categories = ticketSystem.config.categories || [];
    const choices = categories.map(cat => ({
      name: `${cat.name} (${cat.id})`,
      value: cat.id
    }));
    
    await interaction.respond(choices.slice(0, 25));
  }
}

export const commands = [
  { data: ticketData, execute, autocomplete }
];