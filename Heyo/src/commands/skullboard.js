// src/commands/skullboard.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js';

let skullboardSystem = null;

export function setSkullboardSystem(system) {
  skullboardSystem = system;
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

// Import moderation system reference
let moderationSystem = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

// Execute functions
export async function executeSetupSkullboard(interaction) {
  if (!skullboardSystem) {
    return interaction.reply({ 
      content: '❌ Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  // Check moderation permissions if system is available
  if (moderationSystem) {
    // For setupskullboard, we'll check if user has admin permissions
    // even if the command isn't explicitly in the config
    const hasAdminPerms = moderationSystem.hasPermissionLevel(interaction.member, 'administrator') ||
                         interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                         interaction.member.id === interaction.guild.ownerId;
    
    if (!hasAdminPerms) {
      return interaction.reply({
        content: '❌ You need administrator permissions to set up skullboard.',
        ephemeral: true
      });
    }
    
    // Check cooldown
    const cooldown = moderationSystem.checkCooldown(interaction.user.id, 'setupskullboard');
    if (cooldown.onCooldown) {
      return interaction.reply({
        content: `⏱️ Please wait ${cooldown.timeLeft} seconds before using this command again.`,
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
    const embed = new EmbedBuilder()
      .setTitle('✅ Skullboard Channel Set')
      .setDescription(`Skullboard has been configured for this server`)
      .addFields(
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Emoji', value: emoji, inline: true },
        { name: 'Threshold', value: `${threshold} reactions`, inline: true },
        { name: 'Set By', value: `${interaction.user.tag}`, inline: true }
      )
      .setColor(0x00ff00)
      .setFooter({ text: `Messages need ${threshold} ${emoji} reactions to appear on skullboard` })
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
    
    // Log the action
    if (moderationSystem) {
      await moderationSystem.logAction(interaction.guild, {
        action: 'Skullboard Setup',
        moderator: interaction.user,
        target: `#${channel.name}`,
        additional: `Emoji: ${emoji}, Threshold: ${threshold}`,
        color: 0x00ff00
      });
    }
  } else {
    await interaction.editReply({ 
      content: '❌ Failed to set up skullboard channel.' 
    });
  }
}

export async function executeSkullboardStats(interaction) {
  if (!skullboardSystem) {
    return interaction.reply({ 
      content: '❌ Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  const stats = skullboardSystem.getStats(interaction.guild.id);
  
  const embed = new EmbedBuilder()
    .setTitle(`📊 Skullboard Statistics`)
    .setDescription(`Statistics for ${interaction.guild.name}'s skullboard`)
    .addFields(
      { name: 'Total Messages', value: stats.total.toString(), inline: true },
      { name: 'Emoji', value: stats.config?.emoji || skullboardSystem.config.emoji, inline: true },
      { name: 'Threshold', value: stats.config?.threshold?.toString() || 'Not set', inline: true }
    )
    .setColor(0xffd700)
    .setTimestamp();
  
  if (stats.config?.channelId) {
    embed.addFields({ 
      name: 'Skullboard Channel', 
      value: `<#${stats.config.channelId}>`, 
      inline: false 
    });
  } else {
    embed.addFields({ 
      name: 'Status', 
      value: '❌ Skullboard not set up in this server', 
      inline: false 
    });
  }
  
  await interaction.reply({ embeds: [embed] });
}

export async function executeSkullboardTop(interaction) {
  if (!skullboardSystem) {
    return interaction.reply({ 
      content: '❌ Skullboard system not loaded.', 
      ephemeral: true 
    });
  }
  
  const stats = skullboardSystem.getStats(interaction.guild.id);
  
  if (!stats.config?.channelId) {
    return interaction.reply({ 
      content: '❌ Skullboard is not set up in this server.', 
      ephemeral: true 
    });
  }
  
  if (stats.topMessages.length === 0) {
    return interaction.reply({ 
      content: 'No messages on the skullboard yet!', 
      ephemeral: true 
    });
  }
  
  const guildEmoji = stats.config.emoji || skullboardSystem.config.emoji;
  
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Top Skullboard Messages`)
    .setDescription(`Top ${Math.min(10, stats.topMessages.length)} messages by ${guildEmoji} count`)
    .setColor(0xffd700)
    .setTimestamp();
  
  // Add top messages
  for (let i = 0; i < Math.min(10, stats.topMessages.length); i++) {
    const msg = stats.topMessages[i];
    const medals = ['🥇', '🥈', '🥉'];
    const prefix = medals[i] || `**${i + 1}.**`;
    
    embed.addFields({
      name: `${prefix} ${guildEmoji} ${msg.reactionCount}`,
      value: `By <@${msg.authorId}> in <#${msg.channelId}>\n[Jump to message](https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.originalMessageId})`,
      inline: false
    });
  }
  
  await interaction.reply({ embeds: [embed] });
}

// Export commands
export const commands = [
  { data: setupSkullboardData, execute: executeSetupSkullboard },
  { data: skullboardStatsData, execute: executeSkullboardStats },
  { data: skullboardTopData, execute: executeSkullboardTop }
];