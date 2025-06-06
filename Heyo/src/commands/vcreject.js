import {
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';

let j2cManagerInstance;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export const data = new SlashCommandBuilder()
  .setName('vcreject')
  .setDescription('Reject a user from your voice channel')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('User to reject from your channel')
      .setRequired(true)
  );

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
  
  const targetUser = interaction.options.getUser('user');
  const result = await j2cManagerInstance.rejectUser(voiceChannel, interaction.user.id, targetUser.id);
  
  if (!result.success) {
    await interaction.reply({ content: result.message, ephemeral: true });
    return;
  }
  
  const embed = new EmbedBuilder()
    .setTitle('❌ User Rejected')
    .setDescription(`${targetUser} has been rejected from your voice channel and can no longer see or join it.`)
    .setColor(0xff0000)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}