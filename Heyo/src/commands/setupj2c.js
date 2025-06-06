import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let j2cManagerInstance;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export const data = new SlashCommandBuilder()
  .setName('setupj2c')
  .setDescription('Set up Join to Create voice channel system')
  .addStringOption(option =>
    option.setName('channel_name')
      .setDescription('Name for the J2C channel (default: ➕ Create Voice Channel)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  await interaction.deferReply();
  
  const channelName = interaction.options.getString('channel_name') || '➕ Create Voice Channel';
  
  try {
    const result = await j2cManagerInstance.setupJ2C(interaction.guild, channelName);
    
    if (!result.success) {
      const embed = new EmbedBuilder()
        .setTitle('J2C Setup Failed')
        .setDescription(result.message)
        .setColor(0xff0000)
        .addFields(
          { name: 'Existing Channel', value: `<#${result.channel.id}>` }
        )
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle('✅ J2C System Set Up')
      .setDescription('Join to Create voice channel system has been successfully set up!')
      .setColor(0x00ff00)
      .addFields(
        { name: 'J2C Channel', value: `<#${result.channel.id}>` },
        { name: 'How it works', value: 
          '1️⃣ Users join this channel\n' +
          '2️⃣ A new voice channel is created for them\n' +
          '3️⃣ They become the owner with full control\n' +
          '4️⃣ Channel is deleted when empty' 
        }
      )
      .setFooter({ text: 'Use /vchelp for voice channel commands' })
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error setting up J2C:', error);
    
    const embed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription('An error occurred while setting up the J2C system.')
      .setColor(0xff0000)
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }
}