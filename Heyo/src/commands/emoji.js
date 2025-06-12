// src/commands/emoji.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let moderationSystem = null;
let embedLoader = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('emoji')
  .setDescription('Manage server emojis')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add an emoji to the server')
      .addAttachmentOption(option =>
        option
          .setName('image')
          .setDescription('The image file for the emoji (PNG, JPG, or GIF)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Name for the emoji (2-32 characters, alphanumeric and underscores only)')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(32)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for adding this emoji')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove an emoji from the server')
      .addStringOption(option =>
        option
          .setName('emoji')
          .setDescription('The emoji to remove (use the emoji itself or its ID)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for removing this emoji')
          .setRequired(false)
      )
  );

export async function execute(interaction) {
  if (!moderationSystem) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Moderation system not loaded.')
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Moderation system not loaded.',
      ephemeral: true 
    });
  }

  // Check permissions using moderation system
  const permCheck = moderationSystem.checkPermission(interaction.member, 'emoji');
  if (!permCheck.allowed) {
    const errorEmbed = embedLoader 
      ? embedLoader.error(permCheck.reason)
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : permCheck.reason,
      ephemeral: true 
    });
  }

  // Check bot permissions
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('I need the **Manage Emojis and Stickers** permission to manage emojis.')
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'I need the Manage Emojis and Stickers permission to manage emojis.',
      ephemeral: true 
    });
  }

  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'add') {
    return executeAdd(interaction);
  } else if (subcommand === 'remove') {
    return executeRemove(interaction);
  }
}

async function executeAdd(interaction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('image');
  const name = interaction.options.getString('name');
  const reason = interaction.options.getString('reason') || `Added by ${interaction.user.tag}`;

  // Validate emoji name
  const validNameRegex = /^[a-zA-Z0-9_]+$/;
  if (!validNameRegex.test(name)) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Emoji name can only contain letters, numbers, and underscores.')
      : null;
    
    return interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Emoji name can only contain letters, numbers, and underscores.'
    });
  }

  // Check file type
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
  if (!validTypes.includes(attachment.contentType)) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Invalid file type. Please use PNG, JPG, or GIF images.')
      : null;
    
    return interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Invalid file type. Please use PNG, JPG, or GIF images.'
    });
  }

  // Check file size (emojis must be under 256KB)
  const maxSize = 256 * 1024; // 256KB in bytes
  if (attachment.size > maxSize) {
    const errorEmbed = embedLoader 
      ? embedLoader.error(`File is too large. Emojis must be under 256KB. Your file is ${(attachment.size / 1024).toFixed(2)}KB.`)
      : null;
    
    return interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : `File is too large. Emojis must be under 256KB. Your file is ${(attachment.size / 1024).toFixed(2)}KB.`
    });
  }

  // Check if guild has emoji slots available
  const emojiSlots = {
    0: 50,  // No boost level
    1: 100, // Level 1
    2: 150, // Level 2
    3: 250  // Level 3
  };

  const guildBoostLevel = interaction.guild.premiumTier;
  const maxEmojis = emojiSlots[guildBoostLevel];
  const currentEmojis = interaction.guild.emojis.cache.size;

  if (currentEmojis >= maxEmojis) {
    const errorEmbed = embedLoader 
      ? embedLoader.error(`This server has reached its emoji limit (${currentEmojis}/${maxEmojis}). Consider boosting the server for more emoji slots!`)
      : null;
    
    return interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : `This server has reached its emoji limit (${currentEmojis}/${maxEmojis}). Consider boosting the server for more emoji slots!`
    });
  }

  try {
    // Create the emoji
    const emoji = await interaction.guild.emojis.create({
      attachment: attachment.url,
      name: name,
      reason: reason
    });

    // Create success embed
    const fields = [
      {
        name: 'Emoji',
        value: `${emoji} \`:${emoji.name}:\``,
        inline: true
      },
      {
        name: 'Name',
        value: emoji.name,
        inline: true
      },
      {
        name: 'Type',
        value: emoji.animated ? 'Animated' : 'Static',
        inline: true
      },
      {
        name: 'Added By',
        value: interaction.user.toString(),
        inline: true
      },
      {
        name: 'Emoji Slots',
        value: `${currentEmojis + 1}/${maxEmojis}`,
        inline: true
      }
    ];

    if (reason !== `Added by ${interaction.user.tag}`) {
      fields.push({
        name: 'Reason',
        value: reason,
        inline: false
      });
    }

    const embed = embedLoader 
      ? embedLoader.success('Emoji added successfully!', { fields })
      : null;

    if (embed && emoji.url) {
      embed.setThumbnail(emoji.url);
    }

    await interaction.editReply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Emoji added successfully! ${emoji}`
    });

    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Emoji Added',
      moderator: interaction.user,
      target: `:${emoji.name}: (${emoji.id})`,
      reason: reason
    });

  } catch (error) {
    console.error('Error adding emoji:', error);
    
    let errorMessage = 'Failed to add emoji. ';
    
    if (error.code === 30008) {
      errorMessage += 'Maximum number of emojis reached.';
    } else if (error.code === 50035) {
      errorMessage += 'Invalid form body or file format.';
    } else if (error.code === 50013) {
      errorMessage += 'Missing permissions.';
    } else {
      errorMessage += error.message || 'Unknown error occurred.';
    }

    const errorEmbed = embedLoader 
      ? embedLoader.error(errorMessage)
      : null;

    await interaction.editReply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : errorMessage
    });
  }
}

async function executeRemove(interaction) {
  await interaction.deferReply();

  const emojiInput = interaction.options.getString('emoji');
  const reason = interaction.options.getString('reason') || `Removed by ${interaction.user.tag}`;

  let emoji;

  // Try to parse the emoji from the input
  // Check if it's a custom emoji format <:name:id> or <a:name:id>
  const emojiRegex = /<?(a)?:?(\w+):(\d+)>?/;
  const match = emojiInput.match(emojiRegex);

  if (match) {
    // Extract emoji ID from the match
    const emojiId = match[3];
    emoji = interaction.guild.emojis.cache.get(emojiId);
  } else {
    // Try to find by ID or name
    emoji = interaction.guild.emojis.cache.get(emojiInput) || 
            interaction.guild.emojis.cache.find(e => e.name === emojiInput);
  }

  if (!emoji) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Could not find that emoji in this server. Please use the emoji itself or its ID.')
      : null;
    
    return interaction.editReply({
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Could not find that emoji in this server. Please use the emoji itself or its ID.'
    });
  }

  try {
    const emojiInfo = {
      name: emoji.name,
      id: emoji.id,
      animated: emoji.animated,
      url: emoji.url
    };

    // Delete the emoji
    await emoji.delete(reason);

    // Create success embed
    const fields = [
      {
        name: 'Emoji Name',
        value: `:${emojiInfo.name}:`,
        inline: true
      },
      {
        name: 'Emoji ID',
        value: emojiInfo.id,
        inline: true
      },
      {
        name: 'Type',
        value: emojiInfo.animated ? 'Animated' : 'Static',
        inline: true
      },
      {
        name: 'Removed By',
        value: interaction.user.toString(),
        inline: true
      },
      {
        name: 'Emoji Slots',
        value: `${interaction.guild.emojis.cache.size}/${getMaxEmojis(interaction.guild)}`,
        inline: true
      }
    ];

    if (reason !== `Removed by ${interaction.user.tag}`) {
      fields.push({
        name: 'Reason',
        value: reason,
        inline: false
      });
    }

    const embed = embedLoader 
      ? embedLoader.success('Emoji removed successfully!', { fields })
      : null;

    if (embed && emojiInfo.url) {
      embed.setThumbnail(emojiInfo.url);
    }

    await interaction.editReply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Emoji removed successfully! :${emojiInfo.name}:`
    });

    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Emoji Removed',
      moderator: interaction.user,
      target: `:${emojiInfo.name}: (${emojiInfo.id})`,
      reason: reason
    });

  } catch (error) {
    console.error('Error removing emoji:', error);
    
    let errorMessage = 'Failed to remove emoji. ';
    
    if (error.code === 50013) {
      errorMessage += 'Missing permissions.';
    } else if (error.code === 10014) {
      errorMessage += 'Unknown emoji.';
    } else {
      errorMessage += error.message || 'Unknown error occurred.';
    }

    const errorEmbed = embedLoader 
      ? embedLoader.error(errorMessage)
      : null;

    await interaction.editReply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : errorMessage
    });
  }
}

function getMaxEmojis(guild) {
  const emojiSlots = {
    0: 50,  // No boost level
    1: 100, // Level 1
    2: 150, // Level 2
    3: 250  // Level 3
  };

  return emojiSlots[guild.premiumTier];
}