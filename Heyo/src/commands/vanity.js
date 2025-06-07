import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';


let vanityManager = null;

export function setVanityManager(manager) {
  vanityManager = manager;
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
  if (!vanityManager) {
    return interaction.reply({ content: '❌ Vanity manager not loaded.', ephemeral: true });
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
    const embed = new EmbedBuilder()
      .setTitle('✅ Vanity System Enabled')
      .setDescription('The vanity system is now active and will check members for vanity strings.')
      .setColor(0x00ff00)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await vanityManager.disable();
    const embed = new EmbedBuilder()
      .setTitle('❌ Vanity System Disabled')
      .setDescription('The vanity system has been disabled.')
      .setColor(0xff0000)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
}

async function executeVanityView(interaction) {
  const config = vanityManager.config;
  
  const embed = new EmbedBuilder()
    .setTitle('Vanity System Configuration')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      {
        name: 'Status',
        value: config.enabled ? '✅ Enabled' : '❌ Disabled',
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
        value: config.vanityStrings.length > 0 ? config.vanityStrings.map(s => `\`${s}\``).join(', ') : 'None',
        inline: false
      },
      {
        name: 'Roles to Assign',
        value: config.roles.length > 0 ? config.roles.map(id => `<@&${id}>`).join(', ') : 'None',
        inline: false
      },
      {
        name: 'Check Settings',
        value: `Username: ${config.checkUsername ? '✅' : '❌'}\n` +
               `Nickname: ${config.checkNickname ? '✅' : '❌'}\n` +
               `Bio: ${config.checkBio ? '✅' : '❌'}\n` +
               `Status: ${config.checkStatus ? '✅' : '❌'}\n` +
               `Remove on Loss: ${config.removeOnVanityLoss ? '✅' : '❌'}`,
        inline: true
      },
      {
        name: 'Exempt Roles',
        value: config.exemptRoles.length > 0 ? config.exemptRoles.map(id => `<@&${id}>`).join(', ') : 'None',
        inline: true
      }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeAddString(interaction) {
  const vanity = interaction.options.getString('vanity');
  
  const success = await vanityManager.addVanityString(vanity);
  
  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Vanity String Added')
      .setDescription(`Added \`${vanity}\` to vanity strings.`)
      .setColor(0x00ff00)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({ 
      content: '❌ That vanity string already exists.', 
      ephemeral: true 
    });
  }
}

async function executeRemoveString(interaction) {
  const vanity = interaction.options.getString('vanity');
  
  const success = await vanityManager.removeVanityString(vanity);
  
  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Vanity String Removed')
      .setDescription(`Removed \`${vanity}\` from vanity strings.`)
      .setColor(0xff0000)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({ 
      content: '❌ That vanity string was not found.', 
      ephemeral: true 
    });
  }
}

async function executeVanityAddRole(interaction) {
  const role = interaction.options.getRole('role');
  
  const success = await vanityManager.addRole(role.id);
  
  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Role Added')
      .setDescription(`Added ${role} to vanity assignment roles.`)
      .setColor(0x00ff00)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({ 
      content: '❌ That role is already in the vanity assignment list.', 
      ephemeral: true 
    });
  }
}

async function executeVanityRemoveRole(interaction) {
  const role = interaction.options.getRole('role');
  
  const success = await vanityManager.removeRole(role.id);
  
  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Role Removed')
      .setDescription(`Removed ${role} from vanity assignment roles.`)
      .setColor(0xff0000)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({ 
      content: '❌ That role was not in the vanity assignment list.', 
      ephemeral: true 
    });
  }
}

async function executeInterval(interaction) {
  const seconds = interaction.options.getInteger('seconds');
  
  await vanityManager.setCheckInterval(seconds);
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Check Interval Updated')
    .setDescription(`Vanity check interval set to ${seconds} seconds.`)
    .setColor(0x00ff00)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}

async function executeCheck(interaction) {
  const user = interaction.options.getUser('user');
  
  await interaction.deferReply();
  
  if (user) {
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
      return interaction.editReply({ content: '❌ Member not found in this server.' });
    }
    
    await vanityManager.forceCheckMember(member);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Member Checked')
      .setDescription(`Checked vanity status for ${user}.`)
      .setColor(0x00ff00)
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  } else {
    await vanityManager.checkAllMembers();
    
    const embed = new EmbedBuilder()
      .setTitle('✅ All Members Checked')
      .setDescription('Completed vanity check for all members.')
      .setColor(0x00ff00)
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }
}

async function executeVanityStats(interaction) {
  const stats = vanityManager.getStats();
  
  const embed = new EmbedBuilder()
    .setTitle('Vanity System Statistics')
    .setColor(stats.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      {
        name: 'Status',
        value: stats.enabled ? '✅ Enabled' : '❌ Disabled',
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
        inline: true
      },
      {
        name: 'Activity',
        value: `Total Checks: ${stats.stats.totalChecks}\nRoles Added: ${stats.stats.rolesAdded}\nRoles Removed: ${stats.stats.rolesRemoved}\nErrors: ${stats.stats.errors}`,
        inline: true
      }
    )
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}

// Export vanity command separately
export const vanityCommand = {
  data: vanityData,
  execute: executeVanity
};