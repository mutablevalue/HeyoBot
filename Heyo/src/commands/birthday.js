// src/commands/birthday.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

let birthdaySystem = null;
let embedLoader = null;

export function setBirthdaySystem(system) {
  birthdaySystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

// Birthday command
export const birthdayData = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Manage birthdays')
  .addSubcommand(subcommand =>
    subcommand
      .setName('set')
      .setDescription('Set your birthday')
      .addStringOption(option =>
        option
          .setName('date')
          .setDescription('Your birthday (MM/DD/YYYY)')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View a birthday')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to check (leave empty for yourself)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove your birthday')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('upcoming')
      .setDescription('View upcoming birthdays')
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription('Number of days to look ahead (default: 7)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(30)
      )
  );

// Setup birthday command
export const setupBirthdayData = new SlashCommandBuilder()
  .setName('setupbirthday')
  .setDescription('Setup birthday system for the server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel for birthday announcements')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  )
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Role to give on birthdays (optional)')
      .setRequired(false)
  );

// Execute functions
export async function executeBirthday(interaction) {
  if (!birthdaySystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Birthday system not loaded.', 
      ephemeral: true 
    });
  }
  
  const subcommand = interaction.options.getSubcommand();
  
  switch (subcommand) {
    case 'set':
      await handleSetBirthday(interaction);
      break;
    case 'view':
      await handleViewBirthday(interaction);
      break;
    case 'remove':
      await handleRemoveBirthday(interaction);
      break;
    case 'upcoming':
      await handleUpcomingBirthdays(interaction);
      break;
  }
}

async function handleSetBirthday(interaction) {
  const dateString = interaction.options.getString('date');
  
  try {
    const result = await birthdaySystem.setBirthday(interaction.user.id, dateString);
    
    // Calculate days until next birthday
    const today = new Date();
    const birthDate = result.date;
    const thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
    
    if (thisYearBirthday < today && !result.isToday) {
      thisYearBirthday.setFullYear(thisYearBirthday.getFullYear() + 1);
    }
    
    const daysUntil = result.isToday ? 0 : Math.ceil((thisYearBirthday - today) / (1000 * 60 * 60 * 24));
    
    let message = `${interaction.user} set your birthday to **${birthDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}**\n`;
    
    if (result.isToday) {
      message += '\n🎉 **Happy Birthday!** 🎂';
    } else if (daysUntil === 1) {
      message += `\nYour next birthday is **tomorrow!**`;
    } else {
      message += `\nYour next birthday is in **${daysUntil} days**`;
    }
    
    const embed = embedLoader.success(message);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    const embed = embedLoader.error(error.message);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleViewBirthday(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const birthdayData = birthdaySystem.getBirthday(user.id);
  
  if (!birthdayData) {
    const message = user.id === interaction.user.id 
      ? 'You haven\'t set your birthday yet'
      : 'This user hasn\'t set your birthday';
    
    const embed = embedLoader.info(message);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  const birthDate = birthdayData.date;
  
  // Calculate days until next birthday
  const today = new Date();
  const thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  
  if (thisYearBirthday < today) {
    thisYearBirthday.setFullYear(thisYearBirthday.getFullYear() + 1);
  }
  
  const daysUntil = Math.ceil((thisYearBirthday - today) / (1000 * 60 * 60 * 24));
  
  let description = `**Birthday:** ${birthDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  
  if (daysUntil === 0) {
    description += '\n\n🎉 **It\'s your birthday today!** 🎂';
  } else if (daysUntil === 1) {
    description += '\n\n**Your birthday is tomorrow!**';
  } else {
    description += `\n\n**${daysUntil} days** until your birthday`;
  }
  
  const embed = embedLoader.createEmbed({
    title: `${user.username}'s Birthday`,
    description: description,
    formatDescription: false
  });
  
  await interaction.reply({ embeds: [embed] });
}

async function handleRemoveBirthday(interaction) {
  const removed = birthdaySystem.removeBirthday(interaction.user.id);
  
  if (removed) {
    const embed = embedLoader.success(`${interaction.user} removed your birthday`);
    await interaction.reply({ embeds: [embed] });
  } else {
    const embed = embedLoader.info('You haven\'t set a birthday yet');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleUpcomingBirthdays(interaction) {
  const days = interaction.options.getInteger('days') || 7;
  const upcoming = birthdaySystem.getUpcomingBirthdays(days);
  
  // Also get the user's own birthday if not in the list
  const userBirthday = birthdaySystem.getUpcomingBirthdays(365, interaction.user.id).find(b => b.userId === interaction.user.id);
  const hasUserBirthdayInList = upcoming.some(b => b.userId === interaction.user.id);
  
  if (upcoming.length === 0 && !userBirthday) {
    const embed = embedLoader.info(`No birthdays in the next ${days} days`);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  let description = upcoming.slice(0, 20).map(b => {
    const user = interaction.client.users.cache.get(b.userId);
    const name = user ? user.tag : 'Unknown User';
    const isYou = b.userId === interaction.user.id;
    
    if (b.daysUntil === 0) {
      return `🎉 **${isYou ? 'YOU' : name}** - **Today!**`;
    } else if (b.daysUntil === 1) {
      return `• **${isYou ? 'YOU' : name}** - Tomorrow (**1 day**)`;
    } else {
      return `• **${isYou ? 'YOU' : name}** - ${b.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (**${b.daysUntil} days**)`;
    }
  }).join('\n');
  
  // Add user's birthday at the end if it's not in the list
  if (userBirthday && !hasUserBirthdayInList && userBirthday.daysUntil > days) {
    if (description) description += '\n\n';
    description += `Your birthday: ${userBirthday.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (**${userBirthday.daysUntil} days**)`;
  }
  
  const embed = embedLoader.createEmbed({
    title: `Upcoming Birthdays (Next ${days} days)`,
    description: description || 'No upcoming birthdays',
    formatDescription: false
  });
  
  if (upcoming.length > 20) {
    embed.setFooter({ text: `...and ${upcoming.length - 20} more` });
  }
  
  await interaction.reply({ embeds: [embed] });
}

export async function executeSetupBirthday(interaction) {
  if (!birthdaySystem || !embedLoader) {
    return interaction.reply({ 
      content: 'Birthday system not loaded.', 
      ephemeral: true 
    });
  }
  
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  
  await birthdaySystem.setupGuild(interaction.guild.id, {
    announcementChannel: channel.id,
    birthdayRole: role?.id || null
  });
  
  const fields = [
    { 
      name: 'Announcement Channel', 
      value: `${channel}`, 
      inline: true 
    }
  ];
  
  if (role) {
    fields.push({ 
      name: 'Birthday Role', 
      value: `${role}`, 
      inline: true 
    });
  }
  
  const embed = embedLoader.createEmbed({
    title: 'Birthday System Setup',
    description: 'Birthday system has been configured for this server',
    formatDescription: false,
    fields
  });
  
  await interaction.reply({ embeds: [embed] });
}

// Export commands
export const commands = [
  { data: birthdayData, execute: executeBirthday },
  { data: setupBirthdayData, execute: executeSetupBirthday }
];