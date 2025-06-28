// src/commands/message.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let moderationSystem = null;
let antiNuke = null;
let embedLoader = null;
let permissionSystem = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setAntiNuke(system) {
  antiNuke = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export function setPermissionSystem(system) {
  permissionSystem = system;
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
      .setDescription('Ping everyone? (requires permission)')
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
  // Check permissions using unified system
  if (antiNuke) {
    const level = antiNuke.getPermissionLevel(interaction.member);
    if (level < antiNuke.permissions.LEVELS.ADMINISTRATOR) {
      return interaction.reply({
        content: embedLoader.format('You need Administrator permissions to use this command.', 'message'),
        ephemeral: true
      });
    }
  } else if (moderationSystem) {
    // Fallback to moderation system check
    const permCheck = moderationSystem.checkPermission(interaction.member, 'message');
    if (!permCheck.allowed) {
      return interaction.reply({ 
        content: embedLoader.format(permCheck.reason, 'message'), 
        ephemeral: true 
      });
    }
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
    return interaction.reply({
      content: embedLoader.format('Please select a text channel.', 'message'),
      ephemeral: true
    });
  }

  // Check permissions to send in the channel
  if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
    return interaction.reply({
      content: embedLoader.format('I don\'t have permission to send messages in that channel.', 'message'),
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Create embed using embedLoader
    const embedOptions = {
      description: content,
      formatDescription: false // Don't add system prefix
    };
    
    // Only add title if provided
    if (title) {
      embedOptions.title = title;
    }
    
    // Only add footer if provided
    if (footer) {
      embedOptions.footer = footer;
    }
    
    // Create embed
    const embed = embedLoader.createEmbed(embedOptions);
    
    // Add images if provided
    if (imageUrl) embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

    // Prepare message options
    const messageOptions = {
      embeds: [embed]
    };

    // Add everyone ping if requested and user has permission
    if (mentionEveryone) {
      const canMention = interaction.member.permissions.has(PermissionFlagsBits.MentionEveryone) || 
                        interaction.member.id === interaction.guild.ownerId ||
                        (antiNuke && antiNuke.getPermissionLevel(interaction.member) >= antiNuke.permissions.LEVELS.ANTINUKE_ADMIN);
      
      if (canMention) {
        messageOptions.content = '@everyone';
      } else {
        return interaction.editReply({
          content: embedLoader.format('You don\'t have permission to mention everyone.', 'message')
        });
      }
    }

    // Send the message
    const sentMessage = await channel.send(messageOptions);

    // Reply with success
    await interaction.editReply({
      content: embedLoader.format(`Message sent successfully in ${channel}\n[Jump to message](${sentMessage.url})`, 'message')
    });

    // Log the action
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
    await interaction.editReply({
      content: embedLoader.format('Failed to send message. Please check my permissions and try again.', 'message')
    });
  }
}