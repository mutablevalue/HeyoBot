// src/systems/musicSystem.js
import { Player, QueryType, QueueRepeatMode } from 'discord-player';
import { Collection } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MusicSystem {
  constructor(client, config) {
    this.client = client;
    this.config = config.get('music');
    this.fullConfig = config;
    this.embedLoader = null;
    this.permissionSystem = null;
    
    // Validate required config
    if (!this.config) {
      throw new Error('[MusicSystem] No music configuration found in config');
    }
    
    // Initialize discord-player
    this.player = new Player(client);
    
    // Configure player settings
    this.player.options = {
      autoRegisterExtractor: true,
      ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        filter: 'audioonly'
      },
      connectionTimeout: 30000,
      smoothVolume: true,
      initialVolume: this.config.defaultVolume || 80
    };
    
    // Initialize player events BEFORE loading extractors
    this.initializePlayerEvents();
    
    // Load extractors - THIS IS CRITICAL!
    this.loadExtractors();
    
    // DJ setups
    this.djSetups = new Map();
    this.loadDJSetups();
    
    console.log('[MusicSystem] Initialized with discord-player v6');
  }
  
  /**
   * Load extractors - CRITICAL FOR MUSIC TO WORK
   */
  async loadExtractors() {
    try {
      console.log('[MusicSystem] Loading extractors...');
      
      // Register extractors using the built-in method
      await this.player.extractors.loadDefault();
      
      // Log loaded extractors
      const extractors = this.player.extractors.store;
      console.log(`[MusicSystem] Loaded ${extractors.size} extractors:`, [...extractors.keys()]);
      
      // Alternative method if loadDefault doesn't work
      if (extractors.size === 0) {
        console.log('[MusicSystem] No extractors loaded, trying alternative method...');
        
        // Try registering individual extractors
        await this.player.extractors.register('@discord-player/extractor', {
          protocols: ['ytsearch', 'youtube'],
          validate: () => true
        });
      }
      
      console.log('[MusicSystem] Extractors loaded successfully');
    } catch (error) {
      console.error('[MusicSystem] Failed to load extractors:', error);
      console.error('[MusicSystem] Music playback will NOT work without extractors!');
      
      // Try one more fallback
      try {
        console.log('[MusicSystem] Attempting final fallback...');
        // Force load the built-in YouTube extractor
        const { YouTubeExtractor } = await import('@discord-player/extractor');
        await this.player.extractors.register(YouTubeExtractor, {});
        console.log('[MusicSystem] YouTube extractor loaded via fallback');
      } catch (fallbackError) {
        console.error('[MusicSystem] All extractor loading methods failed:', fallbackError);
      }
    }
  }
  
  setEmbedLoader(loader) {
    this.embedLoader = loader;
  }
  
  setPermissionSystem(system) {
    this.permissionSystem = system;
  }
  
  /**
   * Initialize player events
   */
  initializePlayerEvents() {
    // When a track starts playing
    this.player.events.on('playerStart', (queue, track) => {
      console.log(`[MusicSystem] Now playing: ${track.title}`);
      
      if (!this.embedLoader) return;
      
      const embed = this.embedLoader.createEmbed({
        title: 'Now Playing',
        description: `[${track.title}](${track.url})`,
        fields: [
          { name: 'Artist', value: track.author || 'Unknown', inline: true },
          { name: 'Duration', value: track.duration || 'Unknown', inline: true },
          { name: 'Requested By', value: track.requestedBy.toString(), inline: true }
        ],
        footer: `Queue: ${queue.tracks.size + 1} songs • Volume: ${queue.node.volume}%`
      });
      
      if (track.thumbnail) {
        embed.setThumbnail(track.thumbnail);
      }
      
      queue.metadata.channel.send({ embeds: [embed] }).catch(console.error);
    });
    
    // When the queue is empty
    this.player.events.on('emptyQueue', (queue) => {
      console.log(`[MusicSystem] Queue empty for guild: ${queue.guild.id}`);
      
      if (!this.embedLoader) return;
      
      const embed = this.embedLoader.info('Queue finished! No more songs to play.');
      queue.metadata.channel.send({ embeds: [embed] }).catch(console.error);
    });
    
    // When there's an error
    this.player.events.on('error', (queue, error) => {
      console.error(`[MusicSystem] Queue error:`, error);
      
      if (!this.embedLoader) return;
      
      const embed = this.embedLoader.error(
        `An error occurred: ${error.message}`
      );
      queue.metadata.channel.send({ embeds: [embed] }).catch(console.error);
    });
    
    // When a track fails to load
    this.player.events.on('playerError', (queue, error, track) => {
      console.error(`[MusicSystem] Player error:`, error);
      
      if (!this.embedLoader) return;
      
      const embed = this.embedLoader.error(
        `Failed to play **${track.title}**\n` +
        `This track may be unavailable or region-restricted.`
      );
      queue.metadata.channel.send({ embeds: [embed] }).catch(console.error);
    });
    
    // Connection events
    this.player.events.on('connectionCreate', (queue) => {
      console.log(`[MusicSystem] Connection created for guild: ${queue.guild.id}`);
    });
    
    this.player.events.on('connectionError', (queue, error) => {
      console.error(`[MusicSystem] Connection error:`, error);
      
      if (!this.embedLoader) return;
      
      const embed = this.embedLoader.error(
        `Failed to connect to voice channel.\n` +
        `Error: ${error.message}`
      );
      queue.metadata.channel.send({ embeds: [embed] }).catch(console.error);
    });
    
    // Debug events
    this.player.on('debug', (message) => {
      if (process.env.DEBUG) {
        console.log(`[MusicSystem Debug] ${message}`);
      }
    });
    
    this.player.events.on('debug', (queue, message) => {
      if (process.env.DEBUG) {
        console.log(`[MusicSystem Queue Debug] ${message}`);
      }
    });
    
    // Add extractor events
    this.player.extractors.on('extractorLoaded', (extractor) => {
      console.log(`[MusicSystem] Extractor loaded: ${extractor.identifier}`);
    });
  }
  
  /**
   * Check if user has DJ permissions
   */
  hasDJPermissions(member) {
    // Check permission system first
    if (this.permissionSystem) {
      const permLevel = this.permissionSystem.getPermissionLevel(member);
      if (permLevel >= this.permissionSystem.LEVELS.MODERATOR) {
        return true;
      }
    }
    
    // Check if user has VC perm role
    const moderationConfig = this.fullConfig.get('moderation');
    if (moderationConfig?.permRoles?.vc) {
      if (member.roles.cache.has(moderationConfig.permRoles.vc)) {
        return true;
      }
    }
    
    // Check DJ setup for guild
    const djSetup = this.djSetups.get(member.guild.id);
    if (!djSetup) return false;
    
    // Check DJ role
    if (djSetup.djRoleId && member.roles.cache.has(djSetup.djRoleId)) {
      return true;
    }
    
    // Check DJ users
    if (djSetup.djUsers?.includes(member.id)) {
      return true;
    }
    
    // Check if user is alone in voice channel
    if (djSetup.allowAloneDJ && member.voice.channel) {
      const vcMembers = member.voice.channel.members.filter(m => !m.user.bot);
      if (vcMembers.size === 1) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Setup DJ configuration for guild
   */
  async setupDJ(guildId, settings) {
    this.djSetups.set(guildId, {
      enabled: true,
      djRoleId: settings.djRoleId || null,
      djUsers: settings.djUsers || [],
      djChannel: settings.djChannel || null,
      djOnlyMode: settings.djOnlyMode || false,
      allowAloneDJ: settings.allowAloneDJ !== false,
      voteSkipEnabled: settings.voteSkipEnabled !== false,
      voteSkipPercentage: settings.voteSkipPercentage || this.config.voteSkipPercentage || 50
    });
    
    await this.saveDJSetups();
    return true;
  }
  
  /**
   * Search and play music
   */
  async play(query, interaction) {
    const { member, guild, channel } = interaction;
    
    // Check if user is in voice channel
    if (!member.voice.channel) {
      throw new Error('You need to be in a voice channel!');
    }
    
    // Check voice channel permissions
    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      throw new Error('I need Connect and Speak permissions in your voice channel!');
    }
    
    // Log extractor status before searching
    console.log(`[MusicSystem] Current extractors: ${this.player.extractors.store.size}`);
    if (this.player.extractors.store.size === 0) {
      console.error('[MusicSystem] WARNING: No extractors loaded! Attempting to reload...');
      await this.loadExtractors();
    }
    
    // Search for tracks first (before creating queue)
    console.log(`[MusicSystem] Searching for: ${query}`);
    
    let searchResult;
    try {
      // Try different search methods based on the query
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        // Direct YouTube URL
        searchResult = await this.player.search(query, {
          requestedBy: member.user,
          searchEngine: QueryType.YOUTUBE_VIDEO
        });
      } else if (query.includes('spotify.com')) {
        // Spotify URL
        searchResult = await this.player.search(query, {
          requestedBy: member.user,
          searchEngine: QueryType.SPOTIFY_SONG
        });
      } else {
        // General search
        searchResult = await this.player.search(query, {
          requestedBy: member.user,
          searchEngine: QueryType.YOUTUBE_SEARCH
        });
      }
      
      console.log(`[MusicSystem] Search completed:`, {
        hasTracks: searchResult.hasTracks(),
        tracksCount: searchResult.tracks.length,
        playlist: searchResult.playlist ? searchResult.playlist.title : null
      });
    } catch (error) {
      console.error('[MusicSystem] Search error:', error);
      
      // Try AUTO search as fallback
      try {
        searchResult = await this.player.search(query, {
          requestedBy: member.user,
          searchEngine: QueryType.AUTO
        });
      } catch (fallbackError) {
        console.error('[MusicSystem] Fallback search also failed:', fallbackError);
        throw new Error('Failed to search for tracks. Make sure the bot has proper YouTube access.');
      }
    }
    
    if (!searchResult || !searchResult.hasTracks()) {
      throw new Error('No results found! Try a different search query or use a direct YouTube link.');
    }
    
    // Now create/get queue
    let queue = this.player.nodes.get(guild.id);
    
    if (!queue) {
      queue = this.player.nodes.create(guild, {
        metadata: {
          channel: channel,
          requestedBy: member.user
        },
        selfDeaf: true,
        volume: this.config.defaultVolume || 80,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 300000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 300000,
        bufferingTimeout: 30000,
        connectionTimeout: 30000,
        autoSelfDeaf: true,
        spotifyBridge: true,
        ytdlOptions: {
          quality: 'highestaudio',
          filter: 'audioonly',
          highWaterMark: 1 << 30,
          dlChunkSize: 0
        }
      });
    }
    
    // Connect to voice channel if not connected
    try {
      if (!queue.connection) {
        await queue.connect(member.voice.channel);
        console.log(`[MusicSystem] Connected to voice channel: ${member.voice.channel.name}`);
      }
    } catch (error) {
      console.error('[MusicSystem] Connection error:', error);
      this.player.nodes.delete(guild.id);
      throw new Error('Could not join voice channel! Please check my permissions.');
    }
    
    // Add tracks to queue
    try {
      if (searchResult.playlist) {
        queue.addTrack(searchResult.tracks);
        console.log(`[MusicSystem] Added playlist: ${searchResult.playlist.title} (${searchResult.tracks.length} tracks)`);
        
        if (!queue.isPlaying()) {
          await queue.node.play();
        }
        
        return {
          type: 'playlist',
          title: searchResult.playlist.title,
          tracks: searchResult.tracks.length,
          duration: searchResult.playlist.durationFormatted || 'Unknown'
        };
      } else {
        const track = searchResult.tracks[0];
        queue.addTrack(track);
        console.log(`[MusicSystem] Added track: ${track.title}`);
        
        if (!queue.isPlaying()) {
          await queue.node.play();
        }
        
        return {
          type: 'track',
          title: track.title,
          author: track.author || 'Unknown',
          duration: track.duration || 'Unknown',
          url: track.url,
          thumbnail: track.thumbnail,
          position: queue.tracks.size
        };
      }
    } catch (error) {
      console.error('[MusicSystem] Failed to add/play track:', error);
      throw new Error('Failed to play the track. Please try again.');
    }
  }
  
  /**
   * Skip current song
   */
  skip(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue || !queue.isPlaying()) {
      throw new Error('No music is playing!');
    }
    
    const currentTrack = queue.currentTrack;
    queue.node.skip();
    
    return currentTrack;
  }
  
  /**
   * Pause playback
   */
  pause(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue || !queue.isPlaying()) {
      throw new Error('No music is playing!');
    }
    
    queue.node.pause();
    return true;
  }
  
  /**
   * Resume playback
   */
  resume(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    queue.node.resume();
    return true;
  }
  
  /**
   * Set volume
   */
  setVolume(guildId, volume) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    queue.node.setVolume(volume);
    return true;
  }
  
  /**
   * Get queue
   */
  getQueue(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue || !queue.isPlaying()) {
      return null;
    }
    
    return {
      current: queue.currentTrack,
      tracks: queue.tracks.toArray(),
      volume: queue.node.volume,
      repeatMode: queue.repeatMode,
      isPlaying: queue.isPlaying(),
      isPaused: queue.node.isPaused()
    };
  }
  
  /**
   * Clear queue
   */
  clearQueue(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    queue.tracks.clear();
    return true;
  }
  
  /**
   * Shuffle queue
   */
  shuffle(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    queue.tracks.shuffle();
    return true;
  }
  
  /**
   * Set repeat mode
   */
  setRepeatMode(guildId, mode) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    // Map string modes to QueueRepeatMode enum
    const modes = {
      'off': QueueRepeatMode.OFF,
      'track': QueueRepeatMode.TRACK,
      'queue': QueueRepeatMode.QUEUE,
      'autoplay': QueueRepeatMode.AUTOPLAY
    };
    
    queue.setRepeatMode(modes[mode] || QueueRepeatMode.OFF);
    return true;
  }
  
  /**
   * Stop playback and clear queue
   */
  stop(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    queue.delete();
    return true;
  }
  
  /**
   * Get now playing info
   */
  getNowPlaying(guildId) {
    const queue = this.player.nodes.get(guildId);
    if (!queue || !queue.isPlaying()) {
      return null;
    }
    
    const track = queue.currentTrack;
    const progress = queue.node.getTimestamp();
    
    return {
      track,
      progress: progress?.current?.value || '0:00',
      duration: progress?.total?.value || track.duration,
      percentage: progress?.progress || 0,
      isPaused: queue.node.isPaused(),
      volume: queue.node.volume,
      repeatMode: queue.repeatMode
    };
  }
  
  /**
   * Remove song from queue
   */
  removeSong(guildId, position) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    const tracks = queue.tracks.toArray();
    if (position < 1 || position > tracks.length) {
      throw new Error('Invalid position!');
    }
    
    const removed = tracks[position - 1];
    queue.node.remove(removed);
    
    return removed;
  }
  
  /**
   * Move song in queue
   */
  moveSong(guildId, from, to) {
    const queue = this.player.nodes.get(guildId);
    if (!queue) {
      throw new Error('No music queue!');
    }
    
    const tracks = queue.tracks.toArray();
    if (from < 1 || from > tracks.length || to < 1 || to > tracks.length) {
      throw new Error('Invalid positions!');
    }
    
    queue.node.move(tracks[from - 1], to - 1);
    return true;
  }
  
  /**
   * Load DJ setups
   */
  async loadDJSetups() {
    try {
      const dataFile = this.config.djDataFile;
      if (!dataFile) return;
      
      const filePath = path.join(__dirname, '../../data', dataFile);
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.djSetups = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[MusicSystem] Error loading DJ setups:', error);
      }
    }
  }
  
  /**
   * Save DJ setups
   */
  async saveDJSetups() {
    try {
      const dataFile = this.config.djDataFile;
      if (!dataFile) return;
      
      const dirPath = path.join(__dirname, '../../data');
      await fs.mkdir(dirPath, { recursive: true });
      
      const filePath = path.join(dirPath, dataFile);
      const data = Object.fromEntries(this.djSetups);
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[MusicSystem] Error saving DJ setups:', error);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const queues = [...this.player.nodes.cache.values()];
    const activeQueues = queues.filter(q => q.isPlaying()).length;
    const totalTracks = queues.reduce((acc, q) => acc + q.tracks.size, 0);
    
    return {
      activeQueues,
      totalQueues: queues.length,
      totalTracks,
      djSetups: this.djSetups.size,
      extractors: this.player.extractors.store.size
    };
  }
  
  /**
   * Clean up
   */
  async cleanup() {
    // Discord-player v6 handles cleanup automatically
    // Just log the cleanup
    console.log('[MusicSystem] Cleanup called');
  }
}