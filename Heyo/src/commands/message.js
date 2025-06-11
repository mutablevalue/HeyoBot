// src/commands/message.js
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

let moderationSystem = null;
let antiNuke = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setAntiNuke(system) {
  antiNuke = system;
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
    option.setName('timestamp')
      .setDescription('Add timestamp to embed?')
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
    return interaction.reply({
      content: '❌ This command is restricted to server owner and AntiNuke admins only.',
      ephemeral: true
    });
  }

  // Get options
  const channel = interaction.options.getChannel('channel');
  const content = interaction.options.getString('content');
  const title = interaction.options.getString('title');
  const footer = interaction.options.getString('footer');
  const timestamp = interaction.options.getBoolean('timestamp') ?? false;
  const mentionEveryone = interaction.options.getBoolean('mention_everyone') ?? false;
  const imageUrl = interaction.options.getString('image_url');
  const thumbnailUrl = interaction.options.getString('thumbnail_url');

  // Check if channel is a text channel
  if (!channel.isTextBased()) {
    return interaction.reply({
      content: '❌ Please select a text channel.',
      ephemeral: true
    });
  }

  // Check permissions to send in the channel
  if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
    return interaction.reply({
      content: '❌ I don\'t have permission to send messages in that channel.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Create black embed
    const embed = new EmbedBuilder()
      .setColor(0x000000) // Black color
      .setDescription(content);

    // Add optional fields
    if (title) embed.setTitle(title);
    if (footer) embed.setFooter({ text: footer });
    if (timestamp) embed.setTimestamp();
    if (imageUrl) embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

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
        return interaction.editReply({
          content: '❌ You don\'t have permission to mention everyone.'
        });
      }
    }

    // Send the message
    const sentMessage = await channel.send(messageOptions);

    // Reply with success
    await interaction.editReply({
      content: `✅ Message sent successfully in ${channel}\n[Jump to message](${sentMessage.url})`
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
    await interaction.editReply({
      content: '❌ Failed to send message. Please check my permissions and try again.'
    });
  }
}