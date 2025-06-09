// src/commands/automod.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let autoModSystem = null;

export function setAutoModSystem(system) {
  autoModSystem = system;
}

export const automodData = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Configure auto-moderation settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('View auto-moderation status and settings')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('enable')
      .setDescription('Enable auto-moderation')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('disable')
      .setDescription('Disable auto-moderation')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View auto-moderation statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('raidmode')
      .setDescription('Toggle raid mode')
      .addBooleanOption(option =>
        option
          .setName('enable')
          .setDescription('Enable or disable raid mode')
          .setRequired(true)
      )
  );

export const automodConfigData = new SlashCommandBuilder()
  .setName('automodconfig')
  .setDescription('Configure auto-moderation modules')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup(group =>
    group
      .setName('antispam')
      .setDescription('Configure anti-spam settings')
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription('Enable/disable anti-spam')
          .addBooleanOption(option =>
            option
              .setName('enabled')
              .setDescription('Enable or disable')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('settings')
          .setDescription('Configure anti-spam thresholds')
          .addIntegerOption(option =>
            option
              .setName('messages')
              .setDescription('Max messages allowed')
              .setMinValue(1)
              .setMaxValue(20)
              .setRequired(false)
          )
          .addIntegerOption(option =>
            option
              .setName('timewindow')
              .setDescription('Time window in seconds')
              .setMinValue(1)
              .setMaxValue(60)
              .setRequired(false)
          )
      )
  )
  .addSubcommandGroup(group =>
    group
      .setName('antiraid')
      .setDescription('Configure anti-raid settings')
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription('Enable/disable anti-raid')
          .addBooleanOption(option =>
            option
              .setName('enabled')
              .setDescription('Enable or disable')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('settings')
          .setDescription('Configure anti-raid thresholds')
          .addIntegerOption(option =>
            option
              .setName('joins')
              .setDescription('Join threshold')
              .setMinValue(2)
              .setMaxValue(50)
              .setRequired(false)
          )
          .addIntegerOption(option =>
            option
              .setName('timewindow')
              .setDescription('Time window in seconds')
              .setMinValue(5)
              .setMaxValue(300)
              .setRequired(false)
          )
      )
  );

export async function execute(interaction) {
  if (!autoModSystem) {
    return interaction.reply({ content: '❌ Auto-moderation system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'status':
      return executeStatus(interaction);
    case 'enable':
      return executeEnable(interaction);
    case 'disable':
      return executeDisable(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'raidmode':
      return executeRaidMode(interaction);
  }
}

export async function executeConfig(interaction) {
  if (!autoModSystem) {
    return interaction.reply({ content: '❌ Auto-moderation system not loaded.', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (group === 'antispam') {
    if (subcommand === 'toggle') {
      return executeAntiSpamToggle(interaction);
    } else if (subcommand === 'settings') {
      return executeAntiSpamSettings(interaction);
    }
  } else if (group === 'antiraid') {
    if (subcommand === 'toggle') {
      return executeAntiRaidToggle(interaction);
    } else if (subcommand === 'settings') {
      return executeAntiRaidSettings(interaction);
    }
  }
}

async function executeStatus(interaction) {
  const config = autoModSystem.config;
  const stats = autoModSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Auto-Moderation Status')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      { 
        name: 'System Status', 
        value: config.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      },
      { 
        name: 'Raid Mode', 
        value: stats.raidMode.enabled ? '🚨 ACTIVE' : '✅ Normal', 
        inline: true 
      },
      { 
        name: 'Active Punishments', 
        value: `${stats.activePunishments}`, 
        inline: true 
      }
    )
    .setTimestamp();

  // Add module status
  const modules = [];
  if (config.antiSpam.enabled) modules.push('✅ Anti-Spam');
  if (config.massMention.enabled) modules.push('✅ Mass Mention');
  if (config.massEmoji.enabled) modules.push('✅ Mass Emoji');
  if (config.capsSpam.enabled) modules.push('✅ Caps Spam');
  if (config.duplicateMessages.enabled) modules.push('✅ Duplicate Messages');
  if (config.antiRaid.enabled) modules.push('✅ Anti-Raid');

  embed.addFields({
    name: 'Active Modules',
    value: modules.join('\n') || 'None',
    inline: false
  });

  // Add thresholds
  embed.addFields(
    {
      name: 'Spam Settings',
      value: `Messages: ${config.antiSpam.messageLimit} in ${config.antiSpam.timeWindow}ms`,
      inline: true
    },
    {
      name: 'Raid Settings',
      value: `Joins: ${config.antiRaid.joinThreshold} in ${config.antiRaid.timeWindow}ms`,
      inline: true
    }
  );

  await interaction.reply({ embeds: [embed] });
}

async function executeEnable(interaction) {
  autoModSystem.config.enabled = true;
  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Auto-Moderation Enabled')
    .setDescription('Auto-moderation system is now active.')
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeDisable(interaction) {
  autoModSystem.config.enabled = false;
  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('❌ Auto-Moderation Disabled')
    .setDescription('Auto-moderation system has been disabled.')
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeStats(interaction) {
  const stats = autoModSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Auto-Moderation Statistics')
    .setColor(0x0099ff)
    .addFields(
      { 
        name: 'Messages Deleted', 
        value: `${stats.stats.messagesDeleted}`, 
        inline: true 
      },
      { 
        name: 'Users Timed Out', 
        value: `${stats.stats.usersTimedOut}`, 
        inline: true 
      },
      { 
        name: 'Users Banned', 
        value: `${stats.stats.usersBanned}`, 
        inline: true 
      },
      { 
        name: 'Raids Detected', 
        value: `${stats.stats.raidsDetected}`, 
        inline: true 
      }
    )
    .setTimestamp();

  if (stats.raidMode.enabled) {
    embed.addFields({
      name: '🚨 Raid Mode Active',
      value: `Since: <t:${Math.floor(stats.raidMode.triggeredAt / 1000)}:R>`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeRaidMode(interaction) {
  const enable = interaction.options.getBoolean('enable');

  if (enable && !autoModSystem.raidMode.enabled) {
    // Manually trigger raid mode
    autoModSystem.raidMode = {
      enabled: true,
      triggeredAt: Date.now(),
      triggeredBy: 'Manual'
    };
    
    await autoModSystem.lockdownServer(interaction.guild);
    
    const embed = new EmbedBuilder()
      .setTitle('🚨 Raid Mode Enabled')
      .setDescription('Server has been locked down.')
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else if (!enable && autoModSystem.raidMode.enabled) {
    await autoModSystem.disableRaidMode(interaction.guild);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Raid Mode Disabled')
      .setDescription('Server has been restored to normal operation.')
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content: `Raid mode is already ${enable ? 'enabled' : 'disabled'}.`,
      ephemeral: true
    });
  }
}

async function executeAntiSpamToggle(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  
  autoModSystem.config.antiSpam.enabled = enabled;
  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle(enabled ? '✅ Anti-Spam Enabled' : '❌ Anti-Spam Disabled')
    .setDescription(`Anti-spam module has been ${enabled ? 'enabled' : 'disabled'}.`)
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeAntiSpamSettings(interaction) {
  const messages = interaction.options.getInteger('messages');
  const timeWindow = interaction.options.getInteger('timewindow');

  if (messages) {
    autoModSystem.config.antiSpam.messageLimit = messages;
  }
  
  if (timeWindow) {
    autoModSystem.config.antiSpam.timeWindow = timeWindow * 1000; // Convert to ms
  }

  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Anti-Spam Settings Updated')
    .setDescription('Anti-spam thresholds have been updated.')
    .addFields(
      { 
        name: 'Message Limit', 
        value: `${autoModSystem.config.antiSpam.messageLimit}`, 
        inline: true 
      },
      { 
        name: 'Time Window', 
        value: `${autoModSystem.config.antiSpam.timeWindow / 1000}s`, 
        inline: true 
      }
    )
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeAntiRaidToggle(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  
  autoModSystem.config.antiRaid.enabled = enabled;
  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle(enabled ? '✅ Anti-Raid Enabled' : '❌ Anti-Raid Disabled')
    .setDescription(`Anti-raid module has been ${enabled ? 'enabled' : 'disabled'}.`)
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeAntiRaidSettings(interaction) {
  const joins = interaction.options.getInteger('joins');
  const timeWindow = interaction.options.getInteger('timewindow');

  if (joins) {
    autoModSystem.config.antiRaid.joinThreshold = joins;
  }
  
  if (timeWindow) {
    autoModSystem.config.antiRaid.timeWindow = timeWindow * 1000; // Convert to ms
  }

  await autoModSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Anti-Raid Settings Updated')
    .setDescription('Anti-raid thresholds have been updated.')
    .addFields(
      { 
        name: 'Join Threshold', 
        value: `${autoModSystem.config.antiRaid.joinThreshold}`, 
        inline: true 
      },
      { 
        name: 'Time Window', 
        value: `${autoModSystem.config.antiRaid.timeWindow / 1000}s`, 
        inline: true 
      }
    )
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const commands = [
  { data: automodData, execute },
  { data: automodConfigData, execute: executeConfig }
];