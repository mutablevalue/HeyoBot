// src/commands/music.js
import { 
  SlashCommandBuilder, 
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';

let musicSystem = null;
let embedLoader = null;
let permissionSystem = null;

export function setMusicSystem(system) {
  musicSystem = system;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export function setPermissionSystem(system) {
  permissionSystem = system;
}

// Setup DJ command
const setupDJCommand = {
  data: new SlashCommandBuilder()
    .setName('setupdj')
    .setDescription('Setup DJ system for the server (Administrator only)')
    .addRoleOption(option =>
      option.setName('djrole')
        .setDescription('Role that has DJ permissions')
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('djchannel')
        .setDescription('Channel where music commands can be used')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('djonly')
        .setDescription('Enable DJ-only mode (only DJs can use music commands)')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('allowalone')
        .setDescription('Allow users to be DJ when alone in voice channel')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('voteskip')
        .setDescription('Enable vote skip feature')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('votepercent')
        .setDescription('Percentage of users needed to vote skip (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(false)),
  
  async execute(interaction) {
    const permCheck = permissionSystem.canExecuteCommand(interaction.member, 'setupdj');
    if (!permCheck.allowed) {
      const embed = embedLoader.error(permCheck.reason || 'You need Administrator permissions to use this command.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const djRole = interaction.options.getRole('djrole');
    const djChannel = interaction.options.getChannel('djchannel');
    const djOnly = interaction.options.getBoolean('djonly');
    const allowAlone = interaction.options.getBoolean('allowalone');
    const voteSkip = interaction.options.getBoolean('voteskip');
    const votePercent = interaction.options.getInteger('votepercent');
    
    const settings = {
      djRoleId: djRole?.id || null,
      djChannel: djChannel?.id || null,
      djOnlyMode: djOnly !== null ? djOnly : false,
      allowAloneDJ: allowAlone !== null ? allowAlone : true,
      voteSkipEnabled: voteSkip !== null ? voteSkip : true,
      voteSkipPercentage: votePercent || musicSystem.config.voteSkipPercentage
    };
    
    await musicSystem.setupDJ(interaction.guild.id, settings);
    
    const fields = [
      { name: 'DJ Role', value: djRole ? `<@&${djRole.id}>` : 'Not set', inline: true },
      { name: 'DJ Channel', value: djChannel ? `<#${djChannel.id}>` : 'All channels', inline: true },
      { name: 'DJ Only Mode', value: settings.djOnlyMode ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Allow Alone DJ', value: settings.allowAloneDJ ? 'Yes' : 'No', inline: true },
      { name: 'Vote Skip', value: settings.voteSkipEnabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Vote Percentage', value: `${settings.voteSkipPercentage}%`, inline: true }
    ];
    
    const embed = embedLoader.createEmbed({
      title: 'DJ System Setup',
      description: 'DJ system has been configured for this server.',
      fields
    });
    
    await interaction.reply({ embeds: [embed] });
  }
};

// Play command
const playCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube, Spotify, SoundCloud, etc.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song name, URL, or playlist')
        .setRequired(true)),
  
  async execute(interaction) {
    // Check if user is in voice channel
    if (!interaction.member.voice.channel) {
      const embed = embedLoader.error('You need to be in a voice channel!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check DJ permissions if DJ mode is enabled
    const djSetup = musicSystem.djSetups.get(interaction.guild.id);
    if (djSetup?.djOnlyMode && !musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('Only DJs can use music commands in this server!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check if command is in correct channel
    if (djSetup?.djChannel && interaction.channel.id !== djSetup.djChannel) {
      const embed = embedLoader.error(`Music commands can only be used in <#${djSetup.djChannel}>`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const query = interaction.options.getString('query');
    
    await interaction.deferReply();
    
    try {
      const result = await musicSystem.play(query, interaction);
      
      if (result.type === 'playlist') {
        const embed = embedLoader.createEmbed({
          title: 'Playlist Added',
          description: `Added **${result.title}** to the queue`,
          fields: [
            { name: 'Tracks', value: `${result.tracks}`, inline: true },
            { name: 'Duration', value: result.duration, inline: true }
          ]
        });
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = embedLoader.createEmbed({
          title: result.position > 0 ? 'Added to Queue' : 'Now Playing',
          description: `[${result.title}](${result.url})`,
          fields: [
            { name: 'Artist', value: result.author, inline: true },
            { name: 'Duration', value: result.duration, inline: true },
            { name: 'Position', value: result.position > 0 ? `#${result.position + 1}` : 'Now Playing', inline: true }
          ]
        });
        
        if (result.thumbnail) {
          embed.setThumbnail(result.thumbnail);
        }
        
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[Music] Play command error:', error);
      const embed = embedLoader.error(error.message || 'Failed to play the song.');
      await interaction.editReply({ embeds: [embed] });
    }
  }
};

// Skip command
const skipCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song'),
  
  async execute(interaction) {
    const queue = musicSystem.player.nodes.get(interaction.guild.id);
    
    if (!queue || !queue.isPlaying()) {
      const embed = embedLoader.error('There is no song playing!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check if user is in same voice channel
    const botVoice = interaction.guild.members.me.voice.channel;
    if (!botVoice || interaction.member.voice.channel?.id !== botVoice.id) {
      const embed = embedLoader.error('You need to be in the same voice channel as the bot!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const currentTrack = queue.currentTrack;
    const isDJ = musicSystem.hasDJPermissions(interaction.member);
    const isRequester = currentTrack.requestedBy.id === interaction.user.id;
    
    // DJs and requesters can always skip
    if (isDJ || isRequester) {
      try {
        const track = musicSystem.skip(interaction.guild.id);
        const embed = embedLoader.success(`Skipped **${track.title}**`);
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        const embed = embedLoader.error(error.message);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
      return;
    }
    
    // Handle vote skip for non-DJs
    const djSetup = musicSystem.djSetups.get(interaction.guild.id);
    if (!djSetup?.voteSkipEnabled) {
      const embed = embedLoader.error('You need DJ permissions to skip songs!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Initialize vote skip tracking
    if (!interaction.client.voteSkips) {
      interaction.client.voteSkips = new Map();
    }
    
    const guildVotes = interaction.client.voteSkips.get(interaction.guild.id) || new Set();
    
    // Add vote
    guildVotes.add(interaction.user.id);
    interaction.client.voteSkips.set(interaction.guild.id, guildVotes);
    
    // Calculate required votes
    const vcMembers = interaction.member.voice.channel.members.filter(m => !m.user.bot);
    const requiredVotes = vcMembers.size <= 2 ? 2 : Math.ceil(vcMembers.size * (djSetup.voteSkipPercentage / 100));
    
    if (guildVotes.size >= requiredVotes) {
      // Skip the song
      try {
        const track = musicSystem.skip(interaction.guild.id);
        const embed = embedLoader.success(`Vote skip successful! Skipped **${track.title}**`);
        interaction.client.voteSkips.delete(interaction.guild.id); // Clear votes
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        const embed = embedLoader.error(error.message);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    } else {
      const embed = embedLoader.info(
        `Vote skip: **${guildVotes.size}/${requiredVotes}** votes\n` +
        `You need **${requiredVotes - guildVotes.size}** more votes to skip.`
      );
      await interaction.reply({ embeds: [embed] });
    }
  }
};

// Pause command
const pauseCommand = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to pause playback!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      musicSystem.pause(interaction.guild.id);
      const embed = embedLoader.success('⏸️ Playback paused.');
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Resume command
const resumeCommand = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback'),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to resume playback!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      musicSystem.resume(interaction.guild.id);
      const embed = embedLoader.success('▶️ Playback resumed.');
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Queue command
const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the music queue')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setMinValue(1)
        .setRequired(false)),
  
  async execute(interaction) {
    const queueInfo = musicSystem.getQueue(interaction.guild.id);
    
    if (!queueInfo) {
      const embed = embedLoader.error('There is no music playing!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;
    const totalPages = Math.ceil(queueInfo.tracks.length / itemsPerPage);
    
    if (page > totalPages && totalPages > 0) {
      const embed = embedLoader.error(`Invalid page! There are only ${totalPages} pages.`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const tracks = queueInfo.tracks.slice(start, end);
    
    let description = `**Now Playing:**\n🎵 [${queueInfo.current.title}](${queueInfo.current.url}) - ${queueInfo.current.duration}\n\n`;
    
    if (tracks.length > 0) {
      description += '**Up Next:**\n';
      description += tracks.map((track, index) => {
        const position = start + index + 1;
        return `${position}. [${track.title}](${track.url}) - ${track.duration}`;
      }).join('\n');
    } else if (queueInfo.tracks.length === 0) {
      description += '*No songs in queue*';
    }
    
    const embed = embedLoader.createEmbed({
      title: 'Music Queue',
      description,
      footer: `Page ${page}/${totalPages || 1} • ${queueInfo.tracks.length} songs in queue • Volume: ${queueInfo.volume}%`
    });
    
    await interaction.reply({ embeds: [embed] });
  }
};

// Volume command
const volumeCommand = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume level (0-100)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to change volume!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      const volume = interaction.options.getInteger('level');
      musicSystem.setVolume(interaction.guild.id, volume);
      const embed = embedLoader.success(`🔊 Volume set to ${volume}%`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Loop command
const loopCommand = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Loop mode')
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Song', value: 'track' },
          { name: 'Queue', value: 'queue' },
          { name: 'Autoplay', value: 'autoplay' }
        )
        .setRequired(true)),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to change loop mode!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      const mode = interaction.options.getString('mode');
      musicSystem.setRepeatMode(interaction.guild.id, mode);
      
      const emojis = {
        'off': '➡️',
        'track': '🔂',
        'queue': '🔁',
        'autoplay': '♾️'
      };
      
      const embed = embedLoader.success(`${emojis[mode]} Loop mode set to: **${mode}**`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Shuffle command
const shuffleCommand = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queue'),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to shuffle the queue!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      musicSystem.shuffle(interaction.guild.id);
      const embed = embedLoader.success('🔀 Queue shuffled!');
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Clear command
const clearCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear the queue'),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to clear the queue!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      musicSystem.clearQueue(interaction.guild.id);
      const embed = embedLoader.success('🗑️ Queue cleared!');
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Now playing command
const nowPlayingCommand = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing song'),
  
  async execute(interaction) {
    const nowPlaying = musicSystem.getNowPlaying(interaction.guild.id);
    
    if (!nowPlaying) {
      const embed = embedLoader.error('Nothing is playing!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const { track, progress, duration, percentage, isPaused, volume, repeatMode } = nowPlaying;
    const progressBar = createProgressBar(percentage);
    
    const repeatModes = ['Off', '🔂 Song', '🔁 Queue', '♾️ Autoplay'];
    
    const embed = embedLoader.createEmbed({
      title: 'Now Playing',
      description: `[${track.title}](${track.url})\nby **${track.author}**`,
      fields: [
        { 
          name: 'Progress', 
          value: `${progressBar}\n${progress} / ${duration}`, 
          inline: false 
        },
        { name: 'Requested By', value: track.requestedBy.toString(), inline: true },
        { name: 'Volume', value: `${volume}%`, inline: true },
        { name: 'Status', value: isPaused ? '⏸️ Paused' : '▶️ Playing', inline: true },
        { name: 'Loop Mode', value: repeatModes[repeatMode], inline: true }
      ]
    });
    
    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }
    
    await interaction.reply({ embeds: [embed] });
  }
};

// Stop command
const stopCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear queue'),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to stop playback!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      musicSystem.stop(interaction.guild.id);
      const embed = embedLoader.success('⏹️ Playback stopped and queue cleared.');
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Remove command
const removeCommand = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue')
    .addIntegerOption(option =>
      option.setName('position')
        .setDescription('Position of the song to remove')
        .setMinValue(1)
        .setRequired(true)),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to remove songs!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      const position = interaction.options.getInteger('position');
      const removed = musicSystem.removeSong(interaction.guild.id, position);
      const embed = embedLoader.success(`Removed **${removed.title}** from the queue.`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// Move command
const moveCommand = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a song to a different position')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('Current position')
        .setMinValue(1)
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('New position')
        .setMinValue(1)
        .setRequired(true)),
  
  async execute(interaction) {
    if (!musicSystem.hasDJPermissions(interaction.member)) {
      const embed = embedLoader.error('You need DJ permissions to move songs!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    try {
      const from = interaction.options.getInteger('from');
      const to = interaction.options.getInteger('to');
      musicSystem.moveSong(interaction.guild.id, from, to);
      const embed = embedLoader.success(`Moved song from position ${from} to position ${to}`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      const embed = embedLoader.error(error.message);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

// DJ add command
const djAddCommand = {
  data: new SlashCommandBuilder()
    .setName('djadd')
    .setDescription('Add a user to DJ list (Administrator only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to add as DJ')
        .setRequired(true)),
  
  async execute(interaction) {
    const permCheck = permissionSystem.canExecuteCommand(interaction.member, 'djadd');
    if (!permCheck.allowed) {
      const embed = embedLoader.error(permCheck.reason || 'You need Administrator permissions to use this command.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const djSetup = musicSystem.djSetups.get(interaction.guild.id) || {};
    
    if (!djSetup.djUsers) {
      djSetup.djUsers = [];
    }
    
    if (djSetup.djUsers.includes(user.id)) {
      const embed = embedLoader.error('This user is already a DJ!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    djSetup.djUsers.push(user.id);
    musicSystem.djSetups.set(interaction.guild.id, djSetup);
    await musicSystem.saveDJSetups();
    
    const embed = embedLoader.success(`Added ${user} to DJ list.`);
    await interaction.reply({ embeds: [embed] });
  }
};

// DJ remove command
const djRemoveCommand = {
  data: new SlashCommandBuilder()
    .setName('djremove')
    .setDescription('Remove a user from DJ list (Administrator only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to remove from DJ list')
        .setRequired(true)),
  
  async execute(interaction) {
    const permCheck = permissionSystem.canExecuteCommand(interaction.member, 'djremove');
    if (!permCheck.allowed) {
      const embed = embedLoader.error(permCheck.reason || 'You need Administrator permissions to use this command.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const djSetup = musicSystem.djSetups.get(interaction.guild.id);
    
    if (!djSetup?.djUsers || !djSetup.djUsers.includes(user.id)) {
      const embed = embedLoader.error('This user is not a DJ!');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    djSetup.djUsers = djSetup.djUsers.filter(id => id !== user.id);
    musicSystem.djSetups.set(interaction.guild.id, djSetup);
    await musicSystem.saveDJSetups();
    
    const embed = embedLoader.success(`Removed ${user} from DJ list.`);
    await interaction.reply({ embeds: [embed] });
  }
};

// Helper function to create progress bar
function createProgressBar(percentage, length = 20) {
  const progress = Math.round((percentage / 100) * length);
  const emptyProgress = length - progress;
  
  const progressText = '▰'.repeat(progress) + '▱'.repeat(emptyProgress);
  return progressText;
}

// Export all commands
export const commands = [
  setupDJCommand,
  playCommand,
  skipCommand,
  pauseCommand,
  resumeCommand,
  queueCommand,
  volumeCommand,
  loopCommand,
  shuffleCommand,
  clearCommand,
  nowPlayingCommand,
  stopCommand,
  removeCommand,
  moveCommand,
  djAddCommand,
  djRemoveCommand
];