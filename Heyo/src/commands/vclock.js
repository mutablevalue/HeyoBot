import {
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';

let j2cManagerInstance;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export const data = new SlashCommandBuilder()
  .setName('vclock')
  .setDescription('Lock your voice channel');

export async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  // Check if user is in a voice channel
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    await interaction.reply({ 
      content: 'You must be in a voice channel to use this command!', 
      ephemeral: true 
    });
    return;
  }
  
  // Check if user owns the channel
  if (!j2cManagerInstance.isUserOwner(interaction.user.id, voiceChannel.id)) {
    await interaction.reply({ 
      content: 'You do not own this voice channel!', 
      ephemeral: true 
    });
    return;
  }
  
  const result = await j2cManagerInstance.lockChannel(voiceChannel, interaction.user.id);
  
  if (!result.success) {
    await interaction.reply({ content: result.message, ephemeral: true });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🔒 Channel Locked')
    .setDescription('Your voice channel has been locked. No new users can join.')
    .setColor(0xffa500)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}