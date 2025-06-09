// src/systems/reactionRolesSystem.js
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ReactionRolesSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    
    // Get reaction roles config from config loader
    this.config = this.configLoader.get('reactionRoles');
    
    // Validate config
    if (!this.config) {
      throw new Error('[ReactionRolesSystem] Reaction roles configuration not found in config.yaml');
    }
    
    // Active reaction role panels
    this.panels = new Map(); // messageId -> panel data
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadReactionRolesData();

    // Setup event listeners
    if (this.config.enabled) {
      this.setupEventListeners();
    }
  }

  /**
   * Load reaction roles data from file
   */
  loadReactionRolesData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.panels) {
          this.panels = new Map(Object.entries(data.panels));
        }
        
        console.log(`[ReactionRolesSystem] Loaded ${this.panels.size} reaction role panels`);
      }
    } catch (error) {
      console.error('[ReactionRolesSystem] Error loading reaction roles data:', error);
    }
  }

  /**
   * Save reaction roles data to file
   */
  saveReactionRolesData() {
    try {
      const data = {
        panels: Object.fromEntries(this.panels),
        stats: {
          totalPanels: this.panels.size,
          totalRolesGiven: this.config.stats?.totalRolesGiven || 0,
          totalRolesRemoved: this.config.stats?.totalRolesRemoved || 0
        }
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[ReactionRolesSystem] Error saving reaction roles data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Handle button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      
      if (interaction.customId.startsWith('rr_')) {
        await this.handleInteraction(interaction);
      }
    });

    // Handle reaction add (for emoji mode)
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      // Handle partial reactions
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          console.error('[ReactionRolesSystem] Error fetching reaction:', error);
          return;
        }
      }
      
      await this.handleReactionAdd(reaction, user);
    });

    // Handle reaction remove (for emoji mode)
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      
      // Handle partial reactions
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          console.error('[ReactionRolesSystem] Error fetching reaction:', error);
          return;
        }
      }
      
      await this.handleReactionRemove(reaction, user);
    });

    // Clean up on message delete
    this.client.on('messageDelete', (message) => {
      if (this.panels.has(message.id)) {
        this.panels.delete(message.id);
        this.saveReactionRolesData();
      }
    });
  }

  /**
   * Create a reaction role panel
   * @param {import("discord.js").TextChannel} channel
   * @param {Object} options
   * @returns {Promise<import("discord.js").Message>}
   */
  async createPanel(channel, options = {}) {
    const mode = options.mode || this.config.defaultMode;
    const roles = options.roles || [];
    
    if (roles.length === 0) {
      throw new Error('No roles specified for reaction role panel');
    }
    
    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(options.title || 'Select Your Roles')
      .setDescription(options.description || 'Click/Select the roles you want!')
      .setColor(options.color || 0x0099ff)
      .setFooter({ text: options.footer || '' });
    
    // Add role descriptions if provided
    if (options.showRoles) {
      const roleDescriptions = roles.map(r => {
        const emoji = r.emoji ? `${r.emoji} ` : '';
        const role = channel.guild.roles.cache.get(r.roleId);
        const desc = r.description ? ` - ${r.description}` : '';
        return `${emoji}${role ? role.name : 'Unknown Role'}${desc}`;
      }).join('\n');
      
      embed.addFields({
        name: 'Available Roles',
        value: roleDescriptions || 'None',
        inline: false
      });
    }
    
    const components = [];
    let message;
    
    switch (mode) {
      case 'buttons':
        // Create button rows (max 5 buttons per row, max 5 rows)
        for (let i = 0; i < roles.length; i += 5) {
          const row = new ActionRowBuilder();
          const buttonRoles = roles.slice(i, i + 5);
          
          for (const roleData of buttonRoles) {
            const role = channel.guild.roles.cache.get(roleData.roleId);
            if (!role) continue;
            
            const button = new ButtonBuilder()
              .setCustomId(`rr_button_${roleData.roleId}`)
              .setLabel(roleData.label || role.name)
              .setStyle(roleData.style || ButtonStyle.Primary);
            
            if (roleData.emoji) {
              button.setEmoji(roleData.emoji);
            }
            
            row.addComponents(button);
          }
          
          if (row.components.length > 0) {
            components.push(row);
          }
          
          if (components.length >= 5) break; // Max 5 rows
        }
        
        message = await channel.send({ embeds: [embed], components });
        break;
        
      case 'dropdown':
        // Create select menu
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('rr_select')
          .setPlaceholder(options.placeholder || 'Select roles...')
          .setMinValues(options.minValues || 0)
          .setMaxValues(options.maxValues || roles.length);
        
        for (const roleData of roles) {
          const role = channel.guild.roles.cache.get(roleData.roleId);
          if (!role) continue;
          
          const option = {
            label: roleData.label || role.name,
            value: roleData.roleId,
            description: roleData.description
          };
          
          if (roleData.emoji) {
            option.emoji = roleData.emoji;
          }
          
          selectMenu.addOptions(option);
        }
        
        components.push(new ActionRowBuilder().addComponents(selectMenu));
        message = await channel.send({ embeds: [embed], components });
        break;
        
      case 'reactions':
        // Send message and add reactions
        message = await channel.send({ embeds: [embed] });
        
        for (const roleData of roles) {
          if (roleData.emoji) {
            try {
              await message.react(roleData.emoji);
            } catch (error) {
              console.error(`[ReactionRolesSystem] Failed to add reaction ${roleData.emoji}:`, error);
            }
          }
        }
        break;
        
      default:
        throw new Error(`Invalid reaction role mode: ${mode}`);
    }
    
    // Save panel data
    const panelData = {
      messageId: message.id,
      channelId: channel.id,
      guildId: channel.guild.id,
      mode: mode,
      roles: roles.map(r => ({
        roleId: r.roleId,
        emoji: r.emoji,
        label: r.label,
        description: r.description,
        style: r.style
      })),
      options: {
        title: options.title,
        description: options.description,
        color: options.color,
        footer: options.footer,
        maxRoles: options.maxRoles || 0, // 0 = unlimited
        requiredRole: options.requiredRole || null,
        blacklistRole: options.blacklistRole || null,
        removeOnReact: options.removeOnReact || false
      },
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy || null
    };
    
    this.panels.set(message.id, panelData);
    this.saveReactionRolesData();
    
    return message;
  }

  /**
   * Handle interaction (button/dropdown)
   * @param {import("discord.js").Interaction} interaction
   */
  async handleInteraction(interaction) {
    const panel = this.panels.get(interaction.message.id);
    if (!panel) return;
    
    // Check requirements
    const member = interaction.member;
    const canUse = this.checkRequirements(member, panel.options);
    
    if (!canUse.allowed) {
      return interaction.reply({
        content: canUse.reason,
        ephemeral: true
      });
    }
    
    if (interaction.isButton()) {
      const roleId = interaction.customId.split('_')[2];
      await this.toggleRole(interaction, member, roleId, panel);
    } else if (interaction.isStringSelectMenu()) {
      await this.handleSelectMenu(interaction, member, panel);
    }
  }

  /**
   * Handle select menu interaction
   * @param {import("discord.js").StringSelectMenuInteraction} interaction
   * @param {import("discord.js").GuildMember} member
   * @param {Object} panel
   */
  async handleSelectMenu(interaction, member, panel) {
    await interaction.deferReply({ ephemeral: true });
    
    const selectedRoles = interaction.values;
    const currentRoles = member.roles.cache;
    const panelRoleIds = panel.roles.map(r => r.roleId);
    
    const added = [];
    const removed = [];
    const failed = [];
    
    // Remove roles that are no longer selected
    for (const roleData of panel.roles) {
      if (currentRoles.has(roleData.roleId) && !selectedRoles.includes(roleData.roleId)) {
        try {
          await member.roles.remove(roleData.roleId);
          removed.push(`<@&${roleData.roleId}>`);
          
          this.config.stats = this.config.stats || {};
          this.config.stats.totalRolesRemoved = (this.config.stats.totalRolesRemoved || 0) + 1;
        } catch (error) {
          failed.push(`<@&${roleData.roleId}>`);
        }
      }
    }
    
    // Add newly selected roles
    for (const roleId of selectedRoles) {
      if (!currentRoles.has(roleId)) {
        try {
          await member.roles.add(roleId);
          added.push(`<@&${roleId}>`);
          
          this.config.stats = this.config.stats || {};
          this.config.stats.totalRolesGiven = (this.config.stats.totalRolesGiven || 0) + 1;
        } catch (error) {
          failed.push(`<@&${roleId}>`);
        }
      }
    }
    
    // Build response
    const embed = new EmbedBuilder()
      .setTitle('Role Update')
      .setColor(0x0099ff)
      .setTimestamp();
    
    if (added.length > 0) {
      embed.addFields({
        name: '✅ Added',
        value: added.join(', '),
        inline: false
      });
    }
    
    if (removed.length > 0) {
      embed.addFields({
        name: '❌ Removed',
        value: removed.join(', '),
        inline: false
      });
    }
    
    if (failed.length > 0) {
      embed.addFields({
        name: '⚠️ Failed',
        value: failed.join(', '),
        inline: false
      });
    }
    
    if (added.length === 0 && removed.length === 0 && failed.length === 0) {
      embed.setDescription('No changes were made.');
    }
    
    await interaction.editReply({ embeds: [embed] });
    
    // Log action
    if (this.config.enableLogging) {
      await this.logAction(member.guild, {
        action: 'Roles Updated (Dropdown)',
        user: member.user,
        added: added,
        removed: removed,
        panel: panel.options.title || 'Untitled Panel'
      });
    }
    
    this.saveReactionRolesData();
  }

  /**
   * Toggle a single role
   * @param {import("discord.js").Interaction} interaction
   * @param {import("discord.js").GuildMember} member
   * @param {string} roleId
   * @param {Object} panel
   */
  async toggleRole(interaction, member, roleId, panel) {
    await interaction.deferReply({ ephemeral: true });
    
    const hasRole = member.roles.cache.has(roleId);
    let action;
    
    try {
      if (hasRole) {
        await member.roles.remove(roleId);
        action = 'removed';
        
        this.config.stats = this.config.stats || {};
        this.config.stats.totalRolesRemoved = (this.config.stats.totalRolesRemoved || 0) + 1;
      } else {
        // Check max roles
        if (panel.options.maxRoles > 0) {
          const currentPanelRoles = panel.roles
            .filter(r => member.roles.cache.has(r.roleId))
            .length;
          
          if (currentPanelRoles >= panel.options.maxRoles) {
            return interaction.editReply({
              content: `❌ You can only have ${panel.options.maxRoles} role(s) from this panel.`
            });
          }
        }
        
        await member.roles.add(roleId);
        action = 'added';
        
        this.config.stats = this.config.stats || {};
        this.config.stats.totalRolesGiven = (this.config.stats.totalRolesGiven || 0) + 1;
      }
      
      await interaction.editReply({
        content: `✅ Role <@&${roleId}> ${action}!`
      });
      
      // Log action
      if (this.config.enableLogging) {
        await this.logAction(member.guild, {
          action: `Role ${action} (Button)`,
          user: member.user,
          role: `<@&${roleId}>`,
          panel: panel.options.title || 'Untitled Panel'
        });
      }
    } catch (error) {
      console.error('[ReactionRolesSystem] Error toggling role:', error);
      await interaction.editReply({
        content: '❌ Failed to update role. The bot may lack permissions.'
      });
    }
    
    this.saveReactionRolesData();
  }

  /**
   * Handle reaction add
   * @param {import("discord.js").MessageReaction} reaction
   * @param {import("discord.js").User} user
   */
  async handleReactionAdd(reaction, user) {
    const panel = this.panels.get(reaction.message.id);
    if (!panel || panel.mode !== 'reactions') return;
    
    const roleData = panel.roles.find(r => r.emoji === reaction.emoji.toString());
    if (!roleData) return;
    
    const guild = this.client.guilds.cache.get(panel.guildId);
    if (!guild) return;
    
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    // Check requirements
    const canUse = this.checkRequirements(member, panel.options);
    if (!canUse.allowed) {
      // Remove reaction if not allowed
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    
    try {
      await member.roles.add(roleData.roleId);
      
      this.config.stats = this.config.stats || {};
      this.config.stats.totalRolesGiven = (this.config.stats.totalRolesGiven || 0) + 1;
      
      // Remove reaction if configured
      if (panel.options.removeOnReact) {
        await reaction.users.remove(user.id).catch(() => {});
      }
      
      // Log action
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Role Added (Reaction)',
          user: user,
          role: `<@&${roleData.roleId}>`,
          panel: panel.options.title || 'Untitled Panel'
        });
      }
    } catch (error) {
      console.error('[ReactionRolesSystem] Error adding role:', error);
    }
    
    this.saveReactionRolesData();
  }

  /**
   * Handle reaction remove
   * @param {import("discord.js").MessageReaction} reaction
   * @param {import("discord.js").User} user
   */
  async handleReactionRemove(reaction, user) {
    const panel = this.panels.get(reaction.message.id);
    if (!panel || panel.mode !== 'reactions') return;
    
    const roleData = panel.roles.find(r => r.emoji === reaction.emoji.toString());
    if (!roleData) return;
    
    const guild = this.client.guilds.cache.get(panel.guildId);
    if (!guild) return;
    
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    try {
      await member.roles.remove(roleData.roleId);
      
      this.config.stats = this.config.stats || {};
      this.config.stats.totalRolesRemoved = (this.config.stats.totalRolesRemoved || 0) + 1;
      
      // Log action
      if (this.config.enableLogging) {
        await this.logAction(guild, {
          action: 'Role Removed (Reaction)',
          user: user,
          role: `<@&${roleData.roleId}>`,
          panel: panel.options.title || 'Untitled Panel'
        });
      }
    } catch (error) {
      console.error('[ReactionRolesSystem] Error removing role:', error);
    }
    
    this.saveReactionRolesData();
  }

  /**
   * Check if member meets requirements
   * @param {import("discord.js").GuildMember} member
   * @param {Object} options
   * @returns {{allowed: boolean, reason?: string}}
   */
  checkRequirements(member, options) {
    // Check required role
    if (options.requiredRole && !member.roles.cache.has(options.requiredRole)) {
      return {
        allowed: false,
        reason: '❌ You need a specific role to use this panel.'
      };
    }
    
    // Check blacklist role
    if (options.blacklistRole && member.roles.cache.has(options.blacklistRole)) {
      return {
        allowed: false,
        reason: '❌ You have a role that prevents you from using this panel.'
      };
    }
    
    return { allowed: true };
  }

  /**
   * Delete a reaction role panel
   * @param {string} messageId
   * @returns {Promise<boolean>}
   */
  async deletePanel(messageId) {
    const panel = this.panels.get(messageId);
    if (!panel) return false;
    
    try {
      const guild = this.client.guilds.cache.get(panel.guildId);
      const channel = guild?.channels.cache.get(panel.channelId);
      const message = await channel?.messages.fetch(messageId).catch(() => null);
      
      if (message) {
        await message.delete();
      }
    } catch (error) {
      console.error('[ReactionRolesSystem] Error deleting panel message:', error);
    }
    
    this.panels.delete(messageId);
    this.saveReactionRolesData();
    
    return true;
  }

  /**
   * Log action
   * @param {import("discord.js").Guild} guild
   * @param {Object} data
   */
  async logAction(guild, data) {
    if (!this.config.enableLogging || !this.config.logChannel) return;
    
    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;
    
    const embed = new EmbedBuilder()
      .setTitle(`Reaction Roles: ${data.action}`)
      .setColor(data.action.includes('Added') ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: 'User', value: `${data.user.tag || data.user} (${data.user.id})`, inline: true },
        { name: 'Panel', value: data.panel, inline: true }
      )
      .setTimestamp();
    
    if (data.role) {
      embed.addFields({ name: 'Role', value: data.role, inline: true });
    }
    
    if (data.added && data.added.length > 0) {
      embed.addFields({ name: 'Added', value: data.added.join(', '), inline: false });
    }
    
    if (data.removed && data.removed.length > 0) {
      embed.addFields({ name: 'Removed', value: data.removed.join(', '), inline: false });
    }
    
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[ReactionRolesSystem] Failed to log action:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      totalPanels: this.panels.size,
      stats: this.config.stats || {
        totalRolesGiven: 0,
        totalRolesRemoved: 0
      },
      panelsByMode: this.getPanelsByMode()
    };
  }

  /**
   * Get panels grouped by mode
   */
  getPanelsByMode() {
    const modes = {};
    
    for (const panel of this.panels.values()) {
      modes[panel.mode] = (modes[panel.mode] || 0) + 1;
    }
    
    return modes;
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('reactionRoles', this.config);
    return this.configLoader.save();
  }
}