// src/commands/moderation.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

let moderationSystem = null;
let antiNukeInstance = null;
let embedLoader = null;

// Export setters
export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setAntiNukeInstance(instance) {
  antiNukeInstance = instance;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

// Helper function to parse multiple users from input
function parseMultipleUsers(input) {
  if (!input) return [];
  input = String(input);
  const userPattern = /<@!?(\d+)>|(\d{17,19})/g;
  const matches = [...input.matchAll(userPattern)];
  const userIds = matches.map(match => match[1] || match[2]);
  return [...new Set(userIds)];
}

// Helper function to check if user can use multi-user feature
function canUseMultiUser(interaction, commandName) {
  const multiUserConfig = moderationSystem.config.multiUserCommands?.[commandName];
  if (!multiUserConfig?.enabled) return false;
  
  // Check if user meets the permission level requirement
  if (multiUserConfig.requiresPermissionLevel !== undefined && moderationSystem.permissionSystem) {
    const userLevel = moderationSystem.permissionSystem.getPermissionLevel(interaction.member);
    return userLevel >= multiUserConfig.requiresPermissionLevel;
  }
  
  return true;
}

// Create compound slash command with all moderation commands
export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderation commands')
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
  .addSubcommand(subcommand =>
    subcommand
      .setName('lockchannel')
      .setDescription('Lock the current channel (disable sending messages)')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('unlockchannel')
      .setDescription('Unlock the current channel (restore sending messages)')
  )
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
  .addSubcommand(subcommand =>
    subcommand
      .setName('setupperms')
      .setDescription('Create moderation roles with specific permissions')
  );

// Main execute function for compound command
export async function execute(interaction) {
  if (!moderationSystem || !embedLoader) {
    return interaction.reply({ 
      content: embedLoader.format('Moderation system not loaded.', 'message'), 
      ephemeral: true 
    });
  }

  const subcommand = interaction.options.getSubcommand();
  
  const permCheck = moderationSystem.checkPermission(interaction.member, subcommand);
  if (!permCheck.allowed) {
    return interaction.reply({ 
      content: embedLoader.format(permCheck.reason, 'message'), 
      ephemeral: true 
    });
  }

  const cooldownCheck = moderationSystem.checkCooldown(interaction.user.id, subcommand);
  if (cooldownCheck.onCooldown) {
    return interaction.reply({
      content: embedLoader.format(`Please wait ${cooldownCheck.timeLeft} seconds before using this command again.`, 'message'),
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
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to ban.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'ban')) {
      return interaction.reply({ 
        content: embedLoader.format('You need whitelisted or higher permissions to ban multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.ban;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'ban', multiUserConfig.cooldownMultiplier);
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
        if (!member.bannable) {
          results.failed.push({ user: user.tag, reason: 'Cannot ban (higher permissions)' });
          continue;
        }
        
        // Use moderation system's canManageMember check
        const canManage = moderationSystem.canManageMember(interaction.member, member);
        if (!canManage.allowed) {
          results.failed.push({ user: user.tag, reason: canManage.reason });
          continue;
        }
      }
      
      await interaction.guild.members.ban(userId, { reason: `${reason} - Banned by ${interaction.user.tag}` });
      results.success.push(user.tag);
      
      await moderationSystem.logAction(interaction.guild, {
        action: 'Ban',
        moderator: interaction.user,
        target: `${user.tag} (${user.id})`,
        reason: reason
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully Banned (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed to Ban (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Ban action completed',
    fields: fields
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user kick function
export async function executeKick(interaction) {
  const usersInput = interaction.options.getString('users');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to kick.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'kick')) {
      return interaction.reply({ 
        content: embedLoader.format('You need whitelisted or higher permissions to kick multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.kick;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'kick', multiUserConfig.cooldownMultiplier);
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
      
      if (!member.kickable) {
        results.failed.push({ user: member.user.tag, reason: 'Cannot kick (higher permissions)' });
        continue;
      }
      
      // Use moderation system's canManageMember check
      const canManage = moderationSystem.canManageMember(interaction.member, member);
      if (!canManage.allowed) {
        results.failed.push({ user: member.user.tag, reason: canManage.reason });
        continue;
      }
      
      await member.kick(`${reason} - Kicked by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      await moderationSystem.logAction(interaction.guild, {
        action: 'Kick',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully Kicked (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed to Kick (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Kick action completed',
    fields: fields
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user timeout function
export async function executeTimeout(interaction) {
  const usersInput = interaction.options.getString('users');
  const duration = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to timeout.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  const durationMs = parseDuration(duration);
  if (!durationMs) {
    return interaction.reply({ 
      content: embedLoader.format('Invalid duration format. Use formats like: 5m, 1h, 1d', 'message'), 
      ephemeral: true 
    });
  }
  
  if (durationMs > 28 * 24 * 60 * 60 * 1000) {
    return interaction.reply({ 
      content: embedLoader.format('Timeout duration cannot exceed 28 days.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'timeout')) {
      return interaction.reply({ 
        content: embedLoader.format('You need whitelisted or higher permissions to timeout multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.timeout;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'timeout', multiUserConfig.cooldownMultiplier);
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
      
      if (!member.moderatable) {
        results.failed.push({ user: member.user.tag, reason: 'Cannot timeout (higher permissions)' });
        continue;
      }
      
      // Use moderation system's canManageMember check
      const canManage = moderationSystem.canManageMember(interaction.member, member);
      if (!canManage.allowed) {
        results.failed.push({ user: member.user.tag, reason: canManage.reason });
        continue;
      }
      
      await member.timeout(durationMs, `${reason} - Timed out by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      await moderationSystem.logAction(interaction.guild, {
        action: 'Timeout',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason,
        additional: `Duration: ${duration}`
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully Timed Out (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed to Timeout (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
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
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Timeout action completed',
    fields: fields
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user mute function
export async function executeMute(interaction) {
  const usersInput = interaction.options.getString('users');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to mute.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'mute')) {
      return interaction.reply({ 
        content: embedLoader.format('You need whitelisted or higher permissions to mute multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.mute;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'mute', multiUserConfig.cooldownMultiplier);
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  const muteRole = await moderationSystem.getOrCreateMuteRole(interaction.guild);
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      // Use moderation system's canManageMember check
      const canManage = moderationSystem.canManageMember(interaction.member, member);
      if (!canManage.allowed) {
        results.failed.push({ user: member.user.tag, reason: canManage.reason });
        continue;
      }
      
      if (member.roles.cache.has(muteRole.id)) {
        results.failed.push({ user: member.user.tag, reason: 'Already muted' });
        continue;
      }
      
      await member.roles.add(muteRole, `Muted by ${interaction.user.tag}: ${reason}`);
      results.success.push(member.user.tag);
      
      await moderationSystem.logAction(interaction.guild, {
        action: 'Mute',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`,
        reason: reason
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully Muted (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed to Mute (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  }, {
    name: 'Reason',
    value: reason,
    inline: true
  });
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Mute action completed',
    fields: fields
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user unmute function
export async function executeUnmute(interaction) {
  const usersInput = interaction.options.getString('users');
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to unmute.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'unmute')) {
      return interaction.reply({ 
        content: embedLoader.format('You need moderator or higher permissions to unmute multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.unmute;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'unmute', multiUserConfig.cooldownMultiplier);
    }
  }
  
  await interaction.deferReply();
  
  const results = {
    success: [],
    failed: []
  };
  
  const muteRoleId = moderationSystem.muteRoles.get(interaction.guild.id);
  const muteRole = muteRoleId && interaction.guild.roles.cache.get(muteRoleId);
  
  if (!muteRole) {
    return interaction.editReply({ 
      content: embedLoader.format('No mute role found in this server.', 'message'), 
      ephemeral: true 
    });
  }
  
  for (const userId of userIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      
      if (!member.roles.cache.has(muteRole.id)) {
        results.failed.push({ user: member.user.tag, reason: 'Not muted' });
        continue;
      }
      
      await member.roles.remove(muteRole, `Unmuted by ${interaction.user.tag}`);
      results.success.push(member.user.tag);
      
      await moderationSystem.logAction(interaction.guild, {
        action: 'Unmute',
        moderator: interaction.user,
        target: `${member.user.tag} (${member.user.id})`
      });
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully Unmuted (${results.success.length})`,
      value: results.success.join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed to Unmute (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
    name: 'Moderator',
    value: interaction.user.tag,
    inline: true
  });
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Unmute action completed',
    fields: fields
  });
  
  await interaction.editReply({ embeds: [embed] });
}

// Multi-user role function
export async function executeRole(interaction) {
  const usersInput = interaction.options.getString('users');
  const role = interaction.options.getRole('role');
  const action = interaction.options.getString('action');
  
  if (!usersInput) {
    return interaction.reply({ 
      content: embedLoader.format('Please provide at least one user to manage roles for.', 'message'), 
      ephemeral: true 
    });
  }
  
  const userIds = parseMultipleUsers(usersInput);
  
  if (userIds.length === 0) {
    return interaction.reply({ 
      content: embedLoader.format('No valid users found in input.', 'message'), 
      ephemeral: true 
    });
  }
  
  if (userIds.length > 1) {
    if (!canUseMultiUser(interaction, 'role')) {
      return interaction.reply({ 
        content: embedLoader.format('You need administrator or higher permissions to manage roles for multiple users at once.', 'message'), 
        ephemeral: true 
      });
    }
    
    // Apply cooldown multiplier for multi-user
    const multiUserConfig = moderationSystem.config.multiUserCommands?.role;
    if (multiUserConfig?.cooldownMultiplier) {
      moderationSystem.applyCooldownMultiplier(interaction.user.id, 'role', multiUserConfig.cooldownMultiplier);
    }
  }
  
  // Use the moderation system's canManageRole method which includes AntiNuke admin bypass
  const roleCheck = moderationSystem.canManageRole(interaction.member, role);
  if (!roleCheck.allowed) {
    return interaction.reply({ 
      content: embedLoader.format(roleCheck.reason, 'message'), 
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
          additional: `Role: ${role.name}`
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
          additional: `Role: ${role.name}`
        });
      }
    } catch (error) {
      results.failed.push({ user: userId, reason: error.message });
    }
  }
  
  const fields = [];
  
  if (results.success.length > 0) {
    fields.push({
      name: `Successfully ${action === 'give' ? 'Added' : 'Removed'} (${results.success.length})`,
      value: results.success.map(s => s.user).join('\n').slice(0, 1024) || 'None'
    });
  }
  
  if (results.failed.length > 0) {
    fields.push({
      name: `Failed (${results.failed.length})`,
      value: results.failed.map(f => `${f.user}: ${f.reason}`).join('\n').slice(0, 1024)
    });
  }
  
  fields.push({
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
  
  const embed = embedLoader.createEmbed({
    title: 'Moderation System',
    description: 'Role action completed',
    fields: fields
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

    const embed = embedLoader.createEmbed({
      description: `${channel} has been locked by ${interaction.user.tag}`
    });

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Lock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`
    });
  } catch (error) {
    console.error('Error locking channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to lock the channel. Make sure I have the necessary permissions.', 'message'), 
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

    const embed = embedLoader.createEmbed({
      description: `${channel} has been unlocked by ${interaction.user.tag}`
    });

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Unlock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`
    });
  } catch (error) {
    console.error('Error unlocking channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to unlock the channel. Make sure I have the necessary permissions.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeNuke(interaction) {
  const confirm = interaction.options.getBoolean('confirm');
  
  if (!confirm) {
    return interaction.reply({ 
      content: embedLoader.format('Channel nuke cancelled. Set confirm to true to proceed.', 'message'), 
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

    const embed = embedLoader.createEmbed({
      description: `This channel has been nuked and recreated by ${interaction.user.tag}`
    });

    await newChannel.send({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Nuke',
      moderator: interaction.user,
      target: `#${channel.name} (${channel.id})`
    });

    await channel.delete(`Nuked by ${interaction.user.tag}`);
  } catch (error) {
    console.error('Error nuking channel:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to nuke the channel. Make sure I have the necessary permissions.', 'message'), 
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
          content: embedLoader.format('User not found in ban list.', 'message'), 
          ephemeral: true 
        });
      }
      
      userId = bannedUser.user.id;
    }

    await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);

    const embed = embedLoader.createEmbed({
      description: 'User has been unbanned from the server',
      fields: [
        { name: 'User ID', value: userId, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unban',
      moderator: interaction.user,
      target: `User ID: ${userId}`
    });
  } catch (error) {
    console.error('Error unbanning user:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to unban the user. Make sure the user ID is correct and they are banned.', 'message'), 
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
        content: embedLoader.format('No messages found to delete.', 'message'), 
        ephemeral: true 
      });
    }

    const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);

    const fields = [
      { name: 'Channel', value: `${interaction.channel}`, inline: true },
      { name: 'Moderator', value: interaction.user.tag, inline: true }
    ];

    if (targetUser) {
      fields.push({ name: 'Target User', value: `${targetUser.tag}`, inline: true });
    }

    const embed = embedLoader.createEmbed({
      description: `Successfully deleted ${deleted.size} messages`,
      fields: fields
    });

    await interaction.editReply({ embeds: [embed], ephemeral: true });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Purge',
      moderator: interaction.user,
      target: `${interaction.channel} (${interaction.channel.id})`,
      additional: `Deleted ${deleted.size} messages${targetUser ? ` from ${targetUser.tag}` : ''}`
    });
  } catch (error) {
    console.error('Error purging messages:', error);
    await interaction.editReply({ 
      content: embedLoader.format('Failed to purge messages. Messages older than 14 days cannot be bulk deleted.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeForceNickname(interaction) {
  const user = interaction.options.getUser('user');
  const nickname = interaction.options.getString('nickname');

  if (nickname.length > 32) {
    return interaction.reply({ 
      content: embedLoader.format('Nickname must be 32 characters or less.', 'message'), 
      ephemeral: true 
    });
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    if (!member.manageable) {
      return interaction.reply({ 
        content: embedLoader.format('I cannot manage this user\'s nickname. They may have higher permissions than me.', 'message'), 
        ephemeral: true 
      });
    }

    // Allow users to force nickname themselves, otherwise check permissions
    if (user.id !== interaction.user.id) {
      // Use moderation system's canManageMember check
      const canManage = moderationSystem.canManageMember(interaction.member, member);
      if (!canManage.allowed) {
        return interaction.reply({ 
          content: embedLoader.format(canManage.reason, 'message'), 
          ephemeral: true 
        });
      }
    }

    const success = await moderationSystem.forceNickname(interaction.guild.id, user.id, nickname);

    if (!success) {
      return interaction.reply({ 
        content: embedLoader.format('Failed to force nickname.', 'message'), 
        ephemeral: true 
      });
    }

    const embed = embedLoader.createEmbed({
      description: `Forced nickname on ${user.tag}`,
      fields: [
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Forced Nickname', value: nickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      ],
      footer: 'User cannot change this nickname'
    });

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Force Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Nickname: ${nickname}`
    });
  } catch (error) {
    console.error('Error forcing nickname:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to force nickname.', 'message'), 
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
        content: embedLoader.format('This user does not have a forced nickname.', 'message'), 
        ephemeral: true 
      });
    }

    const success = await moderationSystem.removeForcedNickname(interaction.guild.id, user.id);

    if (!success) {
      return interaction.reply({ 
        content: embedLoader.format('Failed to remove forced nickname.', 'message'), 
        ephemeral: true 
      });
    }

    const embed = embedLoader.createEmbed({
      description: `Removed forced nickname from ${user.tag}`,
      fields: [
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Previous Forced Nickname', value: forcedNickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      ],
      footer: 'User can now change their nickname freely'
    });

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unforce Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Previous nickname: ${forcedNickname}`
    });
  } catch (error) {
    console.error('Error removing forced nickname:', error);
    await interaction.reply({ 
      content: embedLoader.format('Failed to remove forced nickname.', 'message'), 
      ephemeral: true 
    });
  }
}

export async function executeSetupPerms(interaction) {
  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    const createdRoles = [];

    // Create VC Perms role
    const vcRole = await guild.roles.create({
      name: 'VC Perms',
      color: 0x000000,
      permissions: [
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(vcRole);

    // Create Pic Perms role
    const picRole = await guild.roles.create({
      name: 'Pic Perms',
      color: 0x000000,
      permissions: [
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(picRole);

    // Create Link Perms role
    const linkRole = await guild.roles.create({
      name: 'Link Perms',
      color: 0x000000,
      permissions: [
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(linkRole);

    // Update config with role IDs
    await moderationSystem.updatePermRoles({
      vc: vcRole.id,
      pic: picRole.id,
      link: linkRole.id
    });

    // Setup channel permissions
    const channelUpdates = {
      text: 0,
      voice: 0,
      failed: 0
    };

    // First, set up @everyone restrictions and role permissions
    for (const channel of guild.channels.cache.values()) {
      try {
        if (channel.isTextBased() && !channel.isThread()) {
          // Restrict @everyone from sending attachments and links
          await channel.permissionOverwrites.edit(guild.roles.everyone, {
            AttachFiles: false,
            EmbedLinks: false
          }, { reason: 'Setup moderation permissions' });

          // Allow Pic Perms role to send attachments and embeds
          await channel.permissionOverwrites.create(picRole, {
            AttachFiles: true,
            EmbedLinks: true
          }, { reason: 'Setup pic permissions' });

          // Allow Link Perms role to send links (but not necessarily attachments)
          await channel.permissionOverwrites.create(linkRole, {
            EmbedLinks: true
          }, { reason: 'Setup link permissions' });

          channelUpdates.text++;
        } else if (channel.isVoiceBased()) {
          // Set up voice channel permissions for VC Perms role
          await channel.permissionOverwrites.create(vcRole, {
            MuteMembers: true,
            DeafenMembers: true,
            MoveMembers: true
          }, { reason: 'Setup VC permissions' });

          channelUpdates.voice++;
        }
      } catch (error) {
        console.error(`[SetupPerms] Error updating channel ${channel.name}:`, error);
        channelUpdates.failed++;
      }
    }

    const embed = embedLoader.createEmbed({
      title: 'Moderation System',
      description: 'Successfully created moderation permission roles and updated channels',
      fields: [
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
        },
        {
          name: 'Channel Updates',
          value: `Text Channels: ${channelUpdates.text}\nVoice Channels: ${channelUpdates.voice}\nFailed: ${channelUpdates.failed}`,
          inline: false
        },
        {
          name: 'Important Notes',
          value: '• @everyone can no longer send images/links in text channels\n• Users need Pic Perms role to send images\n• Users need Link Perms role to send links\n• Users with VC Perms can moderate voice channels',
          inline: false
        }
      ],
      footer: 'Assign these roles to users who need the permissions'
    });

    await interaction.editReply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Setup Permissions',
      moderator: interaction.user,
      target: 'Created permission roles and updated channels',
      additional: `VC: ${vcRole.id}, Pic: ${picRole.id}, Link: ${linkRole.id} | Updated ${channelUpdates.text + channelUpdates.voice} channels`
    });
  } catch (error) {
    console.error('Error setting up permission roles:', error);
    await interaction.editReply({ 
      content: embedLoader.format('Failed to create permission roles. Make sure I have the necessary permissions.', 'message')
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