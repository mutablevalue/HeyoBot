// src/commands/confess.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';
import { EmbedLoader } from '../utils/embedLoader.js';

let confessSystem = null;
let embedLoader = null;

export function setConfessSystem(system) {
  confessSystem = system;
  // Initialize embedLoader using the confessSystem's configLoader
  if (system && system.configLoader) {
    embedLoader = new EmbedLoader(system.configLoader);
  }
}

// Setup confess command
export const setupConfessData = new SlashCommandBuilder()
  .setName('setupconfess')
  .setDescription('Set up the confession channel')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel where confessions will be sent')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

// Confess command
export const confessData = new SlashCommandBuilder()
  .setName('confess')
  .setDescription('Send an anonymous confession');

// Confession stats command
export const confessStatsData = new SlashCommandBuilder()
  .setName('confessstats')
  .setDescription('View confession statistics')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// Delete confession command
export const deleteConfessionData = new SlashCommandBuilder()
  .setName('deleteconfession')
  .setDescription('Delete a confession by ID')
  .addStringOption(option =>
    option
      .setName('id')
      .setDescription('Confession ID (e.g., CONF-0001)')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// Execute functions
export async function executeSetupConfess(interaction) {
  if (!confessSystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Confession system not loaded.', 
      ephemeral: true 
    });
  }
  
  const channel = interaction.options.getChannel('channel');
  
  await interaction.deferReply();
  
  const success = await confessSystem.setupConfessChannel(interaction.guild, channel.id);
  
  if (success) {
    const embed = embedLoader.success(`Confessions will now be sent to ${channel}`);
    embed.addFields(
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Set By', value: `${interaction.user.tag}`, inline: true }
    );
    
    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = embedLoader.error('Failed to set up confession channel.');
    await interaction.editReply({ embeds: [embed] });
  }
}

export async function executeConfess(interaction) {
  if (!confessSystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Confession system not loaded.', 
      ephemeral: true 
    });
  }
  
  // Show the confession modal
  await confessSystem.createConfessModal(interaction);
}

export async function executeConfessStats(interaction) {
  if (!confessSystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Confession system not loaded.', 
      ephemeral: true 
    });
  }
  
  const stats = confessSystem.getStats(interaction.guild.id);
  
  const embed = embedLoader.system('Confession Statistics', '', {
    fields: [
      { name: 'Total Confessions', value: stats.total.toString(), inline: true },
      { name: 'Guild Confessions', value: stats.guildTotal.toString(), inline: true },
      { name: 'Today\'s Confessions', value: stats.todayCount.toString(), inline: true },
      { name: 'Confession Channel', value: stats.channelId ? `<#${stats.channelId}>` : 'Not set', inline: false }
    ]
  });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function executeDeleteConfession(interaction) {
  if (!confessSystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Confession system not loaded.', 
      ephemeral: true 
    });
  }
  
  const confessionId = interaction.options.getString('id').toUpperCase();
  
  // Get confession data
  const confession = confessSystem.getConfession(confessionId);
  
  if (!confession) {
    const embed = embedLoader.error('Confession not found.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // Check if confession is from this guild
  if (confession.guildId !== interaction.guild.id) {
    const embed = embedLoader.error('This confession is not from this guild.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // Delete confession
  const deleted = await confessSystem.deleteConfession(confessionId, interaction.user.id);
  
  if (deleted) {
    const embed = embedLoader.success(`Confession ${confessionId} has been marked as deleted.`);
    embed.addFields(
      { name: 'Deleted By', value: interaction.user.tag, inline: true },
      { name: 'Original Author', value: `||<@${confession.userId}>||`, inline: true }
    );
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
    // Log the deletion
    if (confessSystem.config.logChannel) {
      const logChannel = interaction.guild.channels.cache.get(confessSystem.config.logChannel);
      if (logChannel?.isTextBased()) {
        const logEmbed = embedLoader.createEmbed({
          description: `${confessionId} was deleted by ${interaction.user.tag}`,
          fields: [
            { name: 'Content', value: confession.content.slice(0, 1024), inline: false }
          ]
        });
        
        await logChannel.send({ embeds: [logEmbed] });
      }
    }
  } else {
    const embed = embedLoader.error('Failed to delete confession.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

// Export commands
export const commands = [
  { data: setupConfessData, execute: executeSetupConfess },
  { data: confessData, execute: executeConfess },
  { data: confessStatsData, execute: executeConfessStats },
  { data: deleteConfessionData, execute: executeDeleteConfession }
];