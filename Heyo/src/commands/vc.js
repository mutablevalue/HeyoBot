// commands/vc.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let j2cManagerInstance = null;
let embedLoader = null;

export function setJ2CManager(j2cManager) {
  j2cManagerInstance = j2cManager;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
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
      .setName('take')
      .setDescription('Take ownership of a voice channel (if owner is not present)')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('help')
      .setDescription('Show all voice channel commands')
  );

export async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ 
      content: embedLoader.format('This command can only be used in a server.', 'message'), 
      ephemeral: true 
    });
    return;
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  // Handle help command
  if (subcommand === 'help') {
    const embed = embedLoader.createEmbed({
      title: 'Voice Channel Commands',
      description: 
        'Commands for managing your created voice channel\n\n' +
        '**__Commands:__**\n' +
        '`/vc lock` - Lock your voice channel (prevent new users from joining)\n' +
        '`/vc unlock` - Unlock your voice channel\n' +
        '`/vc reject <user>` - Remove a user and prevent them from seeing your channel\n' +
        '`/vc allow <user>` - Allow a rejected user back into your channel\n' +
        '`/vc limit <number>` - Set user limit for your channel (0 for unlimited)\n' +
        '`/vc rename <name>` - Rename your voice channel\n' +
        '`/vc take` - Take ownership of the channel if the owner is not present\n\n' +
        '**Note:** You must be in a voice channel to use these commands',
      formatDescription: false
    });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  // Check if user is in a voice channel
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    const embed = embedLoader.error('You must be in a voice channel to use this command');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // For take command, check if it's a created channel
  if (subcommand === 'take') {
    const result = await j2cManagerInstance.takeOwnership(voiceChannel, interaction.user.id);
    
    const embed = result.success ? 
      embedLoader.success(result.message || 'You now own this voice channel') :
      embedLoader.error(result.message);
    
    await interaction.reply({ embeds: [embed] });
    return;
  }
  
  // For other commands, check if user owns the channel
  if (!j2cManagerInstance.isUserOwner(interaction.user.id, voiceChannel.id)) {
    const embed = embedLoader.error('You do not own this voice channel');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // Handle subcommands
  switch (subcommand) {
    case 'lock': {
      const result = await j2cManagerInstance.lockChannel(voiceChannel, interaction.user.id);
      
      const embed = result.success ? 
        embedLoader.success('Your voice channel has been locked. No new users can join.') :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'unlock': {
      const result = await j2cManagerInstance.unlockChannel(voiceChannel, interaction.user.id);
      
      const embed = result.success ? 
        embedLoader.success('Your voice channel has been unlocked. New users can join.') :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'reject': {
      const targetUser = interaction.options.getUser('user');
      const result = await j2cManagerInstance.rejectUser(voiceChannel, interaction.user.id, targetUser.id);
      
      const embed = result.success ? 
        embedLoader.success(`${targetUser.username} has been rejected from your voice channel`) :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'allow': {
      const targetUser = interaction.options.getUser('user');
      const result = await j2cManagerInstance.allowUser(voiceChannel, interaction.user.id, targetUser.id);
      
      const embed = result.success ? 
        embedLoader.success(`${targetUser.username} can now join your voice channel again`) :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'limit': {
      const limit = interaction.options.getInteger('limit');
      const result = await j2cManagerInstance.setUserLimit(voiceChannel, interaction.user.id, limit);
      
      const embed = result.success ? 
        embedLoader.success(`User limit set to ${limit === 0 ? 'unlimited' : limit}`) :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
    
    case 'rename': {
      const newName = interaction.options.getString('name');
      const result = await j2cManagerInstance.renameChannel(voiceChannel, interaction.user.id, newName);
      
      const embed = result.success ? 
        embedLoader.success(`Channel renamed to: ${newName}`) :
        embedLoader.error(result.message);
      
      await interaction.reply({ embeds: [embed] });
      break;
    }
  }
}