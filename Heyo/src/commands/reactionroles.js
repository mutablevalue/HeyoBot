// src/commands/reactionroles.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js';

let reactionRolesSystem = null;

export function setReactionRolesSystem(system) {
  reactionRolesSystem = system;
}

export const reactionRolesData = new SlashCommandBuilder()
  .setName('reactionroles')
  .setDescription('Manage reaction role panels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new reaction role panel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to send the panel to')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('mode')
          .setDescription('Panel mode')
          .setRequired(true)
          .addChoices(
            { name: 'Buttons', value: 'buttons' },
            { name: 'Dropdown Menu', value: 'dropdown' },
            { name: 'Reactions (Emojis)', value: 'reactions' }
          )
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
      .setName('addrole')
      .setDescription('Add a role to the last created panel')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to add')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('emoji')
          .setDescription('Emoji for the role')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('label')
          .setDescription('Custom label for the role')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Description for the role')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('finish')
      .setDescription('Finish and send the reaction role panel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete a reaction role panel')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the panel')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all reaction role panels')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View reaction role statistics')
  );

// Temporary storage for panel creation
const panelCreation = new Map();

export async function execute(interaction) {
  if (!reactionRolesSystem) {
    return interaction.reply({ content: '❌ Reaction roles system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      return executeCreate(interaction);
    case 'addrole':
      return executeAddRole(interaction);
    case 'finish':
      return executeFinish(interaction);
    case 'delete':
      return executeDelete(interaction);
    case 'list':
      return executeList(interaction);
    case 'stats':
      return executeStats(interaction);
  }
}

async function executeCreate(interaction) {
  const channel = interaction.options.getChannel('channel');
  const mode = interaction.options.getString('mode');
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');

  // Initialize panel creation
  const panelData = {
    channel: channel,
    mode: mode,
    title: title,
    description: description,
    roles: [],
    createdBy: interaction.user.id,
    guildId: interaction.guild.id
  };

  panelCreation.set(interaction.user.id, panelData);

  const embed = new EmbedBuilder()
    .setTitle('📝 Reaction Role Panel Started')
    .setDescription('Panel creation started. Use `/reactionroles addrole` to add roles.')
    .addFields(
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Mode', value: mode, inline: true },
      { name: 'Roles Added', value: '0', inline: true }
    )
    .setColor(0x0099ff)
    .setFooter({ text: 'Use /reactionroles finish when done' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeAddRole(interaction) {
  const panelData = panelCreation.get(interaction.user.id);
  
  if (!panelData) {
    return interaction.reply({
      content: '❌ No panel in progress. Use `/reactionroles create` first.',
      ephemeral: true
    });
  }

  const role = interaction.options.getRole('role');
  const emoji = interaction.options.getString('emoji');
  const label = interaction.options.getString('label');
  const description = interaction.options.getString('description');

  // Check if role already added
  if (panelData.roles.some(r => r.roleId === role.id)) {
    return interaction.reply({
      content: '❌ This role has already been added to the panel.',
      ephemeral: true
    });
  }

  // Add role
  const roleData = {
    roleId: role.id,
    emoji: emoji,
    label: label || role.name,
    description: description
  };

  panelData.roles.push(roleData);

  const embed = new EmbedBuilder()
    .setTitle('✅ Role Added')
    .setDescription(`Added ${role} to the reaction role panel.`)
    .addFields(
      { name: 'Total Roles', value: `${panelData.roles.length}`, inline: true },
      { name: 'Mode', value: panelData.mode, inline: true }
    )
    .setColor(0x00ff00)
    .setTimestamp();

  // Show limitations based on mode
  if (panelData.mode === 'buttons' && panelData.roles.length >= 25) {
    embed.setFooter({ text: 'Maximum button limit reached (25)' });
  } else if (panelData.mode === 'dropdown' && panelData.roles.length >= 25) {
    embed.setFooter({ text: 'Maximum dropdown option limit reached (25)' });
  } else if (panelData.mode === 'reactions' && panelData.roles.length >= 20) {
    embed.setFooter({ text: 'Maximum reaction limit reached (20)' });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeFinish(interaction) {
  const panelData = panelCreation.get(interaction.user.id);
  
  if (!panelData) {
    return interaction.reply({
      content: '❌ No panel in progress. Use `/reactionroles create` first.',
      ephemeral: true
    });
  }

  if (panelData.roles.length === 0) {
    return interaction.reply({
      content: '❌ No roles added. Use `/reactionroles addrole` to add roles.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const options = {
      mode: panelData.mode,
      roles: panelData.roles,
      title: panelData.title,
      description: panelData.description,
      createdBy: panelData.createdBy,
      showRoles: true
    };

    const message = await reactionRolesSystem.createPanel(panelData.channel, options);

    const embed = new EmbedBuilder()
      .setTitle('✅ Reaction Role Panel Created')
      .setDescription(`Successfully created reaction role panel in ${panelData.channel}`)
      .addFields(
        { name: 'Message ID', value: message.id, inline: true },
        { name: 'Mode', value: panelData.mode, inline: true },
        { name: 'Roles', value: `${panelData.roles.length}`, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    // Clean up
    panelCreation.delete(interaction.user.id);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ReactionRoles Command] Error creating panel:', error);
    await interaction.editReply({
      content: `❌ Failed to create panel: ${error.message}`
    });
  }
}

async function executeDelete(interaction) {
  const messageId = interaction.options.getString('message_id');

  const success = await reactionRolesSystem.deletePanel(messageId);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Panel Deleted')
      .setDescription('Reaction role panel has been deleted.')
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: '❌ Panel not found or could not be deleted.',
      ephemeral: true
    });
  }
}

async function executeList(interaction) {
  const panels = Array.from(reactionRolesSystem.panels.values())
    .filter(panel => panel.guildId === interaction.guild.id);

  if (panels.length === 0) {
    return interaction.reply({
      content: '📋 No reaction role panels found in this server.',
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Reaction Role Panels')
    .setColor(0x0099ff)
    .setTimestamp()
    .setFooter({ text: `Total: ${panels.length} panels` });

  for (const panel of panels.slice(0, 10)) {
    const channel = interaction.guild.channels.cache.get(panel.channelId);
    
    embed.addFields({
      name: panel.options.title || 'Untitled Panel',
      value: [
        `Channel: ${channel ? channel : 'Unknown'}`,
        `Mode: ${panel.mode}`,
        `Roles: ${panel.roles.length}`,
        `Message ID: ${panel.messageId}`,
        `Created: <t:${Math.floor(new Date(panel.createdAt).getTime() / 1000)}:R>`
      ].join('\n'),
      inline: false
    });
  }

  if (panels.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${panels.length} panels` });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeStats(interaction) {
  const stats = reactionRolesSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Reaction Roles Statistics')
    .setColor(0x0099ff)
    .addFields(
      { name: 'Total Panels', value: `${stats.totalPanels}`, inline: true },
      { name: 'Roles Given', value: `${stats.stats.totalRolesGiven}`, inline: true },
      { name: 'Roles Removed', value: `${stats.stats.totalRolesRemoved}`, inline: true }
    )
    .setTimestamp();

  // Add panel breakdown by mode
  if (Object.keys(stats.panelsByMode).length > 0) {
    const modeBreakdown = Object.entries(stats.panelsByMode)
      .map(([mode, count]) => `• ${mode}: ${count}`)
      .join('\n');

    embed.addFields({
      name: 'Panels by Mode',
      value: modeBreakdown,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

export const commands = [
  { data: reactionRolesData, execute }
];