// src/commands/permissions.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let permissionSystem = null;
let moderationSystem = null;
let embedLoader = null;

export function setPermissionSystem(system) {
  permissionSystem = system;
}

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('permissions')
  .setDescription('Manage bot permission hierarchy')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // View permissions
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View permission hierarchy and assignments')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Check permissions for a specific user')
          .setRequired(false)
      )
  )
  // Assign user to permission level
  .addSubcommand(subcommand =>
    subcommand
      .setName('assign')
      .setDescription('Assign a user to a permission level')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to assign')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Moderator', value: 'moderator' },
            { name: 'Administrator', value: 'administrator' },
            { name: 'AntiNuke Admin', value: 'antiNukeAdmin' }
          )
      )
  )
  // Remove user from all permission levels
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove a user from all permission levels')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove')
          .setRequired(true)
      )
  )
  // Whitelist management (AntiNuke admins only)
  .addSubcommandGroup(group =>
    group
      .setName('whitelist')
      .setDescription('Manage AntiNuke whitelist')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a user to whitelist (grants Whitelisted level)')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('User to whitelist')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a user from whitelist')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('User to remove from whitelist')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all whitelisted users')
      )
  )
  // Role permission management
  .addSubcommandGroup(group =>
    group
      .setName('role')
      .setDescription('Manage role permissions')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a role to a permission level')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role to add')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('level')
              .setDescription('Permission level')
              .setRequired(true)
              .addChoices(
                { name: 'Moderator', value: 'moderator' },
                { name: 'Administrator', value: 'administrator' },
                { name: 'AntiNuke Admin', value: 'antiNukeAdmin' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a role from a permission level')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role to remove')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('level')
              .setDescription('Permission level')
              .setRequired(true)
              .addChoices(
                { name: 'Moderator', value: 'moderator' },
                { name: 'Administrator', value: 'administrator' },
                { name: 'AntiNuke Admin', value: 'antiNukeAdmin' }
              )
          )
      )
  );

export async function execute(interaction) {
  if (!permissionSystem) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Permission system not loaded.')
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Permission system not loaded.',
      ephemeral: true 
    });
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  
  // Check permissions for different actions
  const executorLevel = permissionSystem.getPermissionLevel(interaction.member);
  
  // Whitelist management requires AntiNuke admin
  if (subcommandGroup === 'whitelist' && executorLevel < permissionSystem.LEVELS.ANTINUKE_ADMIN) {
    const errorEmbed = embedLoader.error('Only AntiNuke administrators can manage the whitelist.');
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  // Permission assignment requires appropriate level
  if (subcommand === 'assign') {
    const targetLevel = interaction.options.getString('level');
    const canAssign = permissionSystem.canAssignPermissionRole(interaction.member, targetLevel);
    
    if (!canAssign.allowed) {
      const errorEmbed = embedLoader.error(canAssign.reason);
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }

  if (subcommandGroup === 'whitelist') {
    switch (subcommand) {
      case 'add':
        return handleWhitelistAdd(interaction);
      case 'remove':
        return handleWhitelistRemove(interaction);
      case 'list':
        return handleWhitelistList(interaction);
    }
  } else if (subcommandGroup === 'role') {
    switch (subcommand) {
      case 'add':
        return handleRoleAdd(interaction);
      case 'remove':
        return handleRoleRemove(interaction);
    }
  } else {
    switch (subcommand) {
      case 'view':
        return executeView(interaction);
      case 'assign':
        return executeAssign(interaction);
      case 'remove':
        return executeRemove(interaction);
    }
  }
}

async function executeView(interaction) {
  const targetUser = interaction.options.getUser('user');
  
  if (targetUser) {
    // Show specific user's permissions
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      const errorEmbed = embedLoader.error('User not found in this server.');
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    
    const level = permissionSystem.getPermissionLevel(member);
    const levelName = permissionSystem.getLevelName(level);
    
    const fields = [
      { name: 'User', value: `${targetUser}`, inline: true },
      { name: 'Permission Level', value: `**${levelName}** (Level ${level})`, inline: true }
    ];
    
    // Show what commands they can use
    const sampleCommands = ['ban', 'kick', 'mute', 'purge', 'nuke', 'setupperms'];
    const allowedCommands = sampleCommands.filter(cmd => 
      permissionSystem.canExecuteCommand(member, cmd).allowed
    );
    
    if (allowedCommands.length > 0) {
      fields.push({
        name: 'Sample Allowed Commands',
        value: allowedCommands.map(cmd => `\`${cmd}\``).join(', '),
        inline: false
      });
    }
    
    const embed = embedLoader.createEmbed({
      title: 'User Permissions',
      formatDescription: false,
      fields
    });
    
    await interaction.reply({ embeds: [embed] });
  } else {
    // Show overall permission hierarchy
    const stats = permissionSystem.getStats();
    
    const fields = [
      {
        name: 'Server Owner',
        value: moderationSystem.config.ownerBypass ? 
          'Has **all permissions** (bypass enabled)' : 
          'Treated as **AntiNuke Admin** (bypass disabled)',
        inline: false
      },
      {
        name: 'AntiNuke Admins',
        value: `**${stats.antiNukeAdmins} users**\n` +
               `Can manage all permissions\n` +
               `Can modify whitelist\n` +
               `Can use all commands\n` +
               `Bypass AntiNuke checks`,
        inline: false
      },
      {
        name: 'Administrators',
        value: `**${stats.administrators} users**\n` +
               `Can use advanced moderation\n` +
               `Can assign moderator role\n` +
               `Commands: ban, kick, nuke, message, etc.`,
        inline: false
      },
      {
        name: 'Whitelisted',
        value: `**${stats.whitelisted} users** (Permission Level)\n` +
               `**${stats.antiNukeWhitelist} users** (AntiNuke Whitelist)\n` +
               `Bypass AntiNuke tracking\n` +
               `Can use multi-user commands\n` +
               `Trusted by the system`,
        inline: false
      },
      {
        name: 'Moderators',
        value: `**${stats.moderators} users**\n` +
               `Basic moderation commands\n` +
               `Commands: mute, purge, lock`,
        inline: false
      },
      {
        name: 'Statistics',
        value: `Total Managed Users: **${stats.totalManaged}**`,
        inline: false
      }
    ];
    
    const embed = embedLoader.createEmbed({
      title: 'Permission Hierarchy',
      description: 'Bot permission system overview',
      formatDescription: false,
      fields
    });
    
    await interaction.reply({ embeds: [embed] });
  }
}

async function executeAssign(interaction) {
  const user = interaction.options.getUser('user');
  const level = interaction.options.getString('level');
  
  // Check if trying to assign to self
  if (user.id === interaction.user.id && permissionSystem.getPermissionLevel(interaction.member) < permissionSystem.LEVELS.OWNER) {
    const errorEmbed = embedLoader.error('You cannot modify your own permissions.');
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  // Check if target has higher or equal permissions
  const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (targetMember) {
    const canManage = permissionSystem.canManageMember(interaction.member, targetMember, 'permissions');
    if (!canManage.allowed) {
      const errorEmbed = embedLoader.error(canManage.reason);
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
  
  const success = await permissionSystem.addUserToLevel(user.id, level);
  
  if (success) {
    const levelName = level.charAt(0).toUpperCase() + level.slice(1);
    const embed = embedLoader.success(`Successfully assigned ${user} to **${levelName}** level.`);
    
    await interaction.reply({ embeds: [embed] });
    
    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Assigned ${user.tag} to ${levelName}`
    });
  } else {
    const errorEmbed = embedLoader.error('User already has that permission level.');
    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
}

async function executeRemove(interaction) {
  const user = interaction.options.getUser('user');
  
  // Check if trying to remove self
  if (user.id === interaction.user.id && permissionSystem.getPermissionLevel(interaction.member) < permissionSystem.LEVELS.OWNER) {
    const errorEmbed = embedLoader.error('You cannot remove your own permissions.');
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  // Check if target has higher or equal permissions
  const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (targetMember) {
    const canManage = permissionSystem.canManageMember(interaction.member, targetMember, 'permissions');
    if (!canManage.allowed) {
      const errorEmbed = embedLoader.error(canManage.reason);
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
  
  await permissionSystem.removeUserFromAllLevels(user.id);
  
  const embed = embedLoader.success(`Successfully removed all permissions from ${user}.`);
  await interaction.reply({ embeds: [embed] });
  
  // Log the action
  await moderationSystem.logAction(interaction.guild, {
    action: 'Permission Update',
    moderator: interaction.user,
    target: `Removed all permissions from ${user.tag}`
  });
}

async function handleWhitelistAdd(interaction) {
  const user = interaction.options.getUser('user');
  
  // Add to AntiNuke whitelist
  const success = await permissionSystem.addToWhitelist(user.id);
  
  if (success) {
    const embed = embedLoader.success(`Successfully added ${user} to AntiNuke whitelist.`);
    await interaction.reply({ embeds: [embed] });
    
    await moderationSystem.logAction(interaction.guild, {
      action: 'Whitelist Add',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`
    });
  } else {
    const embed = embedLoader.warning(`${user} is already in the AntiNuke whitelist.`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleWhitelistRemove(interaction) {
  const user = interaction.options.getUser('user');
  
  // Remove from AntiNuke whitelist
  const success = await permissionSystem.removeFromWhitelist(user.id);
  
  if (success) {
    const embed = embedLoader.success(`Successfully removed ${user} from AntiNuke whitelist.`);
    await interaction.reply({ embeds: [embed] });
    
    await moderationSystem.logAction(interaction.guild, {
      action: 'Whitelist Remove',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`
    });
  } else {
    const embed = embedLoader.warning(`${user} was not in the AntiNuke whitelist.`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleWhitelistList(interaction) {
  const antiNukeWhitelist = permissionSystem.antiNukeConfig.whitelist || { users: [], roles: [] };
  const permWhitelist = permissionSystem.moderationConfig.permissions.whitelisted || { users: [], roles: [] };
  
  const fields = [];
  
  // Show AntiNuke whitelist
  if (antiNukeWhitelist.users.length > 0 || antiNukeWhitelist.roles.length > 0) {
    const userList = antiNukeWhitelist.users.map(id => `<@${id}>`).join('\n') || 'None';
    const roleList = antiNukeWhitelist.roles.map(id => `<@&${id}>`).join('\n') || 'None';
    
    fields.push({
      name: 'AntiNuke Whitelist Users',
      value: userList.slice(0, 1024),
      inline: false
    });
    
    if (roleList !== 'None') {
      fields.push({
        name: 'AntiNuke Whitelist Roles',
        value: roleList.slice(0, 1024),
        inline: false
      });
    }
  }
  
  // Show permission whitelist
  if (permWhitelist.users.length > 0 || permWhitelist.roles.length > 0) {
    const userList = permWhitelist.users.map(id => `<@${id}>`).join('\n') || 'None';
    const roleList = permWhitelist.roles.map(id => `<@&${id}>`).join('\n') || 'None';
    
    fields.push({
      name: 'Permission Whitelist Users',
      value: userList.slice(0, 1024),
      inline: false
    });
    
    if (roleList !== 'None') {
      fields.push({
        name: 'Permission Whitelist Roles',
        value: roleList.slice(0, 1024),
        inline: false
      });
    }
  }
  
  if (fields.length === 0) {
    fields.push({
      name: 'Empty',
      value: 'No users or roles are whitelisted.',
      inline: false
    });
  }
  
  const embed = embedLoader.createEmbed({
    title: 'Whitelist Status',
    description: 'Current whitelist configuration',
    formatDescription: false,
    fields
  });
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRoleAdd(interaction) {
  const role = interaction.options.getRole('role');
  const level = interaction.options.getString('level');
  
  // Check if executor can assign this level
  const canAssign = permissionSystem.canAssignPermissionRole(interaction.member, level);
  if (!canAssign.allowed) {
    const errorEmbed = embedLoader.error(canAssign.reason);
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  const success = await moderationSystem.addRoleToLevel(level, role.id);
  
  if (success) {
    const levelName = level.charAt(0).toUpperCase() + level.slice(1);
    const embed = embedLoader.success(`Successfully added ${role} to **${levelName}** level.`);
    
    await interaction.reply({ embeds: [embed] });
    
    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Added role ${role.name} to ${levelName}`
    });
  } else {
    const errorEmbed = embedLoader.error('Role already has that permission level.');
    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
}

async function handleRoleRemove(interaction) {
  const role = interaction.options.getRole('role');
  const level = interaction.options.getString('level');
  
  // Check if executor can modify this level
  const canAssign = permissionSystem.canAssignPermissionRole(interaction.member, level);
  if (!canAssign.allowed) {
    const errorEmbed = embedLoader.error(canAssign.reason);
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  const success = await moderationSystem.removeRoleFromLevel(level, role.id);
  
  if (success) {
    const levelName = level.charAt(0).toUpperCase() + level.slice(1);
    const embed = embedLoader.success(`Successfully removed ${role} from **${levelName}** level.`);
    
    await interaction.reply({ embeds: [embed] });
    
    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed role ${role.name} from ${levelName}`
    });
  } else {
    const errorEmbed = embedLoader.error('Role was not in that permission level.');
    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
}