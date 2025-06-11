// src/commands/setstatus.js
// Command to dynamically change bot status - restricted to server owner and antinuke admins

import { SlashCommandBuilder, ActivityType } from 'discord.js';

let antiNuke = null;

export function setAntiNuke(antiNukeSystem) {
  antiNuke = antiNukeSystem;
}

export const data = new SlashCommandBuilder()
  .setName('setstatus')
  .setDescription('Change the bot\'s status and presence')
  .addStringOption(option =>
    option.setName('color')
      .setDescription('Status color')
      .setRequired(true)
      .addChoices(
        { name: 'Online (Green)', value: 'online' },
        { name: 'Idle (Yellow)', value: 'idle' },
        { name: 'Do Not Disturb (Red)', value: 'dnd' },
        { name: 'Invisible (Gray)', value: 'invisible' }
      ))
  .addStringOption(option =>
    option.setName('type')
      .setDescription('Activity type')
      .setRequired(true)
      .addChoices(
        { name: 'Playing', value: 'PLAYING' },
        { name: 'Watching', value: 'WATCHING' },
        { name: 'Listening', value: 'LISTENING' },
        { name: 'Streaming', value: 'STREAMING' },
        { name: 'Competing', value: 'COMPETING' }
      ))
  .addStringOption(option =>
    option.setName('text')
      .setDescription('Activity text')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('url')
      .setDescription('Streaming URL (only for streaming type)')
      .setRequired(false));

export async function execute(interaction) {
  // Check permissions
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  
  // Check if user is an antinuke admin
  let isAntiNukeAdmin = false;
  
  if (antiNuke && antiNuke.config) {
    // Check if user is in antinuke admin users
    if (antiNuke.config.adminUsers?.includes(interaction.user.id)) {
      isAntiNukeAdmin = true;
    }
    
    // Check if user has any antinuke admin role
    if (!isAntiNukeAdmin && antiNuke.config.adminRoles) {
      isAntiNukeAdmin = interaction.member.roles.cache.some(role => 
        antiNuke.config.adminRoles.includes(role.id)
      );
    }
  }
  
  // Only allow server owner or antinuke admins
  if (!isOwner && !isAntiNukeAdmin) {
    return interaction.reply({
      content: '❌ Only the server owner and AntiNuke administrators can change the bot status.',
      ephemeral: true
    });
  }

  const color = interaction.options.getString('color');
  const type = interaction.options.getString('type');
  const text = interaction.options.getString('text');
  const url = interaction.options.getString('url');

  const activityTypes = {
    'PLAYING': ActivityType.Playing,
    'WATCHING': ActivityType.Watching,
    'LISTENING': ActivityType.Listening,
    'STREAMING': ActivityType.Streaming,
    'COMPETING': ActivityType.Competing
  };

  const activityType = activityTypes[type];
  const activityOptions = {
    name: text,
    type: activityType
  };

  if (url && activityType === ActivityType.Streaming) {
    // Validate streaming URL
    if (!url.includes('twitch.tv') && !url.includes('youtube.com')) {
      return interaction.reply({
        content: '❌ Streaming URL must be a valid Twitch or YouTube URL.',
        ephemeral: true
      });
    }
    activityOptions.url = url;
  }

  try {
    // Set the new presence
    await interaction.client.user.setPresence({
      activities: [activityOptions],
      status: color
    });

    const statusEmojis = {
      'online': '🟢',
      'idle': '🟡',
      'dnd': '🔴',
      'invisible': '⚫'
    };

    const embed = {
      title: '✅ Status Updated',
      description: `Bot status has been updated successfully!`,
      fields: [
        {
          name: 'Status',
          value: `${statusEmojis[color]} ${color.charAt(0).toUpperCase() + color.slice(1)}`,
          inline: true
        },
        {
          name: 'Activity',
          value: `${type.charAt(0) + type.slice(1).toLowerCase()} ${text}`,
          inline: true
        },
        {
          name: 'Updated By',
          value: `${interaction.user.tag}`,
          inline: true
        }
      ],
      color: 0x00ff00,
      timestamp: new Date()
    };

    if (url && activityType === ActivityType.Streaming) {
      embed.fields.push({
        name: 'Stream URL',
        value: url,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
    
    // Log the status change if antinuke logging is enabled
    if (antiNuke && antiNuke.config.adminLogChannel) {
      const logChannel = interaction.guild.channels.cache.get(antiNuke.config.adminLogChannel);
      if (logChannel?.isTextBased()) {
        const logEmbed = {
          title: '📊 Bot Status Changed',
          description: `${interaction.user.tag} changed the bot status`,
          fields: [
            { name: 'New Status', value: `${statusEmojis[color]} ${color}`, inline: true },
            { name: 'Activity', value: `${type.charAt(0) + type.slice(1).toLowerCase()} ${text}`, inline: true }
          ],
          color: 0x3498db,
          timestamp: new Date()
        };
        
        await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
      }
    }
  } catch (error) {
    console.error('Error setting status:', error);
    await interaction.reply({
      content: '❌ Failed to update bot status. Please try again.',
      ephemeral: true
    });
  }
}