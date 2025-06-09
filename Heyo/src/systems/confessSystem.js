// src/systems/confessSystem.js
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfessSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('confess');
    
    if (!this.config.enabled) {
      console.log('[ConfessSystem] System is disabled in config');
      return;
    }
    
    this.confessions = new Map();
    this.confessionCounter = 0;
    this.cooldowns = new Map();
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    
    this.loadData();
    this.setupListeners();
  }
  
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.confessionCounter = data.counter || 0;
        
        // Load recent confessions for potential moderation
        if (data.recent && Array.isArray(data.recent)) {
          data.recent.forEach(conf => {
            this.confessions.set(conf.id, conf);
          });
        }
        
        console.log(`[ConfessSystem] Loaded data - Counter: ${this.confessionCounter}`);
      }
    } catch (error) {
      console.error('[ConfessSystem] Error loading data:', error);
    }
  }
  
  saveData() {
    try {
      // Keep only recent confessions (last 100)
      const recentConfessions = Array.from(this.confessions.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 100);
      
      const data = {
        counter: this.confessionCounter,
        recent: recentConfessions
      };
      
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[ConfessSystem] Error saving data:', error);
    }
  }
  
  setupListeners() {
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isModalSubmit()) return;
      
      if (interaction.customId.startsWith('confess_modal_')) {
        await this.handleConfessModal(interaction);
      }
    });
  }
  
  async setupConfessChannel(guild, channelId) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error('Invalid channel');
      }
      
      // Update config
      this.config.channels[guild.id] = channelId;
      this.configLoader.set('confess.channels.' + guild.id, channelId);
      await this.configLoader.save();
      
      // Send initial message if configured
      if (this.config.setupMessage.enabled) {
        const embed = new EmbedBuilder()
          .setTitle(this.config.setupMessage.title)
          .setDescription(this.config.setupMessage.description)
          .setColor(this.config.setupMessage.color)
          .setFooter({ text: this.config.setupMessage.footer })
          .setTimestamp();
        
        await channel.send({ embeds: [embed] });
      }
      
      return true;
    } catch (error) {
      console.error('[ConfessSystem] Error setting up channel:', error);
      return false;
    }
  }
  
  async createConfessModal(interaction) {
    // Check if confession channel is set up
    const confessChannelId = this.config.channels[interaction.guild.id];
    if (!confessChannelId) {
      return interaction.reply({
        content: '❌ Confession channel not set up! Ask an admin to use `/setupconfess`',
        ephemeral: true
      });
    }
    
    // Check cooldown
    const cooldownKey = `${interaction.guild.id}-${interaction.user.id}`;
    if (this.cooldowns.has(cooldownKey)) {
      const timeLeft = Math.ceil((this.cooldowns.get(cooldownKey) - Date.now()) / 1000);
      return interaction.reply({
        content: `⏰ Please wait ${timeLeft} seconds before making another confession.`,
        ephemeral: true
      });
    }
    
    // Create modal
    const modal = new ModalBuilder()
      .setCustomId(`confess_modal_${interaction.guild.id}`)
      .setTitle('Anonymous Confession');
    
    const confessionInput = new TextInputBuilder()
      .setCustomId('confession_text')
      .setLabel('Your Confession')
      .setPlaceholder('Type your confession here...')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(this.config.minLength)
      .setMaxLength(this.config.maxLength)
      .setRequired(true);
    
    const row = new ActionRowBuilder().addComponents(confessionInput);
    modal.addComponents(row);
    
    await interaction.showModal(modal);
  }
  
  async handleConfessModal(interaction) {
    const confession = interaction.fields.getTextInputValue('confession_text');
    const guildId = interaction.customId.split('_')[2];
    
    // Get confession channel
    const confessChannelId = this.config.channels[guildId];
    const channel = this.client.channels.cache.get(confessChannelId);
    
    if (!channel) {
      return interaction.reply({
        content: '❌ Confession channel not found!',
        ephemeral: true
      });
    }
    
    // Check for banned words if enabled
    if (this.config.filterBannedWords && this.config.bannedWords.length > 0) {
      const lowerConfession = confession.toLowerCase();
      for (const word of this.config.bannedWords) {
        if (lowerConfession.includes(word.toLowerCase())) {
          return interaction.reply({
            content: '❌ Your confession contains prohibited content.',
            ephemeral: true
          });
        }
      }
    }
    
    // Increment counter
    this.confessionCounter++;
    
    // Create confession ID
    const confessionId = `CONF-${this.confessionCounter.toString().padStart(4, '0')}`;
    
    // Store confession (for potential moderation)
    const confessionData = {
      id: confessionId,
      userId: interaction.user.id,
      content: confession,
      timestamp: Date.now(),
      guildId: guildId
    };
    
    this.confessions.set(confessionId, confessionData);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(`${this.config.embedTitle} #${this.confessionCounter}`)
      .setDescription(confession)
      .setColor(this.config.embedColor)
      .setFooter({ text: `ID: ${confessionId}` })
      .setTimestamp();
    
    // Add optional fields
    if (this.config.showConfessionNumber) {
      embed.setAuthor({ name: `Confession #${this.confessionCounter}` });
    }
    
    try {
      await channel.send({ embeds: [embed] });
      
      // Set cooldown
      const cooldownKey = `${guildId}-${interaction.user.id}`;
      this.cooldowns.set(cooldownKey, Date.now() + (this.config.cooldown * 1000));
      setTimeout(() => this.cooldowns.delete(cooldownKey), this.config.cooldown * 1000);
      
      // Reply to user
      await interaction.reply({
        content: this.config.successMessage.replace('{id}', confessionId),
        ephemeral: true
      });
      
      // Log if enabled
      if (this.config.logChannel) {
        await this.logConfession(interaction.guild, confessionData);
      }
      
      // Save data
      this.saveData();
      
    } catch (error) {
      console.error('[ConfessSystem] Error sending confession:', error);
      await interaction.reply({
        content: '❌ Failed to send confession. Please try again later.',
        ephemeral: true
      });
    }
  }
  
  async logConfession(guild, confessionData) {
    const logChannelId = this.config.logChannel;
    if (!logChannelId) return;
    
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased()) return;
    
    const user = await this.client.users.fetch(confessionData.userId).catch(() => null);
    
    const embed = new EmbedBuilder()
      .setTitle('🤫 New Confession')
      .setDescription(confessionData.content)
      .addFields(
        { name: 'User', value: user ? `${user.tag} (${user.id})` : confessionData.userId, inline: true },
        { name: 'ID', value: confessionData.id, inline: true },
        { name: 'Time', value: `<t:${Math.floor(confessionData.timestamp / 1000)}:F>`, inline: true }
      )
      .setColor(0x808080)
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  
  async deleteConfession(confessionId, moderatorId) {
    const confession = this.confessions.get(confessionId);
    if (!confession) return false;
    
    // Mark as deleted (don't actually remove from memory)
    confession.deleted = true;
    confession.deletedBy = moderatorId;
    confession.deletedAt = Date.now();
    
    this.saveData();
    return true;
  }
  
  getConfession(confessionId) {
    return this.confessions.get(confessionId);
  }
  
  getStats(guildId) {
    const guildConfessions = Array.from(this.confessions.values())
      .filter(c => c.guildId === guildId && !c.deleted);
    
    return {
      total: this.confessionCounter,
      guildTotal: guildConfessions.length,
      todayCount: guildConfessions.filter(c => 
        c.timestamp > Date.now() - 24 * 60 * 60 * 1000
      ).length,
      channelId: this.config.channels[guildId] || null
    };
  }
}