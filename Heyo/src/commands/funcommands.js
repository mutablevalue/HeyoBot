// src/commands/funcommands.js
import {
  SlashCommandBuilder,
  EmbedBuilder
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Username history tracking
const usernameHistoryPath = path.join(__dirname, '../../data', 'username_history.json');
let usernameHistory = new Map();

// Load username history
function loadUsernameHistory() {
  try {
    if (fs.existsSync(usernameHistoryPath)) {
      const data = JSON.parse(fs.readFileSync(usernameHistoryPath, 'utf8'));
      usernameHistory = new Map(Object.entries(data));
    }
  } catch (error) {
    console.error('[FunCommands] Error loading username history:', error);
  }
}

// Save username history
function saveUsernameHistory() {
  try {
    const data = Object.fromEntries(usernameHistory);
    const dir = path.dirname(usernameHistoryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(usernameHistoryPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[FunCommands] Error saving username history:', error);
  }
}

// Initialize username history
loadUsernameHistory();

// Track username changes
export function trackUsernameChange(userId, username) {
  const userHistory = usernameHistory.get(userId) || { current: username, history: [] };
  
  if (userHistory.current !== username) {
    // Add old username to history with timestamp
    userHistory.history.push({
      username: userHistory.current,
      changedAt: new Date().toISOString()
    });
    userHistory.current = username;
    
    // Limit history to 50 entries per user
    if (userHistory.history.length > 50) {
      userHistory.history = userHistory.history.slice(-50);
    }
    
    usernameHistory.set(userId, userHistory);
    saveUsernameHistory();
  }
}

// PFP Command
// PFP Command
export const pfpData = new SlashCommandBuilder()
  .setName('pfp')
  .setDescription('Shows a user\'s profile picture')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to get profile picture of')
      .setRequired(false)
  );

export async function executePfp(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  
  const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 4096 });
  
  const embed = new EmbedBuilder()
    .setTitle(`${user.username}'s Profile Picture`)
    .setImage(avatarUrl)
    .setColor(0x2b2d31)
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  // Add download links
  const formats = [];
  if (avatarUrl.includes('.gif')) {
    formats.push(`[GIF](${user.displayAvatarURL({ extension: 'gif', size: 4096 })})`);
  }
  formats.push(
    `[PNG](${user.displayAvatarURL({ extension: 'png', size: 4096 })})`,
    `[JPG](${user.displayAvatarURL({ extension: 'jpg', size: 4096 })})`,
    `[WEBP](${user.displayAvatarURL({ extension: 'webp', size: 4096 })})`
  );
  
  embed.addFields({
    name: 'Download Links',
    value: formats.join(' • '),
    inline: false
  });

  await interaction.reply({ embeds: [embed] });
}

// Names Command
export const namesData = new SlashCommandBuilder()
  .setName('names')
  .setDescription('Shows a user\'s past usernames')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to get name history of')
      .setRequired(false)
  );

export async function executeNames(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  
  // Track current username
  trackUsernameChange(user.id, user.username);
  
  const userHistory = usernameHistory.get(user.id);
  
  const embed = new EmbedBuilder()
    .setTitle(`${user.username}'s Username History`)
    .setColor(0x2b2d31)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  if (!userHistory || userHistory.history.length === 0) {
    embed.setDescription(`No previous usernames recorded for ${user.username}.`);
  } else {
    // Current username
    embed.addFields({
      name: 'Current Username',
      value: `**${userHistory.current}**`,
      inline: false
    });

    // Previous usernames (show latest 10)
    const recentHistory = userHistory.history.slice(-10).reverse();
    const historyText = recentHistory.map((entry, index) => {
      const date = new Date(entry.changedAt);
      const timestamp = Math.floor(date.getTime() / 1000);
      return `${index + 1}. **${entry.username}** - <t:${timestamp}:R>`;
    }).join('\n');

    embed.addFields({
      name: `Previous Usernames (${userHistory.history.length} total)`,
      value: historyText || 'None',
      inline: false
    });

    if (userHistory.history.length > 10) {
      embed.setFooter({ 
        text: `Showing 10 most recent • ${userHistory.history.length - 10} more not shown • Requested by ${interaction.user.username}`, 
        iconURL: interaction.user.displayAvatarURL() 
      });
    }
  }

  await interaction.reply({ embeds: [embed] });
}

// Server Info Command
export const serverInfoData = new SlashCommandBuilder()
  .setName('serverinfo')
  .setDescription('Shows information about the server');

export async function executeServerInfo(interaction) {
  const guild = interaction.guild;
  
  // Fetch all members to ensure accurate counts
  await guild.members.fetch();
  
  const totalMembers = guild.memberCount;
  const botCount = guild.members.cache.filter(member => member.user.bot).size;
  const humanCount = totalMembers - botCount;
  
  // Get join/leave stats for the last 24 hours
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentJoins = guild.members.cache.filter(member => member.joinedTimestamp > dayAgo).size;
  
  // Get server creation date
  const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);
  
  const embed = new EmbedBuilder()
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
    .setColor(0x2b2d31)
    .addFields(
      {
        name: '👥 Members',
        value: `Total: **${totalMembers}**\nHumans: **${humanCount}**\nBots: **${botCount}**`,
        inline: true
      },
      {
        name: '📊 Statistics',
        value: `Roles: **${guild.roles.cache.size}**\nChannels: **${guild.channels.cache.size}**\nEmojis: **${guild.emojis.cache.size}**`,
        inline: true
      },
      {
        name: '📈 Activity (24h)',
        value: `New Members: **${recentJoins}**\nBoosts: **${guild.premiumSubscriptionCount || 0}**\nBoost Tier: **${guild.premiumTier || 0}**`,
        inline: true
      },
      {
        name: '👑 Owner',
        value: `<@${guild.ownerId}>`,
        inline: true
      },
      {
        name: '🆔 Server ID',
        value: `\`${guild.id}\``,
        inline: true
      },
      {
        name: '📅 Created',
        value: `<t:${createdTimestamp}:F>\n<t:${createdTimestamp}:R>`,
        inline: true
      }
    )
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  // Add server features if any
  if (guild.features.length > 0) {
    const features = guild.features.map(feature => 
      feature.split('_').map(word => 
        word.charAt(0) + word.slice(1).toLowerCase()
      ).join(' ')
    ).join(', ');
    
    embed.addFields({
      name: '✨ Features',
      value: features,
      inline: false
    });
  }

  // Add banner if exists
  if (guild.banner) {
    embed.setImage(guild.bannerURL({ size: 1024 }));
  }

  await interaction.reply({ embeds: [embed] });
}

// Set up username tracking for all guild members on bot ready
export function setupUsernameTracking(client) {
  client.on('ready', async () => {
    console.log('[FunCommands] Setting up username tracking...');
    
    // Track all current members
    for (const guild of client.guilds.cache.values()) {
      const members = await guild.members.fetch();
      for (const member of members.values()) {
        if (!member.user.bot) {
          trackUsernameChange(member.user.id, member.user.username);
        }
      }
    }
  });

  // Track username changes
  client.on('userUpdate', (oldUser, newUser) => {
    if (oldUser.username !== newUser.username) {
      trackUsernameChange(newUser.id, newUser.username);
    }
  });

  // Track new members
  client.on('guildMemberAdd', (member) => {
    if (!member.user.bot) {
      trackUsernameChange(member.user.id, member.user.username);
    }
  });
}

// Export individual commands
export const commands = [
  { data: pfpData, execute: executePfp },
  { data: namesData, execute: executeNames },
  { data: serverInfoData, execute: executeServerInfo }
];