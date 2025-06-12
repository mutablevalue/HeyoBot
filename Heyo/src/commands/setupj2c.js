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
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
  }

  await interaction.deferReply();
  
  // Get channel name from option or config
  const channelName = interaction.options.getString('channel_name') || 
    j2cManagerInstance.config.get('j2c.defaultChannelName');

  try {
    const result = await j2cManagerInstance.setupJ2C(interaction.guild, channelName);

    if (!result.success) {
      const embed = embedLoader.createEmbed()
        .setDescription(`${result.message}\nExisting Channel: <#${result.channel.id}>`);
      return interaction.editReply({ embeds: [embed] });
    }

    const embed = embedLoader.createEmbed()
      .setTitle('J2C System')
      .setDescription(
        'Join to Create voice channel system has been successfully set up\n\n' +
        `J2C Channel: <#${result.channel.id}>\n\n` +
        'How it works\n' +
        '• Users join this channel\n' +
        '• A new voice channel is created for them\n' +
        '• They become the owner with full control\n' +
        '• Channel is deleted when empty'
      );

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[J2C] Error setting up J2C:', error);
    const embed = embedLoader.createEmbed()
      .setDescription('An error occurred while setting up the J2C system');
    return interaction.editReply({ embeds: [embed] });
  }
}