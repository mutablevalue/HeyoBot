// src/commands/leaderboard.js
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

let leaderboardSystem = null;
let embedLoader = null;

export function setLeaderboardSystem(system) {
  leaderboardSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View server leaderboards')
  .addSubcommand(subcommand =>
    subcommand
      .setName('messages')
      .setDescription('View message leaderboard')
      .addStringOption(option =>
        option
          .setName('period')
          .setDescription('Time period to view')
          .setRequired(false)
          .addChoices(
            { name: 'Weekly', value: 'weekly' },
            { name: 'Monthly', value: 'monthly' },
            { name: 'Lifetime', value: 'lifetime' }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('voice')
      .setDescription('View voice time leaderboard')
      .addStringOption(option =>
        option
          .setName('period')
          .setDescription('Time period to view')
          .setRequired(false)
          .addChoices(
            { name: 'Weekly', value: 'weekly' },
            { name: 'Monthly', value: 'monthly' },
            { name: 'Lifetime', value: 'lifetime' }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View your personal statistics')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to view stats for')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('active')
      .setDescription('View currently active voice sessions')
  );

// Standalone commands
export const topData = new SlashCommandBuilder()
  .setName('top')
  .setDescription('View top users by messages or voice time')
  .addStringOption(option =>
    option
      .setName('type')
      .setDescription('Leaderboard type')
      .setRequired(true)
      .addChoices(
        { name: 'Messages', value: 'messages' },
        { name: 'Voice Time', value: 'voice' }
      )
  )
  .addStringOption(option =>
    option
      .setName('period')
      .setDescription('Time period')
      .setRequired(false)
      .addChoices(
        { name: 'Weekly', value: 'weekly' },
        { name: 'Monthly', value: 'monthly' },
        { name: 'Lifetime', value: 'lifetime' }
      )
  );

export async function execute(interaction) {
  if (!leaderboardSystem) {
    const embed = embedLoader.createEmbed()
      .setDescription('Leaderboard system not loaded');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'messages':
      return executeMessages(interaction);
    case 'voice':
      return executeVoice(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'active':
      return executeActive(interaction);
  }
}

async function executeMessages(interaction) {
  const period = interaction.options.getString('period') || 'weekly';
  
  await interaction.deferReply();

  const leaderboard = await leaderboardSystem.getLeaderboard(
    interaction.guild.id, 
    'messages', 
    period, 
    10
  );

  if (leaderboard.length === 0) {
    const embed = embedLoader.createEmbed()
      .setDescription('No message data available for this period yet');
    return interaction.editReply({ embeds: [embed], ephemeral: true });
  }

  const embed = embedLoader.createEmbed()
    .setTitle(`Message Leaderboard - ${capitalize(period)}`);

  // Build leaderboard text
  const leaderboardText = await Promise.all(
    leaderboard.map(async (entry, index) => {
      const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
      const position = index + 1;
      return `**${position}.** ${user ? user.username : 'Unknown User'} - **${entry.value.toLocaleString()}** messages`;
    })
  );

  embed.setDescription(leaderboardText.join('\n'));

  // Add user's rank if not in top 10
  const userStats = leaderboardSystem.getUserStats(interaction.user.id, interaction.guild.id);
  const userMessages = userStats.messages[period];
  const userInTop = leaderboard.some(entry => entry.userId === interaction.user.id);

  if (!userInTop && userMessages > 0) {
    embed.addFields({
      name: 'Your Position',
      value: `You have **${userMessages.toLocaleString()}** messages this ${period}`,
      inline: false
    });
  }

  // Add navigation buttons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('lb_messages_weekly')
        .setLabel('Weekly')
        .setStyle(period === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'weekly'),
      new ButtonBuilder()
        .setCustomId('lb_messages_monthly')
        .setLabel('Monthly')
        .setStyle(period === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'monthly'),
      new ButtonBuilder()
        .setCustomId('lb_messages_lifetime')
        .setLabel('Lifetime')
        .setStyle(period === 'lifetime' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'lifetime')
    );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function executeVoice(interaction) {
  const period = interaction.options.getString('period') || 'weekly';
  
  await interaction.deferReply();

  const leaderboard = await leaderboardSystem.getLeaderboard(
    interaction.guild.id, 
    'voice', 
    period, 
    10
  );

  if (leaderboard.length === 0) {
    const embed = embedLoader.createEmbed()
      .setDescription('No voice data available for this period yet');
    return interaction.editReply({ embeds: [embed], ephemeral: true });
  }

  const embed = embedLoader.createEmbed()
    .setTitle(`Voice Time Leaderboard - ${capitalize(period)}`);

  // Build leaderboard text
  const leaderboardText = await Promise.all(
    leaderboard.map(async (entry, index) => {
      const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
      const position = index + 1;
      const time = leaderboardSystem.constructor.formatTime(entry.value);
      return `**${position}.** ${user ? user.username : 'Unknown User'} - **${time}**`;
    })
  );

  embed.setDescription(leaderboardText.join('\n'));

  // Add user's rank if not in top 10
  const userStats = leaderboardSystem.getUserStats(interaction.user.id, interaction.guild.id);
  const userVoice = userStats.voice[period];
  const userInTop = leaderboard.some(entry => entry.userId === interaction.user.id);

  if (!userInTop && userVoice > 0) {
    embed.addFields({
      name: 'Your Position',
      value: `You have **${leaderboardSystem.constructor.formatTime(userVoice)}** in voice this ${period}`,
      inline: false
    });
  }

  // Add navigation buttons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('lb_voice_weekly')
        .setLabel('Weekly')
        .setStyle(period === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'weekly'),
      new ButtonBuilder()
        .setCustomId('lb_voice_monthly')
        .setLabel('Monthly')
        .setStyle(period === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'monthly'),
      new ButtonBuilder()
        .setCustomId('lb_voice_lifetime')
        .setLabel('Lifetime')
        .setStyle(period === 'lifetime' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(period === 'lifetime')
    );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function executeStats(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const stats = leaderboardSystem.getUserStats(targetUser.id, interaction.guild.id);

  const embed = embedLoader.createEmbed()
    .setTitle(`Statistics for ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

  // Message stats
  embed.addFields({
    name: 'Messages',
    value: `Weekly: **${stats.messages.weekly.toLocaleString()}**\n` +
           `Monthly: **${stats.messages.monthly.toLocaleString()}**\n` +
           `Lifetime: **${stats.messages.lifetime.toLocaleString()}**`,
    inline: true
  });

  // Voice stats
  embed.addFields({
    name: 'Voice Time',
    value: `Weekly: **${leaderboardSystem.constructor.formatTime(stats.voice.weekly)}**\n` +
           `Monthly: **${leaderboardSystem.constructor.formatTime(stats.voice.monthly)}**\n` +
           `Lifetime: **${leaderboardSystem.constructor.formatTime(stats.voice.lifetime)}**`,
    inline: true
  });

  // Current voice session
  const currentSession = leaderboardSystem.voiceStates.get(targetUser.id);
  if (currentSession) {
    const sessionTime = Math.floor((Date.now() - currentSession.joinTime) / 1000);
    embed.addFields({
      name: 'Currently in Voice',
      value: `Session Time: **${leaderboardSystem.constructor.formatTime(sessionTime)}**\n` +
             `Channel: <#${currentSession.channelId}>`,
      inline: false
    });
  }

  // Rankings
  const rankings = [];
  for (const period of ['weekly', 'monthly', 'lifetime']) {
    const msgRank = await getRanking(interaction.guild.id, targetUser.id, 'messages', period);
    const vcRank = await getRanking(interaction.guild.id, targetUser.id, 'voice', period);
    
    if (msgRank > 0 || vcRank > 0) {
      rankings.push(`**${capitalize(period)}**: ` +
        `Messages #${msgRank > 0 ? msgRank : 'N/A'} | ` +
        `Voice #${vcRank > 0 ? vcRank : 'N/A'}`);
    }
  }

  if (rankings.length > 0) {
    embed.addFields({
      name: 'Rankings',
      value: rankings.join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeActive(interaction) {
  const activeSessions = leaderboardSystem.getCurrentVoiceSessions()
    .filter(session => session.guildId === interaction.guild.id);

  if (activeSessions.length === 0) {
    const embed = embedLoader.createEmbed()
      .setDescription('No active voice sessions right now');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const embed = embedLoader.createEmbed()
    .setTitle('Active Voice Sessions');

  // Sort by duration
  activeSessions.sort((a, b) => b.duration - a.duration);

  const sessionText = await Promise.all(
    activeSessions.slice(0, 20).map(async (session) => {
      const user = await interaction.client.users.fetch(session.userId).catch(() => null);
      const channel = interaction.guild.channels.cache.get(session.channelId);
      const time = leaderboardSystem.constructor.formatTime(session.duration);
      
      return `**${user ? user.username : 'Unknown'}** - ${time} in ${channel ? channel.name : 'Unknown Channel'}`;
    })
  );

  embed.setDescription(sessionText.join('\n'));

  if (activeSessions.length > 20) {
    embed.addFields({
      name: 'Note',
      value: `Showing top 20 of ${activeSessions.length} active sessions`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeTop(interaction) {
  const type = interaction.options.getString('type');
  const period = interaction.options.getString('period') || 'weekly';
  
  await interaction.deferReply();

  const leaderboard = await leaderboardSystem.getLeaderboard(
    interaction.guild.id, 
    type, 
    period, 
    10
  );

  if (leaderboard.length === 0) {
    const embed = embedLoader.createEmbed()
      .setDescription(`No ${type} data available for this period yet`);
    return interaction.editReply({ embeds: [embed], ephemeral: true });
  }

  const embed = embedLoader.createEmbed()
    .setTitle(`Top ${capitalize(type)} - ${capitalize(period)}`);

  // Build leaderboard text
  const leaderboardText = await Promise.all(
    leaderboard.map(async (entry, index) => {
      const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
      const position = index + 1;
      
      if (type === 'messages') {
        return `**${position}.** ${user ? user.username : 'Unknown User'} - **${entry.value.toLocaleString()}** messages`;
      } else {
        const time = leaderboardSystem.constructor.formatTime(entry.value);
        return `**${position}.** ${user ? user.username : 'Unknown User'} - **${time}**`;
      }
    })
  );

  embed.setDescription(leaderboardText.join('\n'));

  await interaction.editReply({ embeds: [embed] });
}

// Helper function to get user ranking
async function getRanking(guildId, userId, type, period) {
  const allData = leaderboardSystem.data[type][period];
  const guildEntries = [];

  for (const [key, value] of allData.entries()) {
    if (key.startsWith(`${guildId}-`)) {
      guildEntries.push({ userId: key.split('-')[1], value });
    }
  }

  guildEntries.sort((a, b) => b.value - a.value);
  
  const index = guildEntries.findIndex(entry => entry.userId === userId);
  return index >= 0 ? index + 1 : 0;
}

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// Handle button interactions
export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  const [, type, period] = interaction.customId.split('_'); 
  if (!['messages','voice'].includes(type)) return;

  // fetch the new top 10
  const leaderboard = await leaderboardSystem.getLeaderboard(
    interaction.guild.id,
    type,
    period,
    10
  );

  // if no data, just ack & exit
  if (leaderboard.length === 0) {
    const embed = embedLoader.createEmbed()
      .setDescription(
        type === 'messages'
          ? 'No message data available for this period yet'
          : 'No voice data available for this period yet'
      );
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }

  // build the embed
  const embed = embedLoader.createEmbed()
    .setTitle(
      type === 'messages'
        ? `Message Leaderboard - ${capitalize(period)}`
        : `Voice Time Leaderboard - ${capitalize(period)}`
    );

  // build the description lines
  const description = await Promise.all(
    leaderboard.map(async (entry, i) => {
      const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
      const position = i + 1;
      if (type === 'messages') {
        return `**${position}.** ${user?.username || 'Unknown'} - **${entry.value.toLocaleString()}** messages`;
      } else {
        const time = leaderboardSystem.constructor.formatTime(entry.value);
        return `**${position}.** ${user?.username || 'Unknown'} - **${time}**`;
      }
    })
  );
  embed.setDescription(description.join('\n'));

  // if user not in top 10, show their stat
  const stats = leaderboardSystem.getUserStats(interaction.user.id, interaction.guild.id);
  const userValue = type === 'messages'
    ? stats.messages[period]
    : stats.voice[period];
  if (!leaderboard.some(e => e.userId === interaction.user.id) && userValue > 0) {
    embed.addFields({
      name: 'Your Position',
      value: type === 'messages'
        ? `You have **${userValue.toLocaleString()}** messages this ${period}`
        : `You have **${leaderboardSystem.constructor.formatTime(userValue)}** in voice this ${period}`
    });
  }

  // rebuild the three period buttons
  const row = new ActionRowBuilder().addComponents(
    ['weekly','monthly','lifetime'].map(p =>
      new ButtonBuilder()
        .setCustomId(`lb_${type}_${p}`)
        .setLabel(capitalize(p))
        .setStyle(p === period ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(p === period)
    )
  );

  // and finally update the original message
  await interaction.update({ embeds: [embed], components: [row] });
}

export const commands = [
  { data, execute },
  { data: topData, execute: executeTop }
];