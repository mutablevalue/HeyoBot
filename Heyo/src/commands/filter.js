// src/commands/filter.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let filterSystem = null;

export function setFilterSystem(system) {
  filterSystem = system;
}

export const filterData = new SlashCommandBuilder()
  .setName('filter')
  .setDescription('Manage word and image filters')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  // Word filter commands
  .addSubcommandGroup(group =>
    group
      .setName('word')
      .setDescription('Manage word filter')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a word to the filter')
          .addStringOption(option =>
            option
              .setName('word')
              .setDescription('Word to filter')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a word from the filter')
          .addStringOption(option =>
            option
              .setName('word')
              .setDescription('Word to remove')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List filtered words')
          .addBooleanOption(option =>
            option
              .setName('show_default')
              .setDescription('Include default words in list')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('enable')
          .setDescription('Enable word filter')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('disable')
          .setDescription('Disable word filter')
      )
  )
  // Image filter commands
  .addSubcommandGroup(group =>
    group
      .setName('image')
      .setDescription('Manage image filter')
      .addSubcommand(subcommand =>
        subcommand
          .setName('enable')
          .setDescription('Enable image filter')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('disable')
          .setDescription('Disable image filter')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('threshold')
          .setDescription('Set NSFW detection threshold')
          .addNumberOption(option =>
            option
              .setName('value')
              .setDescription('Threshold value (0.0-1.0, higher = stricter)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(1)
          )
      )
  )
  // General commands
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View filter statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('View filter status and configuration')
  );

export async function execute(interaction) {
  if (!filterSystem) {
    return interaction.reply({ content: '❌ Filter system not loaded.', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  // Handle word filter commands
  if (group === 'word') {
    switch (subcommand) {
      case 'add':
        return executeWordAdd(interaction);
      case 'remove':
        return executeWordRemove(interaction);
      case 'list':
        return executeWordList(interaction);
      case 'enable':
        return executeWordEnable(interaction);
      case 'disable':
        return executeWordDisable(interaction);
    }
  }

  // Handle image filter commands
  if (group === 'image') {
    switch (subcommand) {
      case 'enable':
        return executeImageEnable(interaction);
      case 'disable':
        return executeImageDisable(interaction);
      case 'threshold':
        return executeImageThreshold(interaction);
    }
  }

  // Handle general commands
  switch (subcommand) {
    case 'stats':
      return executeStats(interaction);
    case 'status':
      return executeStatus(interaction);
  }
}

async function executeWordAdd(interaction) {
  const word = interaction.options.getString('word');

  const success = filterSystem.addFilteredWord(word);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Word Added')
      .setDescription(`Added "${word}" to the filter list.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({ 
      content: '❌ This word is already in the filter list.', 
      ephemeral: true 
    });
  }
}

async function executeWordRemove(interaction) {
  const word = interaction.options.getString('word');

  const success = filterSystem.removeFilteredWord(word);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Word Removed')
      .setDescription(`Removed "${word}" from the filter list.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({ 
      content: '❌ This word is not in the custom filter list or is a default word that cannot be removed.', 
      ephemeral: true 
    });
  }
}

async function executeWordList(interaction) {
  const showDefault = interaction.options.getBoolean('show_default') ?? false;

  const customWords = filterSystem.config.wordFilter.customWords;
  const defaultWords = filterSystem.config.wordFilter.defaultWords;

  const embed = new EmbedBuilder()
    .setTitle('📝 Filtered Words')
    .setColor(0x0099ff)
    .setTimestamp();

  // Add custom words
  if (customWords.length > 0) {
    const customList = customWords.map(w => `\`${w}\``).join(', ');
    embed.addFields({
      name: `Custom Words (${customWords.length})`,
      value: customList.slice(0, 1024),
      inline: false
    });
  } else {
    embed.addFields({
      name: 'Custom Words',
      value: 'No custom words added.',
      inline: false
    });
  }

  // Add default words if requested
  if (showDefault) {
    const defaultList = defaultWords.map(w => `||${w}||`).join(', ');
    embed.addFields({
      name: `Default Words (${defaultWords.length})`,
      value: defaultList.slice(0, 1024),
      inline: false
    });
  } else {
    embed.setFooter({ text: 'Use /filter word list show_default:true to see default words' });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeWordEnable(interaction) {
  filterSystem.config.wordFilter.enabled = true;
  await filterSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Word Filter Enabled')
    .setDescription('The word filter is now active.')
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeWordDisable(interaction) {
  filterSystem.config.wordFilter.enabled = false;
  await filterSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('❌ Word Filter Disabled')
    .setDescription('The word filter has been disabled.')
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeImageEnable(interaction) {
  filterSystem.config.imageFilter.enabled = true;
  await filterSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Image Filter Enabled')
    .setDescription('The image filter is now active.')
    .setColor(0x00ff00)
    .setTimestamp();

  if (!filterSystem.config.imageFilter.apiUrl) {
    embed.addFields({
      name: '⚠️ Warning',
      value: 'No external NSFW detection API is configured. Image filtering may be limited.',
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeImageDisable(interaction) {
  filterSystem.config.imageFilter.enabled = false;
  await filterSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('❌ Image Filter Disabled')
    .setDescription('The image filter has been disabled.')
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeImageThreshold(interaction) {
  const value = interaction.options.getNumber('value');

  filterSystem.config.imageFilter.nsfwThreshold = value;
  await filterSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Threshold Updated')
    .setDescription(`NSFW detection threshold set to ${value}`)
    .addFields({
      name: 'Threshold Guide',
      value: '• 0.0-0.3: Very lenient\n• 0.4-0.6: Moderate\n• 0.7-0.9: Strict\n• 1.0: Maximum strictness',
      inline: false
    })
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeStats(interaction) {
  const stats = filterSystem.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Filter Statistics')
    .setColor(0x0099ff)
    .addFields(
      { 
        name: 'Messages Filtered', 
        value: `${stats.stats.messagesFiltered}`, 
        inline: true 
      },
      { 
        name: 'Images Filtered', 
        value: `${stats.stats.imagesFiltered}`, 
        inline: true 
      },
      { 
        name: 'Total Words', 
        value: `${stats.wordFilter.totalWords}`, 
        inline: true 
      }
    )
    .setTimestamp();

  // Add top detected words
  if (stats.stats.topWords.length > 0) {
    const topWords = stats.stats.topWords
      .map(([word, count]) => `\`${word}\`: ${count}`)
      .join('\n');
    
    embed.addFields({
      name: 'Top Detected Words',
      value: topWords.slice(0, 1024),
      inline: false
    });
  }

  // Add top violators
  if (stats.stats.topViolators.length > 0) {
    const topViolators = stats.stats.topViolators
      .slice(0, 5)
      .map(([userId, count]) => `<@${userId}>: ${count} violations`)
      .join('\n');
    
    embed.addFields({
      name: 'Top Violators',
      value: topViolators,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeStatus(interaction) {
  const config = filterSystem.config;

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Filter System Status')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      { 
        name: 'System Status', 
        value: config.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      },
      { 
        name: 'Word Filter', 
        value: config.wordFilter.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      },
      { 
        name: 'Image Filter', 
        value: config.imageFilter.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      }
    )
    .setTimestamp();

  // Word filter details
  embed.addFields({
    name: 'Word Filter Settings',
    value: [
      `• Action: ${config.wordFilter.action}`,
      `• Case Sensitive: ${config.wordFilter.caseSensitive ? 'Yes' : 'No'}`,
      `• Check Variations: ${config.wordFilter.checkVariations ? 'Yes' : 'No'}`,
      `• Custom Words: ${config.wordFilter.customWords.length}`,
      `• Timeout Duration: ${config.wordFilter.timeoutDuration}s`
    ].join('\n'),
    inline: false
  });

  // Image filter details
  embed.addFields({
    name: 'Image Filter Settings',
    value: [
      `• Action: ${config.imageFilter.action}`,
      `• NSFW Threshold: ${config.imageFilter.nsfwThreshold}`,
      `• Max File Size: ${(config.imageFilter.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
      `• API Configured: ${config.imageFilter.apiUrl ? 'Yes' : 'No'}`
    ].join('\n'),
    inline: false
  });

  // Exemptions
  const exemptInfo = [];
  if (config.wordFilter.exemptRoles.length > 0) {
    exemptInfo.push(`Word Filter Exempt Roles: ${config.wordFilter.exemptRoles.map(id => `<@&${id}>`).join(', ')}`);
  }
  if (config.wordFilter.exemptChannels.length > 0) {
    exemptInfo.push(`Word Filter Exempt Channels: ${config.wordFilter.exemptChannels.map(id => `<#${id}>`).join(', ')}`);
  }
  if (config.imageFilter.exemptRoles.length > 0) {
    exemptInfo.push(`Image Filter Exempt Roles: ${config.imageFilter.exemptRoles.map(id => `<@&${id}>`).join(', ')}`);
  }
  if (config.imageFilter.exemptChannels.length > 0) {
    exemptInfo.push(`Image Filter Exempt Channels: ${config.imageFilter.exemptChannels.map(id => `<#${id}>`).join(', ')}`);
  }
  if (config.imageFilter.nsfwChannels.length > 0) {
    exemptInfo.push(`NSFW Allowed Channels: ${config.imageFilter.nsfwChannels.map(id => `<#${id}>`).join(', ')}`);
  }

  if (exemptInfo.length > 0) {
    embed.addFields({
      name: 'Exemptions',
      value: exemptInfo.join('\n').slice(0, 1024),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

export const commands = [
  { data: filterData, execute }
];