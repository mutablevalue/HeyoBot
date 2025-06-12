// src/systems/genderVerifySystem.js
/**
 * Gender Verification System
 * 
 * A comprehensive system for gender-based role verification with photo ID review.
 * 
 * Permission Hierarchy (respects moderation system config):
 * 1. Server Owner (if ownerBypass enabled) → Full control + bypass verification
 * 2. AntiNuke Administrators → Full control + bypass verification
 * 3. System Administrators → Full control + bypass verification
 * 4. System Moderators → Can only review pending verifications
 * 5. Regular Users → Must complete verification process
 * 
 * Channel Visibility:
 * - verify → Everyone can see, only bot can send (verification panel)
 * - female-chat → Everyone can see, only verified females can send
 * - male-chat → Everyone can see, only verified males can send
 * - verified-chat → Hidden from unverified, both genders can send
 * - verified-vc → Hidden from unverified, both genders can join
 * 
 * Features:
 * - Photo ID verification with review process
 * - Gender-specific channels with controlled access
 * - Automatic role assignment upon approval
 * - Full audit logging with permission levels
 * - Data persistence across restarts
 * - Configurable cooldowns and limits
 */
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class GenderVerifySystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   * @param {import("./moderationSystem.js").ModerationSystem} moderationSystem
   * 
   * Permission Hierarchy:
   * 1. Server Owner (with ownerBypass enabled) - Can configure system and bypass verification
   * 2. AntiNuke Admins - Can configure system and bypass verification
   * 3. System Administrators - Can configure system and bypass verification
   * 4. System Moderators - Can only review verifications
   * 5. Regular Users - Must complete verification
   */
  constructor(client, configLoader, moderationSystem) {
    console.log('[GenderVerifySystem] Initializing...');
    
    this.client = client;
    this.configLoader = configLoader;
    this.moderationSystem = moderationSystem;
    
    // Get config from config loader
    this.config = this.configLoader.get('genderVerify') || {};
    
    // Initialize from config - no defaults
    this.loadConfigValues();
    
    // If config has guild setups, preserve them
    const savedGuilds = this.config.guilds || {};
    console.log(`[GenderVerifySystem] Found ${Object.keys(savedGuilds).length} guild setups in config`);
    
    // Active verifications tracking
    this.activeVerifications = new Map(); // verificationId -> verification data
    this.userVerifications = new Map(); // userId -> verificationId
    this.acceptedUsers = new Map(); // userId -> {gender, approvedAt, approvedBy, guildId}
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadVerificationData();

    // Setup event listeners
    if (this.config.enabled) {
      console.log('[GenderVerifySystem] System enabled, setting up listeners');
      this.setupEventListeners();
    } else {
      console.log('[GenderVerifySystem] System disabled, skipping listeners');
    }
    
    console.log('[GenderVerifySystem] Initialization complete');
  }

  /**
   * Load configuration values from config
   */
  loadConfigValues() {
    // Required config values - no defaults
    if (!this.config.dataFile || !this.config.cooldown || !this.config.maxAttemptsPerUser ||
        !this.config.roleNames || !this.config.channelNames || !this.config.messages) {
      console.error('[GenderVerifySystem] Missing required configuration values');
    }
    
    // Ensure guilds object exists
    if (!this.config.guilds) {
      this.config.guilds = {};
    }
  }

  /**
   * Deep merge utility
   */
  deepMerge(target, source) {
    const output = { ...target };
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Load verification data from file
   */
  loadVerificationData() {
    try {
      // First, ensure we have guild data from config
      const configGuilds = this.config.guilds || {};
      console.log(`[GenderVerifySystem] Starting with ${Object.keys(configGuilds).length} guilds from config`);
      
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.activeVerifications) {
          this.activeVerifications = new Map(Object.entries(data.activeVerifications));
        }
        
        if (data.userVerifications) {
          this.userVerifications = new Map(Object.entries(data.userVerifications));
        }
        
        if (data.acceptedUsers) {
          this.acceptedUsers = new Map(Object.entries(data.acceptedUsers));
        }
        
        // Merge guild setups from data file with config
        if (data.guilds) {
          if (!this.config.guilds) this.config.guilds = {};
          // Merge, don't replace
          for (const [guildId, setup] of Object.entries(data.guilds)) {
            if (!this.config.guilds[guildId]) {
              this.config.guilds[guildId] = setup;
              console.log(`[GenderVerifySystem] Loaded guild setup for ${guildId} from data file`);
            }
          }
        }
        
        console.log(`[GenderVerifySystem] Loaded ${this.acceptedUsers.size} accepted users`);
        console.log(`[GenderVerifySystem] Total guilds after loading: ${Object.keys(this.config.guilds || {}).length}`);
      } else {
        console.log('[GenderVerifySystem] No existing data file found');
      }
    } catch (error) {
      console.error('[GenderVerifySystem] Error loading verification data:', error);
    }
  }

  /**
   * Save verification data to file
   */
  saveVerificationData() {
    try {
      const data = {
        activeVerifications: Object.fromEntries(this.activeVerifications),
        userVerifications: Object.fromEntries(this.userVerifications),
        acceptedUsers: Object.fromEntries(this.acceptedUsers),
        guilds: this.config.guilds || {}
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[GenderVerifySystem] Error saving verification data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    console.log('[GenderVerifySystem] Setting up event listeners');
    
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isButton()) {
        if (interaction.customId === 'gender_verify_start') {
          console.log('[GenderVerifySystem] Verify start button clicked');
          await this.handleVerifyStart(interaction);
        } else if (interaction.customId.startsWith('verify_')) {
          console.log('[GenderVerifySystem] Verification action button clicked:', interaction.customId);
          await this.handleVerificationAction(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'gender_verify_modal') {
          console.log('[GenderVerifySystem] Modal submitted');
          await this.handleModalSubmit(interaction);
        } else if (interaction.customId.startsWith('verify_deny_reason_')) {
          // Handle deny reason modal separately
        }
      }
    });

    // Clean up old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Setup the gender verification system
   */
  async setupGenderVerification(guild, options = {}) {
    // Check if system is already set up
    const existingSetup = await this.checkExistingSetup(guild);
    if (existingSetup.isSetup && !options.force) {
      return {
        success: false,
        message: 'Gender verification is already set up. Use force option to recreate.',
        existing: existingSetup
      };
    }

    try {
      // Create or get roles
      const femaleRole = await this.createOrGetRole(guild, 
        options.femaleRoleName || this.config.roleNames.female,
        { color: this.config.roleColors?.female || null, hoist: true }
      );
      
      const maleRole = await this.createOrGetRole(guild,
        options.maleRoleName || this.config.roleNames.male,
        { color: this.config.roleColors?.male || null, hoist: true }
      );

      // Create main category for all verification channels
      const mainCategory = await this.createOrGetCategory(guild,
        options.mainCategoryName || this.config.channelNames.mainCategory
      );

      // Create review category
      const reviewCategory = await this.createOrGetCategory(guild,
        options.reviewCategoryName || this.config.channelNames.reviewCategory
      );

      // Create channels in main category
      // Verify channel - Everyone can see but not send messages
      const verifyChannel = await this.createOrGetChannel(guild, {
        name: options.verifyChannelName || this.config.channelNames.verify,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        topic: 'Submit your gender verification here',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          },
          {
            id: this.client.user.id, // Bot
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
          }
        ]
      });

      // Gender-specific channels - Everyone can see, only respective gender can send
      const femaleChannel = await this.createOrGetChannel(guild, {
        name: options.femaleChannelName || this.config.channelNames.femaleOnly,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        topic: 'Female-only chat',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          },
          {
            id: this.client.user.id, // Bot
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
          },
          {
            id: femaleRole.id,
            allow: [PermissionFlagsBits.SendMessages]
          }
        ]
      });

      const maleChannel = await this.createOrGetChannel(guild, {
        name: options.maleChannelName || this.config.channelNames.maleOnly,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        topic: 'Male-only chat',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
          },
          {
            id: this.client.user.id, // Bot
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
          },
          {
            id: maleRole.id,
            allow: [PermissionFlagsBits.SendMessages]
          }
        ]
      });

      // Create verified-only channels (completely invisible to non-verified)
      const verifiedChannel = await this.createOrGetChannel(guild, {
        name: options.verifiedChannelName || this.config.channelNames.verified,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        topic: 'Chat for all verified members',
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: this.client.user.id, // Bot
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
          },
          {
            id: femaleRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          },
          {
            id: maleRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]
      });

      const verifiedVC = await this.createOrGetChannel(guild, {
        name: options.verifiedVCName || this.config.channelNames.verifiedVC,
        type: ChannelType.GuildVoice,
        parent: mainCategory.id,
        userLimit: 0,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: this.client.user.id, // Bot
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          },
          {
            id: femaleRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          },
          {
            id: maleRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          }
        ]
      });

      // Add staff permissions to all channels
      if (this.moderationSystem) {
        const modPerms = this.moderationSystem.config.permissions;
        const channels = [femaleChannel, maleChannel, verifiedChannel, verifiedVC];
        
        // Add admin roles with full permissions
        for (const roleId of modPerms.administrator.roles) {
          if (guild.roles.cache.has(roleId)) {
            for (const channel of channels) {
              if (channel.type === ChannelType.GuildText) {
                await channel.permissionOverwrites.create(roleId, {
                  ViewChannel: true,
                  SendMessages: true,
                  ManageMessages: true
                });
              } else {
                await channel.permissionOverwrites.create(roleId, {
                  ViewChannel: true,
                  Connect: true,
                  Speak: true,
                  MoveMembers: true
                });
              }
            }
          }
        }
        
        // Add moderator roles with limited permissions
        for (const roleId of modPerms.moderator.roles) {
          if (guild.roles.cache.has(roleId)) {
            for (const channel of channels) {
              if (channel.type === ChannelType.GuildText) {
                await channel.permissionOverwrites.create(roleId, {
                  ViewChannel: true,
                  SendMessages: true
                });
              } else {
                await channel.permissionOverwrites.create(roleId, {
                  ViewChannel: true,
                  Connect: true,
                  Speak: true
                });
              }
            }
          }
        }
      }

      // Send verification panel with custom message if provided
      const panelOptions = {};
      if (options.messageDescription) panelOptions.description = options.messageDescription;
      if (options.messageFooter) panelOptions.footer = options.messageFooter;
      if (options.buttonLabel) panelOptions.buttonLabel = options.buttonLabel;
      
      const panel = await this.createVerificationPanel(verifyChannel, panelOptions);

      // Save setup data
      const setupData = {
        guildId: guild.id,
        roles: {
          female: femaleRole.id,
          male: maleRole.id
        },
        channels: {
          verify: verifyChannel.id,
          female: femaleChannel.id,
          male: maleChannel.id,
          verified: verifiedChannel.id,
          verifiedVC: verifiedVC.id,
          mainCategory: mainCategory.id,
          reviewCategory: reviewCategory.id
        },
        panelMessageId: panel.id,
        createdAt: new Date().toISOString()
      };

      // Save custom message if provided
      if (Object.keys(panelOptions).length > 0) {
        setupData.customMessage = panelOptions;
      }

      // Store in config
      if (!this.config.guilds) this.config.guilds = {};
      this.config.guilds[guild.id] = setupData;
      
      console.log(`[GenderVerifySystem] Saving setup for guild ${guild.id}`);
      
      // Save to both config and data file
      await this.saveConfig();
      this.saveVerificationData(); // Also save to verification data file
      
      console.log(`[GenderVerifySystem] Setup saved successfully for guild ${guild.id}`);

      return {
        success: true,
        setup: setupData,
        message: 'Gender verification system has been set up successfully!'
      };

    } catch (error) {
      console.error('[GenderVerifySystem] Setup error:', error);
      return {
        success: false,
        message: 'Failed to setup gender verification system',
        error: error.message
      };
    }
  }

  /**
   * Create verification panel
   */
  async createVerificationPanel(channel, options = {}) {
    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    
    const embed = embedLoader.system(
      'Gender Verification',
      options.description || this.config.verifyEmbed.description
    );

    if (options.footer) {
      embed.setFooter({ text: embedLoader.format(options.footer, 'footer') });
    }

    const button = new ButtonBuilder()
      .setCustomId('gender_verify_start')
      .setLabel(options.buttonLabel || this.config.verifyEmbed.buttonLabel)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    return await channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  /**
   * Reload guild configurations
   */
  reloadGuildConfigs() {
    console.log('[GenderVerifySystem] Reloading guild configurations...');
    
    // Reload from config file
    const currentConfig = this.configLoader.get('genderVerify');
    if (currentConfig?.guilds) {
      this.config.guilds = { ...this.config.guilds, ...currentConfig.guilds };
      console.log(`[GenderVerifySystem] Reloaded ${Object.keys(currentConfig.guilds).length} guilds from config`);
    }
    
    // Also reload from data file
    this.loadVerificationData();
    
    console.log(`[GenderVerifySystem] Total guilds after reload: ${Object.keys(this.config.guilds || {}).length}`);
  }

  /**
   * Handle verify button click
   */
  async handleVerifyStart(interaction) {
    console.log('[GenderVerifySystem] handleVerifyStart called');
    
    // Reload guild configs to ensure we have the latest
    this.reloadGuildConfigs();
    // Check if user is already verified
    const member = interaction.member;
    
    console.log(`[GenderVerifySystem] Checking guild setup for ${interaction.guild.id}`);
    
    // Reload configs to get latest
    this.reloadGuildConfigs();
    const guildSetup = this.config.guilds?.[interaction.guild.id];
    
    console.log(`[GenderVerifySystem] Guild setup found: ${!!guildSetup}`);
    
    if (!guildSetup) {
      return interaction.reply({
        content: 'Gender verification is not properly configured. An admin needs to run `/setupgenderverify` first.',
        ephemeral: true
      });
    }

    // Check permission hierarchy for exemptions: Owner > AntiNuke > Administration
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const ownerBypassEnabled = this.moderationSystem.config.ownerBypass;
    
    // Check if user is server owner with bypass enabled
    if (isOwner && ownerBypassEnabled) {
      // Log exemption
      await this.logAction(interaction.guild, {
        action: 'Verification Exemption',
        user: interaction.user,
        additional: 'Server Owner - Automatic exemption'
      });
      
      return interaction.reply({
        content: 'Server owners are exempt from verification requirements.',
        ephemeral: true
      });
    }
    
    // Check if user is an AntiNuke admin
    const antiNukeConfig = this.configLoader.get('antiNuke');
    const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
      member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
    
    if (isAntiNukeAdmin) {
      // Log exemption
      await this.logAction(interaction.guild, {
        action: 'Verification Exemption',
        user: interaction.user,
        additional: 'AntiNuke Administrator - Automatic exemption'
      });
      
      return interaction.reply({
        content: 'AntiNuke administrators are exempt from verification requirements.',
        ephemeral: true
      });
    }
    
    // Check if user is globally exempt (has administrator permissions in moderation system)
    if (this.moderationSystem.isGloballyExempt(member)) {
      // Log exemption
      await this.logAction(interaction.guild, {
        action: 'Verification Exemption',
        user: interaction.user,
        additional: 'System Administrator - Automatic exemption'
      });
      
      return interaction.reply({
        content: 'System administrators are exempt from verification requirements.',
        ephemeral: true
      });
    }

    // Check if already has a gender role or is already verified
    if (member.roles.cache.has(guildSetup.roles.female) || 
        member.roles.cache.has(guildSetup.roles.male) ||
        this.acceptedUsers.has(interaction.user.id)) {
      return interaction.reply({
        content: this.config.messages.alreadyVerified,
        ephemeral: true
      });
    }

    // Check if has pending verification
    if (this.userVerifications.has(interaction.user.id)) {
      return interaction.reply({
        content: this.config.messages.pendingVerification,
        ephemeral: true
      });
    }

    // Check cooldown
    const lastAttempt = this.getLastAttempt(interaction.user.id);
    if (lastAttempt) {
      const timeSince = Date.now() - lastAttempt;
      if (timeSince < this.config.cooldown) {
        const timeLeft = Math.ceil((this.config.cooldown - timeSince) / 1000 / 60);
        return interaction.reply({
          content: this.config.messages.cooldownActive.replace('{time}', `${timeLeft} minutes`),
          ephemeral: true
        });
      }
    }

    // Show modal
    const modal = new ModalBuilder()
      .setCustomId('gender_verify_modal')
      .setTitle(this.config.formModal.title);

    const genderInput = new TextInputBuilder()
      .setCustomId('gender')
      .setLabel(this.config.formModal.genderField.label)
      .setPlaceholder(this.config.formModal.genderField.placeholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(this.config.formModal.genderField.required)
      .setMaxLength(10);

    const idPhotoInput = new TextInputBuilder()
      .setCustomId('id_photo')
      .setLabel(this.config.formModal.idPhotoField.label)
      .setPlaceholder(this.config.formModal.idPhotoField.placeholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(this.config.formModal.idPhotoField.required);

    const selfieInput = new TextInputBuilder()
      .setCustomId('selfie')
      .setLabel(this.config.formModal.selfieField.label)
      .setPlaceholder(this.config.formModal.selfieField.placeholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(this.config.formModal.selfieField.required);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel(this.config.formModal.notesField.label)
      .setPlaceholder(this.config.formModal.notesField.placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(this.config.formModal.notesField.required)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(genderInput),
      new ActionRowBuilder().addComponents(idPhotoInput),
      new ActionRowBuilder().addComponents(selfieInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submission
   */
  async handleModalSubmit(interaction) {
    console.log('[GenderVerifySystem] handleModalSubmit called for user:', interaction.user.tag);
    
    try {
      await interaction.deferReply({ ephemeral: true });
      console.log('[GenderVerifySystem] Deferred reply');

      // Check if user is already verified
      if (this.acceptedUsers.has(interaction.user.id)) {
        console.log('[GenderVerifySystem] User already verified');
        return interaction.editReply({
          content: this.config.messages.alreadyVerified
        });
      }

      const gender = interaction.fields.getTextInputValue('gender').toLowerCase().trim();
      const idPhoto = interaction.fields.getTextInputValue('id_photo').trim();
      const selfie = interaction.fields.getTextInputValue('selfie').trim();
      const notes = interaction.fields.getTextInputValue('notes')?.trim() || 'None';
      
      console.log('[GenderVerifySystem] Form data received');
      console.log('[GenderVerifySystem] Gender:', gender);
      console.log('[GenderVerifySystem] ID Photo URL length:', idPhoto.length);
      console.log('[GenderVerifySystem] ID Photo URL:', idPhoto);
      console.log('[GenderVerifySystem] Selfie URL length:', selfie.length);
      console.log('[GenderVerifySystem] Selfie URL:', selfie);
      console.log('[GenderVerifySystem] Notes:', notes);

      // Validate gender
      if (!['male', 'female'].includes(gender)) {
        console.log('[GenderVerifySystem] Invalid gender:', gender);
        return interaction.editReply({
          content: this.config.messages.invalidGender
        });
      }

      // Basic URL validation - very lenient for Discord URLs
      const isValidUrl = (url) => {
        return url.startsWith('http://') || url.startsWith('https://');
      };
      
      if (!isValidUrl(idPhoto) || !isValidUrl(selfie)) {
        console.log('[GenderVerifySystem] Invalid URLs');
        return interaction.editReply({
          content: this.config.messages.invalidUrls + '\n\nPlease ensure your URLs start with http:// or https://'
        });
      }

      console.log('[GenderVerifySystem] Validation passed, creating verification...');

      try {
        console.log(`[GenderVerifySystem] Starting verification creation for user ${interaction.user.tag}`);
        console.log(`[GenderVerifySystem] Current guild ID: ${interaction.guild.id}`);
        console.log(`[GenderVerifySystem] Available guild setups:`, Object.keys(this.config.guilds || {}));
        console.log(`[GenderVerifySystem] Guild setup exists: ${!!this.config.guilds?.[interaction.guild.id]}`);
        
        // Create verification request
        const verification = await this.createVerification(interaction, {
          gender,
          idPhoto,
          selfie,
          notes
        });

        console.log(`[GenderVerifySystem] Verification created successfully: ${verification.id}`);

        // Send success message using embedLoader
        const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
        const successEmbed = embedLoader.success(
          this.config.messages.submitted
        ).addFields(
          { name: 'Verification ID', value: `#${verification.id.slice(-4)}`, inline: true },
          { name: 'Gender', value: gender.charAt(0).toUpperCase() + gender.slice(1), inline: true },
          { name: 'Status', value: 'Pending Review', inline: true }
        );

        await interaction.editReply({
          embeds: [successEmbed],
          ephemeral: true
        });
        
        console.log('[GenderVerifySystem] Successfully sent submission confirmation to user');

      } catch (error) {
        console.error('[GenderVerifySystem] Error in handleModalSubmit:', error);
        console.error('[GenderVerifySystem] Error stack:', error.stack);
        
        // Provide more detailed error message
        let errorMessage = this.config.messages.errorSubmitting;
        if (error.message.includes('Guild setup not found')) {
          errorMessage = 'Gender verification is not properly set up in this server. Please ask an admin to run /setupgenderverify';
        } else if (error.message.includes('category not found')) {
          errorMessage = 'Review category not found. Please contact an administrator to fix the setup.';
        }
        
        await interaction.editReply({
          content: errorMessage + `\n\nError: ${error.message}`
        });
      }
    } catch (error) {
      console.error('[GenderVerifySystem] Fatal error in handleModalSubmit:', error);
      await interaction.editReply({
        content: 'An unexpected error occurred. Please try again later.'
      }).catch(() => {});
    }
  }

  /**
   * Create verification request and review channel
   */
  async createVerification(interaction, data) {
    const guild = interaction.guild;
    const user = interaction.user;
    console.log(`[GenderVerifySystem] Creating verification for guild ${guild.id}`);
    const guildSetup = this.config.guilds?.[guild.id];
    
    console.log(`[GenderVerifySystem] Guild setup:`, JSON.stringify(guildSetup, null, 2));
    console.log(`[GenderVerifySystem] All guild IDs in config:`, Object.keys(this.config.guilds || {}));
    
    if (!guildSetup) {
      console.error(`[GenderVerifySystem] Guild setup not found for guild ${guild.id}`);
      console.error(`[GenderVerifySystem] Available guilds:`, Object.keys(this.config.guilds || {}));
      throw new Error('Guild setup not found. Please run /setupgenderverify first.');
    }

    // Generate verification ID based on timestamp
    const verificationId = Date.now().toString();

    try {
      // Get the review category
      const reviewCategory = guild.channels.cache.get(guildSetup.channels.reviewCategory);
      console.log(`[GenderVerifySystem] Review category lookup: ${guildSetup.channels.reviewCategory} -> ${reviewCategory?.name || 'NOT FOUND'}`);
      
      if (!reviewCategory) {
        throw new Error(`Review category not found: ${guildSetup.channels.reviewCategory}`);
      }

      // Create review channel
      const channelName = this.config.reviewChannelFormat.replace('{number}', verificationId.slice(-4));
      console.log(`[GenderVerifySystem] Creating review channel: ${channelName} in category ${reviewCategory.id}`);
      
      const reviewChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: reviewCategory.id,
        topic: `Gender verification for ${user.tag}`,
        reason: `Verification request from ${user.tag}`
      });
      
      console.log(`[GenderVerifySystem] Review channel created: ${reviewChannel.id}`);

      // Set base permissions - deny everyone
      await reviewChannel.permissionOverwrites.create(guild.id, {
        ViewChannel: false
      });
      
      // Allow bot
      await reviewChannel.permissionOverwrites.create(this.client.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ManageChannels: true
      });

      // Add all moderators and administrators
      const modPerms = this.moderationSystem.config.permissions;
      console.log(`[GenderVerifySystem] Adding permissions for admins: ${modPerms.administrator.users.length} users, ${modPerms.administrator.roles.length} roles`);
      console.log(`[GenderVerifySystem] Adding permissions for mods: ${modPerms.moderator.users.length} users, ${modPerms.moderator.roles.length} roles`);
      
      // Add administrator users and roles
      for (const userId of modPerms.administrator.users) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            await reviewChannel.permissionOverwrites.create(userId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true
            });
          }
        } catch (error) {
          console.log(`[GenderVerifySystem] Could not add admin user ${userId}`);
        }
      }
      
      for (const roleId of modPerms.administrator.roles) {
        if (guild.roles.cache.has(roleId)) {
          await reviewChannel.permissionOverwrites.create(roleId, {
            ViewChannel: true,
            SendMessages: true,
            ManageMessages: true
          });
        }
      }
      
      // Add moderator users and roles
      for (const userId of modPerms.moderator.users) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            await reviewChannel.permissionOverwrites.create(userId, {
              ViewChannel: true,
              SendMessages: true
            });
          }
        } catch (error) {
          console.log(`[GenderVerifySystem] Could not add mod user ${userId}`);
        }
      }
      
      for (const roleId of modPerms.moderator.roles) {
        if (guild.roles.cache.has(roleId)) {
          await reviewChannel.permissionOverwrites.create(roleId, {
            ViewChannel: true,
            SendMessages: true
          });
        }
      }

      // Create verification data
      const verificationData = {
        id: verificationId,
        userId: user.id,
        userTag: user.tag,
        guildId: guild.id,
        channelId: reviewChannel.id,
        gender: data.gender,
        notes: data.notes,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      // Save verification
      this.activeVerifications.set(verificationId, verificationData);
      this.userVerifications.set(user.id, verificationId);
      this.saveVerificationData();

      // Send review embeds using embedLoader
      const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
      
      const reviewEmbed = embedLoader.createEmbed({
        description: `User ${user} has submitted a verification request`,
        fields: [
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Gender', value: data.gender.charAt(0).toUpperCase() + data.gender.slice(1), inline: true },
          { name: 'Account Age', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Notes', value: data.notes || 'None' },
          { name: 'ID Photo', value: `[View Image](${data.idPhoto})`, inline: true },
          { name: 'Selfie/Second ID', value: `[View Image](${data.selfie})`, inline: true }
        ]
      }).setImage(data.idPhoto);

      const selfieEmbed = new EmbedBuilder()
        .setTitle('Selfie/Second ID')
        .setImage(data.selfie)
        .setColor(embedLoader.config.color);

      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_approve_${verificationId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`verify_deny_${verificationId}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
        );

      // Mention moderators if configured
      const modRoleMentions = [...modPerms.administrator.roles, ...modPerms.moderator.roles]
        .filter(roleId => guild.roles.cache.has(roleId))
        .map(roleId => `<@&${roleId}>`)
        .join(' ');

      const messageContent = modRoleMentions 
        ? `${modRoleMentions}\n\nNew verification request from ${user}` 
        : `New verification request from ${user}`;
      
      console.log(`[GenderVerifySystem] Sending message with mentions: ${modRoleMentions || 'none'}`);

      const sentMessage = await reviewChannel.send({
        content: messageContent,
        embeds: [reviewEmbed, selfieEmbed],
        components: [actionRow]
      });

      console.log(`[GenderVerifySystem] Sent verification message ${sentMessage.id} in channel ${reviewChannel.id}`);
      console.log(`[GenderVerifySystem] Review channel link: https://discord.com/channels/${guild.id}/${reviewChannel.id}`);

      // Log submission
      await this.logAction(guild, {
        action: 'Verification Submitted',
        user: user,
        verificationId: verificationId.slice(-4),
        gender: data.gender,
        reviewChannel: `<#${reviewChannel.id}>`
      });

      console.log(`[GenderVerifySystem] Created verification ${verificationId} in channel ${reviewChannel.id}`);
      
      return verificationData;
      
    } catch (error) {
      console.error('[GenderVerifySystem] Error creating review channel:', error);
      throw error;
    }
  }

  /**
   * Handle verification actions (approve/deny)
   */
  async handleVerificationAction(interaction) {
    const [action, type, verificationId] = interaction.customId.split('_');
    const verification = this.activeVerifications.get(verificationId);

    if (!verification) {
      return interaction.reply({
        content: 'This verification no longer exists.',
        ephemeral: true
      });
    }

    // Check permission hierarchy: Owner > AntiNuke > Administration > Moderation
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const ownerBypassEnabled = this.moderationSystem.config.ownerBypass;
    const antiNukeConfig = this.configLoader.get('antiNuke');
    const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
      interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
    
    let permissionLevel = 'Unknown';
    
    // Server owner can always review
    if (isOwner && ownerBypassEnabled) {
      permissionLevel = 'Server Owner';
    } else if (isAntiNukeAdmin) {
      permissionLevel = 'AntiNuke Administrator';
    } else {
      // Check if user has moderator permissions
      const modPerms = this.moderationSystem.config.permissions;
      const hasAdminRole = interaction.member.roles.cache.some(role => 
        modPerms.administrator.roles.includes(role.id)
      );
      const isAdminUser = modPerms.administrator.users.includes(interaction.member.id);
      const hasModRole = interaction.member.roles.cache.some(role => 
        modPerms.moderator.roles.includes(role.id)
      );
      const isModUser = modPerms.moderator.users.includes(interaction.member.id);
      
      if (hasAdminRole || isAdminUser) {
        permissionLevel = 'System Administrator';
      } else if (hasModRole || isModUser) {
        permissionLevel = 'System Moderator';
      } else {
        return interaction.reply({
          content: `You do not have permission to review verifications.`,
          ephemeral: true
        });
      }
    }
    
    // Store permission level for logging
    verification.reviewerPermissionLevel = permissionLevel;

    // Update verification with reviewer info before processing
    verification.reviewedBy = interaction.user.id;
    verification.reviewerTag = interaction.user.tag;
    verification.reviewerPermissionLevel = permissionLevel;

    if (verification.status !== 'pending') {
      return interaction.reply({
        content: 'This verification has already been reviewed.',
        ephemeral: true
      });
    }

    // Defer reply after permission check but before processing
    if (type === 'approve') {
      await interaction.deferReply();
    }
    // For deny, we don't defer because we show a modal first

    try {
      if (type === 'approve') {
        await this.approveVerification(interaction, verification);
      } else {
        await this.denyVerification(interaction, verification);
      }
    } catch (error) {
      console.error('[GenderVerifySystem] Error handling verification action:', error);
      if (type === 'approve') {
        await interaction.editReply({
          content: 'Failed to process verification.'
        });
      }
    }
  }

  /**
   * Approve verification
   */
  async approveVerification(interaction, verification) {
    const guild = interaction.guild;
    const guildSetup = this.config.guilds[guild.id];
    const user = await this.client.users.fetch(verification.userId);
    const member = await guild.members.fetch(verification.userId).catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: 'User is no longer in the server.'
      });
    }

    // Assign role
    const roleId = verification.gender === 'female' ? guildSetup.roles.female : guildSetup.roles.male;
    await member.roles.add(roleId, `Gender verification approved by ${interaction.user.tag}`);

    // Store accepted user data
    this.acceptedUsers.set(verification.userId, {
      gender: verification.gender,
      approvedAt: new Date().toISOString(),
      approvedBy: interaction.user.id,
      approverTag: interaction.user.tag,
      guildId: guild.id
    });

    // Update verification status
    verification.status = 'approved';
    verification.reviewedAt = new Date().toISOString();
    verification.reviewedBy = interaction.user.id;

    this.saveVerificationData();

    // Send confirmation using embedLoader
    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    const confirmEmbed = embedLoader.success(
      `${user.tag} has been verified as ${verification.gender}`
    ).addFields(
      { name: 'Reviewed by', value: interaction.user.tag, inline: true },
      { name: 'Role assigned', value: `<@&${roleId}>`, inline: true }
    );

    await interaction.editReply({ embeds: [confirmEmbed] });

    // DM user if enabled
    if (this.config.notifications.dmResults) {
      try {
        const dmEmbed = embedLoader.success(this.config.messages.approved);
        await user.send({ embeds: [dmEmbed] });
      } catch (error) {
        console.log('[GenderVerifySystem] Could not DM user');
      }
    }

    // Delete review channel after delay
    setTimeout(async () => {
      try {
        const channel = guild.channels.cache.get(verification.channelId);
        if (channel) await channel.delete('Verification completed');
      } catch (error) {
        console.error('[GenderVerifySystem] Failed to delete review channel:', error);
      }
    }, 10000); // 10 seconds

    // Clean up active verification
    this.activeVerifications.delete(verification.id);
    this.userVerifications.delete(verification.userId);
    this.saveVerificationData();

    // Log action
    await this.logAction(guild, {
      action: 'Verification Approved',
      moderator: interaction.user,
      user: user,
      verificationId: verification.id.slice(-4),
      gender: verification.gender,
      additional: `Reviewed by ${verification.reviewerPermissionLevel || 'Unknown'}`
    });
  }

  /**
   * Deny verification
   */
  async denyVerification(interaction, verification) {
    // Show reason modal
    const modal = new ModalBuilder()
      .setCustomId(`verify_deny_reason_${verification.id}`)
      .setTitle('Deny Verification');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason for denial')
      .setPlaceholder('Please provide a reason for denying this verification')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);

    // Wait for modal submission
    const modalSubmit = await interaction.awaitModalSubmit({
      filter: i => i.customId === `verify_deny_reason_${verification.id}`,
      time: 300000 // 5 minutes
    }).catch(() => null);

    if (!modalSubmit) return;

    await modalSubmit.deferReply();

    const reason = modalSubmit.fields.getTextInputValue('reason');
    const guild = interaction.guild;
    const user = await this.client.users.fetch(verification.userId);

    // Update verification
    verification.status = 'denied';
    verification.reviewedAt = new Date().toISOString();
    verification.reviewedBy = interaction.user.id;
    verification.reviewReason = reason;

    this.saveVerificationData();

    // Send confirmation using embedLoader
    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    const confirmEmbed = embedLoader.error(
      `${user.tag}'s verification has been denied`
    ).addFields(
      { name: 'Reviewed by', value: interaction.user.tag, inline: true },
      { name: 'Reason', value: reason }
    );

    await modalSubmit.editReply({ embeds: [confirmEmbed] });

    // DM user if enabled
    if (this.config.notifications.dmResults) {
      try {
        const dmEmbed = embedLoader.error(
          this.config.messages.denied.replace('{reason}', reason)
        );
        await user.send({ embeds: [dmEmbed] });
      } catch (error) {
        console.log('[GenderVerifySystem] Could not DM user');
      }
    }

    // Delete review channel after delay
    setTimeout(async () => {
      try {
        const channel = guild.channels.cache.get(verification.channelId);
        if (channel) await channel.delete('Verification completed');
      } catch (error) {
        console.error('[GenderVerifySystem] Failed to delete review channel:', error);
      }
    }, 10000); // 10 seconds

    // Clean up
    this.activeVerifications.delete(verification.id);
    this.userVerifications.delete(verification.userId);
    this.saveVerificationData();

    // Log action
    await this.logAction(guild, {
      action: 'Verification Denied',
      moderator: interaction.user,
      user: user,
      verificationId: verification.id.slice(-4),
      reason: reason,
      additional: `Reviewed by ${verification.reviewerPermissionLevel || 'Unknown'}`
    });
  }

  /**
   * Utility methods
   */
  async createOrGetRole(guild, name, options = {}) {
    const existing = guild.roles.cache.find(r => r.name === name);
    if (existing) return existing;

    return await guild.roles.create({
      name,
      color: options.color || null,
      hoist: options.hoist || false,
      mentionable: options.mentionable || false,
      reason: 'Gender verification system setup'
    });
  }

  async createOrGetChannel(guild, options) {
    const existing = guild.channels.cache.find(c => c.name === options.name && c.parent?.id === options.parent);
    if (existing) return existing;

    return await guild.channels.create(options);
  }

  async createOrGetCategory(guild, name) {
    const existing = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (existing) {
      console.log(`[GenderVerifySystem] Found existing category: ${existing.name} (${existing.id})`);
      return existing;
    }

    const created = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: 'Gender verification system setup'
    });
    
    console.log(`[GenderVerifySystem] Created new category: ${created.name} (${created.id})`);
    return created;
  }

  async checkExistingSetup(guild) {
    const setup = this.config.guilds?.[guild.id];
    if (!setup) return { isSetup: false };

    const checks = {
      femaleRole: guild.roles.cache.has(setup.roles.female),
      maleRole: guild.roles.cache.has(setup.roles.male),
      verifyChannel: guild.channels.cache.has(setup.channels.verify),
      femaleChannel: guild.channels.cache.has(setup.channels.female),
      maleChannel: guild.channels.cache.has(setup.channels.male),
      verifiedChannel: guild.channels.cache.has(setup.channels.verified),
      verifiedVC: guild.channels.cache.has(setup.channels.verifiedVC),
      mainCategory: guild.channels.cache.has(setup.channels.mainCategory),
      reviewCategory: guild.channels.cache.has(setup.channels.reviewCategory)
    };

    const isSetup = Object.values(checks).every(v => v);
    return { isSetup, checks, setup };
  }

  getLastAttempt(userId) {
    // Check verification history for last attempt
    for (const [id, verification] of this.activeVerifications) {
      if (verification.userId === userId) {
        return new Date(verification.createdAt).getTime();
      }
    }
    return null;
  }

  cleanupOldData() {
    const cutoffDate = Date.now() - (this.config.deleteDataAfterDays * 24 * 60 * 60 * 1000);
    
    // Only clean up denied/old pending verifications, not accepted users
    for (const [id, verification] of this.activeVerifications) {
      if (verification.status === 'denied' && 
          verification.reviewedAt &&
          new Date(verification.reviewedAt).getTime() < cutoffDate) {
        this.activeVerifications.delete(id);
      }
    }
    
    this.saveVerificationData();
  }

  async logAction(guild, data) {
    if (!this.moderationSystem) return;
    
    await this.moderationSystem.logAction(guild, data);
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalSubmitted = 0;
    let totalApproved = 0;
    let totalDenied = 0;
    let activePending = 0;

    // Count from active verifications
    for (const [id, verification] of this.activeVerifications) {
      totalSubmitted++;
      if (verification.status === 'pending') {
        activePending++;
      } else if (verification.status === 'approved') {
        totalApproved++;
      } else if (verification.status === 'denied') {
        totalDenied++;
      }
    }

    // Add accepted users to approved count
    totalApproved += this.acceptedUsers.size;
    totalSubmitted += this.acceptedUsers.size;

    return {
      totalSubmitted,
      totalApproved,
      totalDenied,
      activePending
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    console.log(`[GenderVerifySystem] Saving config with ${Object.keys(this.config.guilds || {}).length} guild setups`);
    this.configLoader.set('genderVerify', this.config);
    const result = await this.configLoader.save();
    console.log('[GenderVerifySystem] Config save result:', result);
    return result;
  }
}