// src/commands/social.js
import {
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';

let socialLookupSystem = null;

export function setSocialLookupSystem(system) {
  socialLookupSystem = system;
}

// TikTok lookup command
export const ttData = new SlashCommandBuilder()
  .setName('tt')
  .setDescription('Look up a TikTok user profile')
  .addStringOption(option =>
    option
      .setName('username')
      .setDescription('TikTok username (with or without @)')
      .setRequired(true)
  );

// Instagram lookup command
export const igData = new SlashCommandBuilder()
  .setName('ig')
  .setDescription('Look up an Instagram user profile')
  .addStringOption(option =>
    option
      .setName('username')
      .setDescription('Instagram username (with or without @)')
      .setRequired(true)
  );

// Combined social lookup command
export const socialData = new SlashCommandBuilder()
  .setName('social')
  .setDescription('Look up social media profiles')
  .addSubcommand(subcommand =>
    subcommand
      .setName('tiktok')
      .setDescription('Look up a TikTok user')
      .addStringOption(option =>
        option
          .setName('username')
          .setDescription('TikTok username')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('instagram')
      .setDescription('Look up an Instagram user')
      .addStringOption(option =>
        option
          .setName('username')
          .setDescription('Instagram username')
          .setRequired(true)
      )
  );

// Execute functions
export async function executeTT(interaction) {
  if (!socialLookupSystem) {
    return interaction.reply({ 
      content: '❌ Social lookup system not loaded.', 
      ephemeral: true 
    });
  }
  
  const username = interaction.options.getString('username');
  
  // Check rate limit
  if (!socialLookupSystem.checkRateLimit(interaction.user.id)) {
    const remaining = socialLookupSystem.getRateLimitRemaining(interaction.user.id);
    return interaction.reply({ 
      content: `⏰ Please wait ${remaining} seconds before using this command again.`, 
      ephemeral: true 
    });
  }
  
  await interaction.deferReply();
  
  try {
    // Set rate limit
    socialLookupSystem.setRateLimit(interaction.user.id);
    
    // Look up user
    const data = await socialLookupSystem.lookupTikTok(username);
    const embed = await socialLookupSystem.createTikTokEmbed(data);
    
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error('[Social] TikTok lookup error:', error);
    await interaction.editReply({ 
      content: '❌ Failed to look up TikTok user. Please try again later.' 
    });
  }
}

export async function executeIG(interaction) {
  if (!socialLookupSystem) {
    return interaction.reply({ 
      content: '❌ Social lookup system not loaded.', 
      ephemeral: true 
    });
  }
  
  const username = interaction.options.getString('username');
  
  // Check rate limit
  if (!socialLookupSystem.checkRateLimit(interaction.user.id)) {
    const remaining = socialLookupSystem.getRateLimitRemaining(interaction.user.id);
    return interaction.reply({ 
      content: `⏰ Please wait ${remaining} seconds before using this command again.`, 
      ephemeral: true 
    });
  }
  
  await interaction.deferReply();
  
  try {
    // Set rate limit
    socialLookupSystem.setRateLimit(interaction.user.id);
    
    // Look up user
    const data = await socialLookupSystem.lookupInstagram(username);
    const embed = await socialLookupSystem.createInstagramEmbed(data);
    
    await interaction.editReply({ embeds: [embed] });
    
  } catch (error) {
    console.error('[Social] Instagram lookup error:', error);
    await interaction.editReply({ 
      content: '❌ Failed to look up Instagram user. Please try again later.' 
    });
  }
}

export async function executeSocial(interaction) {
  if (!socialLookupSystem) {
    return interaction.reply({ 
      content: '❌ Social lookup system not loaded.', 
      ephemeral: true 
    });
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  if (subcommand === 'tiktok') {
    return executeTT(interaction);
  } else if (subcommand === 'instagram') {
    return executeIG(interaction);
  }
}

// Export commands
export const commands = [
  { data: ttData, execute: executeTT },
  { data: igData, execute: executeIG },
  { data: socialData, execute: executeSocial }
];