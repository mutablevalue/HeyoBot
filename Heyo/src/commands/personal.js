// src/commands/personal.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';

let personalSystem = null;

export function setPersonalSystem(system) {
  personalSystem = system;
}

export const createData = new SlashCommandBuilder()
  .setName('personal')
  .setDescription('Create personal voice channel or role')
  .addSubcommand(subcommand =>
    subcommand
      .setName('voice')
      .setDescription('Create a personal voice channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Create a personal role')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('both')
      .setDescription('Create both voice channel and role')
  );

export const uncreateData = new SlashCommandBuilder()
  .setName('personaldelete')
  .setDescription('Delete your personal voice channel or role')
  .addSubcommand(subcommand =>
    subcommand
      .setName('voice')
      .setDescription('Delete your personal voice channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Delete your personal role')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('all')
      .setDescription('Delete all your personal items')
  );

export const personalData = new SlashCommandBuilder()
  .setName('personalmanage')
  .setDescription('Manage personal voice channels and roles')
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View your personal items')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to view (admin only)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('personalsettings')
      .setDescription('View personal system settings')
  );

export async function executeCreate(interaction) {
  if (!personalSystem) {
    return interaction.reply({ content: '❌ Personal system not loaded.', ephemeral: true });
  }

  // Check requirements
  const requirements = personalSystem.checkRequirements(interaction.member);
  if (!requirements.eligible) {
    return interaction.reply({ 
      content: `❌ ${requirements.reason}`, 
      ephemeral: true 
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();
  const results = { voice: null, role: null };

  // Create voice channel
  if (subcommand === 'voice' || subcommand === 'both') {
    const vcResult = await personalSystem.createPersonalVC(interaction.guild, interaction.member);
    results.voice = vcResult;
    
    if (!vcResult.success && subcommand === 'voice') {
      return interaction.editReply({ content: `❌ ${vcResult.error}` });
    }
  }

  // Create role
  if (subcommand === 'role' || subcommand === 'both') {
    const roleResult = await personalSystem.createPersonalRole(interaction.guild, interaction.member);
    results.role = roleResult;
    
    if (!roleResult.success && subcommand === 'role') {
      return interaction.editReply({ content: `❌ ${roleResult.error}` });
    }
  }

  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('✅ Personal Items Created')
    .setColor(0x00ff00)
    .setTimestamp();

  const fields = [];

  if (results.voice) {
    if (results.voice.success) {
      fields.push({
        name: '🔊 Voice Channel',
        value: `Created ${results.voice.channel}`,
        inline: true
      });
    } else {
      fields.push({
        name: '❌ Voice Channel',
        value: results.voice.error,
        inline: true
      });
    }
  }

  if (results.role) {
    if (results.role.success) {
      fields.push({
        name: '🏷️ Role',
        value: `Created ${results.role.role}`,
        inline: true
      });
    } else {
      fields.push({
        name: '❌ Role',
        value: results.role.error,
        inline: true
      });
    }
  }

  embed.addFields(fields);

  // Add management instructions
  if (results.voice?.success || results.role?.success) {
    embed.addFields({
      name: '📝 Management',
      value: 'Use `/uncreate` to delete your personal items when you no longer need them.',
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

export async function executeUncreate(interaction) {
  if (!personalSystem) {
    return interaction.reply({ content: '❌ Personal system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const userItems = personalSystem.getUserItems(interaction.user.id);

  // Check if user has any items
  const hasVoice = userItems.channels.some(id => interaction.guild.channels.cache.has(id));
  const hasRole = userItems.roles.some(id => interaction.guild.roles.cache.has(id));

  if (!hasVoice && !hasRole) {
    return interaction.reply({ 
      content: '❌ You don\'t have any personal items to delete.', 
      ephemeral: true 
    });
  }

  // Create confirmation embed
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Deletion')
    .setDescription('Are you sure you want to delete your personal items? This action cannot be undone.')
    .setColor(0xffa500)
    .setTimestamp();

  const itemsToDelete = [];
  if (subcommand === 'voice' && hasVoice) {
    itemsToDelete.push('🔊 Voice Channel(s)');
  } else if (subcommand === 'role' && hasRole) {
    itemsToDelete.push('🏷️ Role(s)');
  } else if (subcommand === 'all') {
    if (hasVoice) itemsToDelete.push('🔊 Voice Channel(s)');
    if (hasRole) itemsToDelete.push('🏷️ Role(s)');
  }

  if (itemsToDelete.length === 0) {
    return interaction.reply({ 
      content: `❌ You don't have any personal ${subcommand === 'voice' ? 'voice channels' : 'roles'} to delete.`, 
      ephemeral: true 
    });
  }

  embed.addFields({
    name: 'Items to Delete',
    value: itemsToDelete.join('\n'),
    inline: false
  });

  // Create confirmation buttons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`personal_delete_${subcommand}_${interaction.user.id}`)
        .setLabel('Confirm Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('personal_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });

  // Set up collector
  const collector = response.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 30000
  });

  collector.on('collect', async i => {
    if (i.customId === 'personal_cancel') {
      await i.update({ 
        content: '✅ Deletion cancelled.', 
        embeds: [], 
        components: [] 
      });
    } else if (i.customId.startsWith('personal_delete_')) {
      const [_, __, type] = i.customId.split('_');
      
      await i.deferUpdate();
      
      const result = await personalSystem.deletePersonalItems(
        interaction.guild.id, 
        interaction.user.id, 
        type === 'all' ? 'all' : type
      );

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ Items Deleted')
        .setColor(0x00ff00)
        .setTimestamp();

      const deletedItems = [];
      if (result.deleted.roles > 0) {
        deletedItems.push(`🏷️ ${result.deleted.roles} role(s)`);
      }
      if (result.deleted.channels > 0) {
        deletedItems.push(`🔊 ${result.deleted.channels} voice channel(s)`);
      }

      resultEmbed.addFields({
        name: 'Deleted Items',
        value: deletedItems.join('\n') || 'None',
        inline: false
      });

      await i.editReply({ 
        embeds: [resultEmbed], 
        components: [] 
      });
    }

    collector.stop();
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      await interaction.editReply({ 
        content: '⏰ Deletion timed out.', 
        embeds: [], 
        components: [] 
      });
    }
  });
}

export async function executePersonal(interaction) {
  if (!personalSystem) {
    return interaction.reply({ content: '❌ Personal system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    return executeView(interaction);
  } else if (subcommand === 'settings') {
    return executeSettings(interaction);
  }
}

async function executeView(interaction) {
  const targetUser = interaction.options.getUser('user');
  
  // Only admins can view other users
  if (targetUser && targetUser.id !== interaction.user.id) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ 
        content: '❌ Only administrators can view other users\' personal items.', 
        ephemeral: true 
      });
    }
  }

  const userId = targetUser?.id || interaction.user.id;
  const userItems = personalSystem.getUserItems(userId);

  const embed = new EmbedBuilder()
    .setTitle(`Personal Items for ${targetUser?.username || interaction.user.username}`)
    .setColor(0x0099ff)
    .setTimestamp();

  // List voice channels
  const voiceChannels = [];
  for (const channelId of userItems.channels) {
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      voiceChannels.push(`• ${channel.name} (${channel.id})`);
    }
  }

  embed.addFields({
    name: `🔊 Voice Channels (${voiceChannels.length})`,
    value: voiceChannels.length > 0 ? voiceChannels.join('\n') : 'None',
    inline: false
  });

  // List roles
  const roles = [];
  for (const roleId of userItems.roles) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (role) {
      roles.push(`• ${role.name} (${role.id})`);
    }
  }

  embed.addFields({
    name: `🏷️ Roles (${roles.length})`,
    value: roles.length > 0 ? roles.join('\n') : 'None',
    inline: false
  });

  // Add usage info
  if (userId === interaction.user.id) {
    embed.addFields({
      name: '📝 Commands',
      value: '• `/create` - Create personal items\n• `/uncreate` - Delete personal items',
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeSettings(interaction) {
  const config = personalSystem.config;
  
  const embed = new EmbedBuilder()
    .setTitle('Personal System Settings')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .setTimestamp();

  // General settings
  embed.addFields({
    name: '⚙️ General',
    value: [
      `Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}`,
      `Max items per user: ${config.maxPerUser}`,
      `Delete on boost end: ${config.deleteOnBoostEnd ? 'Yes' : 'No'}`,
      `Delete on leave: ${config.deleteOnLeave ? 'Yes' : 'No'}`
    ].join('\n'),
    inline: false
  });

  // Requirements
  const requirements = [];
  if (config.requireBooster) requirements.push('• Server Booster');
  if (config.requiredRoles.length > 0) {
    requirements.push(`• Required roles: ${config.requiredRoles.map(id => `<@&${id}>`).join(', ')}`);
  }
  
  embed.addFields({
    name: '📋 Requirements',
    value: requirements.length > 0 ? requirements.join('\n') : 'None',
    inline: false
  });

  // Voice channel settings
  if (config.vcEnabled) {
    const vcPerms = [];
    if (config.vcPermissions.manage) vcPerms.push('Manage Channel');
    if (config.vcPermissions.moveMembers) vcPerms.push('Move Members');
    if (config.vcPermissions.muteMembers) vcPerms.push('Mute Members');
    if (config.vcPermissions.deafenMembers) vcPerms.push('Deafen Members');

    embed.addFields({
      name: '🔊 Voice Channel Settings',
      value: [
        `Enabled: ✅`,
        `Name format: \`${config.vcNameFormat}\``,
        `User limit: ${config.vcUserLimit}`,
        `Bitrate: ${config.vcBitrate / 1000}kbps`,
        `Permissions: ${vcPerms.join(', ') || 'None'}`
      ].join('\n'),
      inline: false
    });
  }

  // Role settings
  if (config.roleEnabled) {
    embed.addFields({
      name: '🏷️ Role Settings',
      value: [
        `Enabled: ✅`,
        `Name format: \`${config.roleNameFormat}\``,
        `Color: ${config.roleColor}`,
        `Hoisted: ${config.roleHoist ? 'Yes' : 'No'}`,
        `Mentionable: ${config.roleMentionable ? 'Yes' : 'No'}`
      ].join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const commands = [
  { data: createData, execute: executeCreate },
  { data: uncreateData, execute: executeUncreate },
  { data: personalData, execute: executePersonal }
];