// src/systems/entranceSystem.js
import { 
  EmbedBuilder, 
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class EntranceSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get entrance config from config loader
    this.config = this.configLoader.get('entrance') || {};
    
    // Initialize default config
    this.initializeDefaultConfig();
    
    // Active entrance instances
    this.instances = new Map(); // guildId -> instance data
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile || 'entrance.json');
    this.loadEntranceData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Initialize default configuration
   */
  initializeDefaultConfig() {
    const defaults = {
      enabled: false,
      dataFile: 'entrance.json',
      defaultRoleName: 'Verified',
      defaultEmoji: '✅',
      defaultWelcomeMessage: 'Welcome to the server! You now have access to all channels.',
      dmWelcome: true,
      removeReactionAfterVerify: true,
      logVerifications: true,
      stats: {
        totalVerified: 0,
        totalUnverified: 0
      }
    };

    this.config = { ...defaults, ...this.config };
  }

  /**
   * Load entrance data from file
   */
  loadEntranceData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.instances) {
          this.instances = new Map(Object.entries(data.instances));
        }
        
        if (data.stats) {
          this.config.stats = { ...this.config.stats, ...data.stats };
        }
        
        console.log(`[EntranceSystem] Loaded ${this.instances.size} entrance instances`);
      }
    } catch (error) {
      console.error('[EntranceSystem] Error loading entrance data:', error);
    }
  }

  /**
   * Save entrance data to file
   */
  saveEntranceData() {
    try {
      const data = {
        instances: Object.fromEntries(this.instances),
        stats: this.config.stats
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[EntranceSystem] Error saving entrance data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Handle reaction add
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      // Handle partial reactions
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          console.error('[EntranceSystem] Error fetching reaction:', error);
          return;
        }
      }
      
      await this.handleReactionAdd(reaction, user);
    });

    // Handle reaction remove (for unverifying)
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          return;
        }
      }
      
      await this.handleReactionRemove(reaction, user);
    });

    // Clean up on guild member remove
    this.client.on('guildMemberRemove', async (member) => {
      const instance = this.instances.get(member.guild.id);
      if (!instance) return;

      // Remove user from verified list if they leave
      const index = instance.verifiedUsers.indexOf(member.id);
      if (index > -1) {
        instance.verifiedUsers.splice(index, 1);
        this.saveEntranceData();
      }
    });
  }

  /**
   * Setup entrance instance
   * @param {import("discord.js").Guild} guild
   * @param {string} messageId
   * @param {string} emoji
   * @param {Object} options
   */
  async setupInstance(guild, messageId, emoji, options = {}) {
    try {
      // Find the message
      let message = null;
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;
        
        try {
          message = await channel.messages.fetch(messageId);
          if (message) break;
        } catch (error) {
          continue;
        }
      }

      if (!message) {
        throw new Error('Message not found');
      }

      // React to the message
      await message.react(emoji);

      // Save instance data
      const instanceData = {
        guildId: guild.id,
        messageId: messageId,
        channelId: message.channel.id,
        emoji: emoji,
        roleId: options.roleId,
        logChannel: options.logChannel,
        welcomeMessage: options.welcomeMessage || this.config.defaultWelcomeMessage,
        dmWelcome: options.dmWelcome ?? this.config.dmWelcome,
        removeReaction: options.removeReaction ?? this.config.removeReactionAfterVerify,
        exemptRoles: options.exemptRoles || [],
        exemptChannels: options.exemptChannels || [],
        allowUnverify: options.allowUnverify || false,
        verifiedUsers: [],
        createdAt: new Date().toISOString(),
        createdBy: options.createdBy
      };

      this.instances.set(guild.id, instanceData);
      this.saveEntranceData();

      return { success: true, channel: message.channel };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Setup entrance role with permissions
   * @param {import("discord.js").Guild} guild
   * @param {Object} options
   */
  async setupRole(guild, options = {}) {
    try {
      // Create or get the role
      let role;
      if (options.roleId) {
        role = guild.roles.cache.get(options.roleId);
        if (!role) throw new Error('Role not found');
      } else {
        // Create new role
        role = await guild.roles.create({
          name: options.roleName || this.config.defaultRoleName,
          color: options.roleColor || 0x00ff00,
          hoist: options.roleHoist || false,
          mentionable: false,
          reason: 'Entrance system verification role'
        });
      }

      // Get exempt roles and channels
      const exemptRoles = options.exemptRoles || [];
      const exemptChannels = options.exemptChannels || [];
      const verifyChannel = options.verifyChannel;

      // Track changes
      const changes = {
        hiddenChannels: 0,
        exemptedChannels: 0,
        errors: []
      };

      // Update all channels
      for (const channel of guild.channels.cache.values()) {
        try {
          // Skip exempt channels
          if (exemptChannels.includes(channel.id)) {
            changes.exemptedChannels++;
            continue;
          }

          // Skip verify channel - everyone can see it
          if (channel.id === verifyChannel) {
            // Ensure @everyone can see verify channel
            await channel.permissionOverwrites.edit(guild.id, {
              ViewChannel: true
            });
            continue;
          }

          // Hide channel from @everyone
          await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: false
          });

          // Allow verified role to see channel
          await channel.permissionOverwrites.edit(role.id, {
            ViewChannel: true
          });

          // Ensure exempt roles can see channel
          for (const exemptRoleId of exemptRoles) {
            const exemptRole = guild.roles.cache.get(exemptRoleId);
            if (exemptRole) {
              await channel.permissionOverwrites.edit(exemptRoleId, {
                ViewChannel: true
              });
            }
          }

          changes.hiddenChannels++;
        } catch (error) {
          changes.errors.push(`${channel.name}: ${error.message}`);
        }
      }

      // Update instance with role ID if exists
      const instance = this.instances.get(guild.id);
      if (instance) {
        instance.roleId = role.id;
        instance.exemptRoles = exemptRoles;
        instance.exemptChannels = exemptChannels;
        this.saveEntranceData();
      }

      return {
        role,
        changes
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle reaction add
   * @param {import("discord.js").MessageReaction} reaction
   * @param {import("discord.js").User} user
   */
  async handleReactionAdd(reaction, user) {
    
    const instance = this.instances.get(reaction.message.guild.id);
    if (!instance) {
      //console.log(`[EntranceSystem] No instance found for guild ${reaction.message.guild.id}`);
      return;
    }

    // Check if it's the correct message and emoji
    if (reaction.message.id !== instance.messageId) {
      //console.log(`[EntranceSystem] Wrong message ID. Expected: ${instance.messageId}, Got: ${reaction.message.id}`);
      return;
    }
    
    if (reaction.emoji.toString() !== instance.emoji) {
      //console.log(`[EntranceSystem] Wrong emoji. Expected: ${instance.emoji}, Got: ${reaction.emoji.toString()}`);
      return;
    }

    if (!instance.roleId) {
      console.error(`[EntranceSystem] No roleId set for entrance instance!`);
      return;
    }

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch((err) => {
      console.error(`[EntranceSystem] Failed to fetch member ${user.id}:`, err);
      return null;
    });
    
    if (!member) return;

    // Check if already verified
    if (member.roles.cache.has(instance.roleId)) {
      console.log(`[EntranceSystem] User ${user.tag} already has the role`);
      if (instance.removeReaction) {
        await reaction.users.remove(user.id).catch(() => {});
      }
      return;
    }

    try {
      // Add role
      await member.roles.add(instance.roleId);
      console.log(`[EntranceSystem] Successfully added role to ${user.tag}`);
      
      // Add to verified users
      if (!instance.verifiedUsers.includes(user.id)) {
        instance.verifiedUsers.push(user.id);
      }

      // Update stats
      this.config.stats.totalVerified++;
      this.saveEntranceData();

      // Send welcome message
      if (instance.dmWelcome) {
        try {
          const embed = new EmbedBuilder()
            .setTitle('✅ Verified!')
            .setDescription(instance.welcomeMessage)
            .setColor(0x00ff00)
            .setTimestamp();

          await user.send({ embeds: [embed] });
        } catch (error) {
          console.log(`[EntranceSystem] Could not DM ${user.tag} - DMs likely disabled`);
        }
      }

      // Remove reaction if configured
      if (instance.removeReaction) {
        await reaction.users.remove(user.id).catch(() => {});
      }

      // Log verification
      if (this.config.logVerifications && instance.logChannel) {
        await this.logAction(guild, {
          action: 'User Verified',
          user: user,
          member: member,
          channelId: instance.logChannel
        });
      }
    } catch (error) {
      console.error('[EntranceSystem] Error verifying user:', error);
      console.error('Error details:', {
        roleId: instance.roleId,
        userId: user.id,
        guildId: guild.id,
        botPermissions: guild.members.me.permissions.toArray()
      });
    }
  }

  /**
   * Handle reaction remove (unverify)
   * @param {import("discord.js").MessageReaction} reaction
   * @param {import("discord.js").User} user
   */
  async handleReactionRemove(reaction, user) {
    const instance = this.instances.get(reaction.message.guild.id);
    if (!instance || !instance.allowUnverify) return;

    // Check if it's the correct message and emoji
    if (reaction.message.id !== instance.messageId || 
        reaction.emoji.toString() !== instance.emoji) {
      return;
    }

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    // Check if has role
    if (!member.roles.cache.has(instance.roleId)) return;

    try {
      // Remove role
      await member.roles.remove(instance.roleId);
      
      // Remove from verified users
      const index = instance.verifiedUsers.indexOf(user.id);
      if (index > -1) {
        instance.verifiedUsers.splice(index, 1);
      }

      // Update stats
      this.config.stats.totalUnverified++;
      this.saveEntranceData();

      // Log unverification
      if (this.config.logVerifications && instance.logChannel) {
        await this.logAction(guild, {
          action: 'User Unverified',
          user: user,
          member: member,
          channelId: instance.logChannel
        });
      }
    } catch (error) {
      console.error('[EntranceSystem] Error unverifying user:', error);
    }
  }

  /**
   * Remove entrance instance
   * @param {string} guildId
   */
  async removeInstance(guildId) {
    const instance = this.instances.get(guildId);
    if (!instance) return false;

    try {
      // Try to remove reaction from message
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const channel = guild.channels.cache.get(instance.channelId);
        if (channel) {
          const message = await channel.messages.fetch(instance.messageId).catch(() => null);
          if (message) {
            const reaction = message.reactions.cache.find(r => r.emoji.toString() === instance.emoji);
            if (reaction) {
              await reaction.users.remove(this.client.user.id).catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      console.error('[EntranceSystem] Error removing reaction:', error);
    }

    this.instances.delete(guildId);
    this.saveEntranceData();
    return true;
  }

  /**
   * Reset channel permissions
   * @param {import("discord.js").Guild} guild
   */
  async resetPermissions(guild) {
    const changes = {
      resetChannels: 0,
      errors: []
    };

    for (const channel of guild.channels.cache.values()) {
      try {
        // Reset @everyone permissions to default
        await channel.permissionOverwrites.delete(guild.id);
        
        // Remove any entrance role overrides
        const instance = this.instances.get(guild.id);
        if (instance && instance.roleId) {
          await channel.permissionOverwrites.delete(instance.roleId);
        }

        changes.resetChannels++;
      } catch (error) {
        changes.errors.push(`${channel.name}: ${error.message}`);
      }
    }

    return changes;
  }

  /**
   * Log action
   * @param {import("discord.js").Guild} guild
   * @param {Object} data
   */
  async logAction(guild, data) {
    const channel = guild.channels.cache.get(data.channelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`Entrance System: ${data.action}`)
      .setColor(data.action.includes('Verified') && !data.action.includes('Un') ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'User', value: `${data.user} (${data.user.id})`, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(data.user.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setThumbnail(data.user.displayAvatarURL())
      .setTimestamp();

    if (data.member) {
      embed.addFields({
        name: 'Joined Server',
        value: `<t:${Math.floor(data.member.joinedTimestamp / 1000)}:R>`,
        inline: true
      });
    }

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[EntranceSystem] Failed to log action:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats(guildId) {
    const instance = this.instances.get(guildId);
    
    return {
      enabled: this.config.enabled,
      hasInstance: !!instance,
      stats: this.config.stats,
      instanceStats: instance ? {
        verifiedUsers: instance.verifiedUsers.length,
        messageId: instance.messageId,
        roleId: instance.roleId,
        createdAt: instance.createdAt
      } : null
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('entrance', this.config);
    return this.configLoader.save();
  }
}