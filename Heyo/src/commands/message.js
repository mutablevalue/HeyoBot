// src/commands/message.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let moderationSystem = null;
let antiNuke = null;
let embedLoader = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setAntiNuke(system) {
  antiNuke = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('message')
  .setDescription('Send a custom embedded message as the bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('Channel to send the message in')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('content')
      .setDescription('Message content (required)')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('title')
      .setDescription('Embed title (optional)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('footer')
      .setDescription('Embed footer (optional)')
      .setRequired(false))
  .addBooleanOption(option =>
    option.setName('mention_everyone')
      .setDescription('Ping @everyone? (requires permission)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('image_url')
      .setDescription('Image URL for the embed')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('thumbnail_url')
      .setDescription('Thumbnail URL for the embed')
      .setRequired(false));

export async function execute(interaction) {
  // Check permissions - only server owner or AntiNuke admins
  const isOwner = interaction.member.id === interaction.guild.ownerId;
  const isAntiNukeAdmin = antiNuke && (
    antiNuke.config.adminUsers?.includes(interaction.member.id) ||
    interaction.member.roles.cache.some(role => antiNuke.config.adminRoles?.includes(role.id))
  );

  if (!isOwner && !isAntiNukeAdmin) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('This command is restricted to server owner and AntiNuke admins only.')
      : null;
    
    return interaction.reply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'This command is restricted to server owner and AntiNuke admins only.',
      ephemeral: true
    });
  }

  // Get options
  const channel = interaction.options.getChannel('channel');
  const content = interaction.options.getString('content');
  const title = interaction.options.getString('title');
  const footer = interaction.options.getString('footer');
  const mentionEveryone = interaction.options.getBoolean('mention_everyone') ?? false;
  const imageUrl = interaction.options.getString('image_url');
  const thumbnailUrl = interaction.options.getString('thumbnail_url');

  // Check if channel is a text channel
  if (!channel.isTextBased()) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Please select a text channel.')
      : null;
    
    return interaction.reply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Please select a text channel.',
      ephemeral: true
    });
  }

  // Check permissions to send in the channel
  if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('I don\'t have permission to send messages in that channel.')
      : null;
    
    return interaction.reply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'I don\'t have permission to send messages in that channel.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Create embed using embedLoader or fallback
    let embed;
    if (embedLoader) {
      const embedOptions = {
        description: content
      };
      
      // Only add title if provided
      if (title) {
        embedOptions.title = title;
      }
      
      // Only add footer if provided
      if (footer) {
        embedOptions.footer = footer;
      }
      
      // Create embed without system name since this is a custom message
      embed = embedLoader.createEmbed(embedOptions);
      
      // Add images if provided
      if (imageUrl) embed.setImage(imageUrl);
      if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    } else {
      // Fallback embed creation
      const { EmbedBuilder } = await import('discord.js');
      embed = new EmbedBuilder()
        .setColor(0x800080) // Maroon
        .setDescription(content);
      
      if (title) embed.setTitle(title);
      if (footer) embed.setFooter({ text: footer });
      if (imageUrl) embed.setImage(imageUrl);
      if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    }

    // Prepare message options
    const messageOptions = {
      embeds: [embed]
    };

    // Add @everyone ping if requested and user has permission
    if (mentionEveryone) {
      if (interaction.member.permissions.has(PermissionFlagsBits.MentionEveryone) || 
          isOwner || isAntiNukeAdmin) {
        messageOptions.content = '@everyone';
      } else {
        const errorEmbed = embedLoader 
          ? embedLoader.error('You don\'t have permission to mention everyone.')
          : null;
        
        return interaction.editReply({
          embeds: errorEmbed ? [errorEmbed] : undefined,
          content: errorEmbed ? undefined : 'You don\'t have permission to mention everyone.'
        });
      }
    }

    // Send the message
    const sentMessage = await channel.send(messageOptions);

    // Reply with success
    const successEmbed = embedLoader 
      ? embedLoader.success(`Message sent successfully in ${channel}\n[Jump to message](${sentMessage.url})`)
      : null;
    
    await interaction.editReply({
      embeds: successEmbed ? [successEmbed] : undefined,
      content: successEmbed ? undefined : `Message sent successfully in ${channel}`
    });

    // Log the action if moderation system is available
    if (moderationSystem) {
      await moderationSystem.logAction(interaction.guild, {
        action: 'Custom Message Sent',
        moderator: interaction.user,
        target: `Channel: ${channel.name} (${channel.id})`,
        additional: `Content: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`
      });
    }

  } catch (error) {
    console.error('[Message Command] Error sending message:', error);
    const errorEmbed = embedLoader 
      ? embedLoader.error('Failed to send message. Please check my permissions and try again.')
      : null;
    
    await interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Failed to send message. Please check my permissions and try again.'
    });
  }
}