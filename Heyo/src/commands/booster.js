// src/commands/booster.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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

  const result = await boosterSystem.createBoosterRole(interaction.guild, interaction.member);

  if (result.success) {
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
          name: '💡 Tips',
          value: '• This role is unique to you\n• Use `/booster role delete` to remove it',
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.editReply({ content: `❌ ${result.error}` });
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
      value: `Claimed: <t:${Math.floor(new Date(perks.claimed).getTime() / 1000)}:R>`,
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
        '• `/booster role delete` - Delete your personal role'
      ].join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const commands = [
  { data: claimPerksData, execute: executeClaimPerks },
  { data: boosterData, execute: executeBooster }
];