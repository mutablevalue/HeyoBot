// src/commands/snipe.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

let snipeSystem = null;

export function setSnipeSystem(system) {
  snipeSystem = system;
}

// Snipe command
export const snipeData = new SlashCommandBuilder()
  .setName('snipe')
  .setDescription('View recently deleted messages')
  .addIntegerOption(option =>
    option
      .setName('count')
      .setDescription('Number of messages to show (1-5)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(5)
  )
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to snipe from (defaults to current channel)')
      .setRequired(false)
  );

// Clear snipes command
export const clearSnipesData = new SlashCommandBuilder()
  .setName('clearsnipes')
  .setDescription('Clear sniped messages')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to clear snipes from (leave empty to clear all)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// CS alias for clearsnipes
export const csData = new SlashCommandBuilder()
  .setName('cs')
  .setDescription('Clear sniped messages (alias for clearsnipes)')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to clear snipes from (leave empty to clear all)')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

// Execute functions
export async function executeSnipe(interaction) {
  if (!snipeSystem) {
    return interaction.reply({ 
      content: '❌ Snipe system not loaded.', 
      ephemeral: true 
    });
  }
  
  // Check permissions
  if (!snipeSystem.hasPermission(interaction.member, 'snipe')) {
    return interaction.reply({ 
      content: '❌ You do not have permission to use this command.', 
      ephemeral: true 
    });
  }
  
  const count = interaction.options.getInteger('count') || 1;
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  
  const snipes = await snipeSystem.getSnipes(channel.id, count);
  
  if (snipes.length === 0) {
    return interaction.reply({ 
      content: 'No deleted messages found in this channel.', 
      ephemeral: true 
    });
  }
  
  // If only one snipe, send simple embed
  if (snipes.length === 1) {
    const embed = await snipeSystem.createSnipeEmbed(snipes[0], 0, 1);
    return interaction.reply({ embeds: [embed], ephemeral: snipeSystem.config.ephemeral });
  }
  
  // Multiple snipes - create paginated view
  let currentIndex = 0;
  
  const createMessageOptions = async () => {
    const embed = await snipeSystem.createSnipeEmbed(snipes[currentIndex], currentIndex, snipes.length);
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('snipe_prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentIndex === 0),
        new ButtonBuilder()
          .setCustomId('snipe_next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentIndex === snipes.length - 1)
      );
    
    return { embeds: [embed], components: [row], ephemeral: snipeSystem.config.ephemeral };
  };
  
  const response = await interaction.reply(await createMessageOptions());
  
  // Create collector for pagination
  const collector = response.createMessageComponentCollector({ 
    time: 60000 // 1 minute
  });
  
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ 
        content: 'You cannot use these buttons.', 
        ephemeral: true 
      });
    }
    
    if (i.customId === 'snipe_prev') {
      currentIndex = Math.max(0, currentIndex - 1);
    } else if (i.customId === 'snipe_next') {
      currentIndex = Math.min(snipes.length - 1, currentIndex + 1);
    }
    
    await i.update(await createMessageOptions());
  });
  
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

export async function executeClearSnipes(interaction) {
  if (!snipeSystem) {
    return interaction.reply({ 
      content: '❌ Snipe system not loaded.', 
      ephemeral: true 
    });
  }
  
  // Check permissions
  if (!snipeSystem.hasPermission(interaction.member, 'clearsnipes')) {
    return interaction.reply({ 
      content: '❌ You do not have permission to use this command.', 
      ephemeral: true 
    });
  }
  
  const channel = interaction.options.getChannel('channel');
  
  if (channel) {
    snipeSystem.clearChannelSnipes(channel.id);
    
    const embed = new EmbedBuilder()
      .setTitle('🧹 Snipes Cleared')
      .setDescription(`Cleared all sniped messages from ${channel}`)
      .setColor(0x00ff00)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    // Clear all snipes
    snipeSystem.clearSnipes();
    
    const embed = new EmbedBuilder()
      .setTitle('🧹 All Snipes Cleared')
      .setDescription('Cleared all sniped messages from all channels')
      .setColor(0x00ff00)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // Log the action
  if (snipeSystem.config.logChannel) {
    const logChannel = interaction.guild.channels.cache.get(snipeSystem.config.logChannel);
    if (logChannel?.isTextBased()) {
      const logEmbed = new EmbedBuilder()
        .setTitle('Snipes Cleared')
        .setDescription(`${interaction.user.tag} cleared ${channel ? `snipes from ${channel}` : 'all snipes'}`)
        .setColor(0xff0000)
        .setTimestamp();
      
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }
}

// Export commands
export const commands = [
  { data: snipeData, execute: executeSnipe },
  { data: clearSnipesData, execute: executeClearSnipes },
  { data: csData, execute: executeClearSnipes } // CS uses same execute function
];