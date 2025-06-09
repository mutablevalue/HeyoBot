// src/commands/ticket.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
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
          .setDescription('Panel title')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Panel description')
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
      .setName('forceclose')
      .setDescription('Force close a ticket')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Ticket channel to close')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for force closing')
          .setRequired(false)
      )
  );

export async function execute(interaction) {
  if (!ticketSystem) {
    return interaction.reply({ content: '❌ Ticket system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
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
    case 'forceclose':
      return executeForceClose(interaction);
  }
}

async function executePanel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');

  await interaction.deferReply({ ephemeral: true });

  try {
    const options = {};
    if (title) options.title = title;
    if (description) options.description = description;

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
    console.error('[Ticket Command] Error creating panel:', error);
    await interaction.editReply({
      content: '❌ Failed to create ticket panel.'
    });
  }
}

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
  } catch (error) {
    console.error('[Ticket Command] Error adding user:', error);
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
  } catch (error) {
    console.error('[Ticket Command] Error removing user:', error);
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
  } catch (error) {
    console.error('[Ticket Command] Error renaming channel:', error);
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

async function executeForceClose(interaction) {
  const channel = interaction.options.getChannel('channel');
  const reason = interaction.options.getString('reason') || 'Force closed by administrator';

  // Check if it's a ticket
  const ticket = ticketSystem.activeTickets.get(channel.id);
  if (!ticket) {
    return interaction.reply({
      content: '❌ That channel is not a ticket.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    // Close the ticket
    ticketSystem.closeTicket(channel.id, interaction.user.id, reason);
    
    // Delete the channel
    await channel.delete(reason);

    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket Force Closed')
      .setDescription(`Ticket #${ticket.id} has been force closed.`)
      .addFields(
        { name: 'Channel', value: channel.name, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Ticket Command] Error force closing:', error);
    await interaction.editReply({
      content: '❌ Failed to force close ticket.'
    });
  }
}

export const commands = [
  { data: ticketData, execute }
];