// src/commands/banappeal.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';

let banAppealSystem = null;

export function setBanAppealSystem(system) {
  banAppealSystem = system;
}

export const appealData = new SlashCommandBuilder()
  .setName('appeal')
  .setDescription('Manage ban appeals')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View appeals for a user')
      .addStringOption(option =>
        option
          .setName('user_id')
          .setDescription('User ID to check appeals for')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View ban appeal statistics')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('settings')
      .setDescription('View ban appeal settings')
  );

export const banMessageData = new SlashCommandBuilder()
  .setName('banmessage')
  .setDescription('Configure ban appeal message')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('preview')
      .setDescription('Preview the ban appeal message')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('enable')
      .setDescription('Enable ban appeal messages')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('disable')
      .setDescription('Disable ban appeal messages')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit ban appeal message settings')
      .addStringOption(option =>
        option
          .setName('field')
          .setDescription('Field to edit')
          .setRequired(true)
          .addChoices(
            { name: 'Title', value: 'title' },
            { name: 'Content', value: 'content' },
            { name: 'Description', value: 'description' },
            { name: 'Button Label', value: 'button' }
          )
      )
      .addStringOption(option =>
        option
          .setName('value')
          .setDescription('New value for the field')
          .setRequired(true)
      )
  );

async function executeAppeal(interaction) {
  if (!banAppealSystem) {
    return interaction.reply({ content: '❌ Ban appeal system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'view':
      return executeView(interaction);
    case 'stats':
      return executeStats(interaction);
    case 'settings':
      return executeSettings(interaction);
  }
}

async function executeBanMessage(interaction) {
  if (!banAppealSystem) {
    return interaction.reply({ content: '❌ Ban appeal system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'preview':
      return executePreview(interaction);
    case 'enable':
      return executeEnable(interaction);
    case 'disable':
      return executeDisable(interaction);
    case 'edit':
      return executeEdit(interaction);
  }
}

async function executeView(interaction) {
  const userId = interaction.options.getString('user_id');
  const appeals = banAppealSystem.getUserAppeals(userId, interaction.guild.id);

  if (appeals.length === 0) {
    return interaction.reply({
      content: `No appeals found for user ID: ${userId}`,
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Ban Appeals for User ${userId}`)
    .setColor(0x0099ff)
    .setTimestamp();

  for (const [index, appeal] of appeals.entries()) {
    const status = appeal.status === 'pending' ? '⏳ Pending' : 
                   appeal.status === 'approved' ? '✅ Approved' : 
                   '❌ Denied';

    embed.addFields({
      name: `Appeal #${index + 1} - ${status}`,
      value: [
        `**Submitted:** <t:${Math.floor(new Date(appeal.submittedAt).getTime() / 1000)}:F>`,
        `**Reason:** ${appeal.reason.slice(0, 200)}${appeal.reason.length > 200 ? '...' : ''}`,
        appeal.reviewedBy ? `**Reviewed by:** <@${appeal.reviewedBy}>` : '',
        appeal.reviewedAt ? `**Reviewed at:** <t:${Math.floor(new Date(appeal.reviewedAt).getTime() / 1000)}:F>` : ''
      ].filter(Boolean).join('\n'),
      inline: false
    });
  }

  embed.setFooter({ text: `Total appeals: ${appeals.length}/${banAppealSystem.config.maxAppeals}` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeStats(interaction) {
  const appeals = banAppealSystem.appeals;
  
  let totalAppeals = 0;
  let pendingAppeals = 0;
  let approvedAppeals = 0;
  let deniedAppeals = 0;
  let guildAppeals = 0;

  for (const [userId, userAppeals] of appeals) {
    for (const [guildId, guildAppealList] of Object.entries(userAppeals)) {
      for (const appeal of guildAppealList) {
        totalAppeals++;
        
        if (guildId === interaction.guild.id) {
          guildAppeals++;
        }

        switch (appeal.status) {
          case 'pending':
            pendingAppeals++;
            break;
          case 'approved':
            approvedAppeals++;
            break;
          case 'denied':
            deniedAppeals++;
            break;
        }
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 Ban Appeal Statistics')
    .setColor(0x0099ff)
    .addFields(
      { name: 'Total Appeals', value: `${totalAppeals}`, inline: true },
      { name: 'This Server', value: `${guildAppeals}`, inline: true },
      { name: 'Unique Users', value: `${appeals.size}`, inline: true },
      { name: '⏳ Pending', value: `${pendingAppeals}`, inline: true },
      { name: '✅ Approved', value: `${approvedAppeals}`, inline: true },
      { name: '❌ Denied', value: `${deniedAppeals}`, inline: true }
    )
    .setTimestamp();

  if (approvedAppeals + deniedAppeals > 0) {
    const approvalRate = ((approvedAppeals / (approvedAppeals + deniedAppeals)) * 100).toFixed(1);
    embed.addFields({
      name: 'Approval Rate',
      value: `${approvalRate}%`,
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function executeSettings(interaction) {
  const config = banAppealSystem.config;

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Ban Appeal Settings')
    .setColor(config.enabled ? 0x00ff00 : 0xff0000)
    .addFields(
      { 
        name: 'Status', 
        value: config.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      },
      { 
        name: 'DM on Ban', 
        value: config.dmMessage.enabled ? '✅ Enabled' : '❌ Disabled', 
        inline: true 
      },
      { 
        name: 'Max Appeals', 
        value: `${config.maxAppeals}`, 
        inline: true 
      },
      { 
        name: 'Appeal Cooldown', 
        value: `${config.appealCooldown / (1000 * 60 * 60 * 24)} days`, 
        inline: true 
      },
      { 
        name: 'Appeal Channel', 
        value: config.appealChannel ? `<#${config.appealChannel}>` : 'Not set', 
        inline: true 
      },
      { 
        name: 'Notify Role', 
        value: config.notifyRole ? `<@&${config.notifyRole}>` : 'Not set', 
        inline: true 
      }
    )
    .setTimestamp();

  // Add form field info
  const formFields = [];
  for (const [key, field] of Object.entries(config.appealForm)) {
    formFields.push(`• **${field.label}** (${field.minLength}-${field.maxLength} chars${field.required ? ', required' : ''})`);
  }

  embed.addFields({
    name: 'Appeal Form Fields',
    value: formFields.join('\n'),
    inline: false
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executePreview(interaction) {
  const config = banAppealSystem.config;

  const embed = new EmbedBuilder()
    .setTitle(config.dmMessage.embedTitle)
    .setDescription(
      config.dmMessage.content.replace('{server}', interaction.guild.name) + '\n\n' +
      config.dmMessage.embedDescription
    )
    .setColor(config.dmMessage.embedColor)
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() })
    .setTimestamp();

  await interaction.reply({
    content: 'This is what banned users will see:',
    embeds: [embed],
    ephemeral: true
  });
}

async function executeEnable(interaction) {
  banAppealSystem.config.dmMessage.enabled = true;
  await banAppealSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Ban Messages Enabled')
    .setDescription('Banned users will now receive appeal information via DM.')
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeDisable(interaction) {
  banAppealSystem.config.dmMessage.enabled = false;
  await banAppealSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('❌ Ban Messages Disabled')
    .setDescription('Banned users will no longer receive appeal information.')
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function executeEdit(interaction) {
  const field = interaction.options.getString('field');
  const value = interaction.options.getString('value');

  switch (field) {
    case 'title':
      banAppealSystem.config.dmMessage.embedTitle = value;
      break;
    case 'content':
      banAppealSystem.config.dmMessage.content = value;
      break;
    case 'description':
      banAppealSystem.config.dmMessage.embedDescription = value;
      break;
    case 'button':
      banAppealSystem.config.dmMessage.buttonLabel = value;
      break;
  }

  await banAppealSystem.saveConfig();

  const embed = new EmbedBuilder()
    .setTitle('✅ Setting Updated')
    .setDescription(`Updated ${field} to:\n\`\`\`${value}\`\`\``)
    .setColor(0x00ff00)
    .setTimestamp()
    .setFooter({ text: 'Use /banmessage preview to see the changes' });

  await interaction.reply({ embeds: [embed] });
}

export const commands = [
  { data: appealData, execute: executeAppeal },
  { data: banMessageData, execute: executeBanMessage }
];