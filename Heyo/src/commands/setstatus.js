// src/commands/setstatus.js
// Command to dynamically change bot status - restricted to server owner and antinuke admins

import { SlashCommandBuilder, ActivityType } from 'discord.js';

let antiNuke = null;
let embedLoader = null;

export function setAntiNuke(antiNukeSystem) {
  antiNuke = antiNukeSystem;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
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
    const errorEmbed = embedLoader 
      ? embedLoader.error('Only the server owner and AntiNuke administrators can change the bot status.')
      : null;
    
    return interaction.reply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Only the server owner and AntiNuke administrators can change the bot status.',
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
      const errorEmbed = embedLoader 
        ? embedLoader.error('Streaming URL must be a valid Twitch or YouTube URL.')
        : null;
      
      return interaction.reply({
        embeds: errorEmbed ? [errorEmbed] : undefined,
        content: errorEmbed ? undefined : 'Streaming URL must be a valid Twitch or YouTube URL.',
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

    const statusColors = {
      'online': 'Online',
      'idle': 'Idle',
      'dnd': 'Do Not Disturb',
      'invisible': 'Invisible'
    };

    const fields = [
      {
        name: 'Status',
        value: statusColors[color],
        inline: true
      },
      {
        name: 'Activity',
        value: `${type.charAt(0) + type.slice(1).toLowerCase()} ${text}`,
        inline: true
      },
      {
        name: 'Updated By',
        value: interaction.user.tag,
        inline: true
      }
    ];

    if (url && activityType === ActivityType.Streaming) {
      fields.push({
        name: 'Stream URL',
        value: url,
        inline: false
      });
    }

    const embed = embedLoader 
      ? embedLoader.success('Bot status has been updated successfully!', { fields })
      : null;

    await interaction.reply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : 'Status updated successfully!'
    });
    
    // Log the status change if antinuke logging is enabled
    if (antiNuke && antiNuke.config.adminLogChannel) {
      const logChannel = interaction.guild.channels.cache.get(antiNuke.config.adminLogChannel);
      if (logChannel?.isTextBased()) {
        const logEmbed = embedLoader 
          ? embedLoader.info(`${interaction.user.tag} changed the bot status`, {
              fields: [
                { name: 'New Status', value: statusColors[color], inline: true },
                { name: 'Activity', value: `${type.charAt(0) + type.slice(1).toLowerCase()} ${text}`, inline: true }
              ]
            })
          : null;
        
        if (logEmbed) {
          await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
        }
      }
    }
  } catch (error) {
    console.error('Error setting status:', error);
    const errorEmbed = embedLoader 
      ? embedLoader.error('Failed to update bot status. Please try again.')
      : null;
    
    await interaction.reply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Failed to update bot status. Please try again.',
      ephemeral: true
    });
  }
}