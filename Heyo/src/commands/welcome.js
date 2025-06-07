// src/commands/welcome.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js';

let welcomeSystem = null;

export function setWelcomeSystem(system) {
  welcomeSystem = system;
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
          .setName('title')
          .setDescription('Message title')
          .setRequired(false)
      )
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
          .setName('title')
          .setDescription('DM title')
          .setRequired(false)
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
  if (!welcomeSystem) {
    return interaction.reply({ content: '❌ Welcome system not loaded.', ephemeral: true });
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
    if (!welcomeSystem.config.channel) {
      return interaction.reply({ 
        content: '❌ Please set a welcome channel first using `/setwelcome channel`', 
        ephemeral: true 
      });
    }
    
    await welcomeSystem.enable();
    const embed = new EmbedBuilder()
      .setTitle('✅ Welcome System Enabled')
      .setDescription('Welcome messages are now active.')
      .setColor(0x00ff00)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  } else {
    await welcomeSystem.disable();
    const embed = new EmbedBuilder()
      .setTitle('❌ Welcome System Disabled')
      .setDescription('Welcome messages have been disabled.')
      .setColor(0xff0000)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
}

async function executeSetChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  
  await welcomeSystem.setChannel(channel.id);
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Welcome Channel Set')
    .setDescription(`Welcome messages will be sent to ${channel}.`)
    .setColor(0x00ff00)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}

// Export for index.js

async function executeSetMessage(interaction) {
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const ping = interaction.options.getBoolean('ping');
  const deleteAfter = interaction.options.getInteger('delete_after');
  
  const updates = {};
  if (title !== null) updates.title = title;
  if (description !== null) updates.description = description;
  if (ping !== null) welcomeSystem.config.pingUser = ping;
  if (deleteAfter !== null) welcomeSystem.config.deleteAfter = deleteAfter;
  
  await welcomeSystem.setMessage(updates);
  if (ping !== null || deleteAfter !== null) {
    await welcomeSystem.saveConfig();
  }
  
  const embed = new EmbedBuilder()
    .setTitle('✅ Welcome Message Updated')
    .setDescription('Welcome message configuration has been updated.')
    .setColor(0x00ff00)
    .addFields(
      { 
        name: 'Available Placeholders', 
        value: '`{user}` - Username\n`{user.mention}` - User mention\n`{user.tag}` - User tag\n`{user.id}` - User ID\n`{server}` - Server name\n`{memberCount}` - Member count',
        inline: false 
      }
    )
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}

async function executeSetDM(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  
  welcomeSystem.config.dmEnabled = enabled;
  
  const updates = {};
  if (title !== null) updates.title = title;
  if (description !== null) updates.description = description;
  
  if (Object.keys(updates).length > 0) {
    await welcomeSystem.setDMMessage(updates);
  } else {
    await welcomeSystem.saveConfig();
  }
  
  const embed = new EmbedBuilder()
    .setTitle(enabled ? '✅ Welcome DMs Enabled' : '❌ Welcome DMs Disabled')
    .setDescription(enabled ? 'New members will receive a welcome DM.' : 'Welcome DMs have been disabled.')
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed] });
}

async function executeSetAutoRole(interaction) {
  const role = interaction.options.getRole('role');
  
  if (role) {
    await welcomeSystem.setAutoRole(role.id);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Auto Role Set')
      .setDescription(`New members will receive the ${role} role.`)
      .setColor(0x00ff00)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  } else {
    await welcomeSystem.setAutoRole(null);
    
    const embed = new EmbedBuilder()
      .setTitle('✅ Auto Role Removed')
      .setDescription('Auto role has been disabled.')
      .setColor(0xff0000)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  }
}

async function executePreview(interaction) {
  const config = welcomeSystem.config;
  
  // Create preview embed
  const messageEmbed = welcomeSystem.createWelcomeEmbed(interaction.member, config.message);
  
  const embed = new EmbedBuilder()
    .setTitle('Welcome Message Preview')
    .setDescription('This is how the welcome message will look:')
    .setColor(0x0099ff)
    .setTimestamp();
  
  const content = config.pingUser ? `${interaction.member} (ping preview)` : undefined;
  
  await interaction.reply({ 
    content: content,
    embeds: [embed, messageEmbed], 
    ephemeral: true 
  });
}

async function executeView(interaction) {
  const config = welcomeSystem.config;
  const stats = welcomeSystem.getStats();
  
  const embed = new EmbedBuilder()
    .setTitle('Welcome System Configuration')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      {
        name: 'Status',
        value: config.enabled ? '✅ Enabled' : '❌ Disabled',
        inline: true
      },
      {
        name: 'Channel',
        value: config.channel ? `<#${config.channel}>` : 'Not set',
        inline: true
      },
      {
        name: 'Auto Role',
        value: config.roleOnJoin ? `<@&${config.roleOnJoin}>` : 'None',
        inline: true
      },
      {
        name: 'Message Settings',
        value: `Ping User: ${config.pingUser ? 'Yes' : 'No'}\n` +
               `Delete After: ${config.deleteAfter ? `${config.deleteAfter}s` : 'Never'}\n` +
               `DMs Enabled: ${config.dmEnabled ? 'Yes' : 'No'}`,
        inline: true
      },
      {
        name: 'Statistics',
        value: `Welcomes Sent: ${stats.stats.welcomesSent}\n` +
               `DMs Sent: ${stats.stats.dmsSent}\n` +
               `Errors: ${stats.stats.errors}`,
        inline: true
      }
    )
    .setTimestamp();

  // Add current message config
  if (config.message) {
    embed.addFields({
      name: 'Current Message',
      value: `**Title:** ${config.message.title || 'None'}\n` +
             `**Description:** ${config.message.description || 'None'}`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}