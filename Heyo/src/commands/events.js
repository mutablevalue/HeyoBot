// src/commands/events.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder
} from 'discord.js';

let eventHostingSystem = null;
let leaderboardSystem = null;
let embedLoader = null;

export function setEventHostingSystem(system) {
  eventHostingSystem = system;
}

export function setLeaderboardSystem(system) {
  leaderboardSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Manage server events')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
  // Create event
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new event')
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Event type')
          .setRequired(true)
          .addChoices(
            { name: 'Last to Leave VC', value: 'last_to_leave_vc' },
            { name: 'Message Milestone', value: 'message_milestone' },
            { name: 'Voice Time Milestone', value: 'vc_milestone' },
            { name: 'Be Online', value: 'be_online' }
          )
      )
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Event name')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('rewards')
          .setDescription('Event rewards (comma separated)')
          .setRequired(true)
      )
  )
  // List events
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all active events')
  )
  // View event
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View details of an event')
      .addStringOption(option =>
        option
          .setName('event_id')
          .setDescription('Event ID to view')
          .setRequired(true)
      )
  )
  // Cancel event
  .addSubcommand(subcommand =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel an active event')
      .addStringOption(option =>
        option
          .setName('event_id')
          .setDescription('Event ID to cancel')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for cancellation')
          .setRequired(false)
      )
  )
  // End event
  .addSubcommand(subcommand =>
    subcommand
      .setName('end')
      .setDescription('Manually end an event')
      .addStringOption(option =>
        option
          .setName('event_id')
          .setDescription('Event ID to end')
          .setRequired(true)
      )
      .addUserOption(option =>
        option
          .setName('winner')
          .setDescription('Manual winner selection')
          .setRequired(false)
      )
  )
  // History
  .addSubcommand(subcommand =>
    subcommand
      .setName('history')
      .setDescription('View event history')
      .addIntegerOption(option =>
        option
          .setName('limit')
          .setDescription('Number of events to show')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20)
      )
  );

// Quick event commands
export const lastToLeaveData = new SlashCommandBuilder()
  .setName('lasttoleave')
  .setDescription('Start a "Last to Leave VC" event')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
  .addStringOption(option =>
    option
      .setName('rewards')
      .setDescription('Rewards for the winner')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName('countdown_minutes')
      .setDescription('Minutes before channel closes')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(60)
  )
  .addIntegerOption(option =>
    option
      .setName('duration_minutes')
      .setDescription('Minutes the event runs after closing')
      .setRequired(false)
      .setMinValue(5)
      .setMaxValue(1440)
  )
  .addIntegerOption(option =>
    option
      .setName('start_delay_minutes')
      .setDescription('Minutes until event starts')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1440)
  )
  .addIntegerOption(option =>
    option
      .setName('min_messages')
      .setDescription('Minimum messages required to participate')
      .setRequired(false)
      .setMinValue(0)
  )
  .addBooleanOption(option =>
    option
      .setName('booster_only')
      .setDescription('Only boosters can participate')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!eventHostingSystem || !embedLoader) {
    return interaction.reply({ content: 'Event system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      return executeCreate(interaction);
    case 'list':
      return executeList(interaction);
    case 'view':
      return executeView(interaction);
    case 'cancel':
      return executeCancel(interaction);
    case 'end':
      return executeEnd(interaction);
    case 'history':
      return executeHistory(interaction);
  }
}

async function executeCreate(interaction) {
  const type = interaction.options.getString('type');
  const name = interaction.options.getString('name');
  const rewards = interaction.options.getString('rewards').split(',').map(r => r.trim());

  // Show configuration menu based on event type
  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: `Configure Event: ${name}\nType: **${eventHostingSystem.eventTypes[type]?.name || type}**\n\nSelect additional options:`
  });

  const components = [];

  // Requirements select menu
  const requirementsMenu = new StringSelectMenuBuilder()
    .setCustomId('event_requirements')
    .setPlaceholder('Select requirements')
    .setMinValues(0)
    .setMaxValues(5)
    .addOptions([
      {
        label: 'Minimum 100 Messages',
        description: 'Require at least 100 messages',
        value: 'msg_100'
      },
      {
        label: 'Minimum 1000 Messages',
        description: 'Require at least 1000 messages',
        value: 'msg_1000'
      },
      {
        label: 'Minimum 1 Hour Voice Time',
        description: 'Require at least 1 hour in voice',
        value: 'vc_1h'
      },
      {
        label: 'Must be Booster',
        description: 'Only server boosters can participate',
        value: 'booster'
      },
      {
        label: '7+ Days in Server',
        description: 'Must be in server for at least 7 days',
        value: 'days_7'
      }
    ]);

  components.push(new ActionRowBuilder().addComponents(requirementsMenu));

  // Store event data temporarily
  interaction.client.eventCreationData = interaction.client.eventCreationData || new Map();
  interaction.client.eventCreationData.set(interaction.user.id, {
    type, name, rewards,
    guildId: interaction.guild.id,
    createdBy: interaction.user.id
  });

  await interaction.reply({ 
    embeds: [embed], 
    components,
    ephemeral: true 
  });

  // Set up collector
  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 300000 // 5 minutes
  });

  collector.on('collect', async i => {
    if (i.customId === 'event_requirements') {
      const eventData = interaction.client.eventCreationData.get(interaction.user.id);
      const requirements = {};

      // Parse selected requirements
      for (const value of i.values) {
        switch (value) {
          case 'msg_100':
            requirements.minMessages = 100;
            break;
          case 'msg_1000':
            requirements.minMessages = 1000;
            break;
          case 'vc_1h':
            requirements.minVoiceTime = 3600; // 1 hour in seconds
            break;
          case 'booster':
            requirements.mustBeBooster = true;
            break;
          case 'days_7':
            requirements.minDaysInServer = 7;
            break;
        }
      }

      eventData.requirements = requirements;

      // Type-specific configuration
      switch (eventData.type) {
        case 'last_to_leave_vc':
          // For last to leave, we create the channel automatically
          eventData.data = {
            duration: eventHostingSystem.config.lastToLeave.defaultDurationMinutes * 60,
            countdownDuration: eventHostingSystem.config.lastToLeave.defaultCountdownMinutes * 60
          };
          
          await i.update({
            embeds: [embedLoader.info('Creating Last to Leave Event...\nYour event is being created with a dedicated voice channel.')],
            components: []
          });
          
          await createEvent(interaction, eventData);
          break;

        case 'message_milestone':
          eventData.data = { targetMessages: 100 }; // Default
          await createEvent(interaction, eventData);
          break;

        case 'vc_milestone':
          eventData.data = { targetSeconds: 3600 }; // 1 hour default
          await createEvent(interaction, eventData);
          break;

        case 'be_online':
          eventData.data = { targetTime: new Date(Date.now() + 3600000).toISOString() }; // 1 hour from now
          await createEvent(interaction, eventData);
          break;

        default:
          await createEvent(interaction, eventData);
      }

      collector.stop();
    }
  });

  collector.on('end', () => {
    interaction.client.eventCreationData.delete(interaction.user.id);
  });
}

async function createEvent(interaction, eventData) {
  try {
    const eventId = await eventHostingSystem.createEvent(eventData);
    
    const fields = [
      { name: 'Event ID', value: eventId, inline: true },
      { name: 'Type', value: eventHostingSystem.eventTypes[eventData.type]?.name || eventData.type, inline: true },
      { name: 'Status', value: 'Active', inline: true }
    ];

    if (eventData.rewards.length > 0) {
      fields.push({
        name: 'Rewards',
        value: eventData.rewards.map((r, i) => `${i + 1}. ${r}`).join('\n')
      });
    }

    const event = eventHostingSystem.getEvent(eventId);
    if (event.channelId) {
      fields.push({ name: 'Channel', value: `<#${event.channelId}>`, inline: true });
    }

    const embed = embedLoader.createEmbed({
      title: 'Event System',
      description: `Event Created: **${eventData.name}**`,
      fields
    });

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    console.error('[Events Command] Error creating event:', error);
    await interaction.editReply({ 
      content: `Failed to create event: ${error.message}`, 
      embeds: [], 
      components: [] 
    });
  }
}

async function executeList(interaction) {
  const activeEvents = eventHostingSystem.getActiveEvents()
    .filter(event => event.guildId === interaction.guild.id);

  if (activeEvents.length === 0) {
    return interaction.reply({ 
      content: 'No active events at the moment.', 
      ephemeral: true 
    });
  }

  const fields = [];

  for (const event of activeEvents.slice(0, 10)) {
    const fieldValue = [
      `Type: **${eventHostingSystem.eventTypes[event.type]?.name || event.type}**`,
      `Status: **${event.status}**`,
      `Created: <t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:R>`,
      `Participants: **${event.participants?.length || 0}**`
    ];

    if (event.channelId) {
      fieldValue.push(`Channel: <#${event.channelId}>`);
    }

    fields.push({
      name: `${event.name} (${event.id})`,
      value: fieldValue.join('\n'),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: 'Active Events',
    fields,
    footer: activeEvents.length > 10 ? `Showing 10 of ${activeEvents.length} active events` : `${activeEvents.length} active event${activeEvents.length > 1 ? 's' : ''}`
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeView(interaction) {
  const eventId = interaction.options.getString('event_id');
  const event = eventHostingSystem.getEvent(eventId);

  if (!event || event.guildId !== interaction.guild.id) {
    return interaction.reply({ 
      content: 'Event not found.', 
      ephemeral: true 
    });
  }

  const fields = [
    { name: 'ID', value: event.id, inline: true },
    { name: 'Type', value: eventHostingSystem.eventTypes[event.type]?.name || event.type, inline: true },
    { name: 'Status', value: event.status, inline: true },
    { name: 'Created By', value: `<@${event.createdBy}>`, inline: true },
    { name: 'Created At', value: `<t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:F>`, inline: true }
  ];

  // Add requirements
  if (Object.keys(event.requirements).length > 0) {
    const reqText = [];
    if (event.requirements.minMessages) reqText.push(`${event.requirements.minMessages}+ messages`);
    if (event.requirements.minVoiceTime) reqText.push(`${leaderboardSystem.constructor.formatTime(event.requirements.minVoiceTime)} in voice`);
    if (event.requirements.mustBeBooster) reqText.push('Must be a server booster');
    if (event.requirements.minDaysInServer) reqText.push(`${event.requirements.minDaysInServer}+ days in server`);
    
    fields.push({ name: 'Requirements', value: reqText.join('\n') || 'None' });
  }

  // Add rewards
  if (event.rewards.length > 0) {
    fields.push({ 
      name: 'Rewards', 
      value: event.rewards.map((r, i) => `${i + 1}. ${r}`).join('\n') 
    });
  }

  // Add participants/winners
  if (event.status === 'active' && event.participants) {
    fields.push({ 
      name: 'Participants', 
      value: `${event.participants.length} participants`,
      inline: true
    });
  }

  if (event.winners && event.winners.length > 0) {
    fields.push({ 
      name: 'Winners', 
      value: event.winners.map(id => `<@${id}>`).join(', '),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: `Event: **${event.name}**\n${event.description || 'No description'}`,
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeCancel(interaction) {
  const eventId = interaction.options.getString('event_id');
  const reason = interaction.options.getString('reason') || 'Cancelled by administrator';

  const event = eventHostingSystem.getEvent(eventId);
  if (!event || event.guildId !== interaction.guild.id) {
    return interaction.reply({ 
      content: 'Event not found.', 
      ephemeral: true 
    });
  }

  if (event.status !== 'active' && event.status !== 'pending') {
    return interaction.reply({ 
      content: 'Only active or pending events can be cancelled.', 
      ephemeral: true 
    });
  }

  await eventHostingSystem.cancelEvent(eventId, reason);

  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: `Event Cancelled: **${event.name}**`,
    fields: [
      { name: 'Event ID', value: eventId, inline: true },
      { name: 'Reason', value: reason, inline: false }
    ]
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeEnd(interaction) {
  const eventId = interaction.options.getString('event_id');
  const winner = interaction.options.getUser('winner');

  const event = eventHostingSystem.getEvent(eventId);
  if (!event || event.guildId !== interaction.guild.id) {
    return interaction.reply({ 
      content: 'Event not found.', 
      ephemeral: true 
    });
  }

  if (event.status !== 'active') {
    return interaction.reply({ 
      content: 'Only active events can be ended.', 
      ephemeral: true 
    });
  }

  const winners = winner ? [winner.id] : [];
  await eventHostingSystem.endEvent(eventId, winners);

  const fields = [
    { name: 'Event ID', value: eventId, inline: true }
  ];

  if (winners.length > 0) {
    fields.push({ name: 'Winner', value: `<@${winners[0]}>`, inline: true });
  }

  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: `Event Ended: **${event.name}**`,
    fields
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeHistory(interaction) {
  const limit = interaction.options.getInteger('limit') || 10;
  const history = eventHostingSystem.eventHistory
    .filter(event => event.guildId === interaction.guild.id)
    .slice(-limit)
    .reverse();

  if (history.length === 0) {
    return interaction.reply({ 
      content: 'No event history found.', 
      ephemeral: true 
    });
  }

  const fields = [];

  for (const event of history) {
    const fieldValue = [
      `Type: **${eventHostingSystem.eventTypes[event.type]?.name || event.type}**`,
      `Status: **${event.status}**`,
      `Date: <t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:F>`
    ];

    if (event.winners && event.winners.length > 0) {
      fieldValue.push(`Winners: ${event.winners.map(id => `<@${id}>`).join(', ')}`);
    }

    fields.push({
      name: event.name,
      value: fieldValue.join('\n'),
      inline: false
    });
  }

  const embed = embedLoader.createEmbed({
    title: 'Event System',
    description: 'Event History',
    fields,
    footer: `Showing ${history.length} most recent events`
  });

  await interaction.reply({ embeds: [embed] });
}

async function executeLastToLeave(interaction) {
  const rewards = interaction.options.getString('rewards').split(',').map(r => r.trim());
  const countdownMinutes = interaction.options.getInteger('countdown_minutes') || eventHostingSystem.config.lastToLeave.defaultCountdownMinutes;
  const durationMinutes = interaction.options.getInteger('duration_minutes') || eventHostingSystem.config.lastToLeave.defaultDurationMinutes;
  const startDelayMinutes = interaction.options.getInteger('start_delay_minutes') || 0;
  const minMessages = interaction.options.getInteger('min_messages');
  const boosterOnly = interaction.options.getBoolean('booster_only');

  const requirements = {};
  if (minMessages) requirements.minMessages = minMessages;
  if (boosterOnly) requirements.mustBeBooster = true;

  const eventData = {
    type: 'last_to_leave_vc',
    name: `Last to Leave VC`,
    description: `Be the last person to leave the voice channel to win!`,
    guildId: interaction.guild.id,
    createdBy: interaction.user.id,
    requirements,
    rewards,
    data: {
      countdownDuration: countdownMinutes * 60,
      duration: durationMinutes * 60
    }
  };

  // Add start time if delayed
  if (startDelayMinutes > 0) {
    eventData.startTime = new Date(Date.now() + (startDelayMinutes * 60000)).toISOString();
  }

  try {
    const eventId = await eventHostingSystem.createEvent(eventData);
    const event = eventHostingSystem.getEvent(eventId);

    const fields = [
      { name: 'Event ID', value: eventId, inline: true },
      { name: 'Channel', value: `<#${event.channelId}>`, inline: true },
      { name: 'Status', value: startDelayMinutes > 0 ? 'Pending' : 'Active', inline: true }
    ];

    // Add timing info
    if (startDelayMinutes > 0) {
      fields.push({
        name: 'Event Timeline',
        value: [
          `Opens: <t:${Math.floor(new Date(eventData.startTime).getTime() / 1000)}:R>`,
          `Closes: ${countdownMinutes} minutes after opening`,
          `Duration: ${durationMinutes} minutes after closing`
        ].join('\n')
      });
    } else {
      fields.push({
        name: 'Event Timeline',
        value: [
          `Opens: Now!`,
          `Closes: In ${countdownMinutes} minutes`,
          `Duration: ${durationMinutes} minutes after closing`
        ].join('\n')
      });
    }

    if (Object.keys(requirements).length > 0) {
      const reqText = [];
      if (requirements.minMessages) reqText.push(`${requirements.minMessages}+ messages`);
      if (requirements.mustBeBooster) reqText.push('Must be a server booster');
      
      fields.push({ name: 'Requirements', value: reqText.join('\n') });
    }

    fields.push({ 
      name: 'Rewards', 
      value: rewards.map((r, i) => `${i + 1}. ${r}`).join('\n') 
    });

    const embed = embedLoader.createEmbed({
      title: 'Event System',
      description: 'Last to Leave Event Created!\nA voice channel has been created for the event.',
      fields
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[LastToLeave Command] Error creating event:', error);
    await interaction.reply({ 
      content: `Failed to create event: ${error.message}`, 
      ephemeral: true 
    });
  }
}

export const commands = [
  { data, execute },
  { data: lastToLeaveData, execute: executeLastToLeave }
];