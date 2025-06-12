// src/commands/filter.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let filterSystem = null;
let embedLoader = null;

export function setFilterSystem(system) {
  filterSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
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
  if (!filterSystem || !embedLoader) {
    return interaction.reply({ content: 'Filter system not loaded.', ephemeral: true });
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
    const embed = embedLoader.success(`Added "${word}" to the filter list.`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({ 
      content: 'This word is already in the filter list.', 
      ephemeral: true 
    });
  }
}

async function executeWordRemove(interaction) {
  const word = interaction.options.getString('word');

  const success = filterSystem.removeFilteredWord(word);

  if (success) {
    const embed = embedLoader.success(`Removed "${word}" from the filter list.`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({ 
      content: 'This word is not in the custom filter list or is a default word that cannot be removed.', 
      ephemeral: true 
    });
  }
}

async function executeWordList(interaction) {
  const showDefault = interaction.options.getBoolean('show_default') ?? false;

  const customWords = filterSystem.config.wordFilter.customWords;
  const defaultWords = filterSystem.config.wordFilter.defaultWords;

  const fields = [];

  // Add custom words
  if (customWords.length > 0) {
    const customList = customWords.map(w => `\`${w}\``).join(', ');
    fields.push({
      name: `Custom Words (${customWords.length})`,
      value: customList.slice(0, 1024),
      inline: false
    });
  } else {
    fields.push({
      name: 'Custom Words',
      value: 'No custom words added.',
      inline: false
    });
  }

  // Add default words if requested
  if (showDefault) {
    const defaultList = defaultWords.map(w => `||${w}||`).join(', ');
    fields.push({
      name: `Default Words (${defaultWords.length})`,
      value: defaultList.slice(0, 1024),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'Filter System',
    description: 'Filtered words list',
    fields,
    footer: showDefault ? null : 'Use /filter word list show_default:true to see default words'
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeWordEnable(interaction) {
  filterSystem.config.wordFilter.enabled = true;
  await filterSystem.saveConfig();

  const embed = embedLoader.success('The word filter is now active.');
  await interaction.reply({ embeds: [embed] });
}

async function executeWordDisable(interaction) {
  filterSystem.config.wordFilter.enabled = false;
  await filterSystem.saveConfig();

  const embed = embedLoader.info('The word filter has been disabled.');
  await interaction.reply({ embeds: [embed] });
}

async function executeImageEnable(interaction) {
  filterSystem.config.imageFilter.enabled = true;
  await filterSystem.saveConfig();

  const embed = embedLoader.success('The image filter is now active.');
  await interaction.reply({ embeds: [embed] });
}

async function executeImageDisable(interaction) {
  filterSystem.config.imageFilter.enabled = false;
  await filterSystem.saveConfig();

  const embed = embedLoader.info('The image filter has been disabled.');
  await interaction.reply({ embeds: [embed] });
}

async function executeStats(interaction) {
  const stats = filterSystem.getStats();

  const fields = [
    { 
      name: 'Word Filter', 
      value: stats.wordFilter.enabled ? 'Enabled' : 'Disabled', 
      inline: true 
    },
    { 
      name: 'Total Words', 
      value: `${stats.wordFilter.totalWords}`, 
      inline: true 
    },
    { 
      name: 'Custom Words', 
      value: `${stats.wordFilter.customWords}`, 
      inline: true 
    },
    { 
      name: 'Image Filter', 
      value: stats.imageFilter.enabled ? 'Enabled' : 'Disabled', 
      inline: true 
    }
  ];

  const embed = embedLoader.createEmbed({
    title: 'Filter System',
    description: 'Statistics',
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeStatus(interaction) {
  const config = filterSystem.config;

  const fields = [
    { 
      name: 'System Status', 
      value: config.enabled ? 'Enabled' : 'Disabled', 
      inline: true 
    },
    { 
      name: 'Word Filter', 
      value: config.wordFilter.enabled ? 'Enabled' : 'Disabled', 
      inline: true 
    },
    { 
      name: 'Image Filter', 
      value: config.imageFilter.enabled ? 'Enabled' : 'Disabled', 
      inline: true 
    }
  ];

  // Word filter details
  fields.push({
    name: 'Word Filter Settings',
    value: [
      `Action: ${config.wordFilter.action}`,
      `Case Sensitive: ${config.wordFilter.caseSensitive ? 'Yes' : 'No'}`,
      `Check Variations: ${config.wordFilter.checkVariations ? 'Yes' : 'No'}`,
      `Custom Words: ${config.wordFilter.customWords.length}`,
      `Timeout Duration: ${config.wordFilter.timeoutDuration}s`
    ].join('\n'),
    inline: false
  });

  // Image filter details
  fields.push({
    name: 'Image Filter Settings',
    value: [
      `Action: ${config.imageFilter.action}`,
      `NSFW Channels: ${config.imageFilter.nsfwChannels.length}`
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
    fields.push({
      name: 'Exemptions',
      value: exemptInfo.join('\n').slice(0, 1024),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'Filter System',
    description: 'Configuration status',
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

export const commands = [
  { data: filterData, execute }
];