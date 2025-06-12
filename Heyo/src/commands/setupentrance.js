// src/commands/setupentrance.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

let entranceSystem = null;
let embedLoader = null;

export function setEntranceSystem(system) {
  entranceSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const setupEntranceData = new SlashCommandBuilder()
  .setName('setupentrance')
  .setDescription('Setup server entrance verification system')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('instance')
      .setDescription('Setup entrance verification instance')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('ID of the message to react to')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('emoji')
          .setDescription('Emoji to react with')
          .setRequired(false)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to give when verified (uses existing or creates default)')
          .setRequired(false)
      )
      .addChannelOption(option =>
        option
          .setName('log_channel')
          .setDescription('Channel for verification logs')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('welcome_message')
          .setDescription('Custom welcome message for verified users')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('dm_welcome')
          .setDescription('Send welcome message via DM')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('allow_unverify')
          .setDescription('Allow users to unverify by removing reaction')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Setup entrance role permissions')
      .addChannelOption(option =>
        option
          .setName('verify_channel')
          .setDescription('Channel where verification happens (stays visible)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to configure (creates new if not specified)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('role_name')
          .setDescription('Name for new role (if creating)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('role_color')
          .setDescription('Hex color for new role (e.g., #00ff00)')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('hoist')
          .setDescription('Display role separately in member list')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('exempt')
      .setDescription('Manage exempt roles and channels')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to exempt from entrance requirement')
          .setRequired(false)
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to keep visible for everyone')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('remove')
          .setDescription('Remove exemption instead of adding')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove entrance system from server')
      .addBooleanOption(option =>
        option
          .setName('reset_permissions')
          .setDescription('Reset all channel permissions')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('reset')
      .setDescription('Reset all channel permissions to default')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View entrance system statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('test')
      .setDescription('Test the entrance system')
  );

export async function execute(interaction) {
  if (!entranceSystem || !embedLoader) {
    return interaction.reply({ content: 'Entrance system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'instance':
      return executeInstance(interaction);
    case 'role':
      return executeRole(interaction);
    case 'exempt':
      return executeExempt(interaction);
    case 'remove':
      return executeRemove(interaction);
    case 'reset':
      return executeReset(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'test':
      return executeTest(interaction);
  }
}

async function executeInstance(interaction) {
  const messageId = interaction.options.getString('message_id');
  const emoji = interaction.options.getString('emoji') || '✅';
  const role = interaction.options.getRole('role');
  const logChannel = interaction.options.getChannel('log_channel');
  const welcomeMessage = interaction.options.getString('welcome_message');
  const dmWelcome = interaction.options.getBoolean('dm_welcome') ?? true;
  const allowUnverify = interaction.options.getBoolean('allow_unverify') ?? false;

  await interaction.deferReply();

  try {
    // Check if instance already exists
    const existing = entranceSystem.instances.get(interaction.guild.id);
    if (existing) {
      return interaction.editReply({
        content: 'An entrance instance already exists. Use `/setupentrance remove` first.'
      });
    }

    // Setup instance
    const options = {
      roleId: role?.id,
      logChannel: logChannel?.id,
      welcomeMessage,
      dmWelcome,
      allowUnverify,
      createdBy: interaction.user.id
    };

    const result = await entranceSystem.setupInstance(interaction.guild, messageId, emoji, options);

    // Enable system
    entranceSystem.config.enabled = true;
    await entranceSystem.saveConfig();

    const fields = [
      { name: 'Message', value: `[Jump to Message](https://discord.com/channels/${interaction.guild.id}/${result.channel.id}/${messageId})`, inline: true },
      { name: 'Emoji', value: emoji, inline: true },
      { name: 'Role', value: role ? `${role}` : 'Not set (use `/setupentrance role`)', inline: true },
      { name: 'Log Channel', value: logChannel ? `${logChannel}` : 'Not set', inline: true },
      { name: 'DM Welcome', value: dmWelcome ? 'Yes' : 'No', inline: true },
      { name: 'Allow Unverify', value: allowUnverify ? 'Yes' : 'No', inline: true }
    ];

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Instance created successfully',
      fields,
      footer: role ? 'Ready to use!' : 'Use /setupentrance role to complete setup'
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SetupEntrance] Error creating instance:', error);
    await interaction.editReply({
      content: `Failed to create instance: ${error.message}`
    });
  }
}

async function executeRole(interaction) {
  const role = interaction.options.getRole('role');
  const verifyChannel = interaction.options.getChannel('verify_channel');
  const roleName = interaction.options.getString('role_name') || entranceSystem.config.defaultRoleName;
  const roleColor = interaction.options.getString('role_color');
  const hoist = interaction.options.getBoolean('hoist') ?? false;

  await interaction.deferReply();

  try {
    // Get current instance
    const instance = entranceSystem.instances.get(interaction.guild.id);
    
    const options = {
      roleId: role?.id,
      roleName,
      roleHoist: hoist,
      verifyChannel: verifyChannel.id,
      exemptRoles: instance?.exemptRoles || [],
      exemptChannels: instance?.exemptChannels || []
    };

    // Parse color
    if (roleColor) {
      const color = parseInt(roleColor.replace('#', ''), 16);
      if (!isNaN(color)) {
        options.roleColor = color;
      }
    }

    const result = await entranceSystem.setupRole(interaction.guild, options);

    const fields = [
      { name: 'Role', value: `${result.role}`, inline: true },
      { name: 'Verify Channel', value: `${verifyChannel}`, inline: true },
      { name: 'Hidden Channels', value: `${result.changes.hiddenChannels}`, inline: true },
      { name: 'Exempt Channels', value: `${result.changes.exemptedChannels}`, inline: true }
    ];

    if (result.changes.errors.length > 0) {
      fields.push({
        name: 'Errors',
        value: result.changes.errors.slice(0, 5).join('\n'),
        inline: false
      });
    }

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Role configured successfully',
      fields,
      footer: !instance ? 'Use /setupentrance instance to complete setup' : 'Entrance system is ready!'
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SetupEntrance] Error configuring role:', error);
    await interaction.editReply({
      content: `Failed to configure role: ${error.message}`
    });
  }
}

async function executeExempt(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  const remove = interaction.options.getBoolean('remove') ?? false;

  if (!role && !channel) {
    return interaction.reply({
      content: 'Please specify either a role or channel to exempt.',
      ephemeral: true
    });
  }

  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found. Use `/setupentrance instance` first.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const changes = [];

    if (role) {
      if (!instance.exemptRoles) instance.exemptRoles = [];
      
      if (remove) {
        const index = instance.exemptRoles.indexOf(role.id);
        if (index > -1) {
          instance.exemptRoles.splice(index, 1);
          changes.push(`Removed exempt role: ${role}`);
        }
      } else {
        if (!instance.exemptRoles.includes(role.id)) {
          instance.exemptRoles.push(role.id);
          changes.push(`Added exempt role: ${role}`);
        }
      }
    }

    if (channel) {
      if (!instance.exemptChannels) instance.exemptChannels = [];
      
      if (remove) {
        const index = instance.exemptChannels.indexOf(channel.id);
        if (index > -1) {
          instance.exemptChannels.splice(index, 1);
          changes.push(`Removed exempt channel: ${channel}`);
        }
      } else {
        if (!instance.exemptChannels.includes(channel.id)) {
          instance.exemptChannels.push(channel.id);
          changes.push(`Added exempt channel: ${channel}`);
        }
      }
    }

    if (changes.length === 0) {
      return interaction.editReply({
        content: 'No changes made. Item may already be in the list.'
      });
    }

    entranceSystem.saveEntranceData();

    const fields = [
      { name: 'Exempt Roles', value: instance.exemptRoles.length > 0 ? instance.exemptRoles.map(id => `<@&${id}>`).join(', ') : 'None', inline: false },
      { name: 'Exempt Channels', value: instance.exemptChannels.length > 0 ? instance.exemptChannels.map(id => `<#${id}>`).join(', ') : 'None', inline: false }
    ];

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Exemptions updated\n' + changes.join('\n'),
      fields
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SetupEntrance] Error updating exemptions:', error);
    await interaction.editReply({
      content: `Failed to update exemptions: ${error.message}`
    });
  }
}

async function executeRemove(interaction) {
  const resetPermissions = interaction.options.getBoolean('reset_permissions') ?? false;

  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found.',
      ephemeral: true
    });
  }

  // Confirm deletion
  const embed = embedLoader.createEmbed({
    title: 'Entrance System',
    description: 'Confirm removal\nAre you sure you want to remove the entrance system?',
    fields: [
      { name: 'Reset Permissions', value: resetPermissions ? 'Yes' : 'No', inline: true },
      { name: 'Verified Users', value: `${instance.verifiedUsers.length}`, inline: true }
    ]
  });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('entrance_confirm_remove')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('entrance_cancel_remove')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true
  });

  const collector = response.createMessageComponentCollector({ time: 30000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Only the command user can confirm.', ephemeral: true });
    }

    if (i.customId === 'entrance_confirm_remove') {
      await i.deferUpdate();

      const success = await entranceSystem.removeInstance(interaction.guild.id);

      let resetResult = null;
      if (resetPermissions) {
        resetResult = await entranceSystem.resetPermissions(interaction.guild);
      }

      const fields = [];
      if (resetResult) {
        fields.push({
          name: 'Permissions Reset',
          value: `Reset ${resetResult.resetChannels} channels`,
          inline: false
        });
      }

      const resultEmbed = embedLoader.createEmbed({
        title: 'Entrance System',
        description: 'System removed successfully',
        fields
      });

      await i.editReply({ embeds: [resultEmbed], components: [] });
    } else {
      await i.update({
        content: 'Cancelled.',
        embeds: [],
        components: []
      });
    }

    collector.stop();
  });

  collector.on('end', collected => {
    if (collected.size === 0) {
      interaction.editReply({
        content: 'Command timed out.',
        embeds: [],
        components: []
      });
    }
  });
}

async function executeReset(interaction) {
  // Confirm reset
  const embed = embedLoader.createEmbed({
    title: 'Entrance System',
    description: 'Confirm permission reset\nThis will reset ALL channel permissions to default. Are you sure?'
  });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('entrance_confirm_reset')
        .setLabel('Reset All Permissions')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('entrance_cancel_reset')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true
  });

  const collector = response.createMessageComponentCollector({ time: 30000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'Only the command user can confirm.', ephemeral: true });
    }

    if (i.customId === 'entrance_confirm_reset') {
      await i.deferUpdate();

      const result = await entranceSystem.resetPermissions(interaction.guild);

      const fields = [];
      if (result.errors.length > 0) {
        fields.push({
          name: 'Errors',
          value: result.errors.slice(0, 5).join('\n'),
          inline: false
        });
      }

      const resultEmbed = embedLoader.createEmbed({
        title: 'Entrance System',
        description: `Permissions reset successfully\nReset permissions for ${result.resetChannels} channels.`,
        fields
      });

      await i.editReply({ embeds: [resultEmbed], components: [] });
    } else {
      await i.update({
        content: 'Cancelled.',
        embeds: [],
        components: []
      });
    }

    collector.stop();
  });
}

async function executeStats(interaction) {
  const stats = entranceSystem.getStats(interaction.guild.id);

  const fields = [
    { name: 'System Status', value: stats.enabled ? 'Enabled' : 'Disabled', inline: true },
    { name: 'Instance Status', value: stats.hasInstance ? 'Active' : 'Not Setup', inline: true },
    { name: 'Total Verified', value: `${stats.stats.totalVerified}`, inline: true },
    { name: 'Total Unverified', value: `${stats.stats.totalUnverified}`, inline: true }
  ];

  if (stats.instanceStats) {
    fields.push(
      { name: 'Current Verified Users', value: `${stats.instanceStats.verifiedUsers}`, inline: true },
      { name: 'Verification Role', value: stats.instanceStats.roleId ? `<@&${stats.instanceStats.roleId}>` : 'Not set', inline: true },
      { name: 'Created', value: `<t:${Math.floor(new Date(stats.instanceStats.createdAt).getTime() / 1000)}:R>`, inline: true }
    );
  }

  const embed = embedLoader.createEmbed({
    title: 'Entrance System',
    description: 'Statistics',
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeTest(interaction) {
  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found. Use `/setupentrance instance` first.',
      ephemeral: true
    });
  }

  if (!instance.roleId) {
    return interaction.reply({
      content: 'No role configured. Use `/setupentrance role` first.',
      ephemeral: true
    });
  }

  const hasRole = interaction.member.roles.cache.has(instance.roleId);

  const fields = [
    { name: 'Verified', value: hasRole ? 'Yes' : 'No', inline: true },
    { name: 'Has Role', value: hasRole ? `<@&${instance.roleId}>` : 'No', inline: true }
  ];

  const embed = embedLoader.createEmbed({
    title: 'Entrance System',
    description: 'Testing your current verification status...',
    fields,
    footer: !hasRole ? 'React to the verification message to get verified!' : null
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Export both as default and as commands array for compatibility
export default { data: setupEntranceData, execute };
export const commands = [
  { data: setupEntranceData, execute }
];