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
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('Action to perform')
      .setRequired(true)
      .addChoices(
        { name: 'Setup Instance', value: 'instance' },
        { name: 'Configure Role', value: 'role' },
        { name: 'Add Exempt', value: 'add_exempt' },
        { name: 'Remove Exempt', value: 'remove_exempt' },
        { name: 'Remove System', value: 'remove' },
        { name: 'Reset Permissions', value: 'reset' },
        { name: 'View Stats', value: 'stats' },
        { name: 'Test System', value: 'test' }
      )
  )
  .addStringOption(option =>
    option
      .setName('message_id')
      .setDescription('ID of the message to react to (for instance setup)')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('emoji')
      .setDescription('Emoji to react with (default: ✅)')
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName('verify_channel')
      .setDescription('Channel where verification happens (for role setup)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('create_verify_channel')
      .setDescription('Create a new verify channel instead of using existing')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('channel_name')
      .setDescription('Name for new verify channel (default: verify)')
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName('category')
      .setDescription('Category to place verify channel in (or create new)')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName('create_category')
      .setDescription('Create a new category for the verify channel')
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName('category_name')
      .setDescription('Name for new category (default: Verification)')
      .setRequired(false)
  )
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Verification role or role to exempt')
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel to exempt from hiding')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
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
      .setName('role_name')
      .setDescription('Name for new verification role (default: Verified)')
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
      .setName('reset_permissions')
      .setDescription('Reset all channel permissions when removing')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!entranceSystem || !embedLoader) {
    return interaction.reply({ content: 'Entrance system not loaded.', ephemeral: true });
  }

  const action = interaction.options.getString('action');

  switch (action) {
    case 'instance':
      return executeInstance(interaction);
    case 'role':
      return executeRole(interaction);
    case 'add_exempt':
      return executeAddExempt(interaction);
    case 'remove_exempt':
      return executeRemoveExempt(interaction);
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
  const logChannel = interaction.options.getChannel('log_channel');
  const dmWelcome = interaction.options.getBoolean('dm_welcome') ?? false;

  if (!messageId) {
    return interaction.reply({
      content: 'Message ID is required for instance setup. Use `action: Setup Instance` with `message_id` option.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    // Check if instance already exists
    const existing = entranceSystem.instances.get(interaction.guild.id);
    if (existing) {
      // Update existing instance
      existing.emoji = emoji;
      existing.logChannel = logChannel?.id || existing.logChannel;
      existing.dmWelcome = dmWelcome;
      entranceSystem.saveEntranceData();

      return interaction.editReply({
        content: 'Updated existing entrance instance configuration.'
      });
    }

    // Get current role and verify channel from system if exists
    const currentInstance = entranceSystem.instances.get(interaction.guild.id);
    const roleId = currentInstance?.roleId;
    const verifyChannelId = currentInstance?.verifyChannelId;

    // Setup new instance
    const options = {
      roleId: roleId,
      verifyChannelId: verifyChannelId,
      logChannel: logChannel?.id,
      dmWelcome,
      createdBy: interaction.user.id
    };

    const result = await entranceSystem.setupInstance(interaction.guild, messageId, emoji, options);

    // Enable system
    entranceSystem.config.enabled = true;
    await entranceSystem.saveConfig();

    const fields = [
      { name: 'Message', value: `[Jump to Message](https://discord.com/channels/${interaction.guild.id}/${result.channel.id}/${messageId})`, inline: true },
      { name: 'Emoji', value: emoji, inline: true },
      { name: 'Role', value: roleId ? `<@&${roleId}>` : 'Not set (use role action)', inline: true },
      { name: 'Log Channel', value: logChannel ? `${logChannel}` : 'Not set', inline: true },
      { name: 'DM Welcome', value: dmWelcome ? 'Yes' : 'No', inline: true }
    ];

    if (verifyChannelId) {
      fields.push({ name: 'Verify Channel', value: `<#${verifyChannelId}>`, inline: true });
    }

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Instance created successfully',
      fields,
      footer: !roleId ? 'Use action: Configure Role to complete setup' : 'Ready to use!'
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
  const createVerifyChannel = interaction.options.getBoolean('create_verify_channel') ?? false;
  const channelName = interaction.options.getString('channel_name');
  const category = interaction.options.getChannel('category');
  const createCategory = interaction.options.getBoolean('create_category') ?? false;
  const categoryName = interaction.options.getString('category_name');
  const roleName = interaction.options.getString('role_name') || entranceSystem.config.defaultRoleName;

  // Either need an existing verify channel or create a new one
  if (!verifyChannel && !createVerifyChannel) {
    return interaction.reply({
      content: 'Verify channel is required. Use `verify_channel` option to select an existing channel, or use `create_verify_channel: true` to create a new one.',
      ephemeral: true
    });
  }

  if (verifyChannel && createVerifyChannel) {
    return interaction.reply({
      content: 'Please choose either an existing verify channel OR create a new one, not both.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    let finalVerifyChannel = verifyChannel;
    
    // Create verify channel if requested
    if (createVerifyChannel) {
      const createOptions = {
        channelName: channelName,
        createCategory: createCategory,
        categoryName: categoryName,
        categoryId: category?.id
      };
      
      // Validate category options
      if (createCategory && category) {
        return interaction.editReply({
          content: 'Please choose either to create a new category OR use an existing one, not both.'
        });
      }
      
      const result = await entranceSystem.createVerifyChannel(interaction.guild, createOptions);
      finalVerifyChannel = result.channel;
      
      // Send verification instructions message
      if (embedLoader) {
        const instructionEmbed = embedLoader.createEmbed({
          title: 'Server Verification',
          description: 'Welcome to the server! To gain access to all channels, please react to this message with the verification emoji.\n\nOnce verified, you will be able to see and interact with all server channels.',
          footer: 'React below to verify'
        });
        
        await finalVerifyChannel.send({ embeds: [instructionEmbed] });
      }
    }

    // Get current instance
    const instance = entranceSystem.instances.get(interaction.guild.id);
    
    const options = {
      roleId: role?.id,
      roleName,
      verifyChannel: finalVerifyChannel.id,
      exemptRoles: instance?.exemptRoles || [],
      exemptChannels: instance?.exemptChannels || []
    };

    const result = await entranceSystem.setupRole(interaction.guild, options);

    const fields = [
      { name: 'Role', value: `${result.role}`, inline: true },
      { name: 'Verify Channel', value: `${finalVerifyChannel}`, inline: true },
      { name: 'Hidden Channels', value: `${result.changes.hiddenChannels}`, inline: true },
      { name: 'Exempt Channels', value: `${result.changes.exemptedChannels}`, inline: true }
    ];

    if (createVerifyChannel) {
      fields.push({ 
        name: 'Channel Created', 
        value: `Successfully created ${finalVerifyChannel}`, 
        inline: false 
      });
    }

    if (result.changes.errors.length > 0) {
      fields.push({
        name: 'Errors',
        value: result.changes.errors.slice(0, 5).join('\n'),
        inline: false
      });
    }

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Role configured successfully\n\n**All channels are now hidden except the verify channel!**',
      fields,
      footer: !instance ? 'Use action: Setup Instance to complete setup' : 'Entrance system is ready!'
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SetupEntrance] Error configuring role:', error);
    await interaction.editReply({
      content: `Failed to configure role: ${error.message}`
    });
  }
}

async function executeAddExempt(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');

  if (!role && !channel) {
    return interaction.reply({
      content: 'Please specify either a role or channel to exempt.',
      ephemeral: true
    });
  }

  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found. Use `action: Setup Instance` first.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const changes = [];

    if (role) {
      if (!instance.exemptRoles) instance.exemptRoles = [];
      
      if (!instance.exemptRoles.includes(role.id)) {
        instance.exemptRoles.push(role.id);
        changes.push(`Added exempt role: ${role}`);
        
        // Update channel permissions for this role
        for (const channel of interaction.guild.channels.cache.values()) {
          try {
            await channel.permissionOverwrites.edit(role.id, {
              ViewChannel: true
            });
          } catch (error) {
            // Silent fail for channels we can't edit
          }
        }
      } else {
        changes.push(`Role ${role} is already exempt`);
      }
    }

    if (channel) {
      if (!instance.exemptChannels) instance.exemptChannels = [];
      
      if (!instance.exemptChannels.includes(channel.id)) {
        instance.exemptChannels.push(channel.id);
        changes.push(`Added exempt channel: ${channel}`);
        
        // Make channel visible to everyone
        try {
          await channel.permissionOverwrites.edit(interaction.guild.id, {
            ViewChannel: true
          });
        } catch (error) {
          changes.push(`Warning: Could not update permissions for ${channel}`);
        }
      } else {
        changes.push(`Channel ${channel} is already exempt`);
      }
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
    console.error('[SetupEntrance] Error adding exemptions:', error);
    await interaction.editReply({
      content: `Failed to add exemptions: ${error.message}`
    });
  }
}

async function executeRemoveExempt(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');

  if (!role && !channel) {
    return interaction.reply({
      content: 'Please specify either a role or channel to remove from exemptions.',
      ephemeral: true
    });
  }

  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const changes = [];

    if (role && instance.exemptRoles) {
      const index = instance.exemptRoles.indexOf(role.id);
      if (index > -1) {
        instance.exemptRoles.splice(index, 1);
        changes.push(`Removed exempt role: ${role}`);
      }
    }

    if (channel && instance.exemptChannels) {
      const index = instance.exemptChannels.indexOf(channel.id);
      if (index > -1) {
        instance.exemptChannels.splice(index, 1);
        changes.push(`Removed exempt channel: ${channel}`);
      }
    }

    if (changes.length === 0) {
      return interaction.editReply({
        content: 'No exemptions were removed. Items may not have been in the exempt list.'
      });
    }

    entranceSystem.saveEntranceData();

    const embed = embedLoader.createEmbed({
      title: 'Entrance System',
      description: 'Exemptions removed\n' + changes.join('\n')
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SetupEntrance] Error removing exemptions:', error);
    await interaction.editReply({
      content: `Failed to remove exemptions: ${error.message}`
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
  const instance = entranceSystem.instances.get(interaction.guild.id);

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
    
    if (stats.instanceStats.verifyChannelId) {
      fields.push({
        name: 'Verify Channel',
        value: `<#${stats.instanceStats.verifyChannelId}>`,
        inline: true
      });
    }
  }

  if (instance) {
    fields.push(
      { name: 'Emoji', value: instance.emoji || 'Not set', inline: true },
      { name: 'Log Channel', value: instance.logChannel ? `<#${instance.logChannel}>` : 'Not set', inline: true },
      { name: 'DM Welcome', value: instance.dmWelcome ? 'Yes' : 'No', inline: true }
    );

    if (instance.exemptRoles?.length > 0) {
      fields.push({
        name: 'Exempt Roles',
        value: instance.exemptRoles.map(id => `<@&${id}>`).join(', '),
        inline: false
      });
    }

    if (instance.exemptChannels?.length > 0) {
      fields.push({
        name: 'Exempt Channels',
        value: instance.exemptChannels.map(id => `<#${id}>`).join(', '),
        inline: false
      });
    }
  }

  const embed = embedLoader.createEmbed({
    title: 'Entrance System',
    description: 'System Statistics & Configuration',
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeTest(interaction) {
  const instance = entranceSystem.instances.get(interaction.guild.id);
  if (!instance) {
    return interaction.reply({
      content: 'No entrance instance found. Use `action: Setup Instance` first.',
      ephemeral: true
    });
  }

  if (!instance.roleId) {
    return interaction.reply({
      content: 'No role configured. Use `action: Configure Role` first.',
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