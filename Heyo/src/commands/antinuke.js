// src/commands/antinuke.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let antiNukeInstance;
let embedLoader;

export function setAntiNuke(antiNuke) {
  antiNukeInstance = antiNuke;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Manage Anti-Nuke system')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup(group =>
    group
      .setName('whitelist')
      .setDescription('Manage Anti-Nuke whitelist')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a user or role to whitelist')
          .addStringOption(option =>
            option
              .setName('type')
              .setDescription('Type to add')
              .setRequired(true)
              .addChoices(
                { name: 'user', value: 'user' },
                { name: 'role', value: 'role' }
              )
          )
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription('ID of the user or role')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a user or role from whitelist')
          .addStringOption(option =>
            option
              .setName('type')
              .setDescription('Type to remove')
              .setRequired(true)
              .addChoices(
                { name: 'user', value: 'user' },
                { name: 'role', value: 'role' }
              )
          )
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription('ID of the user or role')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all whitelisted users and roles')
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View Anti-Nuke statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('highalert')
      .setDescription('Toggle high alert mode')
      .addBooleanOption(option =>
        option
          .setName('enabled')
          .setDescription('Enable or disable high alert mode')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('raidmode')
      .setDescription('Manually control raid mode')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'enable', value: 'enable' },
            { name: 'disable', value: 'disable' },
            { name: 'status', value: 'status' }
          )
      )
  );

export async function execute(interaction) {
  if (!antiNukeInstance) {
    return interaction.reply({
      content: 'AntiNuke system is not initialized.',
      ephemeral: true
    });
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'whitelist') {
    switch (subcommand) {
      case 'add':
        await handleWhitelistAdd(interaction);
        break;
      case 'remove':
        await handleWhitelistRemove(interaction);
        break;
      case 'list':
        await handleWhitelistList(interaction);
        break;
    }
  } else {
    switch (subcommand) {
      case 'stats':
        await handleStats(interaction);
        break;
      case 'highalert':
        await handleHighAlert(interaction);
        break;
      case 'raidmode':
        await handleRaidMode(interaction);
        break;
    }
  }
}

async function handleWhitelistAdd(interaction) {
  // Check admin permissions
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Only administrators can manage AntiNuke settings.',
      ephemeral: true
    });
  }

  const type = interaction.options.getString('type');
  const id = interaction.options.getString('id');

  // Validate ID format
  if (!/^\d+$/.test(id)) {
    return interaction.reply({
      content: 'Invalid ID format. Please provide a valid Discord ID.',
      ephemeral: true
    });
  }

  const success = antiNukeInstance.addToWhitelist(type, id);

  if (success) {
    await antiNukeInstance.saveConfig();
    
    const embed = embedLoader.createEmbed({
      description: `Successfully added ${type} ${type === 'user' ? `<@${id}>` : `<@&${id}>`} to whitelist`
    });

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `Failed to add ${type}. It may already be in the whitelist.`,
      ephemeral: true
    });
  }
}

async function handleWhitelistRemove(interaction) {
  // Check admin permissions
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Only administrators can manage AntiNuke settings.',
      ephemeral: true
    });
  }

  const type = interaction.options.getString('type');
  const id = interaction.options.getString('id');

  // Validate ID format
  if (!/^\d+$/.test(id)) {
    return interaction.reply({
      content: 'Invalid ID format. Please provide a valid Discord ID.',
      ephemeral: true
    });
  }

  const success = antiNukeInstance.removeFromWhitelist(type, id);

  if (success) {
    await antiNukeInstance.saveConfig();
    
    const embed = embedLoader.createEmbed({
      description: `Successfully removed ${type} ${type === 'user' ? `<@${id}>` : `<@&${id}>`} from whitelist`
    });

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `Failed to remove ${type}. It may not be in the whitelist.`,
      ephemeral: true
    });
  }
}

async function handleWhitelistList(interaction) {
  // List whitelisted users
  const whitelistedUsers = antiNukeInstance.config.whitelist?.users || [];
  const whitelistedRoles = antiNukeInstance.config.whitelist?.roles || [];

  const fields = [];

  if (whitelistedUsers.length > 0) {
    const userList = whitelistedUsers.map(userId => `<@${userId}> (${userId})`).join('\n');
    fields.push({ name: 'Whitelisted Users', value: userList.slice(0, 1024) || 'None' });
  } else {
    fields.push({ name: 'Whitelisted Users', value: 'None' });
  }

  if (whitelistedRoles.length > 0) {
    const roleList = whitelistedRoles.map(roleId => `<@&${roleId}> (${roleId})`).join('\n');
    fields.push({ name: 'Whitelisted Roles', value: roleList.slice(0, 1024) || 'None' });
  } else {
    fields.push({ name: 'Whitelisted Roles', value: 'None' });
  }

  const embed = embedLoader.createEmbed({
    title: 'AntiNuke Whitelist',
    formatDescription: false,
    fields
  });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStats(interaction) {
  const stats = antiNukeInstance.getStats();
  
  const fields = [
    { name: 'Status', value: stats.highAlert ? 'High Alert' : 'Normal', inline: true },
    { name: 'Tracked Users', value: `${stats.trackedUsers}`, inline: true },
    { name: 'Suspicious Users', value: `${stats.suspiciousUsers}`, inline: true }
  ];

  // Add tracked actions
  if (Object.keys(stats.trackedActions).length > 0) {
    const actionList = Object.entries(stats.trackedActions)
      .map(([action, count]) => `**${action}**: ${count}`)
      .join('\n');
    
    fields.push({
      name: 'Tracked Actions',
      value: actionList || 'None',
      inline: false
    });
  }

  // Add content moderation stats if enabled
  if (stats.contentModeration.enabled) {
    fields.push({
      name: 'Content Moderation',
      value: [
        `**Mass Mentions**: ${stats.contentModeration.violations.massMentions}`,
        `**Mass Emojis**: ${stats.contentModeration.violations.massEmojis}`,
        `**Caps Spam**: ${stats.contentModeration.violations.capsSpam}`,
        `**Duplicates**: ${stats.contentModeration.violations.duplicates}`,
        `**Raids Detected**: ${stats.contentModeration.violations.raidsDetected}`,
        `**Raid Mode**: ${stats.contentModeration.raidMode.enabled ? 'Active' : 'Inactive'}`
      ].join('\n'),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'AntiNuke Statistics',
    formatDescription: false,
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function handleHighAlert(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  
  antiNukeInstance.setHighAlert(enabled);
  
  const embed = embedLoader.createEmbed({
    description: enabled ? 
      'High alert enabled. AntiNuke thresholds have been reduced by 50%.' : 
      'High alert disabled. AntiNuke thresholds have been restored to normal.'
  });
  
  await interaction.reply({ embeds: [embed] });
}

async function handleRaidMode(interaction) {
  const action = interaction.options.getString('action');
  
  if (action === 'status') {
    const raidMode = antiNukeInstance.raidMode;
    
    const fields = [
      { name: 'Status', value: raidMode.enabled ? 'Active' : 'Inactive', inline: true }
    ];
    
    if (raidMode.enabled) {
      fields.push(
        { name: 'Triggered At', value: `<t:${Math.floor(raidMode.triggeredAt / 1000)}:F>`, inline: true },
        { name: 'Reason', value: raidMode.triggeredBy || 'Manual', inline: true }
      );
    }
    
    const embed = embedLoader.createEmbed({
      title: 'Raid Mode Status',
      formatDescription: false,
      fields
    });
    
    await interaction.reply({ embeds: [embed] });
  } else if (action === 'enable') {
    await antiNukeInstance.triggerRaidMode(interaction.guild, 'Manually triggered');
    
    const embed = embedLoader.createEmbed({
      description: 'Raid mode enabled. Server has been locked down.'
    });
    
    await interaction.reply({ embeds: [embed] });
  } else if (action === 'disable') {
    await antiNukeInstance.disableRaidMode(interaction.guild);
    
    const embed = embedLoader.createEmbed({
      description: 'Raid mode disabled. Server has been restored to normal operation.'
    });
    
    await interaction.reply({ embeds: [embed] });
  }
}

// Export both ways for compatibility
export default { data, execute };