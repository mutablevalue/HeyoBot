// src/commands/moderation.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js';

let moderationSystem = null;
let antiNukeInstance = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setAntiNukeInstance(instance) {
  antiNukeInstance = instance;
}

// Helper function to check if user is owner with bypass enabled
function isOwnerWithBypass(member) {
  return moderationSystem.config.ownerBypass && member.id === member.guild.ownerId;
}

// Helper function to parse multiple users from input
function parseMultipleUsers(input) {
  // Match user IDs and mentions
  const userPattern = /<@!?(\d+)>|(\d{17,19})/g;
  const matches = [...input.matchAll(userPattern)];
  const userIds = matches.map(match => match[1] || match[2]);
  
  // Remove duplicates
  return [...new Set(userIds)];
}

// Helper function to check if user can use multi-user feature
function canUseMultiUser(interaction, commandName) {
  const multiUserConfig = moderationSystem.config.multiUserCommands?.[commandName];
  
  // If no config or not enabled, multi-user is not allowed
  if (!multiUserConfig?.enabled) return false;
  
  // If requiresAntiNukeWhitelist is true, check if user is whitelisted
  // This only matters when targeting multiple users (2+)
  if (multiUserConfig.requiresAntiNukeWhitelist && antiNukeInstance) {
    return antiNukeInstance.isWhitelisted(interaction.user.id);
  }
  
  // Otherwise, allow based on normal permissions
  return true;
}

// Create compound slash command with all moderation commands
export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderation commands')
  // Ban subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('ban')
      .setDescription('Ban user(s) from the server')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('User(s) to ban (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for ban')
          .setRequired(false)
      )
  )
  // Kick subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('kick')
      .setDescription('Kick user(s) from the server')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('User(s) to kick (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for kick')
          .setRequired(false)
      )
  )
  // Timeout subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('timeout')
      .setDescription('Timeout user(s)')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('User(s) to timeout (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('duration')
          .setDescription('Duration (e.g., 5m, 1h, 1d)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for timeout')
          .setRequired(false)
      )
  )
  // Mute subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('mute')
      .setDescription('Mute user(s) (timeout alias)')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('User(s) to mute (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for mute')
          .setRequired(false)
      )
  )
  // Unmute subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('unmute')
      .setDescription('Unmute user(s) (remove timeout)')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('User(s) to unmute (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
  )
  // Lock channel subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('lockchannel')
      .setDescription('Lock the current channel (disable sending messages)')
  )
  // Unlock channel subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unlockchannel')
      .setDescription('Unlock the current channel (restore sending messages)')
  )
  // Nuke subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('nuke')
      .setDescription('Clone and delete the current channel')
      .addBooleanOption(option =>
        option
          .setName('confirm')
          .setDescription('Confirm channel nuke')
          .setRequired(true)
      )
  )
  // Unban subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unban')
      .setDescription('Unban a user')
      .addStringOption(option =>
        option
          .setName('user')
          .setDescription('User ID or tag to unban')
          .setRequired(true)
      )
  )
  // Purge subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('purge')
      .setDescription('Delete multiple messages at once')
      .addIntegerOption(option =>
        option
          .setName('amount')
          .setDescription('Number of messages to delete (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Only delete messages from this user')
          .setRequired(false)
      )
  )
  // Role subcommand with multi-user support
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Give or remove a role from user(s)')
      .addStringOption(option =>
        option
          .setName('users')
          .setDescription('Target user(s) (mention or ID, space-separated for multiple)')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to give/remove')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Give or remove the role')
          .setRequired(true)
          .addChoices(
            { name: 'Give', value: 'give' },
            { name: 'Remove', value: 'remove' }
          )
      )
  )
  // Force nickname subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('forcenickname')
      .setDescription('Force a nickname on a user that they cannot change')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to force nickname on')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('nickname')
          .setDescription('Nickname to force (32 chars max)')
          .setRequired(true)
      )
  )
  // Unforce nickname subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unforcenickname')
      .setDescription('Remove forced nickname from a user')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove forced nickname from')
          .setRequired(true)
      )
  )
  // Setup permissions subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('setupperms')
      .setDescription('Create moderation roles with specific permissions')
  );

// Main execute function for compound command
export async function execute(interaction) {
  if (!moderationSystem) {
    return interaction.reply({ content: '❌ Moderation system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  
  // Check permissions for the specific subcommand
  const permCheck = moderationSystem.checkPermission(interaction.member, subcommand);
  if (!permCheck.allowed) {
    return interaction.reply({ 
      content: `❌ ${permCheck.reason}`, 
      ephemeral: true 
    });
  }

  // Check cooldown
  const cooldownCheck = moderationSystem.checkCooldown(interaction.user.id, subcommand);
  if (cooldownCheck.onCooldown) {
    return interaction.reply({
      content: `⏰ Please wait ${cooldownCheck.timeLeft} seconds before using this command again.`,
      ephemeral: true
    });
  }

  switch (subcommand) {
    case 'lockchannel':
      return executeLockChannel(interaction);
    case 'unlockchannel':
      return executeUnlockChannel(interaction);
    case 'nuke':
      return executeNuke(interaction);
    case 'ban':
      return executeBan(interaction);
    case 'kick':
      return executeKick(interaction);
    case 'unban':
      return executeUnban(interaction);
    case 'timeout':
      return executeTimeout(interaction);
    case 'mute':
      return executeMute(interaction);
    case 'unmute':
      return executeUnmute(interaction);
    case 'purge':
      return executePurge(interaction);
    case 'role':
      return executeRole(interaction);
    case 'forcenickname':
      return executeForceNickname(interaction);
    case 'unforcenickname':
      return executeUnforceNickname(interaction);
    case 'setupperms':
      return executeSetupPerms(interaction);
  }
}

// Multi-user ban function
export async function executeBan(interaction) {
  const usersInput = interaction.options.getString('users');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  // AntiNuke whitelist is only required for multi-user operations (2+ users)
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'ban')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to ban multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const userId of userIds) {
    try {
      const user = await interaction.client.users.fetch(userId);
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      
      if (member) {
        // Check if target is bannable
        if (!member.bannable) {
          results.failed.push({ user: user.tag, reason: 'Cannot ban (higher permissions)' });
          continue;
        }
        
        // Check role hierarchy (skip for owners with bypass)
        if (!isOwnerWithBypass(interaction.member) && member.roles.highest.position >= interaction.member.roles.highest.position) {
          results.failed.push({ user: user.tag, reason: 'Higher or equal role' });
          continue;
        }
      }
      
      await interaction.guild.members.ban(userId, { reason: `${reason} - Banned by ${interaction.user.tag}` });
      results.success.push(user.tag);
      
      // Log each ban
      await moderationSystem.logAction(interaction.guild, {
        action: 'Ban',
        moderator: interaction.user,
        target: `${user.tag} (${user.id})`,
        reason: reason,
        color: 0xff0000
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('🔨 Ban Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully Banned (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed to Ban (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user kick function
export async function executeKick(interaction) {
  const usersInput = interaction.options.getString('users');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'kick')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to kick multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      // Check if target is kickable
      if (!member.kickable) {
        results.failed.push({ user: member.user.tag, reason: 'Cannot kick (higher permissions)' });
        continue;
      }
      
      // Check role hierarchy (skip for owners with bypass)
      if (!isOwnerWithBypass(interaction.member) && member.roles.highest.position >= interaction.member.roles.highest.position) {
        results.failed.push({ user: member.user.tag, reason: 'Higher or equal role' });
        continue;
      }
      
      await member.kick(`${reason} - Kicked by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      // Log each kick
      await moderationSystem.logAction(interaction.guild, {
        action: 'Kick',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason,
        color: 0xffa500
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('👢 Kick Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully Kicked (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed to Kick (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user timeout function
export async function executeTimeout(interaction) {
  const usersInput = interaction.options.getString('users');
  const duration = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Parse duration
  const durationMs = parseDuration(duration);
  if (!durationMs) {
    return interaction.reply({ 
      content: '❌ Invalid duration format. Use formats like: 5m, 1h, 1d', 
      ephemeral: true 
    });
  }
  
  // Check if duration is within Discord's limits
  if (durationMs > 28 * 24 * 60 * 60 * 1000) {
    return interaction.reply({ 
      content: '❌ Timeout duration cannot exceed 28 days.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'timeout')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to timeout multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      // Check role hierarchy (skip for owners with bypass)
      if (!isOwnerWithBypass(interaction.member) && member.roles.highest.position >= interaction.member.roles.highest.position) {
        results.failed.push({ user: member.user.tag, reason: 'Higher or equal role' });
        continue;
      }
      
      // Check if bot can timeout the member
      if (!member.moderatable) {
        results.failed.push({ user: member.user.tag, reason: 'Cannot timeout (higher permissions)' });
        continue;
      }
      
      await member.timeout(durationMs, `${reason} - Timed out by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      // Log each timeout
      await moderationSystem.logAction(interaction.guild, {
        action: 'Timeout',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason,
        additional: `Duration: ${duration}`,
        color: 0xffff00
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('⏰ Timeout Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully Timed Out (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed to Timeout (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Duration',
    value: duration,
    inline: true
  }, {
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: false
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user mute function
export async function executeMute(interaction) {
  const usersInput = interaction.options.getString('users');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'mute')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to mute multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  const { cfg } = locateMuteConfig();
  const muteRole = await ensureMuteRole(interaction);
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      // Check role hierarchy (skip for owners with bypass)
      if (!isOwnerWithBypass(interaction.member) && member.roles.highest.position >= interaction.member.roles.highest.position) {
        results.failed.push({ user: member.user.tag, reason: 'Higher or equal role' });
        continue;
      }
      
      // Check if already muted
      if (member.roles.cache.has(muteRole.id)) {
        results.failed.push({ user: member.user.tag, reason: 'Already muted' });
        continue;
      }
      
      await member.roles.add(muteRole, `Muted by ${interaction.user.tag}: ${reason}`);
      results.success.push(member.user.tag);
      
      // Log each mute
      await moderationSystem.logAction(interaction.guild, {
        action: 'Mute',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason,
        color: cfg.defaultColor
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('🔇 Mute Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully Muted (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed to Mute (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user unmute function
export async function executeUnmute(interaction) {
  const usersInput = interaction.options.getString('users');
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'unmute')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to unmute multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  const { cfg } = locateMuteConfig();
  const muteRole = cfg.roleId && interaction.guild.roles.cache.get(cfg.roleId);
  
  if (!muteRole) {
    return interaction.editReply({ 
      content: '❌ No "Muted" role found in this server.', 
      ephemeral: true 
    });
  }
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      // Check if user is muted
      if (!member.roles.cache.has(muteRole.id)) {
        results.failed.push({ user: member.user.tag, reason: 'Not muted' });
        continue;
      }
      
      await member.roles.remove(muteRole, `Unmuted by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      // Log each unmute
      await moderationSystem.logAction(interaction.guild, {
        action: 'Unmute',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        color: 0x00ff00
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle('🔊 Unmute Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully Unmuted (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed to Unmute (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user role function
export async function executeRole(interaction) {
  const usersInput = interaction.options.getString('users');
  const role = interaction.options.getRole('role');
  const action = interaction.options.getString('action');
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: '❌ No valid users found in input.', 
      ephemeral: true 
    });
  }
  
  // Check if multiple users and if allowed
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'role')) {
      return interaction.reply({ 
        content: '❌ You are not authorized to manage roles for multiple users at once. You must be whitelisted in the AntiNuke system.', 
        ephemeral: true 
      });
    }
  }
  
  // Check if invoker's highest role is above the target role (skip for owners with bypass)
  if (!isOwnerWithBypass(interaction.member) && role.position >= interaction.member.roles.highest.position) {
    return interaction.reply({ 
      content: '❌ You can only manage roles below your highest role.', 
      ephemeral: true 
    });
  }
  
  // Check if bot can manage the role
  const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
  if (role.position >= botMember.roles.highest.position) {
    return interaction.reply({ 
      content: '❌ I cannot manage this role. It\'s higher than my highest role.', 
      ephemeral: true 
    });
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      if (action === 'give') {
        if (member.roles.cache.has(role.id)) {
          results.failed.push({ user: member.user.tag, reason: 'Already has role' });
          continue;
        }
        
        await member.roles.add(role, `Given by ${interaction.user.tag}`);
        results.success.push({ user: member.user.tag, action: 'added' });
        
        await moderationSystem.logAction(interaction.guild, {
          action: 'Role Add',
          moderator: interaction.user,
          target: `${member.user.tag} (${member.user.id})`,
          additional: `Role: ${role.name}`,
          color: 0x00ff00
        });
      } else {
        if (!member.roles.cache.has(role.id)) {
          results.failed.push({ user: member.user.tag, reason: 'Doesn\'t have role' });
          continue;
        }
        
        await member.roles.remove(role, `Removed by ${interaction.user.tag}`);
        results.success.push({ user: member.user.tag, action: 'removed' });
        
        await moderationSystem.logAction(interaction.guild, {
          action: 'Role Remove',
          moderator: interaction.user,
          target: `${member.user.tag} (${member.user.id})`,
          additional: `Role: ${role.name}`,
          color: 0xff0000
        });
      }
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  // Build response embed
  const embed = new EmbedBuilder()
    .setTitle(action === 'give' ? '✅ Role Add Results' : '✅ Role Remove Results')
    .setColor(results.failed.length === 0 ? 0x00ff00 : 0xffff00)
    .setTimestamp();
  
  if (results.success.length > 0) {
    embed.addFields({
      name: `✅ Successfully ${action === 'give' ? 'Added' : 'Removed'} (${results.success.length})`,
      value: results.success.map(s => s.user).join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    embed.addFields({
      name: `❌ Failed (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  embed.addFields({
    name: 'Role',
    value: role.toString(),
    inline: true
  }, {
    name: 'Action',
    value: action === 'give' ? 'Added' : 'Removed',
    inline: true
  }, {
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Keep existing single-user functions for channels and other commands
export async function executeLockChannel(interaction) {
  const channel = interaction.channel;
  
  try {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false
    });

    const embed = new EmbedBuilder()
      .setTitle('🔒 Channel Locked')
      .setDescription(`${channel} has been locked.`)
      .setColor(0xff0000)
      .setFooter({ text: `Locked by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Lock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`,
      color: 0xff0000
    });
  } catch (error) {
    console.error('Error locking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to lock the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeUnlockChannel(interaction) {
  const channel = interaction.channel;
  
  try {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: null
    });

    const embed = new EmbedBuilder()
      .setTitle('🔓 Channel Unlocked')
      .setDescription(`${channel} has been unlocked.`)
      .setColor(0x00ff00)
      .setFooter({ text: `Unlocked by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Unlock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error unlocking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to unlock the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeNuke(interaction) {
  const confirm = interaction.options.getBoolean('confirm');
  
  if (!confirm) {
    return interaction.reply({ 
      content: '❌ Channel nuke cancelled. Set confirm to true to proceed.', 
      ephemeral: true 
    });
  }

  const channel = interaction.channel;
  
  try {
    const newChannel = await channel.clone({
      name: channel.name,
      parent: channel.parent,
      topic: channel.topic,
      nsfw: channel.nsfw,
      rateLimitPerUser: channel.rateLimitPerUser,
      position: channel.position,
      permissionOverwrites: channel.permissionOverwrites.cache,
      reason: `Channel nuked by ${interaction.user.tag}`
    });

    const embed = new EmbedBuilder()
      .setTitle('💥 Channel Nuked')
      .setDescription('This channel has been nuked and recreated.')
      .setColor(0xffa500)
      .setFooter({ text: `Nuked by ${interaction.user.tag}` })
      .setTimestamp();

    await newChannel.send({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Nuke',
      moderator: interaction.user,
      target: `#${channel.name} (${channel.id})`,
      color: 0xffa500
    });

    await channel.delete(`Nuked by ${interaction.user.tag}`);
  } catch (error) {
    console.error('Error nuking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to nuke the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeUnban(interaction) {
  const userInput = interaction.options.getString('user');

  try {
    let userId = userInput;
    
    if (userInput.includes('#')) {
      const bans = await interaction.guild.bans.fetch();
      const bannedUser = bans.find(ban => ban.user.tag === userInput);
      
      if (!bannedUser) {
        return interaction.reply({ 
          content: '❌ User not found in ban list.', 
          ephemeral: true 
        });
      }
      
      userId = bannedUser.user.id;
    }

    await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);

    const embed = new EmbedBuilder()
      .setTitle('✅ User Unbanned')
      .setDescription(`User has been unbanned from the server.`)
      .addFields(
        { name: 'User ID', value: userId, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unban',
      moderator: interaction.user,
      target: `User ID: ${userId}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error unbanning user:', error);
    await interaction.reply({ 
      content: '❌ Failed to unban the user. Make sure the user ID is correct and they are banned.', 
      ephemeral: true 
    });
  }
}

export async function executePurge(interaction) {
  const amount = interaction.options.getInteger('amount');
  const targetUser = interaction.options.getUser('user');

  try {
    await interaction.deferReply({ ephemeral: true });

    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    let messagesToDelete = Array.from(messages.values());
    
    if (targetUser) {
      messagesToDelete = messagesToDelete.filter(msg => msg.author.id === targetUser.id);
    }

    messagesToDelete = messagesToDelete.slice(0, amount);

    const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    messagesToDelete = messagesToDelete.filter(msg => msg.createdTimestamp > twoWeeksAgo);

    if (messagesToDelete.length === 0) {
      return interaction.editReply({ 
        content: '❌ No messages found to delete.', 
        ephemeral: true 
      });
    }

    const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);

    const embed = new EmbedBuilder()
      .setTitle('🧹 Messages Purged')
      .setDescription(`Successfully deleted ${deleted.size} messages.`)
      .addFields(
        { name: 'Channel', value: `${interaction.channel}`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    if (targetUser) {
      embed.addFields({ name: 'Target User', value: `${targetUser.tag}`, inline: true });
    }

    await interaction.editReply({ embeds: [embed], ephemeral: true });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Purge',
      moderator: interaction.user,
      target: `${interaction.channel} (${interaction.channel.id})`,
      additional: `Deleted ${deleted.size} messages${targetUser ? ` from ${targetUser.tag}` : ''}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error purging messages:', error);
    await interaction.editReply({ 
      content: '❌ Failed to purge messages. Messages older than 14 days cannot be bulk deleted.', 
      ephemeral: true 
    });
  }
}

export async function executeForceNickname(interaction) {
  const user = interaction.options.getUser('user');
  const nickname = interaction.options.getString('nickname');

  if (nickname.length > 32) {
    return interaction.reply({ 
      content: '❌ Nickname must be 32 characters or less.', 
      ephemeral: true 
    });
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    if (!member.manageable) {
      return interaction.reply({ 
        content: '❌ I cannot manage this user\'s nickname. They may have higher permissions than me.', 
        ephemeral: true 
      });
    }

    // Check role hierarchy (skip for owners with bypass)
    if (!isOwnerWithBypass(interaction.member) && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You cannot force a nickname on someone with an equal or higher role.', 
        ephemeral: true 
      });
    }

    const success = await moderationSystem.forceNickname(interaction.guild.id, user.id, nickname);

    if (!success) {
      return interaction.reply({ 
        content: '❌ Failed to force nickname.', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📝 Nickname Forced')
      .setDescription(`Forced nickname on ${user.tag}`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Forced Nickname', value: nickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x9b59b6)
      .setFooter({ text: 'User cannot change this nickname' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Force Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Nickname: ${nickname}`,
      color: 0x9b59b6
    });
  } catch (error) {
    console.error('Error forcing nickname:', error);
    await interaction.reply({ 
      content: '❌ Failed to force nickname.', 
      ephemeral: true 
    });
  }
}

export async function executeUnforceNickname(interaction) {
  const user = interaction.options.getUser('user');

  try {
    const forcedNickname = moderationSystem.getForcedNickname(user.id);
    if (!forcedNickname) {
      return interaction.reply({ 
        content: '❌ This user does not have a forced nickname.', 
        ephemeral: true 
      });
    }

    const success = await moderationSystem.removeForcedNickname(interaction.guild.id, user.id);

    if (!success) {
      return interaction.reply({ 
        content: '❌ Failed to remove forced nickname.', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Forced Nickname Removed')
      .setDescription(`Removed forced nickname from ${user.tag}`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Previous Forced Nickname', value: forcedNickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setFooter({ text: 'User can now change their nickname freely' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unforce Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Previous nickname: ${forcedNickname}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error removing forced nickname:', error);
    await interaction.reply({ 
      content: '❌ Failed to remove forced nickname.', 
      ephemeral: true 
    });
  }
}

export async function executeSetupPerms(interaction) {
  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    const createdRoles = [];

    const vcRole = await guild.roles.create({
      name: 'VC Perms',
      color: 0x3498db,
      permissions: [
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(vcRole);

    const picRole = await guild.roles.create({
      name: 'Pic Perms',
      color: 0xe74c3c,
      permissions: [
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(picRole);

    const linkRole = await guild.roles.create({
      name: 'Link Perms',
      color: 0x2ecc71,
      permissions: [
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(linkRole);

    await moderationSystem.updatePermRoles({
      vc: vcRole.id,
      pic: picRole.id,
      link: linkRole.id
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Permission Roles Created')
      .setDescription('Successfully created moderation permission roles.')
      .addFields(
        { 
          name: 'VC Perms', 
          value: `${vcRole}\nMute, Deafen, Move Members`, 
          inline: true 
        },
        { 
          name: 'Pic Perms', 
          value: `${picRole}\nSend Images/Embeds`, 
          inline: true 
        },
        { 
          name: 'Link Perms', 
          value: `${linkRole}\nSend Links`, 
          inline: true 
        }
      )
      .setColor(0x00ff00)
      .setFooter({ text: 'Assign these roles to users who need the permissions' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Setup Permissions',
      moderator: interaction.user,
      target: 'Created permission roles',
      additional: `VC: ${vcRole.id}, Pic: ${picRole.id}, Link: ${linkRole.id}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error setting up permission roles:', error);
    await interaction.editReply({ 
      content: '❌ Failed to create permission roles. Make sure I have the necessary permissions.' 
    });
  }
}

// Helper functions
function parseDuration(duration) {
  const regex = /^(\d+)([smhd])$/;
  const match = duration.match(regex);
  
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  
  return value * multipliers[unit];
}

function locateMuteConfig() {
  const top    = moderationSystem.config;
  const nested = moderationSystem.config.moderation;

  if (top.permMuteRole) {
    return { cfg: top.permMuteRole, updateKey: 'permMuteRole.roleId' };
  }
  if (nested && nested.permMuteRole) {
    return {
      cfg: nested.permMuteRole,
      updateKey: 'moderation.permMuteRole.roleId'
    };
  }

  console.error('❌ Could not find permMuteRole in config:', moderationSystem.config);
  throw new Error('Configuration error: missing permMuteRole');
}

async function ensureMuteRole(interaction) {
  const { roleId, defaultName, defaultColor } = moderationSystem.config.permMuteRole;

  let role = roleId && interaction.guild.roles.cache.get(roleId);
  if (!role) {
    role = await interaction.guild.roles.create({
      name: defaultName,
      color: defaultColor,
      permissions: []
    });

    moderationSystem.config.permMuteRole.roleId = role.id;
    await moderationSystem.saveConfig();

    for (const channel of interaction.guild.channels.cache.values()) {
      if (channel.isTextBased && channel.isTextBased()) {
        await channel.permissionOverwrites.edit(role, {
          SendMessages:  false,
          AddReactions:  false,
          ViewChannel:   true
        });
      }
      else if (channel.isVoiceBased && channel.isVoiceBased()) {
        await channel.permissionOverwrites.edit(role, {
          Connect: false,
          Speak:   false
        });
      }
    }
  }

  return role;
}

// Export all standalone commands
export const lockChannelData = new SlashCommandBuilder()
  .setName('lockchannel')
  .setDescription('Lock the current channel (disable sending messages)');

export const unlockChannelData = new SlashCommandBuilder()
  .setName('unlockchannel')
  .setDescription('Unlock the current channel (restore sending messages)');

export const nukeData = new SlashCommandBuilder()
  .setName('nuke')
  .setDescription('Clone and delete the current channel')
  .addBooleanOption(option =>
    option
      .setName('confirm')
      .setDescription('Confirm channel nuke')
      .setRequired(true)
  );

// Multi-user standalone commands
export const banData = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban user(s) from the server')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('User(s) to ban (mention or ID, space-separated for multiple)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for ban')
      .setRequired(false)
  );

export const kickData = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick user(s) from the server')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('User(s) to kick (mention or ID, space-separated for multiple)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for kick')
      .setRequired(false)
  );

export const unbanData = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user')
  .addStringOption(option =>
    option
      .setName('user')
      .setDescription('User ID or tag to unban')
      .setRequired(true)
  );

export const timeoutData = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Timeout user(s)')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('User(s) to timeout (mention or ID, space-separated for multiple)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription('Duration (e.g., 5m, 1h, 1d)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for timeout')
      .setRequired(false)
  );

export const muteData = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Mute user(s) (timeout alias)')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('User(s) to mute (mention or ID, space-separated for multiple)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for mute')
      .setRequired(false)
  );

export const unmuteData = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Unmute user(s) (remove timeout)')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('User(s) to unmute (mention or ID, space-separated for multiple)')
      .setRequired(true)
  );

export const purgeData = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Delete multiple messages at once')
  .addIntegerOption(option =>
    option
      .setName('amount')
      .setDescription('Number of messages to delete (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('Only delete messages from this user')
      .setRequired(false)
  );

export const roleData = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Give or remove a role from user(s)')
  .addStringOption(option =>
    option
      .setName('users')
      .setDescription('Target user(s) (mention or ID, space-separated for multiple)')
      .setRequired(true)
  )
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Role to give/remove')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('Give or remove the role')
      .setRequired(true)
      .addChoices(
        { name: 'Give', value: 'give' },
        { name: 'Remove', value: 'remove' }
      )
  );

export const forceNicknameData = new SlashCommandBuilder()
  .setName('forcenickname')
  .setDescription('Force a nickname on a user that they cannot change')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to force nickname on')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('nickname')
      .setDescription('Nickname to force (32 chars max)')
      .setRequired(true)
  );

export const unforceNicknameData = new SlashCommandBuilder()
  .setName('unforcenickname')
  .setDescription('Remove forced nickname from a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to remove forced nickname from')
      .setRequired(true)
  );

export const setupPermsData = new SlashCommandBuilder()
  .setName('setupperms')
  .setDescription('Create moderation roles with specific permissions');

// Export all commands
export const commands = [
  { data: lockChannelData, execute: executeLockChannel },
  { data: unlockChannelData, execute: executeUnlockChannel },
  { data: nukeData, execute: executeNuke },
  { data: banData, execute: executeBan },
  { data: kickData, execute: executeKick },
  { data: unbanData, execute: executeUnban },
  { data: timeoutData, execute: executeTimeout },
  { data: muteData, execute: executeMute },
  { data: unmuteData, execute: executeUnmute },
  { data: purgeData, execute: executePurge },
  { data: roleData, execute: executeRole },
  { data: forceNicknameData, execute: executeForceNickname },
  { data: unforceNicknameData, execute: executeUnforceNickname },
  { data: setupPermsData, execute: executeSetupPerms }
];