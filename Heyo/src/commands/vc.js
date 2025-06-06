import {
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';

let j2cManagerInstance;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export const data = new SlashCommandBuilder()
  .setName('vc')
  .setDescription('Voice channel management commands')
  .addSubcommand(subcommand =>
    subcommand
      .setName('lock')
      .setDescription('Lock your voice channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('unlock')
      .setDescription('Unlock your voice channel')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reject')
      .setDescription('Reject a user from your voice channel')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to reject')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('allow')
      .setDescription('Allow a rejected user back into your voice channel')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to allow')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('limit')
      .setDescription('Set user limit for your voice channel')
      .addIntegerOption(option =>
        option.setName('limit')
          .setDescription('User limit (0 for unlimited)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(99)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('rename')
      .setDescription('Rename your voice channel')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('New channel name')
          .setRequired(true)
          .setMaxLength(100)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('help')
      .setDescription('Show all voice channel commands')
  );

export async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  // Handle help command
  if (subcommand === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('Voice Channel Commands')
      .setDescription('Commands for managing your created voice channel')
      .setColor(0x00ff00)
      .addFields(
        { name: '/vc lock', value: 'Lock your voice channel (prevent new users from joining)' },
        { name: '/vc unlock', value: 'Unlock your voice channel' },
        { name: '/vc reject <user>', value: 'Remove a user and prevent them from seeing your channel' },
        { name: '/vc allow <user>', value: 'Allow a rejected user back into your channel' },
        { name: '/vc limit <number>', value: 'Set user limit for your channel (0 for unlimited)' },
        { name: '/vc rename <name>', value: 'Rename your voice channel' }
      )
      .setFooter({ text: 'You must be in your created voice channel to use these commands' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
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
  
  // Handle subcommands
  switch (subcommand) {
    case 'lock': {
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
      break;
    }
    
    case 'unlock': {
      const result = await j2cManagerInstance.unlockChannel(voiceChannel, interaction.user.id);
      
      if (!result.success) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🔓 Channel Unlocked')
        .setDescription('Your voice channel has been unlocked. New users can join.')
        .setColor(0x00ff00)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'reject': {
      const targetUser = interaction.options.getUser('user');
      const result = await j2cManagerInstance.rejectUser(voiceChannel, interaction.user.id, targetUser.id);
      
      if (!result.success) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('❌ User Rejected')
        .setDescription(`${targetUser} has been rejected from your voice channel.`)
        .setColor(0xff0000)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'allow': {
      const targetUser = interaction.options.getUser('user');
      const result = await j2cManagerInstance.allowUser(voiceChannel, interaction.user.id, targetUser.id);
      
      if (!result.success) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('✅ User Allowed')
        .setDescription(`${targetUser} can now join your voice channel again.`)
        .setColor(0x00ff00)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'limit': {
      const limit = interaction.options.getInteger('limit');
      const result = await j2cManagerInstance.setUserLimit(voiceChannel, interaction.user.id, limit);
      
      if (!result.success) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('👥 User Limit Set')
        .setDescription(`User limit set to ${limit === 0 ? 'unlimited' : limit}`)
        .setColor(0x00ff00)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'rename': {
      const newName = interaction.options.getString('name');
      const result = await j2cManagerInstance.renameChannel(voiceChannel, interaction.user.id, newName);
      
      if (!result.success) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setTitle('✏️ Channel Renamed')
        .setDescription(`Channel renamed to: **${newName}**`)
        .setColor(0x00ff00)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
  }
}