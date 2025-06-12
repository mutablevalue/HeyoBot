// src/commands/welcome.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';
import { EmbedLoader } from '../utils/embedLoader.js';

let welcomeSystem = null;
let embedLoader = null;

export function setWelcomeSystem(system) {
  welcomeSystem = system;
  // Initialize embedLoader using the welcomeSystem's configLoader
  if (system && system.configLoader) {
    embedLoader = new EmbedLoader(system.configLoader);
  }
}

export const data = new SlashCommandBuilder()
  .setName('setwelcome')
  .setDescription('Configure the welcome message system')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  // Enable/disable
  .addSubcommand(subcommand =>
    subcommand
      .setName('toggle')
      .setDescription('Enable or disable welcome messages')
      .addBooleanOption(option =>
        option
          .setName('enabled')
          .setDescription('Enable welcome messages')
          .setRequired(true)
      )
  )
  // Set channel
  .addSubcommand(subcommand =>
    subcommand
      .setName('channel')
      .setDescription('Set the welcome message channel')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel for welcome messages')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  // Set message
  .addSubcommand(subcommand =>
    subcommand
      .setName('message')
      .setDescription('Configure the welcome message')
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('Message description (use {user}, {server}, {memberCount})')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('ping')
          .setDescription('Ping the user in the welcome message')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('delete_after')
          .setDescription('Delete message after X seconds (0 to disable)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(3600)
      )
  )
  // Set DM
  .addSubcommand(subcommand =>
    subcommand
      .setName('dm')
      .setDescription('Configure welcome DMs')
      .addBooleanOption(option =>
        option
          .setName('enabled')
          .setDescription('Enable welcome DMs')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('DM description')
          .setRequired(false)
      )
  )
  // Set auto role
  .addSubcommand(subcommand =>
    subcommand
      .setName('autorole')
      .setDescription('Set role to give on join')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to give new members')
          .setRequired(false)
      )
  )
  // Preview
  .addSubcommand(subcommand =>
    subcommand
      .setName('preview')
      .setDescription('Preview the current welcome message')
  )
  // View config
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View welcome system configuration')
  );

export async function execute(interaction) {
  if (!welcomeSystem || !embedLoader) {
    return interaction.reply({ content: 'Welcome system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'toggle':
      return executeToggle(interaction);
    case 'channel':
      return executeSetChannel(interaction);
    case 'message':
      return executeSetMessage(interaction);
    case 'dm':
      return executeSetDM(interaction);
    case 'autorole':
      return executeSetAutoRole(interaction);
    case 'preview':
      return executePreview(interaction);
    case 'view':
      return executeView(interaction);
  }
}

async function executeToggle(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  
  if (enabled) {
    // Check if channel is set
    if (!welcomeSystem.config?.channel) {
      const embed = embedLoader.error('Please set a welcome channel first using `/setwelcome channel`');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    await welcomeSystem.enable();
    const embed = embedLoader.success('Welcome messages are now active.');
    await interaction.reply({ embeds: [embed] });
  } else {
    await welcomeSystem.disable();
    const embed = embedLoader.success('Welcome messages have been disabled.');
    await interaction.reply({ embeds: [embed] });
  }
}

async function executeSetChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  
  await welcomeSystem.setChannel(channel.id);
  
  const embed = embedLoader.success(`Welcome messages will be sent to ${channel}.`);
  await interaction.reply({ embeds: [embed] });
}

async function executeSetMessage(interaction) {
  const description = interaction.options.getString('description');
  const ping = interaction.options.getBoolean('ping');
  const deleteAfter = interaction.options.getInteger('delete_after');
  
  const updates = {};
  if (description !== null) updates.description = description;
  
  if (Object.keys(updates).length > 0) {
    await welcomeSystem.setMessage(updates);
  }
  
  if (ping !== null) welcomeSystem.config.pingUser = ping;
  if (deleteAfter !== null) welcomeSystem.config.deleteAfter = deleteAfter;
  
  if (ping !== null || deleteAfter !== null || Object.keys(updates).length > 0) {
    await welcomeSystem.saveConfig();
  }
  
  const embed = embedLoader.success('Welcome message configuration has been updated.');
  embed.addFields({
    name: 'Available Placeholders',
    value: '{user} - Username\n{user.mention} - User mention\n{user.tag} - User tag\n{user.id} - User ID\n{server} - Server name\n{memberCount} - Member count',
    inline: false
  });
  
  await interaction.reply({ embeds: [embed] });
}

async function executeSetDM(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  const description = interaction.options.getString('description');
  
  welcomeSystem.config.dmEnabled = enabled;
  
  const updates = {};
  if (description !== null) updates.description = description;
  
  if (Object.keys(updates).length > 0) {
    await welcomeSystem.setDMMessage(updates);
  } else {
    await welcomeSystem.saveConfig();
  }
  
  const message = enabled ? 'New members will receive a welcome DM.' : 'Welcome DMs have been disabled.';
  const embed = embedLoader.success(message);
  
  await interaction.reply({ embeds: [embed] });
}

async function executeSetAutoRole(interaction) {
  const role = interaction.options.getRole('role');
  
  if (role) {
    await welcomeSystem.setAutoRole(role.id);
    const embed = embedLoader.success(`New members will receive the ${role} role.`);
    await interaction.reply({ embeds: [embed] });
  } else {
    await welcomeSystem.setAutoRole(null);
    const embed = embedLoader.success('Auto role has been disabled.');
    await interaction.reply({ embeds: [embed] });
  }
}

async function executePreview(interaction) {
  const config = welcomeSystem.config;
  
  // Create preview embed
  const messageEmbed = welcomeSystem.createPreviewEmbed(interaction.member, config.message || {});
  
  const previewEmbed = embedLoader.info('This is how the welcome message will look:');
  
  const content = config.pingUser ? `${interaction.member} (ping preview)` : undefined;
  
  await interaction.reply({ 
    content: content,
    embeds: [previewEmbed, messageEmbed], 
    ephemeral: true 
  });
}

async function executeView(interaction) {
  const config = welcomeSystem.getConfig();
  
  const embed = embedLoader.system('Welcome System', 'Current configuration', {
    fields: [
      {
        name: 'Status',
        value: config.enabled ? 'Enabled' : 'Disabled',
        inline: true
      },
      {
        name: 'Channel',
        value: config.channel ? `<#${config.channel}>` : 'Not set',
        inline: true
      },
      {
        name: 'Auto Role',
        value: config.autoRole ? `<@&${config.autoRole}>` : 'None',
        inline: true
      },
      {
        name: 'Settings',
        value: `Ping User: ${config.pingUser ? 'Yes' : 'No'}\nDelete After: ${config.deleteAfter ? `${config.deleteAfter}s` : 'Never'}\nDMs Enabled: ${config.dmEnabled ? 'Yes' : 'No'}`,
        inline: false
      },
      {
        name: 'Message',
        value: welcomeSystem.config.message?.description || 'Not set',
        inline: false
      }
    ]
  });

  await interaction.reply({ embeds: [embed] });
}