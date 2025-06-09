// src/commands/giveaway.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let giveawaySystem = null;

export function setGiveawaySystem(system) {
  giveawaySystem = system;
}

export const giveawayData = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Manage giveaways')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
  .addSubcommand(subcommand =>
    subcommand
      .setName('start')
      .setDescription('Start a new giveaway')
      .addStringOption(option =>
        option
          .setName('prize')
          .setDescription('What you are giving away')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('duration')
          .setDescription('How long the giveaway should last (e.g., 1h, 30m, 1d)')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('winners')
          .setDescription('Number of winners')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Additional description for the giveaway')
          .setRequired(false)
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to host the giveaway in')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('end')
      .setDescription('End a giveaway early')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reroll')
      .setDescription('Reroll a giveaway')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('winners')
          .setDescription('Number of new winners')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel a giveaway')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for cancellation')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all active giveaways')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View giveaway statistics')
  );

export const giveawayRequireData = new SlashCommandBuilder()
  .setName('giveawayrequire')
  .setDescription('Set requirements for a giveaway')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Require specific roles')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('required_role')
          .setDescription('Role required to enter')
          .setRequired(false)
      )
      .addRoleOption(option =>
        option
          .setName('blacklist_role')
          .setDescription('Role that cannot enter')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('account')
      .setDescription('Set account requirements')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('account_age')
          .setDescription('Minimum account age in days')
          .setRequired(false)
          .setMinValue(1)
      )
      .addIntegerOption(option =>
        option
          .setName('server_time')
          .setDescription('Minimum days in server')
          .setRequired(false)
          .setMinValue(1)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('bonus')
      .setDescription('Set bonus entries for roles')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Message ID of the giveaway')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to give bonus entries')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('entries')
          .setDescription('Number of entries (e.g., 2 = 2x entries)')
          .setRequired(true)
          .setMinValue(2)
          .setMaxValue(10)
      )
  );

export async function execute(interaction) {
  if (!giveawaySystem) {
    return interaction.reply({ content: '❌ Giveaway system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'start':
      return executeStart(interaction);
    case 'end':
      return executeEnd(interaction);
    case 'reroll':
      return executeReroll(interaction);
    case 'cancel':
      return executeCancel(interaction);
    case 'list':
      return executeList(interaction);
    case 'stats':
      return executeStats(interaction);
  }
}

export async function executeRequire(interaction) {
  if (!giveawaySystem) {
    return interaction.reply({ content: '❌ Giveaway system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const messageId = interaction.options.getString('message_id');
  
  // Get giveaway
  const giveaway = giveawaySystem.activeGiveaways.get(messageId);
  if (!giveaway) {
    return interaction.reply({
      content: '❌ Giveaway not found.',
      ephemeral: true
    });
  }

  if (giveaway.status !== 'active') {
    return interaction.reply({
      content: '❌ Can only modify requirements for active giveaways.',
      ephemeral: true
    });
  }

  switch (subcommand) {
    case 'role':
      return executeRequireRole(interaction, giveaway);
    case 'account':
      return executeRequireAccount(interaction, giveaway);
    case 'bonus':
      return executeBonus(interaction, giveaway);
  }
}

async function executeStart(interaction) {
  const prize = interaction.options.getString('prize');
  const durationStr = interaction.options.getString('duration');
  const winners = interaction.options.getInteger('winners') || 1;
  const description = interaction.options.getString('description');
  const channel = interaction.options.getChannel('channel') || interaction.channel;

  // Parse duration
  const duration = parseDuration(durationStr);
  if (!duration) {
    return interaction.reply({
      content: '❌ Invalid duration format. Use formats like: 1h, 30m, 1d, 1w',
      ephemeral: true
    });
  }

  // Check minimum duration
  if (duration < 60000) { // 1 minute
    return interaction.reply({
      content: '❌ Giveaway duration must be at least 1 minute.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const giveawayData = await giveawaySystem.createGiveaway({
      channelId: channel.id,
      prize: prize,
      duration: duration,
      winnerCount: winners,
      hostId: interaction.user.id,
      description: description,
      embedColor: 0xff73fa
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Giveaway Started!')
      .setDescription(`Successfully started giveaway for **${prize}**`)
      .addFields(
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Winners', value: `${winners}`, inline: true },
        { name: 'Duration', value: formatDuration(duration), inline: true },
        { name: 'Message ID', value: giveawayData.message.id, inline: false }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Giveaway Command] Error starting giveaway:', error);
    await interaction.editReply({
      content: `❌ Failed to start giveaway: ${error.message}`
    });
  }
}

async function executeEnd(interaction) {
  const messageId = interaction.options.getString('message_id');

  const giveaway = giveawaySystem.activeGiveaways.get(messageId);
  if (!giveaway) {
    return interaction.reply({
      content: '❌ Giveaway not found.',
      ephemeral: true
    });
  }

  if (giveaway.status !== 'active') {
    return interaction.reply({
      content: '❌ This giveaway has already ended.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  await giveawaySystem.endGiveaway(messageId);

  const embed = new EmbedBuilder()
    .setTitle('✅ Giveaway Ended')
    .setDescription(`Ended giveaway for **${giveaway.prize}**`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function executeReroll(interaction) {
  const messageId = interaction.options.getString('message_id');
  const winnerCount = interaction.options.getInteger('winners') || 1;

  const giveaway = giveawaySystem.activeGiveaways.get(messageId);
  if (!giveaway) {
    return interaction.reply({
      content: '❌ Giveaway not found.',
      ephemeral: true
    });
  }

  if (giveaway.status !== 'ended') {
    return interaction.reply({
      content: '❌ Can only reroll ended giveaways.',
      ephemeral: true
    });
  }

  // Create a modified giveaway object for reroll
  const rerollGiveaway = {
    ...giveaway,
    winnerCount: winnerCount
  };

  await giveawaySystem.handleReroll(interaction, rerollGiveaway);
}

async function executeCancel(interaction) {
  const messageId = interaction.options.getString('message_id');
  const reason = interaction.options.getString('reason') || 'Cancelled by administrator';

  const giveaway = giveawaySystem.activeGiveaways.get(messageId);
  if (!giveaway) {
    return interaction.reply({
      content: '❌ Giveaway not found.',
      ephemeral: true
    });
  }

  await giveawaySystem.cancelGiveaway(messageId, reason);

  const embed = new EmbedBuilder()
    .setTitle('❌ Giveaway Cancelled')
    .setDescription(`Cancelled giveaway for **${giveaway.prize}**`)
    .addFields({ name: 'Reason', value: reason })
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeList(interaction) {
  const activeGiveaways = Array.from(giveawaySystem.activeGiveaways.values())
    .filter(g => g.guildId === interaction.guild.id && g.status === 'active');

  if (activeGiveaways.length === 0) {
    return interaction.reply({
      content: '📋 No active giveaways in this server.',
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('🎉 Active Giveaways')
    .setColor(0xff73fa)
    .setTimestamp()
    .setFooter({ text: `Total: ${activeGiveaways.length} active giveaways` });

  for (const giveaway of activeGiveaways.slice(0, 10)) {
    const channel = interaction.guild.channels.cache.get(giveaway.channelId);
    const timeLeft = new Date(giveaway.endTime).getTime() - Date.now();
    
    embed.addFields({
      name: giveaway.prize,
      value: [
        `Channel: ${channel || 'Unknown'}`,
        `Winners: ${giveaway.winnerCount}`,
        `Ends: <t:${Math.floor(new Date(giveaway.endTime).getTime() / 1000)}:R>`,
        `Participants: ${new Set(giveaway.participants).size}`,
        `Message ID: ${giveaway.messageId}`
      ].join('\n'),
      inline: false
    });
  }

  if (activeGiveaways.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${activeGiveaways.length} giveaways` });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeStats(interaction) {
  const stats = giveawaySystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Giveaway Statistics')
    .setColor(0xff73fa)
    .addFields(
      { name: 'Total Giveaways', value: `${stats.stats.totalGiveaways}`, inline: true },
      { name: 'Active Giveaways', value: `${stats.activeGiveaways}`, inline: true },
      { name: 'Total Winners', value: `${stats.stats.totalWinners}`, inline: true },
      { name: 'Total Participants', value: `${stats.stats.totalParticipants}`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeRequireRole(interaction, giveaway) {
  const requiredRole = interaction.options.getRole('required_role');
  const blacklistRole = interaction.options.getRole('blacklist_role');

  if (!requiredRole && !blacklistRole) {
    return interaction.reply({
      content: '❌ Please specify at least one role requirement.',
      ephemeral: true
    });
  }

  // Update requirements
  if (requiredRole) {
    giveaway.requirements.requiredRoles = giveaway.requirements.requiredRoles || [];
    if (!giveaway.requirements.requiredRoles.includes(requiredRole.id)) {
      giveaway.requirements.requiredRoles.push(requiredRole.id);
    }
  }

  if (blacklistRole) {
    giveaway.requirements.blacklistRoles = giveaway.requirements.blacklistRoles || [];
    if (!giveaway.requirements.blacklistRoles.includes(blacklistRole.id)) {
      giveaway.requirements.blacklistRoles.push(blacklistRole.id);
    }
  }

  giveawaySystem.saveGiveawayData();

  const embed = new EmbedBuilder()
    .setTitle('✅ Requirements Updated')
    .setDescription('Role requirements have been updated for the giveaway.')
    .setColor(0x00ff00);

  if (requiredRole) {
    embed.addFields({ name: 'Required Role', value: `${requiredRole}`, inline: true });
  }
  if (blacklistRole) {
    embed.addFields({ name: 'Blacklisted Role', value: `${blacklistRole}`, inline: true });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeRequireAccount(interaction, giveaway) {
  const accountAge = interaction.options.getInteger('account_age');
  const serverTime = interaction.options.getInteger('server_time');

  if (!accountAge && !serverTime) {
    return interaction.reply({
      content: '❌ Please specify at least one account requirement.',
      ephemeral: true
    });
  }

  // Update requirements
  if (accountAge) {
    giveaway.requirements.minAccountAge = accountAge;
  }
  if (serverTime) {
    giveaway.requirements.minServerTime = serverTime;
  }

  giveawaySystem.saveGiveawayData();

  const embed = new EmbedBuilder()
    .setTitle('✅ Requirements Updated')
    .setDescription('Account requirements have been updated for the giveaway.')
    .setColor(0x00ff00);

  if (accountAge) {
    embed.addFields({ name: 'Min Account Age', value: `${accountAge} days`, inline: true });
  }
  if (serverTime) {
    embed.addFields({ name: 'Min Server Time', value: `${serverTime} days`, inline: true });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeBonus(interaction, giveaway) {
  const role = interaction.options.getRole('role');
  const entries = interaction.options.getInteger('entries');

  // Update bonus entries
  giveaway.bonusEntries = giveaway.bonusEntries || [];
  
  // Remove existing bonus for this role
  giveaway.bonusEntries = giveaway.bonusEntries.filter(b => b.roleId !== role.id);
  
  // Add new bonus
  giveaway.bonusEntries.push({
    roleId: role.id,
    entries: entries
  });

  giveawaySystem.saveGiveawayData();

  const embed = new EmbedBuilder()
    .setTitle('✅ Bonus Entries Added')
    .setDescription(`Members with ${role} will receive ${entries}x entries!`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// Utility functions
function parseDuration(str) {
  const regex = /^(\d+)([smhdw])$/i;
  const match = str.match(regex);
  
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'w': 7 * 24 * 60 * 60 * 1000
  };
  
  return value * multipliers[unit];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

export const commands = [
  { data: giveawayData, execute },
  { data: giveawayRequireData, execute: executeRequire }
];