// src/commands/vanity.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { EmbedLoader } from '../utils/embedLoader.js';

let vanityManager = null;
let embedLoader = null;

export function setVanityManager(manager) {
  vanityManager = manager;
  // Initialize embedLoader using the vanityManager's configLoader
  if (manager && manager.configLoader) {
    embedLoader = new EmbedLoader(manager.configLoader);
  }
}

export const vanityData = new SlashCommandBuilder()
  .setName('vanity')
  .setDescription('Manage vanity system settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // Enable/disable subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('toggle')
      .setDescription('Enable or disable the vanity system')
      .addBooleanOption(option =>
        option
          .setName('enabled')
          .setDescription('Enable the vanity system')
          .setRequired(true)
      )
  )
  // View configuration
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View vanity system configuration')
  )
  // Add vanity string
  .addSubcommand(subcommand =>
    subcommand
      .setName('addstring')
      .setDescription('Add a vanity string to check for')
      .addStringOption(option =>
        option
          .setName('vanity')
          .setDescription('Vanity string to add')
          .setRequired(true)
      )
  )
  // Remove vanity string
  .addSubcommand(subcommand =>
    subcommand
      .setName('removestring')
      .setDescription('Remove a vanity string')
      .addStringOption(option =>
        option
          .setName('vanity')
          .setDescription('Vanity string to remove')
          .setRequired(true)
      )
  )
  // Add role
  .addSubcommand(subcommand =>
    subcommand
      .setName('addrole')
      .setDescription('Add a role to assign when vanity is found')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to add')
          .setRequired(true)
      )
  )
  // Remove role
  .addSubcommand(subcommand =>
    subcommand
      .setName('removerole')
      .setDescription('Remove a role from vanity assignment')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to remove')
          .setRequired(true)
      )
  )
  // Set check interval
  .addSubcommand(subcommand =>
    subcommand
      .setName('interval')
      .setDescription('Set how often to check all members')
      .addIntegerOption(option =>
        option
          .setName('seconds')
          .setDescription('Check interval in seconds')
          .setRequired(true)
          .setMinValue(60)
          .setMaxValue(86400)
      )
  )
  // Force check
  .addSubcommand(subcommand =>
    subcommand
      .setName('check')
      .setDescription('Force check a member or all members')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to check (leave empty for all)')
          .setRequired(false)
      )
  )
  // View stats
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View vanity system statistics')
  );

export async function executeVanity(interaction) {
  if (!vanityManager || !embedLoader) {
    return interaction.reply({ content: 'Vanity system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'toggle':
      return executeToggle(interaction);
    case 'view':
      return executeVanityView(interaction);
    case 'addstring':
      return executeAddString(interaction);
    case 'removestring':
      return executeRemoveString(interaction);
    case 'addrole':
      return executeVanityAddRole(interaction);
    case 'removerole':
      return executeVanityRemoveRole(interaction);
    case 'interval':
      return executeInterval(interaction);
    case 'check':
      return executeCheck(interaction);
    case 'stats':
      return executeVanityStats(interaction);
  }
}

async function executeToggle(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  
  if (enabled) {
    await vanityManager.enable();
    const embed = embedLoader.success('The vanity system is now active and will check members for vanity strings.');
    await interaction.reply({ embeds: [embed] });
  } else {
    await vanityManager.disable();
    const embed = embedLoader.success('The vanity system has been disabled.');
    await interaction.reply({ embeds: [embed] });
  }
}

async function executeVanityView(interaction) {
  const config = vanityManager.config;
  
  const embed = embedLoader.system('Vanity System', '', {
    fields: [
      {
        name: 'Status',
        value: config.enabled ? 'Enabled' : 'Disabled',
        inline: true
      },
      {
        name: 'Check Interval',
        value: `${config.checkIntervalSeconds} seconds`,
        inline: true
      },
      {
        name: 'Case Sensitive',
        value: config.caseSensitive ? 'Yes' : 'No',
        inline: true
      },
      {
        name: 'Vanity Strings',
        value: config.vanityStrings?.length > 0 ? config.vanityStrings.map(s => `\`${s}\``).join(', ') : 'None',
        inline: false
      },
      {
        name: 'Roles to Assign',
        value: config.roles?.length > 0 ? config.roles.map(id => `<@&${id}>`).join(', ') : 'None',
        inline: false
      },
      {
        name: 'Check Settings',
        value: `Username: ${config.checkUsername ? 'Yes' : 'No'}\n` +
               `Nickname: ${config.checkNickname ? 'Yes' : 'No'}\n` +
               `Bio: ${config.checkBio ? 'Yes' : 'No'}\n` +
               `Status: ${config.checkStatus ? 'Yes' : 'No'}\n` +
               `Remove on Loss: ${config.removeOnVanityLoss ? 'Yes' : 'No'}`,
        inline: true
      },
      {
        name: 'Exempt Roles',
        value: config.exemptRoles?.length > 0 ? config.exemptRoles.map(id => `<@&${id}>`).join(', ') : 'None',
        inline: true
      }
    ]
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeAddString(interaction) {
  const vanity = interaction.options.getString('vanity');
  
  const success = await vanityManager.addVanityString(vanity);
  
  if (success) {
    const embed = embedLoader.success(`Added \`${vanity}\` to vanity strings.`);
    await interaction.reply({ embeds: [embed] });
  } else {
    const embed = embedLoader.error('That vanity string already exists.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function executeRemoveString(interaction) {
  const vanity = interaction.options.getString('vanity');
  
  const success = await vanityManager.removeVanityString(vanity);
  
  if (success) {
    const embed = embedLoader.success(`Removed \`${vanity}\` from vanity strings.`);
    await interaction.reply({ embeds: [embed] });
  } else {
    const embed = embedLoader.error('That vanity string was not found.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function executeVanityAddRole(interaction) {
  const role = interaction.options.getRole('role');
  
  const success = await vanityManager.addRole(role.id);
  
  if (success) {
    const embed = embedLoader.success(`Added ${role} to vanity assignment roles.`);
    await interaction.reply({ embeds: [embed] });
  } else {
    const embed = embedLoader.error('That role is already in the vanity assignment list.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function executeVanityRemoveRole(interaction) {
  const role = interaction.options.getRole('role');
  
  const success = await vanityManager.removeRole(role.id);
  
  if (success) {
    const embed = embedLoader.success(`Removed ${role} from vanity assignment roles.`);
    await interaction.reply({ embeds: [embed] });
  } else {
    const embed = embedLoader.error('That role was not in the vanity assignment list.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function executeInterval(interaction) {
  const seconds = interaction.options.getInteger('seconds');
  
  await vanityManager.setCheckInterval(seconds);
  
  const embed = embedLoader.success(`Vanity check interval set to ${seconds} seconds.`);
  await interaction.reply({ embeds: [embed] });
}

async function executeCheck(interaction) {
  const user = interaction.options.getUser('user');
  
  await interaction.deferReply();
  
  if (user) {
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
      const embed = embedLoader.error('Member not found in this server.');
      return interaction.editReply({ embeds: [embed] });
    }
    
    await vanityManager.forceCheckMember(member);
    
    const embed = embedLoader.success(`Checked vanity status for ${user}.`);
    await interaction.editReply({ embeds: [embed] });
  } else {
    await vanityManager.checkAllMembers();
    
    const embed = embedLoader.success('Completed vanity check for all members.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function executeVanityStats(interaction) {
  const stats = vanityManager.getConfig();
  
  const embed = embedLoader.system('Vanity System Statistics', '', {
    fields: [
      {
        name: 'Status',
        value: stats.enabled ? 'Enabled' : 'Disabled',
        inline: true
      },
      {
        name: 'Last Check',
        value: stats.lastCheck ? `<t:${Math.floor(stats.lastCheck.getTime() / 1000)}:R>` : 'Never',
        inline: true
      },
      {
        name: 'Next Check',
        value: stats.nextCheck ? `<t:${Math.floor(stats.nextCheck.getTime() / 1000)}:R>` : 'N/A',
        inline: true
      },
      {
        name: 'Configuration',
        value: `Vanity Strings: ${stats.vanityStrings}\nRoles: ${stats.roles}`,
        inline: false
      }
    ]
  });
  
  await interaction.reply({ embeds: [embed] });
}

// Export vanity command separately
export const vanityCommand = {
  data: vanityData,
  execute: executeVanity
};