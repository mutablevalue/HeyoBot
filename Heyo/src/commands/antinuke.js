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
      .setDescription('Control raid mode')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Enable', value: 'enable' },
            { name: 'Disable', value: 'disable' },
            { name: 'Status', value: 'status' }
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('admin')
      .setDescription('Manage AntiNuke administrators')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List', value: 'list' }
          )
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to add/remove (not needed for list)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('whitelist')
      .setDescription('Manage AntiNuke whitelist')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List', value: 'list' }
          )
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to add/remove (not needed for list)')
          .setRequired(false)
      )
  );

export async function execute(interaction) {
  if (!antiNukeInstance) {
    return interaction.reply({
      content: 'AntiNuke system is not initialized.',
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();

  // Permission check
  if (permissionSystem) {
    const level = permissionSystem.getPermissionLevel(interaction.member);
    
    // Admin management requires AntiNuke admin or higher
    if (subcommand === 'admin' && level < permissionSystem.LEVELS.ANTINUKE_ADMIN) {
      const embed = embedLoader.error('Only AntiNuke administrators or the bot owner can manage AntiNuke admins.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // All other commands require AntiNuke admin
    if (level < permissionSystem.LEVELS.ANTINUKE_ADMIN) {
      const embed = embedLoader.error('Only AntiNuke administrators can use this command.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

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
    case 'admin':
      await handleAdmin(interaction);
      break;
    case 'whitelist':
      await handleWhitelist(interaction);
      break;
  }
}

async function handleStats(interaction) {
  const stats = antiNukeInstance.getStats();
  
  const fields = [
    { name: 'Status', value: stats.highAlert ? '**High Alert**' : 'Normal', inline: true },
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

  // Add protection stats
  if (stats.protection) {
    fields.push({
      name: 'Protection Stats',
      value: [
        `**Webhook Abuses**: ${stats.protection.webhookAbuses}`,
        `**Unauthorized Bots**: ${stats.protection.unauthorizedBots}`
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
  
  // Update config directly
  antiNukeInstance.config.highAlert.enabled = enabled;
  antiNukeInstance.highAlert = enabled;
  
  // Save the config
  await antiNukeInstance.saveConfig();
  
  const embed = embedLoader.createEmbed({
    title: 'High Alert Mode',
    description: enabled ? 
      'High alert **ENABLED**. AntiNuke thresholds have been reduced for maximum protection.' : 
      'High alert **DISABLED**. AntiNuke thresholds have been restored to normal levels.'
  });
  
  await interaction.reply({ embeds: [embed] });
  
  // Log the action
  antiNukeInstance.logSecurity(
    interaction.guild, 
    `High Alert ${enabled ? 'Enabled' : 'Disabled'}`, 
    `Changed by ${interaction.user.tag}`
  );
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
      description: 'Server has been locked down with anti-raid restrictions.'
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

async function handleAdmin(interaction) {
  const action = interaction.options.getString('action');
  const user = interaction.options.getUser('user');
  
  if (action === 'list') {
    // Get from config directly
    const config = antiNukeInstance.fullConfig.get('moderation');
    const admins = config.permissions.antiNukeAdmin?.users || [];
    
    if (admins.length === 0) {
      const embed = embedLoader.createEmbed({
        title: 'AntiNuke Administrators',
        description: 'No AntiNuke administrators configured.'
      });
      return interaction.reply({ embeds: [embed] });
    }
    
    const adminList = admins.map(id => `<@${id}>`).join('\n');
    
    const embed = embedLoader.createEmbed({
      title: 'AntiNuke Administrators',
      description: adminList,
      footer: `Total: ${admins.length} admin${admins.length !== 1 ? 's' : ''}`
    });
    
    await interaction.reply({ embeds: [embed] });
  } else {
    if (!user) {
      const embed = embedLoader.error('Please provide a user.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (action === 'add') {
      // ONLY update moderation.permissions.antiNukeAdmin (single source of truth)
      const config = antiNukeInstance.fullConfig.get('moderation');
      if (!config.permissions.antiNukeAdmin) {
        config.permissions.antiNukeAdmin = { users: [], roles: [], commands: ['all'] };
      }
      
      if (!config.permissions.antiNukeAdmin.users.includes(user.id)) {
        config.permissions.antiNukeAdmin.users.push(user.id);
        await antiNukeInstance.fullConfig.save();
        
        // Clear permission cache
        if (permissionSystem) {
          permissionSystem.clearUserCache(interaction.guild.id, user.id);
        }
        
        const embed = embedLoader.success(`${user} has been granted **AntiNuke Admin** permissions.`);
        await interaction.reply({ embeds: [embed] });
        
        // Log the action
        antiNukeInstance.logSecurity(
          interaction.guild,
          'AntiNuke Admin Added',
          `${user.tag} (${user.id}) by ${interaction.user.tag}`
        );
      } else {
        const embed = embedLoader.warning(`${user} already has AntiNuke admin permissions.`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } else if (action === 'remove') {
      if (user.id === permissionSystem.BOT_OWNER_ID) {
        const embed = embedLoader.error('Cannot remove permissions from the bot owner.');
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      // ONLY remove from moderation.permissions.antiNukeAdmin
      const config = antiNukeInstance.fullConfig.get('moderation');
      const index = config.permissions.antiNukeAdmin?.users?.indexOf(user.id);
      
      if (index > -1) {
        config.permissions.antiNukeAdmin.users.splice(index, 1);
        await antiNukeInstance.fullConfig.save();
        
        // Clear permission cache
        if (permissionSystem) {
          permissionSystem.clearUserCache(interaction.guild.id, user.id);
        }
        
        const embed = embedLoader.success(`Removed **AntiNuke Admin** permissions from ${user}.`);
        await interaction.reply({ embeds: [embed] });
        
        // Log the action
        antiNukeInstance.logSecurity(
          interaction.guild,
          'AntiNuke Admin Removed',
          `${user.tag} (${user.id}) by ${interaction.user.tag}`
        );
      } else {
        const embed = embedLoader.warning(`${user} doesn't have AntiNuke admin permissions.`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}

async function handleWhitelist(interaction) {
  const action = interaction.options.getString('action');
  const user = interaction.options.getUser('user');
  
  if (action === 'list') {
    const whitelist = antiNukeInstance.config.whitelist || { users: [], roles: [] };
    
    const fields = [];
    
    if (whitelist.users.length > 0) {
      const userList = whitelist.users.map(id => `<@${id}>`).join('\n');
      fields.push({
        name: 'Whitelisted Users',
        value: userList.slice(0, 1024),
        inline: false
      });
    }
    
    if (whitelist.roles.length > 0) {
      const roleList = whitelist.roles.map(id => `<@&${id}>`).join('\n');
      fields.push({
        name: 'Whitelisted Roles',
        value: roleList.slice(0, 1024),
        inline: false
      });
    }
    
    if (fields.length === 0) {
      fields.push({
        name: 'Empty',
        value: 'No users or roles are whitelisted.',
        inline: false
      });
    }
    
    const embed = embedLoader.createEmbed({
      title: 'AntiNuke Whitelist',
      formatDescription: false,
      fields,
      footer: `${whitelist.users.length} users, ${whitelist.roles.length} roles`
    });
    
    await interaction.reply({ embeds: [embed] });
  } else {
    if (!user) {
      const embed = embedLoader.error('Please provide a user.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (action === 'add') {
      // ONLY update antiNuke.whitelist (single source of truth)
      if (!antiNukeInstance.config.whitelist) {
        antiNukeInstance.config.whitelist = { users: [], roles: [] };
      }
      
      if (!antiNukeInstance.config.whitelist.users.includes(user.id)) {
        antiNukeInstance.config.whitelist.users.push(user.id);
        await antiNukeInstance.fullConfig.save();
        
        // Clear permission cache
        if (permissionSystem) {
          permissionSystem.clearUserCache(interaction.guild.id, user.id);
        }
        
        const embed = embedLoader.success(`${user} has been added to the AntiNuke whitelist.`);
        await interaction.reply({ embeds: [embed] });
        
        // Log the action
        antiNukeInstance.logSecurity(
          interaction.guild,
          'Whitelist Add',
          `${user.tag} (${user.id}) by ${interaction.user.tag}`
        );
      } else {
        const embed = embedLoader.warning(`${user} is already whitelisted.`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } else if (action === 'remove') {
      if (user.id === permissionSystem.BOT_OWNER_ID) {
        const embed = embedLoader.error('Cannot remove the bot owner from whitelist.');
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      // ONLY remove from antiNuke.whitelist
      const index = antiNukeInstance.config.whitelist?.users?.indexOf(user.id);
      
      if (index > -1) {
        antiNukeInstance.config.whitelist.users.splice(index, 1);
        await antiNukeInstance.fullConfig.save();
        
        // Clear permission cache
        if (permissionSystem) {
          permissionSystem.clearUserCache(interaction.guild.id, user.id);
        }
        
        const embed = embedLoader.success(`${user} has been removed from the AntiNuke whitelist.`);
        await interaction.reply({ embeds: [embed] });
        
        // Log the action
        antiNukeInstance.logSecurity(
          interaction.guild,
          'Whitelist Remove',
          `${user.tag} (${user.id}) by ${interaction.user.tag}`
        );
      } else {
        const embed = embedLoader.warning(`${user} was not whitelisted.`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
}

// Export both ways for compatibility
export default { data, execute };