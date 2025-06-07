// commands/root.js
// Root management commands for the moderation system
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let moderationSystem = null;

export function setModerationSystem(system) {
  moderationSystem = system;
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
    return interaction.reply({ content: '❌ Moderation system not loaded.', ephemeral: true });
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
  
  const embed = new EmbedBuilder()
    .setTitle('Moderation System Configuration')
    .setColor(0x0099ff)
    .addFields(
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
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeAddUser(interaction) {
  const level = interaction.options.getString('level');
  const user = interaction.options.getUser('user');

  const success = await moderationSystem.addUserToLevel(level, user.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ User Added')
      .setDescription(`Added ${user} to ${level} level.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Added ${user.tag} to ${level}`,
      color: 0x00ff00
    });
  } else {
    await interaction.reply({ 
      content: '❌ User is already in that permission level.', 
      ephemeral: true 
    });
  }
}

async function executeRemoveUser(interaction) {
  const level = interaction.options.getString('level');
  const user = interaction.options.getUser('user');

  const success = await moderationSystem.removeUserFromLevel(level, user.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ User Removed')
      .setDescription(`Removed ${user} from ${level} level.`)
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed ${user.tag} from ${level}`,
      color: 0xff0000
    });
  } else {
    await interaction.reply({ 
      content: '❌ User was not in that permission level.', 
      ephemeral: true 
    });
  }
}

async function executeAddRole(interaction) {
  const level = interaction.options.getString('level');
  const role = interaction.options.getRole('role');

  const success = await moderationSystem.addRoleToLevel(level, role.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Role Added')
      .setDescription(`Added ${role} to ${level} level.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Added role ${role.name} to ${level}`,
      color: 0x00ff00
    });
  } else {
    await interaction.reply({ 
      content: '❌ Role is already in that permission level.', 
      ephemeral: true 
    });
  }
}

async function executeRemoveRole(interaction) {
  const level = interaction.options.getString('level');
  const role = interaction.options.getRole('role');

  const success = await moderationSystem.removeRoleFromLevel(level, role.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Role Removed')
      .setDescription(`Removed ${role} from ${level} level.`)
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Permission Update',
      moderator: interaction.user,
      target: `Removed role ${role.name} from ${level}`,
      color: 0xff0000
    });
  } else {
    await interaction.reply({ 
      content: '❌ Role was not in that permission level.', 
      ephemeral: true 
    });
  }
}

async function executeStats(interaction) {
  const stats = moderationSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('Moderation System Statistics')
    .setColor(0x0099ff)
    .addFields(
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
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}