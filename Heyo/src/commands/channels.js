// src/commands/channels.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

let moderationSystem = null;
let roleTracker = null;
let embedLoader = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setRoleTracker(tracker) {
  roleTracker = tracker;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

// Create channel command
export const createChannelData = new SlashCommandBuilder()
  .setName('createchannel')
  .setDescription('Create a new channel')
  .addStringOption(option =>
    option
      .setName('name')
      .setDescription('Channel name')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Channel type')
      .setRequired(true)
      .addChoices(
        { name: 'Text Channel', value: 'text' },
        { name: 'Voice Channel', value: 'voice' },
        { name: 'Forum Channel', value: 'forum' },
        { name: 'Stage Channel', value: 'stage' },
        { name: 'Announcement Channel', value: 'announcement' }
      )
  )
  .addChannelOption(option =>
    option
      .setName('category')
      .setDescription('Category to place the channel in')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('topic')
      .setDescription('Channel topic (text channels only)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('slowmode')
      .setDescription('Slowmode in seconds (text channels only)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(21600)
  )
  .addIntegerOption(option =>
    option
      .setName('user_limit')
      .setDescription('User limit (voice channels only)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(99)
  )
  .addIntegerOption(option =>
    option
      .setName('bitrate')
      .setDescription('Bitrate in kbps (voice channels only)')
      .setRequired(false)
      .setMinValue(8)
      .setMaxValue(384)
  )
  .addBooleanOption(option =>
    option
      .setName('nsfw')
      .setDescription('Mark as NSFW (text channels only)')
      .setRequired(false)
  );

// Delete channel command
export const deleteChannelData = new SlashCommandBuilder()
  .setName('deletechannel')
  .setDescription('Delete a channel')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to delete')
      .setRequired(true)
  )
  .addBooleanOption(option =>
    option
      .setName('confirm')
      .setDescription('Confirm channel deletion')
      .setRequired(true)
  );

// Restore roles command
export const restoreRolesData = new SlashCommandBuilder()
  .setName('restoreroles')
  .setDescription('Restore a user\'s previous roles')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to restore roles for')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName('from')
      .setDescription('Which point in history to restore from (0 = most recent)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(9)
  );

// View role history command
export const roleHistoryData = new SlashCommandBuilder()
  .setName('rolehistory')
  .setDescription('View a user\'s role history')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to view history for')
      .setRequired(true)
  );

// Channel management compound command
export const channelData = new SlashCommandBuilder()
  .setName('channel')
  .setDescription('Channel management commands')
  // Create subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new channel')
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Channel name')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Channel type')
          .setRequired(true)
          .addChoices(
            { name: 'Text', value: 'text' },
            { name: 'Voice', value: 'voice' },
            { name: 'Forum', value: 'forum' },
            { name: 'Stage', value: 'stage' }
          )
      )
      .addChannelOption(option =>
        option
          .setName('category')
          .setDescription('Category to place the channel in')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(false)
      )
  )
  // Delete subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete a channel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to delete')
          .setRequired(true)
      )
      .addBooleanOption(option =>
        option
          .setName('confirm')
          .setDescription('Confirm deletion')
          .setRequired(true)
      )
  )
  // Clone subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('clone')
      .setDescription('Clone a channel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to clone')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Name for the cloned channel')
          .setRequired(false)
      )
  );

// Execute functions
export async function executeChannel(interaction) {
  if (!moderationSystem || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Moderation system not loaded.', 'message') || 'Moderation system not loaded.', 
      ephemeral: true 
    });
  }

  const subcommand = interaction.options.getSubcommand();
  
  // Check permissions
  const permCheck = moderationSystem.checkPermission(interaction.member, 'createchannel');
  if (!permCheck.allowed) {
    return interaction.reply({ 
      content: embedLoader.format(permCheck.reason, 'message'), 
      ephemeral: true 
    });
  }

  switch (subcommand) {
    case 'create':
      return executeCreateChannel(interaction);
    case 'delete':
      return executeDeleteChannel(interaction);
    case 'clone':
      return executeCloneChannel(interaction);
  }
}

export async function executeCreateChannel(interaction) {
  const name = interaction.options.getString('name');
  const type = interaction.options.getString('type');
  const category = interaction.options.getChannel('category');
  const topic = interaction.options.getString('topic');
  const slowmode = interaction.options.getInteger('slowmode');
  const userLimit = interaction.options.getInteger('user_limit');
  const bitrate = interaction.options.getInteger('bitrate');
  const nsfw = interaction.options.getBoolean('nsfw');

  // Check permissions if not using compound command
  if (!interaction.options._subcommand) {
    const permCheck = moderationSystem.checkPermission(interaction.member, 'createchannel');
    if (!permCheck.allowed) {
      return interaction.reply({ 
        content: embedLoader.format(permCheck.reason, 'message'), 
        ephemeral: true 
      });
    }
  }

  const channelTypes = {
    'text': ChannelType.GuildText,
    'voice': ChannelType.GuildVoice,
    'forum': ChannelType.GuildForum,
    'stage': ChannelType.GuildStageVoice,
    'announcement': ChannelType.GuildAnnouncement
  };

  const channelType = channelTypes[type];
  const channelOptions = {
    name: name,
    type: channelType,
    parent: category?.id || null,
    reason: `Created by ${interaction.user.tag}`
  };

  // Text channel specific options
  if (type === 'text' || type === 'announcement') {
    if (topic) channelOptions.topic = topic;
    if (slowmode !== null) channelOptions.rateLimitPerUser = slowmode;
    if (nsfw !== null) channelOptions.nsfw = nsfw;
  }

  // Voice channel specific options
  if (type === 'voice' || type === 'stage') {
    if (userLimit !== null) channelOptions.userLimit = userLimit;
    if (bitrate !== null) channelOptions.bitrate = bitrate * 1000; // Convert to bps
  }

  try {
    const channel = await interaction.guild.channels.create(channelOptions);

    const embed = embedLoader.createEmbed({
      description: `Successfully created ${channel}`,
      fields: [
        { name: 'Name', value: channel.name, inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'Category', value: category ? category.name : 'None', inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });

    // Log action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Create',
      moderator: interaction.user,
      target: `${channel.name} (${channel.id})`,
      additional: `Type: ${type}`
    });
  } catch (error) {
    console.error('Error creating channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to create channel. Make sure I have the necessary permissions.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeDeleteChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const confirm = interaction.options.getBoolean('confirm');

  // Check permissions if not using compound command
  if (!interaction.options._subcommand) {
    const permCheck = moderationSystem.checkPermission(interaction.member, 'deletechannel');
    if (!permCheck.allowed) {
      return interaction.reply({ 
        content: embedLoader.format(permCheck.reason, 'message'), 
        ephemeral: true 
      });
    }
  }

  if (!confirm) {
    return interaction.reply({ 
      content: embedLoader.format('Channel deletion cancelled. Set confirm to true to proceed.', 'message'), 
      ephemeral: true 
    });
  }

  // Prevent deletion of the channel the command was used in
  if (channel.id === interaction.channel.id) {
    return interaction.reply({ 
      content: embedLoader.format('You cannot delete the channel you are currently in.', 'message'), 
      ephemeral: true 
    });
  }

  try {
    const channelName = channel.name;
    const channelId = channel.id;
    const channelType = channel.type;

    await channel.delete(`Deleted by ${interaction.user.tag}`);

    const embed = embedLoader.createEmbed({
      description: 'Successfully deleted channel',
      fields: [
        { name: 'Channel', value: `#${channelName} (${channelId})`, inline: true },
        { name: 'Type', value: ChannelType[channelType] || 'Unknown', inline: true },
        { name: 'Deleted By', value: interaction.user.tag, inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });

    // Log action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Delete',
      moderator: interaction.user,
      target: `#${channelName} (${channelId})`
    });
  } catch (error) {
    console.error('Error deleting channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to delete channel. Make sure I have the necessary permissions.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeCloneChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const newName = interaction.options.getString('name');

  try {
    const clonedChannel = await channel.clone({
      name: newName || `${channel.name}-clone`,
      reason: `Cloned by ${interaction.user.tag}`
    });

    const embed = embedLoader.createEmbed({
      description: `Successfully cloned ${channel} to ${clonedChannel}`,
      fields: [
        { name: 'Original', value: `${channel}`, inline: true },
        { name: 'Clone', value: `${clonedChannel}`, inline: true },
        { name: 'Cloned By', value: interaction.user.tag, inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });

    // Log action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Clone',
      moderator: interaction.user,
      target: `${channel.name} → ${clonedChannel.name}`
    });
  } catch (error) {
    console.error('Error cloning channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to clone channel. Make sure I have the necessary permissions.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeRestoreRoles(interaction) {
  if (!roleTracker || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Role tracker not loaded.', 'message') || 'Role tracker not loaded.', 
      ephemeral: true 
    });
  }

  // Check permissions
  const permCheck = moderationSystem.checkPermission(interaction.member, 'restoreroles');
  if (!permCheck.allowed) {
    return interaction.reply({ 
      content: embedLoader.format(permCheck.reason, 'message'), 
      ephemeral: true 
    });
  }

  const user = interaction.options.getUser('user');
  const fromIndex = interaction.options.getInteger('from') || 0;

  await interaction.deferReply();

  const result = await roleTracker.restoreRoles(interaction.guild, user.id, fromIndex);

  if (!result.success && result.errors.length > 0) {
    const embed = embedLoader.createEmbed({
      description: `Could not restore roles for ${user.tag}`,
      fields: [{
        name: 'Errors',
        value: result.errors.join('\n').slice(0, 1024),
        inline: false
      }]
    });

    return interaction.editReply({ embeds: [embed] });
  }

  const fields = [
    { name: 'Restored', value: result.restored.toString(), inline: true },
    { name: 'Failed', value: result.failed.toString(), inline: true },
    { name: 'From Index', value: fromIndex.toString(), inline: true }
  ];

  if (result.errors.length > 0) {
    fields.push({
      name: 'Issues',
      value: result.errors.join('\n').slice(0, 1024),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    description: `Role restoration for ${user.tag}`,
    fields: fields
  });

  await interaction.editReply({ embeds: [embed] });

  // Log action
  await moderationSystem.logAction(interaction.guild, {
    action: 'Restore Roles',
    moderator: interaction.user,
    target: `${user.tag} (${user.id})`,
    additional: `Restored: ${result.restored}, Failed: ${result.failed}`
  });
}

export async function executeRoleHistory(interaction) {
  if (!roleTracker || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Role tracker not loaded.', 'message') || 'Role tracker not loaded.', 
      ephemeral: true 
    });
  }

  const user = interaction.options.getUser('user');

  const history = roleTracker.getRoleHistory(interaction.guild.id, user.id);

  if (!history || history.history.length === 0) {
    const embed = embedLoader.createEmbed({
      title: 'Role History',
      description: `No role history found for ${user.tag}`
    });

    return interaction.reply({ embeds: [embed] });
  }

  const fields = [];

  // Show up to 5 most recent entries
  const recentHistory = history.history.slice(0, 5);

  recentHistory.forEach((entry, index) => {
    const timestamp = Math.floor(new Date(entry.timestamp).getTime() / 1000);
    const rolesList = entry.roles.map(r => `• ${r.name}`).join('\n');

    fields.push({
      name: `#${index} - <t:${timestamp}:R>`,
      value: rolesList || 'No roles',
      inline: false
    });
  });

  const embed = embedLoader.createEmbed({
    title: 'Role History',
    description: `Role history for ${user.tag}`,
    fields: fields
  });

  embed.setThumbnail(user.displayAvatarURL({ dynamic: true }));

  if (history.history.length > 5) {
    embed.setFooter({ 
      text: `Showing 5 most recent of ${history.history.length} total entries` 
    });
  }

  await interaction.reply({ embeds: [embed] });
}

// Export commands
export const commands = [
  { data: createChannelData, execute: executeCreateChannel },
  { data: deleteChannelData, execute: executeDeleteChannel },
  { data: restoreRolesData, execute: executeRestoreRoles },
  { data: roleHistoryData, execute: executeRoleHistory },
  { data: channelData, execute: executeChannel }
];