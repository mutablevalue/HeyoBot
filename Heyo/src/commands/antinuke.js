// src/commands/antinuke.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let antiNukeInstance;
let embedLoader;
let permissionSystem;

export function setAntiNuke(antiNuke) {
  antiNukeInstance = antiNuke;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export function setPermissionSystem(system) {
  permissionSystem = system;
}

export const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Manage Anti-Nuke system')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

  // Check if user has AntiNuke admin permissions
  if (permissionSystem) {
    const hasPermission = permissionSystem.hasPermissionLevel(interaction.member, permissionSystem.LEVELS.ANTINUKE_ADMIN);
    if (!hasPermission) {
      const embed = embedLoader.error('Only AntiNuke administrators can manage AntiNuke settings.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } else {
    // Fallback to basic admin check
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = embedLoader.error('Only administrators can manage AntiNuke settings.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  const subcommand = interaction.options.getSubcommand();

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
        `**Raid Mode**: ${stats.contentModeration.raidMode.enabled ? 'ACTIVE' : 'Inactive'}`
      ].join('\n'),
      inline: false
    });
  }

  // Add permission stats if available
  if (permissionSystem) {
    const permStats = permissionSystem.getStats();
    fields.push({
      name: 'Permission Hierarchy',
      value: [
        `**AntiNuke Admins**: ${permStats.antiNukeAdmins}`,
        `**Administrators**: ${permStats.administrators}`,
        `**Moderators**: ${permStats.moderators}`,
        `**Total Whitelisted**: ${permStats.whitelisted}`
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
    title: 'High Alert Mode',
    description: enabled ? 
      'High alert **ENABLED**. AntiNuke thresholds have been reduced for maximum protection.' : 
      'High alert **DISABLED**. AntiNuke thresholds have been restored to normal levels.'
  });
  
  await interaction.reply({ embeds: [embed] });
  
  // Log the action
  if (antiNukeInstance.embedLoader) {
    antiNukeInstance.logSecurity(
      interaction.guild, 
      `High Alert ${enabled ? 'Enabled' : 'Disabled'}`, 
      `Changed by ${interaction.user.tag}`
    );
  }
}

async function handleRaidMode(interaction) {
  const action = interaction.options.getString('action');
  
  if (action === 'status') {
    const raidMode = antiNukeInstance.raidMode;
    
    const fields = [
      { name: 'Status', value: raidMode.enabled ? '**ACTIVE**' : 'Inactive', inline: true }
    ];
    
    if (raidMode.enabled) {
      fields.push(
        { name: 'Triggered At', value: `<t:${Math.floor(raidMode.triggeredAt / 1000)}:F>`, inline: false },
        { name: 'Reason', value: raidMode.triggeredBy || 'Manual activation', inline: false }
      );
      
      // Show active restrictions
      const restrictions = antiNukeInstance.config.raidMode?.restrictions || [];
      if (restrictions.length > 0) {
        fields.push({
          name: 'Active Restrictions',
          value: restrictions.map(r => `• ${r.replace(/([A-Z])/g, ' $1').trim()}`).join('\n'),
          inline: false
        });
      }
    }
    
    const embed = embedLoader.createEmbed({
      title: 'Raid Mode Status',
      formatDescription: false,
      fields
    });
    
    await interaction.reply({ embeds: [embed] });
  } else if (action === 'enable') {
    if (antiNukeInstance.raidMode.enabled) {
      const embed = embedLoader.warning('Raid mode is already active.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    await interaction.deferReply();
    await antiNukeInstance.triggerRaidMode(interaction.guild, `Manually triggered by ${interaction.user.tag}`);
    
    const embed = embedLoader.createEmbed({
      title: 'Raid Mode Activated',
      description: 'Server has been locked down with the following restrictions:',
      fields: [{
        name: 'Active Restrictions',
        value: (antiNukeInstance.config.raidMode?.restrictions || [])
          .map(r => `• ${r.replace(/([A-Z])/g, ' $1').trim()}`)
          .join('\n') || 'Default restrictions applied',
        inline: false
      }]
    });
    
    await interaction.editReply({ embeds: [embed] });
  } else if (action === 'disable') {
    if (!antiNukeInstance.raidMode.enabled) {
      const embed = embedLoader.warning('Raid mode is not currently active.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    await interaction.deferReply();
    await antiNukeInstance.disableRaidMode(interaction.guild);
    
    const embed = embedLoader.success('Raid mode has been **disabled**. Server restrictions have been lifted.');
    
    await interaction.editReply({ embeds: [embed] });
  }
}

// Export both ways for compatibility
export default { data, execute };