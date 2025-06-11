// src/commands/booster.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

let boosterSystem = null;

export function setBoosterSystem(system) {
  boosterSystem = system;
}

export const claimPerksData = new SlashCommandBuilder()
  .setName('claimboosterperks')
  .setDescription('Claim your booster perks and permissions');

export const boosterData = new SlashCommandBuilder()
  .setName('booster')
  .setDescription('Manage your booster perks')
  .addSubcommandGroup(group =>
    group
      .setName('channel')
      .setDescription('Manage your personal voice channel')
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription('Create a personal voice channel')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('delete')
          .setDescription('Delete your personal voice channel')
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('role')
      .setDescription('Manage your personal role')
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription('Create a personal role')
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Name for your role')
              .setRequired(false)
          )
          .addStringOption(option =>
            option
              .setName('color')
              .setDescription('Hex color for your role (e.g., #FF0000) or "Random"')
              .setRequired(false)
          )
          .addBooleanOption(option =>
            option
              .setName('hoist')
              .setDescription('Display role separately in member list (requires minimum boosts)')
              .setRequired(false)
          )
          .addBooleanOption(option =>
            option
              .setName('mentionable')
              .setDescription('Allow this role to be mentioned')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('edit')
          .setDescription('Edit your personal role')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('delete')
          .setDescription('Delete your personal role')
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View your booster perks')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove all your booster perks')
  );

export async function executeClaimPerks(interaction) {
  if (!boosterSystem) {
    return interaction.reply({ content: '❌ Booster system not loaded.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await boosterSystem.claimBoosterPerks(interaction.guild, interaction.member);

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Booster Perks Claimed!')
      .setDescription('You have successfully claimed your booster perks!')
      .setColor(0xff73fa)
      .addFields(
        {
          name: '🎁 Perks Granted',
          value: '• Voice channel permissions\n• Picture permissions\n• Link permissions',
          inline: false
        },
        {
          name: '📝 Next Steps',
          value: 'Use `/booster` to create your personal voice channel or role!',
          inline: false
        }
      )
      .setFooter({ text: 'Your perks will remain active as long as you continue boosting.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply({ content: `❌ ${result.error}` });
  }
}

export async function executeBooster(interaction) {
  if (!boosterSystem) {
    return interaction.reply({ content: '❌ Booster system not loaded.', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    return executeView(interaction);
  } else if (subcommand === 'remove') {
    return executeRemove(interaction);
  }

  // Handle channel commands
  if (group === 'channel') {
    if (subcommand === 'create') {
      return executeCreateChannel(interaction);
    } else if (subcommand === 'delete') {
      return executeDeleteChannel(interaction);
    }
  }

  // Handle role commands
  if (group === 'role') {
    if (subcommand === 'create') {
      return executeCreateRole(interaction);
    } else if (subcommand === 'edit') {
      return executeEditRole(interaction);
    } else if (subcommand === 'delete') {
      return executeDeleteRole(interaction);
    }
  }
}

async function executeCreateChannel(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const result = await boosterSystem.createBoosterVC(interaction.guild, interaction.member);

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Voice Channel Created!')
      .setDescription(`Your personal voice channel has been created!`)
      .setColor(0x00ff00)
      .addFields(
        {
          name: '🔊 Channel',
          value: `${result.channel}`,
          inline: true
        },
        {
          name: '👥 User Limit',
          value: `${result.channel.userLimit || 'No limit'}`,
          inline: true
        },
        {
          name: '⚙️ Permissions',
          value: '• Manage Channel\n• Move Members\n• Mute Members\n• Deafen Members',
          inline: false
        },
        {
          name: '💡 Tips',
          value: '• You are the permanent owner of this channel\n• You can manage who has access\n• Use `/booster channel delete` to remove it',
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply({ content: `❌ ${result.error}` });
  }
}

async function executeDeleteChannel(interaction) {
  // Create confirmation embed
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Channel Deletion')
    .setDescription('Are you sure you want to delete your personal voice channel?\n\nThis action cannot be undone.')
    .setColor(0xffa500)
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`booster_delete_channel_${interaction.user.id}`)
        .setLabel('Delete Channel')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('booster_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });

  const collector = response.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 30000
  });

  collector.on('collect', async i => {
    if (i.customId === 'booster_cancel') {
      await i.update({ 
        content: '✅ Deletion cancelled.', 
        embeds: [], 
        components: [] 
      });
    } else if (i.customId.startsWith('booster_delete_channel_')) {
      await i.deferUpdate();
      
      const result = await boosterSystem.deleteBoosterItems(
        interaction.guild.id, 
        interaction.user.id, 
        'channel'
      );

      if (result.success) {
        await i.editReply({ 
          content: '✅ Your personal voice channel has been deleted.', 
          embeds: [], 
          components: [] 
        });
      } else {
        await i.editReply({ 
          content: `❌ ${result.error}`, 
          embeds: [], 
          components: [] 
        });
      }
    }

    collector.stop();
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      await interaction.editReply({ 
        content: '⏰ Deletion timed out.', 
        embeds: [], 
        components: [] 
      });
    }
  });
}

async function executeCreateRole(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Get options
  const name = interaction.options.getString('name');
  const color = interaction.options.getString('color');
  const hoist = interaction.options.getBoolean('hoist');
  const mentionable = interaction.options.getBoolean('mentionable');

  // Parse color
  let parsedColor = color;
  if (color && color !== 'Random') {
    // Remove # if present and parse hex
    parsedColor = parseInt(color.replace('#', ''), 16);
    if (isNaN(parsedColor)) {
      return interaction.editReply({ content: '❌ Invalid color format. Use hex format like #FF0000 or "Random".' });
    }
  }

  const options = {};
  if (name) options.name = name;
  if (color) options.color = parsedColor;
  if (hoist !== null) options.hoist = hoist;
  if (mentionable !== null) options.mentionable = mentionable;

  const result = await boosterSystem.createBoosterRole(interaction.guild, interaction.member, options);

  if (result.success) {
    const boostCount = boosterSystem.getUserBoostCount(interaction.member);
    const minBoostsForHoist = boosterSystem.config.minBoostsForHoist;
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Role Created!')
      .setDescription(`Your personal role has been created!`)
      .setColor(result.role.color || 0x00ff00)
      .addFields(
        {
          name: '🏷️ Role',
          value: `${result.role}`,
          inline: true
        },
        {
          name: '🎨 Color',
          value: `#${result.role.color.toString(16).padStart(6, '0')}`,
          inline: true
        },
        {
          name: '📍 Position',
          value: `${result.role.position}`,
          inline: true
        },
        {
          name: '⚙️ Settings',
          value: `• Hoisted: ${result.role.hoist ? 'Yes' : 'No'}\n• Mentionable: ${result.role.mentionable ? 'Yes' : 'No'}`,
          inline: false
        }
      );

    if (boostCount < minBoostsForHoist && hoist) {
      embed.addFields({
        name: '📌 Note',
        value: `You need ${minBoostsForHoist} boosts to make your role displayable. Currently you have ${boostCount} boost(s).`,
        inline: false
      });
    }

    embed.addFields({
      name: '💡 Tips',
      value: '• Use `/booster role edit` to modify your role\n• Use `/booster role delete` to remove it',
      inline: false
    });

    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply({ content: `❌ ${result.error}` });
  }
}

async function executeEditRole(interaction) {
  // Create modal for editing
  const modal = new ModalBuilder()
    .setCustomId(`booster_edit_role_${interaction.user.id}`)
    .setTitle('Edit Your Booster Role');

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Role Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Leave empty to keep current name');

  const colorInput = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Role Color')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('#FF0000 or "Random" (leave empty to keep current)');

  const hoistInput = new TextInputBuilder()
    .setCustomId('hoist')
    .setLabel('Display Separately? (true/false)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Leave empty to keep current setting');

  const mentionableInput = new TextInputBuilder()
    .setCustomId('mentionable')
    .setLabel('Mentionable? (true/false)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Leave empty to keep current setting');

  const rows = [
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(colorInput),
    new ActionRowBuilder().addComponents(hoistInput),
    new ActionRowBuilder().addComponents(mentionableInput)
  ];

  modal.addComponents(...rows);

  await interaction.showModal(modal);

  // Wait for modal submission
  try {
    const modalInteraction = await interaction.awaitModalSubmit({
      time: 300000,
      filter: i => i.customId === `booster_edit_role_${interaction.user.id}`
    });

    await modalInteraction.deferReply({ ephemeral: true });

    // Parse inputs
    const name = modalInteraction.fields.getTextInputValue('name') || undefined;
    const colorInput = modalInteraction.fields.getTextInputValue('color') || undefined;
    const hoistInput = modalInteraction.fields.getTextInputValue('hoist') || undefined;
    const mentionableInput = modalInteraction.fields.getTextInputValue('mentionable') || undefined;

    const options = {};
    
    if (name) options.name = name;
    
    if (colorInput) {
      if (colorInput.toLowerCase() === 'random') {
        options.color = 'Random';
      } else {
        const parsedColor = parseInt(colorInput.replace('#', ''), 16);
        if (!isNaN(parsedColor)) {
          options.color = parsedColor;
        }
      }
    }
    
    if (hoistInput) {
      options.hoist = hoistInput.toLowerCase() === 'true';
    }
    
    if (mentionableInput) {
      options.mentionable = mentionableInput.toLowerCase() === 'true';
    }

    const result = await boosterSystem.editBoosterRole(
      modalInteraction.guild, 
      modalInteraction.member, 
      options
    );

    if (result.success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Role Updated!')
        .setDescription('Your personal role has been updated successfully!')
        .setColor(result.role.color || 0x00ff00)
        .addFields(
          {
            name: '🏷️ Role',
            value: `${result.role}`,
            inline: true
          },
          {
            name: '🎨 Color',
            value: `#${result.role.color.toString(16).padStart(6, '0')}`,
            inline: true
          },
          {
            name: '⚙️ Settings',
            value: `• Hoisted: ${result.role.hoist ? 'Yes' : 'No'}\n• Mentionable: ${result.role.mentionable ? 'Yes' : 'No'}`,
            inline: false
          }
        )
        .setTimestamp();

      await modalInteraction.editReply({ embeds: [embed] });
    } else {
      await modalInteraction.editReply({ content: `❌ ${result.error}` });
    }
  } catch (error) {
    // Modal timed out
    console.error('Modal timeout:', error);
  }
}

async function executeDeleteRole(interaction) {
  // Create confirmation embed
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Role Deletion')
    .setDescription('Are you sure you want to delete your personal role?\n\nThis action cannot be undone.')
    .setColor(0xffa500)
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`booster_delete_role_${interaction.user.id}`)
        .setLabel('Delete Role')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('booster_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });

  const collector = response.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 30000
  });

  collector.on('collect', async i => {
    if (i.customId === 'booster_cancel') {
      await i.update({ 
        content: '✅ Deletion cancelled.', 
        embeds: [], 
        components: [] 
      });
    } else if (i.customId.startsWith('booster_delete_role_')) {
      await i.deferUpdate();
      
      const result = await boosterSystem.deleteBoosterItems(
        interaction.guild.id, 
        interaction.user.id, 
        'role'
      );

      if (result.success) {
        await i.editReply({ 
          content: '✅ Your personal role has been deleted.', 
          embeds: [], 
          components: [] 
        });
      } else {
        await i.editReply({ 
          content: `❌ ${result.error}`, 
          embeds: [], 
          components: [] 
        });
      }
    }

    collector.stop();
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      await interaction.editReply({ 
        content: '⏰ Deletion timed out.', 
        embeds: [], 
        components: [] 
      });
    }
  });
}

async function executeView(interaction) {
  const perks = boosterSystem.getUserPerks(interaction.user.id);
  const boostCount = boosterSystem.getUserBoostCount(interaction.member);

  const embed = new EmbedBuilder()
    .setTitle(`Booster Perks for ${interaction.user.username}`)
    .setColor(0xff73fa)
    .setTimestamp();

  if (!perks) {
    embed.setDescription('You have not claimed any booster perks yet.\n\nUse `/claimboosterperks` to get started!');
  } else {
    // Status
    embed.addFields({
      name: '📊 Status',
      value: `Claimed: <t:${Math.floor(new Date(perks.claimed).getTime() / 1000)}:R>\nBoost Count: ${boostCount}`,
      inline: false
    });

    // Permission roles
    if (perks.permRoles?.length > 0) {
      embed.addFields({
        name: '🎁 Permission Roles',
        value: perks.permRoles.map(id => `<@&${id}>`).join(', '),
        inline: false
      });
    }

    // Voice channels
    const channels = [];
    for (const channelId of perks.channels || []) {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (channel) {
        channels.push(`• ${channel.name}`);
      }
    }

    embed.addFields({
      name: `🔊 Voice Channels (${channels.length})`,
      value: channels.length > 0 ? channels.join('\n') : 'None',
      inline: false
    });

    // Roles
    const roles = [];
    for (const roleId of perks.roles || []) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role) {
        roles.push(`• ${role.name}`);
      }
    }

    embed.addFields({
      name: `🏷️ Personal Roles (${roles.length})`,
      value: roles.length > 0 ? roles.join('\n') : 'None',
      inline: false
    });

    // Commands
    embed.addFields({
      name: '📝 Available Commands',
      value: [
        '• `/booster channel create` - Create a voice channel',
        '• `/booster channel delete` - Delete your voice channel',
        '• `/booster role create` - Create a personal role',
        '• `/booster role edit` - Edit your personal role',
        '• `/booster role delete` - Delete your personal role',
        '• `/booster remove` - Remove all your perks'
      ].join('\n'),
      inline: false
    });

    if (boostCount >= boosterSystem.config.minBoostsForHoist) {
      embed.addFields({
        name: '✨ Special Perks',
        value: `You can make your role displayable separately (hoisted) with ${boostCount} boosts!`,
        inline: false
      });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeRemove(interaction) {
  // Create confirmation embed
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Perk Removal')
    .setDescription('Are you sure you want to remove ALL your booster perks?\n\nThis will:\n• Remove all permission roles\n• Delete your personal voice channel\n• Delete your personal role\n\n**This action cannot be undone!**')
    .setColor(0xff0000)
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`booster_remove_all_${interaction.user.id}`)
        .setLabel('Remove Everything')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('booster_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

  const response = await interaction.reply({ 
    embeds: [embed], 
    components: [row], 
    ephemeral: true 
  });

  const collector = response.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 30000
  });

  collector.on('collect', async i => {
    if (i.customId === 'booster_cancel') {
      await i.update({ 
        content: '✅ Removal cancelled.', 
        embeds: [], 
        components: [] 
      });
    } else if (i.customId.startsWith('booster_remove_all_')) {
      await i.deferUpdate();
      
      const result = await boosterSystem.removeAllBoosterPerks(
        interaction.guild.id, 
        interaction.user.id
      );

      if (result.success) {
        await i.editReply({ 
          content: '✅ All your booster perks have been removed.', 
          embeds: [], 
          components: [] 
        });
      } else {
        await i.editReply({ 
          content: `❌ ${result.error}`, 
          embeds: [], 
          components: [] 
        });
      }
    }

    collector.stop();
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      await interaction.editReply({ 
        content: '⏰ Removal timed out.', 
        embeds: [], 
        components: [] 
      });
    }
  });
}

// Handle modal submissions from index.js
export async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith('booster_edit_role_')) {
    // Modal handling is done in executeEditRole
  }
}

export const commands = [
  { data: claimPerksData, execute: executeClaimPerks },
  { data: boosterData, execute: executeBooster }
];