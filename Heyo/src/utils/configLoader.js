// src/utils/configLoader.js
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = {};
    this.defaults = this.getDefaultConfig();
    
    // Load config on initialization
    this.load();
  }

  /**
   * Get default configuration
   * @returns {Object}
   */
  getDefaultConfig() {
    return {
      token: '',
      prefix: '',
      logging: {
        level: 'info'
      },
      bot: {
        name: '',
        avatar: 'https://example.com/avatar.png',
        status: {
          type: 'PLAYING',
          text: 'with commands',
          url: null
        },
        bio: "I'm a multi-purpose Discord bot!"
      },
      developmentGuildId: null,
      
      // Queue System
      queue: {
        maxSize: 100,
        workerCount: 3,
        retryDelaySeconds: 5
      },
      
      // Rate Limiting
      rateLimit: {
        windowMs: 60000,
        limits: {
          serverOwner: 0,
          administrator: 0,
          default: 5
        },
        customRoles: null,
        message: 'You\'re sending commands too quickly! Please wait {time} seconds.'
      },
      
      // Moderation System
      moderation: {
        ownerBypass: true,
        permissions: {
          administrator: {
            users: [],
            roles: [],
            commands: [
              'ban', 'unban', 'kick', 'timeout', 'mute', 'unmute', 'role', 'nuke',
              'setupperms', 'forcenickname', 'unforcenickname', 'purge',
              'createchannel', 'deletechannel', 'restoreroles'
            ]
          },
          moderator: {
            users: [],
            roles: [],
            commands: [
              'lockchannel', 'unlockchannel', 'timeout', 'mute', 'unmute', 'purge'
            ]
          }
        },
        permRoles: {
          vc: null,
          pic: null,
          link: null
        },
        logChannel: null,
        cooldowns: {
          default: 3,
          nuke: 30,
          setupperms: 60,
          forcenickname: 5,
          unforcenickname: 5,
          mute: 5,
          unmute: 5,
          purge: 10,
          createchannel: 10,
          deletechannel: 15,
          restoreroles: 10
        },
        forcedNicknames: {
          dataFile: 'forced_nicknames.json',
          checkInterval: 5000,
          roleId: null
        },
        permMuteRole: {
          roleId: null,
          defaultName: 'Muted',
          defaultColor: 0x808080
        }
      },
      
      // AFK System
      afk: {
        enabled: true,
        dataFile: 'afk_data.json',
        embedColor: 0x808080,
        removeOnMessage: true,
        mentionResponse: {
          showTimestamp: true,
          showReason: true
        }
      },
      
      // Link Protection
      linkProtection: {
        enabled: true,
        patterns: [
          'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)',
          'discord\\.gg\\/[a-zA-Z0-9]+',
          'discordapp\\.com\\/invite\\/[a-zA-Z0-9]+'
        ],
        allowed: {
          users: [],
          roles: [],
          useLinkPermRole: true
        },
        exemptChannels: [],
        logChannel: null,
        deleteMessage: true,
        warningMessage: '❌ You do not have permission to send links in this channel.',
        ephemeralWarning: true
      },
      
      // Vanity System
      vanity: {
        enabled: false,
        checkIntervalSeconds: 1800,
        vanityStrings: [],
        roles: [],
        logChannel: null,
        enableLogging: false,
        caseSensitive: false,
        checkUsername: true,
        checkNickname: true,
        checkBio: true,
        checkStatus: true,
        exemptRoles: [],
        removeOnVanityLoss: true
      },
      
      // Anti-Nuke
      antiNuke: {
        whitelist: {
          users: [],
          roles: []
        },
        adminUsers: [],
        adminRoles: [],
        limits: {
          commands: {
            maxActions: 5,
            timeWindowSeconds: 60
          },
          bans: {
            maxActions: 3,
            timeWindowSeconds: 120
          },
          kicks: {
            maxActions: 5,
            timeWindowSeconds: 120
          },
          messages: {
            maxMessages: 1,
            timeWindowSeconds: 10,
            timeoutDuration: '60s'
          },
          channelCreate: {
            maxActions: 3,
            timeWindowSeconds: 60
          },
          channelDelete: {
            maxActions: 2,
            timeWindowSeconds: 60
          },
          roleCreate: {
            maxActions: 3,
            timeWindowSeconds: 60
          },
          roleDelete: {
            maxActions: 2,
            timeWindowSeconds: 60
          }
        },
        adminLogChannel: null,
        abuseLogChannel: null
      },
      
      // Join to Create
      j2c: {
        defaultChannelName: '➕ Create Voice Channel',
        logChannel: null,
        categoryId: null,
        j2cChannelId: null
      },
      
      // Welcome System
      welcome: {
        enabled: false,
        channel: null,
        message: {
          title: 'Welcome!',
          description: 'Welcome {user} to **{server}**!\\n\\nYou are member #{memberCount}',
          color: 0x00ff00,
          thumbnail: true,
          footer: 'Enjoy your stay!',
          timestamp: true
        },
        dmEnabled: false,
        dmMessage: {
          title: 'Welcome to {server}!',
          description: 'Welcome {user}! We\'re glad to have you here.',
          color: 0x00ff00,
          footer: 'Have a great time!',
          timestamp: true
        },
        roleOnJoin: null,
        pingUser: false,
        deleteAfter: null
      },
      
      // Role Tracker
      roleTracker: {
        enabled: true,
        dataFile: 'role_history.json',
        maxHistoryPerUser: 10,
        trackBots: false,
        exemptRoles: [],
        logChannel: null
      },
      
      // Leaderboard System
      leaderboard: {
        enabled: true,
        trackMessages: true,
        trackVoice: true,
        dataFile: 'leaderboard_data.json',
        resetSchedule: {
          weekly: 'Monday',
          monthly: 1
        },
        minimumVCTime: 60,
        excludedChannels: [],
        excludedRoles: [],
        trackBots: false
      },
      
      // Event Hosting System
      events: {
        enabled: true,
        dataFile: 'events_data.json',
        announcementChannel: null,
        logChannel: null,
        pingRole: null,
        dmWinners: true,
        enableLogging: true,
        lastToLeave: {
          defaultCountdownMinutes: 5,
          defaultDurationMinutes: 60,
          maxCountdownMinutes: 60,
          maxDurationMinutes: 1440
        }
      },
      
      // Booster System
      boosterSystem: {
        enabled: true,
        dataFile: 'booster_data.json',
        boostMessageChannel: null,
        vcNameFormat: '{username}\'s Channel',
        vcUserLimit: 10,
        vcBitrate: 64000,
        vcCategory: null,
        roleNameFormat: '{username}\'s Role',
        roleColor: 'Random',
        rolePosition: null,
        roleHoist: false,
        roleMentionable: false,
        checkInterval: 86400000,
        logChannel: null,
        enableLogging: true
      },
      
      // Ticket System
      ticketSystem: {
        enabled: true,
        dataFile: 'ticket_data.json',
        maxTicketsPerUser: 1,
        cooldown: 10000, // 10 seconds
        channelNameFormat: 'ticket-{number}-{username}',
        welcomeMessage: 'Thank you for creating a ticket! A staff member will be with you shortly.',
        categories: [
          {
            id: 'general',
            name: 'General Support',
            description: 'General questions and support',
            emoji: '❓',
            supportRole: null,
            categoryId: null, // Discord category ID
            welcomeMessage: null, // Override default
            color: 0x0099ff
          }
        ],
        panelEmbed: {
          title: '🎫 Support Tickets',
          description: 'Need help? Create a ticket by clicking the button below!',
          color: 0x0099ff,
          footer: 'We typically respond within 24 hours',
          buttonLabel: 'Create Ticket',
          buttonEmoji: '🎫'
        },
        autoDelete: {
          enabled: true,
          timeout: 300000 // 5 minutes after closing
        },
        transcriptChannel: null,
        logChannel: null,
        enableLogging: true,
        stats: {
          totalTickets: 0,
          totalClosed: 0,
          averageResponseTime: 0
        }
      },
      
      // Filter System
      filter: {
        enabled: true,
        dataFile: 'filter_data.json',
        wordFilter: {
          enabled: true,
          defaultWords: [
            'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kys'
          ],
          customWords: [],
          exemptRoles: [],
          exemptChannels: [],
          action: 'delete',
          timeoutDuration: 300,
          warningMessage: '⚠️ Your message contains prohibited words.',
          caseSensitive: false,
          checkVariations: true
        },
        imageFilter: {
          enabled: false,
          nsfwThreshold: 0.7,
          exemptRoles: [],
          exemptChannels: [],
          nsfwChannels: [],
          action: 'delete',
          warningMessage: '⚠️ Your image appears to contain NSFW content.',
          apiUrl: null,
          maxFileSize: 8388608
        },
        logChannel: null,
        enableLogging: true,
        trackStats: true
      },
      
      // Ticket System
      ticketSystem: {
        enabled: true,
        dataFile: 'ticket_data.json',
        maxTicketsPerUser: 1,
        cooldown: 10000, // 10 seconds
        channelNameFormat: 'ticket-{number}-{username}',
        welcomeMessage: 'Thank you for creating a ticket! A staff member will be with you shortly.',
        categories: [
          {
            id: 'general',
            name: 'General Support',
            description: 'General questions and support',
            emoji: '❓',
            supportRole: null,
            categoryId: null, // Discord category ID
            welcomeMessage: null, // Override default
            color: 0x0099ff
          }
        ],
        panelEmbed: {
          title: '🎫 Support Tickets',
          description: 'Need help? Create a ticket by clicking the button below!',
          color: 0x0099ff,
          footer: 'We typically respond within 24 hours',
          buttonLabel: 'Create Ticket',
          buttonEmoji: '🎫'
        },
        autoDelete: {
          enabled: true,
          timeout: 300000 // 5 minutes after closing
        },
        transcriptChannel: null,
        logChannel: null,
        enableLogging: true,
        stats: {
          totalTickets: 0,
          totalClosed: 0,
          averageResponseTime: 0
        }
      }
    };
  }

  /**
   * Deep merge two objects
   * @param {Object} target 
   * @param {Object} source 
   * @returns {Object}
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          output[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          output[key] = source[key];
        }
      }
    }
    
    return output;
  }

  /**
   * Load configuration from file
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = YAML.parse(fileContent) || {};
        
        // Merge loaded config with defaults
        this.config = this.deepMerge(this.defaults, loadedConfig);
        
        console.log('[ConfigLoader] Configuration loaded successfully');
      } else {
        console.warn('[ConfigLoader] Config file not found, using defaults');
        this.config = { ...this.defaults };
        
        // Create config file with defaults
        this.save();
      }
    } catch (error) {
      console.error('[ConfigLoader] Error loading config:', error);
      this.config = { ...this.defaults };
    }
  }

  /**
   * Save configuration to file
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const yamlStr = YAML.stringify(this.config, {
        indent: 2,
        lineWidth: 0,
        defaultStringType: 'PLAIN',
        defaultKeyType: 'PLAIN'
      });
      
      fs.writeFileSync(this.configPath, yamlStr);
      console.log('[ConfigLoader] Configuration saved successfully');
    } catch (error) {
      console.error('[ConfigLoader] Error saving config:', error);
    }
  }

  /**
   * Get configuration value
   * @param {string} path - Dot notation path (e.g., 'moderation.logChannel')
   * @returns {*}
   */
  get(path) {
    if (!path) return this.config;
    
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  /**
   * Set configuration value
   * @param {string} path - Dot notation path
   * @param {*} value 
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    
    let current = this.config;
    for (const key of keys) {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  /**
   * Reload configuration from file
   */
  reload() {
    this.load();
  }

  /**
   * Validate configuration
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate() {
    const errors = [];
    
    // Check required fields
    if (!this.config.token) {
      errors.push('Missing required field: token');
    }
    
    // Validate types
    if (typeof this.config.developmentGuildId !== 'string' && this.config.developmentGuildId !== null) {
      errors.push('developmentGuildId must be a string or null');
    }
    
    // Add more validation as needed
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}