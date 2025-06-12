// src/commands/skullboard.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

let skullboardSystem = null;
let embedLoader = null;
let moderationSystem = null;

export function setSkullboardSystem(system) {
  skullboardSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export function setModerationSystem(system) {
  moderationSystem = system;
}

// Setup skullboard command
export const setupSkullboardData = new SlashCommandBuilder()
  .setName('setupskullboard')
  .setDescription('Set up the skullboard channel')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel where skullboard messages will be sent')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('emoji')
      .setDescription('Emoji to use for skullboard (default: 💀)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('threshold')
      .setDescription('Number of reactions needed to appear on skullboard')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Skullboard stats command
export const skullboardStatsData = new SlashCommandBuilder()
  .setName('skullboardstats')
  .setDescription('View skullboard statistics');

// Skullboard leaderboard command
export const skullboardTopData = new SlashCommandBuilder()
  .setName('skullboardtop')
  .setDescription('View top skullboard messages');

// Execute functions
export async function executeSetupSkullboard(interaction) {
  if (!skullboardSystem || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Skullboard system not loaded.', 'message') || 'Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  // Check moderation permissions if system is available
  if (moderationSystem) {
    const hasAdminPerms = moderationSystem.hasPermissionLevel(interaction.member, 'administrator') ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                         interaction.member.id === interaction.guild.ownerId;
    
    if (!hasAdminPerms) {
      return interaction.reply({
        content: embedLoader.format('You need administrator permissions to set up skullboard.', 'message'),
        ephemeral: true
      });
    }
    
    // Check cooldown
    const cooldown = moderationSystem.checkCooldown(interaction.user.id, 'setupskullboard');
    if (cooldown.onCooldown) {
      return interaction.reply({
        content: embedLoader.format(`Please wait ${cooldown.timeLeft} seconds before using this command again.`, 'message'),
        ephemeral: true
      });
    }
  }
  
  const channel = interaction.options.getChannel('channel');
  const emoji = interaction.options.getString('emoji') || skullboardSystem.config.emoji;
  const threshold = interaction.options.getInteger('threshold') || skullboardSystem.config.defaultThreshold;
  
  await interaction.deferReply();
  
  const success = await skullboardSystem.setupSkullboard(interaction.guild, channel.id, threshold, emoji);
  
  if (success) {
    const embed = embedLoader.createEmbed({
      title: 'Skullboard',
      description: 'Skullboard has been configured for this server',
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Emoji', value: emoji, inline: true },
        { name: 'Threshold', value: `${threshold} reactions`, inline: true },
        { name: 'Set By', value: `${interaction.user.tag}`, inline: true }
      ],
      footer: `Messages need ${threshold} ${emoji} reactions to appear on skullboard`
    });
    
    await interaction.editReply({ embeds: [embed] });
    
    // Log the action
    if (moderationSystem) {
      await moderationSystem.logAction(interaction.guild, {
        action: 'Skullboard Setup',
        moderator: interaction.user,
        target: `#${channel.name}`,
        additional: `Emoji: ${emoji}, Threshold: ${threshold}`
      });
    }
  } else {
    await interaction.editReply({ 
      content: embedLoader.format('Failed to set up skullboard channel.', 'message')
    });
  }
}

export async function executeSkullboardStats(interaction) {
  if (!skullboardSystem || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Skullboard system not loaded.', 'message') || 'Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  const stats = skullboardSystem.getStats(interaction.guild.id);
  
  const fields = [
    { name: 'Total Messages', value: stats.total.toString(), inline: true },
    { name: 'Emoji', value: stats.config?.emoji || skullboardSystem.config.emoji, inline: true },
    { name: 'Threshold', value: stats.config?.threshold?.toString() || 'Not set', inline: true }
  ];
  
  if (stats.config?.channelId) {
    fields.push({ 
      name: 'Skullboard Channel', 
      value: `<#${stats.config.channelId}>`, 
      inline: false 
    });
  } else {
    fields.push({ 
      name: 'Status', 
      value: 'Skullboard not set up in this server', 
      inline: false 
    });
  }
  
  const embed = embedLoader.createEmbed({
    title: 'Skullboard Statistics',
    description: `Statistics for ${interaction.guild.name}'s skullboard`,
    fields: fields
  });
  
  await interaction.reply({ embeds: [embed] });
}

export async function executeSkullboardTop(interaction) {
  if (!skullboardSystem || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader?.format('Skullboard system not loaded.', 'message') || 'Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  const stats = skullboardSystem.getStats(interaction.guild.id);
  
  if (!stats.config?.channelId) {
    return interaction.reply({ 
      content: embedLoader.format('Skullboard is not set up in this server.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (stats.topMessages.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No messages on the skullboard yet!', 'message'), 
      ephemeral: true 
    });
  }
  
  const guildEmoji = stats.config.emoji || skullboardSystem.config.emoji;
  
  const fields = [];
  
  // Add top messages
  for (let i = 0; i < Math.min(10, stats.topMessages.length); i++) {
    const msg = stats.topMessages[i];
    const prefix = `${i + 1}.`;
    
    fields.push({
      name: `${prefix} ${guildEmoji} ${msg.reactionCount}`,
      value: `By <@${msg.authorId}> in <#${msg.channelId}>\n[Jump to message](https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.originalMessageId})`,
      inline: false
    });
  }
  
  const embed = embedLoader.createEmbed({
    title: 'Top Skullboard Messages',
    description: `Top ${Math.min(10, stats.topMessages.length)} messages by ${guildEmoji} count`,
    fields: fields
  });
  
  await interaction.reply({ embeds: [embed] });
}

// Export commands
export const commands = [
  { data: setupSkullboardData, execute: executeSetupSkullboard },
  { data: skullboardStatsData, execute: executeSkullboardStats },
  { data: skullboardTopData, execute: executeSkullboardTop }
];