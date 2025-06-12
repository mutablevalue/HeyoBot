// src/commands/root.js
// Root management commands for the moderation system
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let moderationSystem = null;
let embedLoader = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Root management for moderation system')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // View permissions subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View moderation system configuration')
  )
  // Add user to permission level
  .addSubcommand(subcommand =>
    subcommand
      .setName('adduser')
      .setDescription('Add a user to a permission level')
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Administrator', value: 'administrator' },
            { name: 'Moderator', value: 'moderator' }
          )
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to add')
          .setRequired(true)
      )
  )
  // Remove user from permission level
  .addSubcommand(subcommand =>
    subcommand
      .setName('removeuser')
      .setDescription('Remove a user from a permission level')
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Administrator', value: 'administrator' },
            { name: 'Moderator', value: 'moderator' }
          )
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove')
          .setRequired(true)
      )
  )
  // Add role to permission level
  .addSubcommand(subcommand =>
    subcommand
      .setName('addrole')
      .setDescription('Add a role to a permission level')
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Administrator', value: 'administrator' },
            { name: 'Moderator', value: 'moderator' }
          )
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to add')
          .setRequired(true)
      )
  )
  // Remove role from permission level
  .addSubcommand(subcommand =>
    subcommand
      .setName('removerole')
      .setDescription('Remove a role from a permission level')
      .addStringOption(option =>
        option
          .setName('level')
          .setDescription('Permission level')
          .setRequired(true)
          .addChoices(
            { name: 'Administrator', value: 'administrator' },
            { name: 'Moderator', value: 'moderator' }
          )
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to remove')
          .setRequired(true)
      )
  )
  // View stats
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View moderation system statistics')
  );

export async function execute(interaction) {
  if (!moderationSystem) {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Moderation system not loaded.')
      : null;
    
    return interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Moderation system not loaded.',
      ephemeral: true 
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'view':
      return executeView(interaction);
    case 'adduser':
      return executeAddUser(interaction);
    case 'removeuser':
      return executeRemoveUser(interaction);
    case 'addrole':
      return executeAddRole(interaction);
    case 'removerole':
      return executeRemoveRole(interaction);
    case 'stats':
      return executeStats(interaction);
  }
}

async function executeView(interaction) {
  const config = moderationSystem.config;
  
  const fields = [
    {
      name: 'Administrator Level',
      value: `**Users:** ${config.permissions.administrator.users.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
             `**Roles:** ${config.permissions.administrator.roles.map(id => `<@&${id}>`).join(', ') || 'None'}\n` +
             `**Commands:** ${config.permissions.administrator.commands.join(', ')}`,
      inline: false
    },
    {
      name: 'Moderator Level',
      value: `**Users:** ${config.permissions.moderator.users.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
             `**Roles:** ${config.permissions.moderator.roles.map(id => `<@&${id}>`).join(', ') || 'None'}\n` +
             `**Commands:** ${config.permissions.moderator.commands.join(', ')}`,
      inline: false
    },
    {
      name: 'Log Channel',
      value: config.logChannel ? `<#${config.logChannel}>` : 'Not set',
      inline: true
    }
  ];

  const embed = embedLoader 
    ? embedLoader.system('Moderation System', 'Current configuration and permissions', { fields })
    : null;

  await interaction.reply({ 
    embeds: embed ? [embed] : undefined,
    content: embed ? undefined : 'View configuration in console.'
  });
}

async function executeAddUser(interaction) {
  const level = interaction.options.getString('level');
  const user = interaction.options.getUser('user');

  const success = await moderationSystem.addUserToLevel(level, user.id);

  if (success) {
    const embed = embedLoader 
      ? embedLoader.success(`Added ${user} to ${level} level.`)
      : null;

    await interaction.reply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Added ${user.tag} to ${level} level.`
    });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Added ${user.tag} to ${level}`
    });
  } else {
    const errorEmbed = embedLoader 
      ? embedLoader.error('User is already in that permission level.')
      : null;
    
    await interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'User is already in that permission level.',
      ephemeral: true 
    });
  }
}

async function executeRemoveUser(interaction) {
  const level = interaction.options.getString('level');
  const user = interaction.options.getUser('user');

  const success = await moderationSystem.removeUserFromLevel(level, user.id);

  if (success) {
    const embed = embedLoader 
      ? embedLoader.success(`Removed ${user} from ${level} level.`)
      : null;

    await interaction.reply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Removed ${user.tag} from ${level} level.`
    });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed ${user.tag} from ${level}`
    });
  } else {
    const errorEmbed = embedLoader 
      ? embedLoader.error('User was not in that permission level.')
      : null;
    
    await interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'User was not in that permission level.',
      ephemeral: true 
    });
  }
}

async function executeAddRole(interaction) {
  const level = interaction.options.getString('level');
  const role = interaction.options.getRole('role');

  const success = await moderationSystem.addRoleToLevel(level, role.id);

  if (success) {
    const embed = embedLoader 
      ? embedLoader.success(`Added ${role} to ${level} level.`)
      : null;

    await interaction.reply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Added role ${role.name} to ${level} level.`
    });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Added role ${role.name} to ${level}`
    });
  } else {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Role is already in that permission level.')
      : null;
    
    await interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Role is already in that permission level.',
      ephemeral: true 
    });
  }
}

async function executeRemoveRole(interaction) {
  const level = interaction.options.getString('level');
  const role = interaction.options.getRole('role');

  const success = await moderationSystem.removeRoleFromLevel(level, role.id);

  if (success) {
    const embed = embedLoader 
      ? embedLoader.success(`Removed ${role} from ${level} level.`)
      : null;

    await interaction.reply({ 
      embeds: embed ? [embed] : undefined,
      content: embed ? undefined : `Removed role ${role.name} from ${level} level.`
    });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed role ${role.name} from ${level}`
    });
  } else {
    const errorEmbed = embedLoader 
      ? embedLoader.error('Role was not in that permission level.')
      : null;
    
    await interaction.reply({ 
      embeds: errorEmbed ? [errorEmbed] : undefined,
      content: errorEmbed ? undefined : 'Role was not in that permission level.',
      ephemeral: true 
    });
  }
}

async function executeStats(interaction) {
  const stats = moderationSystem.getStats();

  const fields = [
    {
      name: 'Administrators',
      value: `Users: ${stats.administrators.users}\nRoles: ${stats.administrators.roles}\nCommands: ${stats.administrators.commands}`,
      inline: true
    },
    {
      name: 'Moderators',
      value: `Users: ${stats.moderators.users}\nRoles: ${stats.moderators.roles}\nCommands: ${stats.moderators.commands}`,
      inline: true
    },
    {
      name: 'System Info',
      value: `Permission Roles: ${stats.permRoles.configured}/${stats.permRoles.total}\nActive Cooldowns: ${stats.activeCooldowns}`,
      inline: true
    }
  ];

  const embed = embedLoader 
    ? embedLoader.system('Moderation System', 'Statistics and usage information', { fields })
    : null;

  await interaction.reply({ 
    embeds: embed ? [embed] : undefined,
    content: embed ? undefined : 'Statistics logged to console.'
  });
}