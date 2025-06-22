// commands/setupj2c.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let j2cManagerInstance = null;
let embedLoader = null;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('setupj2c')
  .setDescription('Set up Join to Create voice channel system')
  .addStringOption(option =>
    option
      .setName('channel_name')
      .setDescription('Name for the J2C channel')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('category_name')
      .setDescription('Name for the category to hold created channels')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  if (!interaction.guild) {
    // For plain text responses, don't use format
    return interaction.reply({
      content: 'This can only be used in a server.',
      ephemeral: true
    });
  }

  await interaction.deferReply();
 
  // Get channel and category names from options or config
  const channelName = interaction.options.getString('channel_name') ||
    j2cManagerInstance.config.get('j2c.defaultChannelName') || 'Join to Create';
  const categoryName = interaction.options.getString('category_name');

  try {
    const result = await j2cManagerInstance.setupJ2C(interaction.guild, channelName, categoryName);

    if (!result.success) {
      // Let createEmbed handle the formatting
      const embed = embedLoader.createEmbed({
        description: `${result.message}\nExisting Channel: <#${result.channel.id}>`
      });
      return interaction.editReply({ embeds: [embed] });
    }

    // For the success message, we don't want formatting on the description
    // because it contains formatted sections
    const embed = embedLoader.createEmbed({
      title: 'J2C System',
      description: `Join to Create voice channel system has been successfully set up\n\nJ2C Channel: <#${result.channel.id}>\nCategory: <#${result.category.id}>\n\nHow it works\n• Users join the J2C channel\n• A new voice channel is created in the category\n• They become the owner with full control\n• Channel is deleted when empty`,
      formatDescription: false
    });

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[J2C] Error setting up J2C:', error);
    // Let createEmbed handle the formatting
    const embed = embedLoader.createEmbed({
      description: 'An error occurred while setting up the J2C system'
    });
    return interaction.editReply({ embeds: [embed] });
  }
}