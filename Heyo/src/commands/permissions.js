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
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View permission hierarchy')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Check permissions for a specific user')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('user')
      .setDescription('Manage user permissions')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Assign', value: 'assign' },
            { name: 'Remove', value: 'remove' }
          )
      )
      .addUserOption(option =>
        option
          .setName('target')
          .setDescription('User to manage')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level (only for assign)')
          .setRequired(false)
          .addChoices(
            { name: 'Moderator', value: 'moderator' },
            { name: 'Administrator', value: 'administrator' }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Manage role permissions')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' }
          )
      )
      .addRoleOption(option =>
        option
          .setName('target')
          .setDescription('Role to manage')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Moderator', value: 'moderator' },
            { name: 'Administrator', value: 'administrator' }
          )
      )
  );

export async function execute(interaction) {
  if (!permissionSystem || !moderationSystem) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Permission system not loaded.')
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Permission system not loaded.',
      ephemeral: true 
    });
  }

  const subcommand = interaction.options.getSubcommand();
  
  switch (subcommand) {
    case 'view':
      return executeView(interaction);
    case 'user':
      return executeUser(interaction);
    case 'role':
      return executeRole(interaction);
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
    
    // Add special badges
    const badges = [];
    if (targetUser.id === permissionSystem.BOT_OWNER_ID) {
      badges.push('Bot Owner');
    }
    if (member.id === member.guild.ownerId) {
      badges.push('Server Owner');
    }
    
    if (badges.length > 0) {
      fields.push({
        name: 'Special Status',
        value: badges.join('\n'),
        inline: true
      });
    }
    
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
    const config = moderationSystem.config;
    
    const fields = [
      {
        name: 'Bot Owner',
        value: `<@${permissionSystem.BOT_OWNER_ID}>\n` +
               `Has **absolute control** over all systems`,
        inline: false
      },
      {
        name: 'Server Owner',
        value: config.ownerBypass ? 
          'Has **all permissions** (bypass enabled)' : 
          'Treated as **AntiNuke Admin** (bypass disabled)',
        inline: false
      },
      {
        name: 'AntiNuke Admins',
        value: `**${stats.antiNukeAdmins} users**\n` +
               `Manage all permissions\n` +
               `Bypass AntiNuke checks\n` +
               `Use all commands`,
        inline: false
      },
      {
        name: 'Administrators',
        value: `**${stats.administrators} users**\n` +
               `Advanced moderation\n` +
               `Commands: ban, kick, nuke, etc.`,
        inline: false
      },
      {
        name: 'Whitelisted',
        value: `**${stats.antiNukeWhitelist} users**\n` +
               `Bypass AntiNuke tracking\n` +
               `Trusted by the system`,
        inline: false
      },
      {
        name: 'Moderators',
        value: `**${stats.moderators} users**\n` +
               `Basic moderation\n` +
               `Commands: mute, purge, lock`,
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

async function executeUser(interaction) {
  const action = interaction.options.getString('action');
  const user = interaction.options.getUser('target');
  const level = interaction.options.getString('level');
  
  // Check permissions
  const executorLevel = permissionSystem.getPermissionLevel(interaction.member);
  
  if (action === 'assign') {
    if (!level) {
      const errorEmbed = embedLoader.error('Please specify a permission level to assign.');
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    
    // Check if executor can assign this level
    const canAssign = permissionSystem.canAssignPermissionRole(interaction.member, level);
    if (!canAssign.allowed) {
      const errorEmbed = embedLoader.error(canAssign.reason);
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    
    // Check if trying to assign to self
    if (user.id === interaction.user.id && executorLevel < permissionSystem.LEVELS.OWNER) {
      const errorEmbed = embedLoader.error('You cannot modify your own permissions.');
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    
    // Check if target has higher permissions
    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (targetMember) {
      const canManage = permissionSystem.canManageMember(interaction.member, targetMember, 'permissions');
      if (!canManage.allowed) {
        const errorEmbed = embedLoader.error(canManage.reason);
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
    
    // Update config directly
    const config = moderationSystem.config;
    
    // Remove from all levels first
    for (const lvl of ['moderator', 'administrator']) {
      const idx = config.permissions[lvl].users.indexOf(user.id);
      if (idx > -1) {
        config.permissions[lvl].users.splice(idx, 1);
      }
    }
    
    // Add to new level
    if (!config.permissions[level].users.includes(user.id)) {
      config.permissions[level].users.push(user.id);
    }
    
    // Save config
    await moderationSystem.saveConfig();
    
    // Clear permission cache
    permissionSystem.clearUserCache(interaction.guild.id, user.id);
    
    const levelName = level.charAt(0).toUpperCase() + level.slice(1);
    const embed = embedLoader.success(`Assigned ${user} to **${levelName}** level.`);
    
    await interaction.reply({ embeds: [embed] });
    
    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Assigned ${user.tag} to ${levelName}`
    });
  } else if (action === 'remove') {
    // Check if trying to remove from self
    if (user.id === interaction.user.id && executorLevel < permissionSystem.LEVELS.OWNER) {
      const errorEmbed = embedLoader.error('You cannot remove your own permissions.');
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
    
    // Check if target has higher permissions
    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (targetMember) {
      const canManage = permissionSystem.canManageMember(interaction.member, targetMember, 'permissions');
      if (!canManage.allowed) {
        const errorEmbed = embedLoader.error(canManage.reason);
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
    
    // Remove from all permission levels in config
    const config = moderationSystem.config;
    
    for (const lvl of ['moderator', 'administrator']) {
      const idx = config.permissions[lvl].users.indexOf(user.id);
      if (idx > -1) {
        config.permissions[lvl].users.splice(idx, 1);
      }
    }
    
    // Save config
    await moderationSystem.saveConfig();
    
    // Clear permission cache
    permissionSystem.clearUserCache(interaction.guild.id, user.id);
    
    const embed = embedLoader.success(`Removed all permissions from ${user}.`);
    await interaction.reply({ embeds: [embed] });
    
    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed all permissions from ${user.tag}`
    });
  }
}

async function executeRole(interaction) {
  const action = interaction.options.getString('action');
  const role = interaction.options.getRole('target');
  const level = interaction.options.getString('level');
  
  // Check if executor can assign this level
  const canAssign = permissionSystem.canAssignPermissionRole(interaction.member, level);
  if (!canAssign.allowed) {
    const errorEmbed = embedLoader.error(canAssign.reason);
    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }
  
  const config = moderationSystem.config;
  
  if (action === 'add') {
    if (!config.permissions[level].roles.includes(role.id)) {
      config.permissions[level].roles.push(role.id);
      
      await moderationSystem.saveConfig();
      
      // Clear cache for all members with this role
      for (const member of role.members.values()) {
        permissionSystem.clearUserCache(interaction.guild.id, member.id);
      }
      
      const levelName = level.charAt(0).toUpperCase() + level.slice(1);
      const embed = embedLoader.success(`Added ${role} to **${levelName}** level.`);
      
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
  } else if (action === 'remove') {
    const index = config.permissions[level].roles.indexOf(role.id);
    
    if (index > -1) {
      config.permissions[level].roles.splice(index, 1);
      
      await moderationSystem.saveConfig();
      
      // Clear cache for all members with this role
      for (const member of role.members.values()) {
        permissionSystem.clearUserCache(interaction.guild.id, member.id);
      }
      
      const levelName = level.charAt(0).toUpperCase() + level.slice(1);
      const embed = embedLoader.success(`Removed ${role} from **${levelName}** level.`);
      
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
}