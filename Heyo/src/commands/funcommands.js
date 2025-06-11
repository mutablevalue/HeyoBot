// src/commands/funcommands.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
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

// Banner Command
export const bannerData = new SlashCommandBuilder()
  .setName('banner')
  .setDescription('Shows a user\'s profile banner')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to get profile banner of')
      .setRequired(false)
  );

export async function executeBanner(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  
  // Fetch user to get banner data
  const fetchedUser = await user.fetch({ force: true });
  
  if (!fetchedUser.banner) {
    const embed = new EmbedBuilder()
      .setTitle(`${fetchedUser.username}'s Banner`)
      .setDescription(`${fetchedUser.username} doesn't have a banner set.`)
      .setColor(0x2b2d31)
      .setThumbnail(fetchedUser.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }

  const bannerUrl = fetchedUser.bannerURL({ dynamic: true, size: 4096 });
  
  const embed = new EmbedBuilder()
    .setTitle(`${fetchedUser.username}'s Profile Banner`)
    .setImage(bannerUrl)
    .setColor(fetchedUser.hexAccentColor || 0x2b2d31)
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  // Add download links
  const formats = [];
  if (bannerUrl.includes('.gif')) {
    formats.push(`[GIF](${fetchedUser.bannerURL({ extension: 'gif', size: 4096 })})`);
  }
  formats.push(
    `[PNG](${fetchedUser.bannerURL({ extension: 'png', size: 4096 })})`,
    `[JPG](${fetchedUser.bannerURL({ extension: 'jpg', size: 4096 })})`,
    `[WEBP](${fetchedUser.bannerURL({ extension: 'webp', size: 4096 })})`
  );
  
  embed.addFields({
    name: 'Download Links',
    value: formats.join(' • '),
    inline: false
  });

  if (fetchedUser.hexAccentColor) {
    embed.addFields({
      name: 'Accent Color',
      value: fetchedUser.hexAccentColor,
      inline: true
    });
  }

  await interaction.reply({ embeds: [embed] });
}

// Whois Command
export const whoisData = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Shows detailed information about a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to get information about')
      .setRequired(false)
  );

export async function executeWhois(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = interaction.guild.members.cache.get(user.id);
  
  // Fetch user to get full data
  const fetchedUser = await user.fetch({ force: true });
  
  const embed = new EmbedBuilder()
    .setTitle(`Who is ${fetchedUser.username}?`)
    .setThumbnail(fetchedUser.displayAvatarURL({ dynamic: true, size: 512 }))
    .setColor(member?.displayHexColor || fetchedUser.hexAccentColor || 0x2b2d31)
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  // User Information
  const userFlags = fetchedUser.flags?.toArray() || [];
  const badges = userFlags.length > 0 ? userFlags.map(flag => {
    const flagEmojis = {
      'Staff': '👷',
      'Partner': '🤝',
      'Hypesquad': '🏘️',
      'BugHunterLevel1': '🐛',
      'BugHunterLevel2': '🐛',
      'HypeSquadOnlineHouse1': '🟣',
      'HypeSquadOnlineHouse2': '🟢',
      'HypeSquadOnlineHouse3': '🟠',
      'PremiumEarlySupporter': '💎',
      'VerifiedBot': '✅',
      'VerifiedDeveloper': '👨‍💻',
      'CertifiedModerator': '🛡️',
      'ActiveDeveloper': '⚙️'
    };
    return `${flagEmojis[flag] || ''} ${flag.replace(/([A-Z])/g, ' $1').trim()}`;
  }).join('\n') : 'None';

  embed.addFields(
    {
      name: '👤 User Information',
      value: `**Username:** ${fetchedUser.username}\n**Display Name:** ${fetchedUser.displayName}\n**User ID:** \`${fetchedUser.id}\`\n**Bot:** ${fetchedUser.bot ? 'Yes' : 'No'}\n**Badges:** ${badges}`,
      inline: false
    },
    {
      name: '📅 Account Created',
      value: `<t:${Math.floor(fetchedUser.createdTimestamp / 1000)}:F>\n<t:${Math.floor(fetchedUser.createdTimestamp / 1000)}:R>`,
      inline: true
    }
  );

  // If user has banner or accent color
  if (fetchedUser.banner) {
    embed.addFields({
      name: '🎨 Customization',
      value: `Has custom banner\nAccent Color: ${fetchedUser.hexAccentColor || 'None'}`,
      inline: true
    });
  }

  // Server-specific information if member exists
  if (member) {
    // Join date
    embed.addFields({
      name: '📥 Joined Server',
      value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
      inline: true
    });

    // Roles
    const roles = member.roles.cache
      .filter(role => role.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString());
    
    if (roles.length > 0) {
      const displayRoles = roles.length > 20 ? roles.slice(0, 20).join(', ') + ` +${roles.length - 20} more` : roles.join(', ');
      embed.addFields({
        name: `🎭 Roles (${roles.length})`,
        value: displayRoles || 'None',
        inline: false
      });
    }

    // Nickname
    if (member.nickname) {
      embed.addFields({
        name: '📛 Nickname',
        value: member.nickname,
        inline: true
      });
    }

    // Status and activity
    if (member.presence) {
      const status = {
        online: '🟢 Online',
        idle: '🟡 Idle',
        dnd: '🔴 Do Not Disturb',
        offline: '⚫ Offline'
      };
      
      embed.addFields({
        name: '📊 Status',
        value: status[member.presence.status] || '⚫ Offline',
        inline: true
      });

      // Activities
      if (member.presence.activities.length > 0) {
        const activities = member.presence.activities.map(activity => {
          if (activity.type === 0) return `Playing **${activity.name}**`;
          if (activity.type === 1) return `Streaming **${activity.name}**`;
          if (activity.type === 2) return `Listening to **${activity.name}**`;
          if (activity.type === 3) return `Watching **${activity.name}**`;
          if (activity.type === 4) return activity.state || 'Custom Status';
          if (activity.type === 5) return `Competing in **${activity.name}**`;
          return activity.name;
        }).join('\n');
        
        embed.addFields({
          name: '🎮 Activity',
          value: activities,
          inline: false
        });
      }
    }

    // Key permissions
    const keyPerms = [];
    if (member.permissions.has(PermissionFlagsBits.Administrator)) keyPerms.push('Administrator');
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) keyPerms.push('Manage Server');
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) keyPerms.push('Manage Messages');
    if (member.permissions.has(PermissionFlagsBits.ManageRoles)) keyPerms.push('Manage Roles');
    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) keyPerms.push('Timeout Members');
    if (member.permissions.has(PermissionFlagsBits.KickMembers)) keyPerms.push('Kick Members');
    if (member.permissions.has(PermissionFlagsBits.BanMembers)) keyPerms.push('Ban Members');
    
    if (keyPerms.length > 0) {
      embed.addFields({
        name: '🔑 Key Permissions',
        value: keyPerms.join(', '),
        inline: false
      });
    }

    // Join position
    const members = [...interaction.guild.members.cache.values()].sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    const joinPosition = members.findIndex(m => m.id === member.id) + 1;
    
    embed.addFields({
      name: '📊 Join Position',
      value: `${joinPosition} / ${interaction.guild.memberCount}`,
      inline: true
    });
  } else {
    embed.addFields({
      name: '❌ Not in this server',
      value: 'This user is not a member of this server.',
      inline: false
    });
  }

  // Add banner as image if available
  if (fetchedUser.banner) {
    embed.setImage(fetchedUser.bannerURL({ size: 512 }));
  }

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
    embed.setDescription(`No previous usernames recorded for ${user.username}.\n\n*Note: Username tracking starts from when the bot first sees a user.*`);
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
  { data: bannerData, execute: executeBanner },
  { data: whoisData, execute: executeWhois },
  { data: namesData, execute: executeNames },
  { data: serverInfoData, execute: executeServerInfo }
];