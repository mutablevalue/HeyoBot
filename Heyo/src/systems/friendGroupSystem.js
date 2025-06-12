// src/systems/friendGroupSystem.js
/**
 * Friend Group System
 * 
 * Allows users to apply for friend group voice channels with staff review.
 * 
 * Permission Hierarchy:
 * 1. Server Owner (if ownerBypass enabled) → Can setup system
 * 2. AntiNuke Administrators → Can setup system
 * 3. System Administrators → Can review applications
 * 4. System Moderators → Can review applications
 * 5. Regular Users → Can apply for friend groups
 * 
 * Features:
 * - Application system with member requirements
 * - Staff review process
 * - Custom role creation for accepted groups
 * - Voice channel management
 * - Persistent data storage
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

export class FriendGroupSystem {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   * @param {import("./moderationSystem.js").ModerationSystem} moderationSystem
   */
  constructor(client, configLoader, moderationSystem) {
    console.log('[FriendGroupSystem] Initializing...');
    
    this.client = client;
    this.configLoader = configLoader;
    this.moderationSystem = moderationSystem;
    
    // Get config from config loader
    this.config = this.configLoader.get('friendGroup') || {};
    
    // Load configuration values - no defaults
    this.loadConfigValues();
    
    // Active applications tracking
    this.activeApplications = new Map(); // applicationId -> application data
    this.userApplications = new Map(); // userId -> applicationId
    this.acceptedGroups = new Map(); // ownerId -> group data
    
    // Load data
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadGroupData();

    // Setup event listeners
    if (this.config.enabled) {
      console.log('[FriendGroupSystem] System enabled, setting up listeners');
      this.setupEventListeners();
    } else {
      console.log('[FriendGroupSystem] System disabled, skipping listeners');
    }
    
    console.log('[FriendGroupSystem] Initialization complete');
  }

  /**
   * Load configuration values from config
   */
  loadConfigValues() {
    // Required config values - no defaults
    if (!this.config.dataFile || !this.config.minMembers || !this.config.cooldown ||
        !this.config.messages || !this.config.reviewCategory || !this.config.friendGroupCategory) {
      console.error('[FriendGroupSystem] Missing required configuration values');
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
   * Load group data from file
   */
  loadGroupData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        
        if (data.activeApplications) {
          this.activeApplications = new Map(Object.entries(data.activeApplications));
        }
        
        if (data.userApplications) {
          this.userApplications = new Map(Object.entries(data.userApplications));
        }
        
        if (data.acceptedGroups) {
          this.acceptedGroups = new Map(Object.entries(data.acceptedGroups));
        }
        
        // Merge guild setups from data file with config
        if (data.guilds) {
          if (!this.config.guilds) this.config.guilds = {};
          for (const [guildId, setup] of Object.entries(data.guilds)) {
            if (!this.config.guilds[guildId]) {
              this.config.guilds[guildId] = setup;
            }
          }
        }
        
        console.log(`[FriendGroupSystem] Loaded ${this.acceptedGroups.size} friend groups`);
      }
    } catch (error) {
      console.error('[FriendGroupSystem] Error loading group data:', error);
    }
  }

  /**
   * Save group data to file
   */
  saveGroupData() {
    try {
      const data = {
        activeApplications: Object.fromEntries(this.activeApplications),
        userApplications: Object.fromEntries(this.userApplications),
        acceptedGroups: Object.fromEntries(this.acceptedGroups),
        guilds: this.config.guilds || {}
      };

      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[FriendGroupSystem] Error saving group data:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isButton()) {
        if (interaction.customId.startsWith('fg_')) {
          await this.handleApplicationAction(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('fg_deny_reason_')) {
          await this.handleDenyModal(interaction);
        }
      }
    });

    // Clean up old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Setup the friend group system
   */
  async setupFriendGroup(guild, options = {}) {
    try {
      // Check if already setup
      const existingSetup = this.config.guilds?.[guild.id];
      
      // Create or get the review category
      const reviewCategory = await this.createOrGetCategory(guild,
        options.reviewCategoryName || this.config.reviewCategory
      );

      // Create or get the friend group category
      const fgCategory = await this.createOrGetCategory(guild,
        options.fgCategoryName || this.config.friendGroupCategory
      );

      // Save setup data
      const setupData = {
        guildId: guild.id,
        categories: {
          review: reviewCategory.id,
          friendGroups: fgCategory.id
        },
        createdAt: existingSetup?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store in config
      if (!this.config.guilds) this.config.guilds = {};
      this.config.guilds[guild.id] = setupData;
      
      // Save to both config and data file
      await this.saveConfig();
      this.saveGroupData();
      
      console.log(`[FriendGroupSystem] Setup saved successfully for guild ${guild.id}`);

      return {
        success: true,
        setup: setupData,
        message: existingSetup ? 'Friend group system has been updated!' : 'Friend group system has been set up successfully!',
        wasUpdate: !!existingSetup
      };

    } catch (error) {
      console.error('[FriendGroupSystem] Setup error:', error);
      return {
        success: false,
        message: 'Failed to setup friend group system',
        error: error.message
      };
    }
  }

  /**
   * Handle modal submission for apply command
   */
  async handleModalSubmit(interaction) {
    const members = interaction.fields.getTextInputValue('members');
    const activity = interaction.fields.getTextInputValue('activity');
    const notes = interaction.fields.getTextInputValue('notes');

    // Parse member mentions
    const memberMentions = members.match(/<@!?(\d+)>/g) || [];
    const memberIds = memberMentions.map(mention => mention.replace(/<@!?|>/g, ''));
    
    // Remove duplicates and filter out the applicant
    const uniqueMembers = [...new Set(memberIds)].filter(id => id !== interaction.user.id);

    try {
      const application = await this.handleApplication(
        interaction,
        uniqueMembers,
        activity,
        notes
      );

      const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
      const embed = embedLoader.success(
        this.config.messages.applicationSubmitted
      ).addFields(
        { name: 'Application ID', value: `#${application.id.slice(-4)}`, inline: true },
        { name: 'Members', value: `${uniqueMembers.length}`, inline: true },
        { name: 'Status', value: 'Pending Review', inline: true }
      );

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('[FriendGroup] Error in modal submit:', error);
      
      await interaction.editReply({
        content: error.message || this.config.messages.errorSubmitting
      });
    }
  }

  /**
   * Reload configuration from file
   */
  reloadConfig() {
    console.log('[FriendGroupSystem] Reloading configuration...');
    
    // Reload from config file
    const currentConfig = this.configLoader.get('friendGroup');
    if (currentConfig) {
      // Preserve guilds data
      const guilds = this.config.guilds || {};
      
      // Update config with fresh values
      this.config = { ...currentConfig, guilds };
      
      console.log(`[FriendGroupSystem] Config reloaded. MinMembers from file: ${currentConfig.minMembers}, Using: ${this.config.minMembers}`);
    } else {
      console.log('[FriendGroupSystem] No friendGroup config found in file, using existing');
    }
  }

  /**
   * Verify and fix guild setup
   */
  async verifyAndFixSetup(guild) {
    const guildSetup = this.config.guilds?.[guild.id];
    if (!guildSetup) {
      return false;
    }

    let fixed = false;

    // Check review category
    if (!guild.channels.cache.get(guildSetup.categories.review)) {
      console.log('[FriendGroupSystem] Review category missing, recreating...');
      const reviewCategory = await this.createOrGetCategory(guild, this.config.reviewCategory);
      guildSetup.categories.review = reviewCategory.id;
      fixed = true;
    }

    // Check friend groups category
    if (!guild.channels.cache.get(guildSetup.categories.friendGroups)) {
      console.log('[FriendGroupSystem] Friend groups category missing, recreating...');
      const fgCategory = await this.createOrGetCategory(guild, this.config.friendGroupCategory);
      guildSetup.categories.friendGroups = fgCategory.id;
      fixed = true;
    }

    if (fixed) {
      guildSetup.updatedAt = new Date().toISOString();
      this.saveGroupData();
      await this.saveConfig();
      console.log('[FriendGroupSystem] Guild setup fixed and saved');
    }

    return true;
  }

  /**
   * Handle friend group application
   */
  async handleApplication(interaction, members, activity, notes) {
    // Reload config to get latest values
    this.reloadConfig();
    
    const guild = interaction.guild;
    const user = interaction.user;
    const guildSetup = this.config.guilds?.[guild.id];
    
    if (!guildSetup) {
      throw new Error(this.config.messages.setupRequired);
    }

    // Verify and fix setup if needed
    await this.verifyAndFixSetup(guild);

    // Check if user already has a friend group
    if (this.acceptedGroups.has(user.id)) {
      throw new Error(this.config.messages.alreadyHasGroup);
    }

    // Check if user has pending application
    if (this.userApplications.has(user.id)) {
      throw new Error(this.config.messages.pendingApplication);
    }

    // Check cooldown
    const lastAttempt = this.getLastAttempt(user.id);
    if (lastAttempt) {
      const timeSince = Date.now() - lastAttempt;
      if (timeSince < this.config.cooldown) {
        const timeLeft = Math.ceil((this.config.cooldown - timeSince) / 1000 / 60 / 60 / 24);
        throw new Error(this.config.messages.cooldownActive.replace('{time}', `${timeLeft} days`));
      }
    }

    // Validate member count
    console.log(`[FriendGroupSystem] Validating members: ${members.length} provided, ${this.config.minMembers} required`);
    if (members.length < this.config.minMembers) {
      const errorMsg = this.config.messages.notEnoughMembers.replace('{min}', String(this.config.minMembers));
      console.log(`[FriendGroupSystem] Validation failed: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Create application
    const applicationId = Date.now().toString();
    
    // Get the review category
    let reviewCategory = guild.channels.cache.get(guildSetup.categories.review);
    
    // If review category doesn't exist, create it
    if (!reviewCategory) {
      console.log('[FriendGroupSystem] Review category not found, creating...');
      try {
        reviewCategory = await this.createOrGetCategory(guild, this.config.reviewCategory);
        
        // Update the guild setup with new category ID
        guildSetup.categories.review = reviewCategory.id;
        this.saveGroupData();
        await this.saveConfig();
        
        console.log(`[FriendGroupSystem] Created review category: ${reviewCategory.id}`);
      } catch (error) {
        console.error('[FriendGroupSystem] Failed to create review category:', error);
        throw new Error('Failed to create review category. Please run /setupfg again.');
      }
    }

    // Create review channel
    const channelName = this.config.applicationChannelFormat.replace('{number}', applicationId.slice(-4));
    const reviewChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: reviewCategory.id,
      topic: `Friend group application from ${user.tag}`,
      reason: `FG application from ${user.tag}`
    });

    // Set permissions
    await this.setReviewChannelPermissions(reviewChannel);

    // Create application data
    const applicationData = {
      id: applicationId,
      userId: user.id,
      userTag: user.tag,
      guildId: guild.id,
      channelId: reviewChannel.id,
      members: members,
      activity: activity,
      notes: notes,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Save application
    this.activeApplications.set(applicationId, applicationData);
    this.userApplications.set(user.id, applicationId);
    this.saveGroupData();

    // Send review embed
    await this.sendReviewEmbed(reviewChannel, applicationData);

    // Log submission
    await this.logAction(guild, {
      action: 'Friend Group Application Submitted',
      user: user,
      applicationId: applicationId.slice(-4),
      memberCount: members.length,
      reviewChannel: `<#${reviewChannel.id}>`
    });

    return applicationData;
  }

  /**
   * Send review embed to channel
   */
  async sendReviewEmbed(channel, application) {
    const user = await this.client.users.fetch(application.userId);
    const guild = channel.guild;
    
    // Get member objects for all mentioned members
    const memberList = [];
    for (const memberId of application.members) {
      try {
        const member = await guild.members.fetch(memberId);
        memberList.push(`${member.user.tag} (${memberId})`);
      } catch {
        memberList.push(`Unknown User (${memberId})`);
      }
    }

    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    const embed = embedLoader.createEmbed({
      description: `User ${user} has submitted a friend group application`,
      fields: [
        { name: 'Applicant', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Member Count', value: `${application.members.length}`, inline: true },
        { name: 'Account Age', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Activity Plan', value: application.activity || 'None provided' },
        { name: 'Members', value: memberList.join('\n').slice(0, 1024) },
        { name: 'Additional Notes', value: application.notes || 'None' }
      ]
    });

    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`fg_approve_${application.id}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`fg_deny_${application.id}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger)
      );

    // Mention staff if configured
    const modPerms = this.moderationSystem.config.permissions;
    const staffMentions = [...modPerms.administrator.roles, ...modPerms.moderator.roles]
      .filter(roleId => guild.roles.cache.has(roleId))
      .map(roleId => `<@&${roleId}>`)
      .join(' ');

    const messageContent = staffMentions 
      ? `${staffMentions}\n\nNew friend group application from ${user}` 
      : `New friend group application from ${user}`;

    await channel.send({
      content: messageContent,
      embeds: [embed],
      components: [actionRow]
    });
  }

  /**
   * Set review channel permissions
   */
  async setReviewChannelPermissions(channel) {
    const guild = channel.guild;
    
    // Deny everyone
    await channel.permissionOverwrites.create(guild.id, {
      ViewChannel: false
    });
    
    // Allow bot
    await channel.permissionOverwrites.create(this.client.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ManageChannels: true
    });

    // Add staff permissions
    const modPerms = this.moderationSystem.config.permissions;
    
    // Add administrator users and roles
    for (const userId of modPerms.administrator.users) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await channel.permissionOverwrites.create(userId, {
            ViewChannel: true,
            SendMessages: true,
            ManageMessages: true
          });
        }
      } catch (error) {
        console.log(`[FriendGroupSystem] Could not add admin user ${userId}`);
      }
    }
    
    for (const roleId of modPerms.administrator.roles) {
      if (guild.roles.cache.has(roleId)) {
        await channel.permissionOverwrites.create(roleId, {
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
          await channel.permissionOverwrites.create(userId, {
            ViewChannel: true,
            SendMessages: true
          });
        }
      } catch (error) {
        console.log(`[FriendGroupSystem] Could not add mod user ${userId}`);
      }
    }
    
    for (const roleId of modPerms.moderator.roles) {
      if (guild.roles.cache.has(roleId)) {
        await channel.permissionOverwrites.create(roleId, {
          ViewChannel: true,
          SendMessages: true
        });
      }
    }
  }

  /**
   * Handle application review actions
   */
  async handleApplicationAction(interaction) {
    const [action, type, applicationId] = interaction.customId.split('_');
    const application = this.activeApplications.get(applicationId);

    if (!application) {
      return interaction.reply({
        content: 'This application no longer exists.',
        ephemeral: true
      });
    }

    // Check permission hierarchy: Owner > AntiNuke > Administration > Moderation
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const ownerBypassEnabled = this.moderationSystem.config.ownerBypass;
    
    // Get AntiNuke config
    const antiNukeConfig = this.configLoader.get('antiNuke');
    const isAntiNukeWhitelisted = antiNukeConfig?.whitelist?.users?.includes(interaction.user.id) ||
      interaction.member.roles.cache.some(role => antiNukeConfig?.whitelist?.roles?.includes(role.id));
    const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
      interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
    
    // Check moderation permissions
    const modPerms = this.moderationSystem.config.permissions;
    const hasAdminRole = interaction.member.roles.cache.some(role => 
      modPerms.administrator.roles.includes(role.id)
    );
    const isAdminUser = modPerms.administrator.users.includes(interaction.user.id);
    const hasModRole = interaction.member.roles.cache.some(role => 
      modPerms.moderator.roles.includes(role.id)
    );
    const isModUser = modPerms.moderator.users.includes(interaction.user.id);
    
    // Check if user has any permission to review
    const canReview = (isOwner && ownerBypassEnabled) || 
                      isAntiNukeWhitelisted || 
                      isAntiNukeAdmin || 
                      hasAdminRole || 
                      isAdminUser || 
                      hasModRole || 
                      isModUser;
    
    if (!canReview) {
      return interaction.reply({
        content: 'You do not have permission to review applications.',
        ephemeral: true
      });
    }

    if (application.status !== 'pending') {
      return interaction.reply({
        content: 'This application has already been reviewed.',
        ephemeral: true
      });
    }

    // Store permission level for logging
    let permissionLevel = 'Unknown';
    if (isOwner && ownerBypassEnabled) {
      permissionLevel = 'Server Owner';
    } else if (isAntiNukeAdmin) {
      permissionLevel = 'AntiNuke Administrator';
    } else if (isAntiNukeWhitelisted) {
      permissionLevel = 'AntiNuke Whitelisted';
    } else if (hasAdminRole || isAdminUser) {
      permissionLevel = 'System Administrator';
    } else if (hasModRole || isModUser) {
      permissionLevel = 'System Moderator';
    }
    
    application.reviewerPermissionLevel = permissionLevel;

    if (type === 'approve') {
      await interaction.deferReply();
      await this.approveApplication(interaction, application);
    } else {
      // Show deny modal
      const modal = new ModalBuilder()
        .setCustomId(`fg_deny_reason_${applicationId}`)
        .setTitle('Deny Friend Group Application');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for denial')
        .setPlaceholder('Please provide a reason for denying this application')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
  }

  /**
   * Handle deny modal submission
   */
  async handleDenyModal(interaction) {
    const applicationId = interaction.customId.split('_').pop();
    const application = this.activeApplications.get(applicationId);
    
    if (!application) {
      return interaction.reply({
        content: 'Application not found.',
        ephemeral: true
      });
    }

    await interaction.deferReply();
    
    const reason = interaction.fields.getTextInputValue('reason');
    await this.denyApplication(interaction, application, reason);
  }

  /**
   * Approve application
   */
  async approveApplication(interaction, application) {
    const guild = interaction.guild;
    const user = await this.client.users.fetch(application.userId);
    const member = await guild.members.fetch(application.userId).catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: 'User is no longer in the server.'
      });
    }

    // Create temporary owner role
    const tempRole = await this.createOrGetRole(guild, this.config.tempOwnerRole, {
      color: null,
      hoist: false
    });

    await member.roles.add(tempRole, `Friend group approved by ${interaction.user.tag}`);

    // Store accepted group data
    this.acceptedGroups.set(application.userId, {
      applicationId: application.id,
      members: application.members,
      approvedAt: new Date().toISOString(),
      approvedBy: interaction.user.id,
      approverTag: interaction.user.tag,
      guildId: guild.id,
      tempRoleId: tempRole.id,
      status: 'pending_setup' // Waiting for owner to set up their group
    });

    // Update application status
    application.status = 'approved';
    application.reviewedAt = new Date().toISOString();
    application.reviewedBy = interaction.user.id;

    this.saveGroupData();

    // Send confirmation using embedLoader
    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    const confirmEmbed = embedLoader.success(
      `${user.tag}'s friend group application has been approved`
    ).addFields(
      { name: 'Reviewed by', value: interaction.user.tag, inline: true },
      { name: 'Temporary role assigned', value: `<@&${tempRole.id}>`, inline: true }
    );

    await interaction.editReply({ embeds: [confirmEmbed] });

    // DM user with instructions
    if (this.config.notifications.dmResults) {
      try {
        const dmEmbed = embedLoader.system(
          'Friend Group Application Approved',
          'Your friend group application has been approved!'
        ).addFields(
          { 
            name: 'Next Steps', 
            value: `1. Use \`/renamefg\` to rename your owner role\n2. Use \`/createfgrole\` to create your friend group role\n3. Use \`/createfgvc\` to create your voice channel\n4. Use \`/fgvc role allow <role>\` to set permissions`
          },
          {
            name: 'Your Members',
            value: `You applied with ${application.members.length} members`
          }
        );

        await user.send({ embeds: [dmEmbed] });
      } catch (error) {
        console.log('[FriendGroupSystem] Could not DM user');
      }
    }

    // Delete review channel after delay
    setTimeout(async () => {
      try {
        const channel = guild.channels.cache.get(application.channelId);
        if (channel) await channel.delete('Application completed');
      } catch (error) {
        console.error('[FriendGroupSystem] Failed to delete review channel:', error);
      }
    }, 10000); // 10 seconds

    // Clean up application
    this.activeApplications.delete(application.id);
    this.userApplications.delete(application.userId);
    this.saveGroupData();

    // Log action
    await this.logAction(guild, {
      action: 'Friend Group Application Approved',
      moderator: interaction.user,
      user: user,
      applicationId: application.id.slice(-4)
    });
  }

  /**
   * Deny application
   */
  async denyApplication(interaction, application, reason) {
    const guild = interaction.guild;
    const user = await this.client.users.fetch(application.userId);

    // Update application
    application.status = 'denied';
    application.reviewedAt = new Date().toISOString();
    application.reviewedBy = interaction.user.id;
    application.reviewReason = reason;

    this.saveGroupData();

    // Send confirmation using embedLoader
    const embedLoader = this.moderationSystem.embedLoader || this.client.embedLoader;
    const confirmEmbed = embedLoader.error(
      `${user.tag}'s friend group application has been denied`
    ).addFields(
      { name: 'Reviewed by', value: interaction.user.tag, inline: true },
      { name: 'Reason', value: reason }
    );

    await interaction.editReply({ embeds: [confirmEmbed] });

    // DM user if enabled
    if (this.config.notifications.dmResults) {
      try {
        const dmEmbed = embedLoader.error(
          this.config.messages.applicationDenied.replace('{reason}', reason)
        );
        await user.send({ embeds: [dmEmbed] });
      } catch (error) {
        console.log('[FriendGroupSystem] Could not DM user');
      }
    }

    // Delete review channel after delay
    setTimeout(async () => {
      try {
        const channel = guild.channels.cache.get(application.channelId);
        if (channel) await channel.delete('Application completed');
      } catch (error) {
        console.error('[FriendGroupSystem] Failed to delete review channel:', error);
      }
    }, 10000); // 10 seconds

    // Clean up
    this.activeApplications.delete(application.id);
    this.userApplications.delete(application.userId);
    this.saveGroupData();

    // Log action
    await this.logAction(guild, {
      action: 'Friend Group Application Denied',
      moderator: interaction.user,
      user: user,
      applicationId: application.id.slice(-4),
      reason: reason
    });
  }

  /**
   * Create friend group voice channel
   */
  async createVoiceChannel(guild, ownerId, name) {
    const guildSetup = this.config.guilds?.[guild.id];
    if (!guildSetup) {
      throw new Error('Friend group system not set up');
    }

    const groupData = this.acceptedGroups.get(ownerId);
    if (!groupData) {
      throw new Error('You do not own a friend group');
    }

    // Check if already has VC
    if (groupData.voiceChannelId) {
      const existingVC = guild.channels.cache.get(groupData.voiceChannelId);
      if (existingVC) {
        throw new Error('You already have a voice channel');
      }
    }

    let category = guild.channels.cache.get(guildSetup.categories.friendGroups);
    
    // If category doesn't exist, create it
    if (!category) {
      console.log('[FriendGroupSystem] Friend groups category not found, creating...');
      try {
        category = await this.createOrGetCategory(guild, this.config.friendGroupCategory);
        
        // Update the guild setup with new category ID
        guildSetup.categories.friendGroups = category.id;
        this.saveGroupData();
        await this.saveConfig();
        
        console.log(`[FriendGroupSystem] Created friend groups category: ${category.id}`);
      } catch (error) {
        console.error('[FriendGroupSystem] Failed to create friend groups category:', error);
        throw new Error('Failed to create friend groups category');
      }
    }

    // Create voice channel
    const voiceChannel = await guild.channels.create({
      name: name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: this.config.vcUserLimit,
      bitrate: this.config.vcBitrate,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.Connect]
        },
        {
          id: ownerId, // Owner
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.Stream,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers
          ]
        }
      ]
    });

    // Update group data
    groupData.voiceChannelId = voiceChannel.id;
    groupData.voiceChannelName = name;
    this.saveGroupData();

    return voiceChannel;
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
      reason: 'Friend group system'
    });
  }

  async createOrGetCategory(guild, name) {
    const existing = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (existing) return existing;

    return await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: 'Friend group system setup'
    });
  }

  getLastAttempt(userId) {
    // Check application history for last attempt
    for (const [id, application] of this.activeApplications) {
      if (application.userId === userId) {
        return new Date(application.createdAt).getTime();
      }
    }
    return null;
  }

  cleanupOldData() {
    const cutoffDate = Date.now() - (this.config.deleteDataAfterDays * 24 * 60 * 60 * 1000);
    
    // Clean up old denied applications
    for (const [id, application] of this.activeApplications) {
      if (application.status === 'denied' && 
          application.reviewedAt &&
          new Date(application.reviewedAt).getTime() < cutoffDate) {
        this.activeApplications.delete(id);
      }
    }
    
    this.saveGroupData();
  }

  async logAction(guild, data) {
    if (!this.moderationSystem) return;
    
    await this.moderationSystem.logAction(guild, data);
  }

  /**
   * Disband a friend group
   */
  async disbandGroup(guild, ownerId) {
    const groupData = this.acceptedGroups.get(ownerId);
    if (!groupData || groupData.guildId !== guild.id) {
      return { success: false, error: 'Friend group not found' };
    }

    const results = {
      voiceChannel: false,
      memberRole: false,
      ownerRole: false
    };

    try {
      // Delete voice channel
      if (groupData.voiceChannelId) {
        const voiceChannel = guild.channels.cache.get(groupData.voiceChannelId);
        if (voiceChannel) {
          await voiceChannel.delete('Friend group disbanded');
          results.voiceChannel = true;
        }
      }

      // Delete member role
      if (groupData.memberRoleId) {
        const memberRole = guild.roles.cache.get(groupData.memberRoleId);
        if (memberRole) {
          await memberRole.delete('Friend group disbanded');
          results.memberRole = true;
        }
      }

      // Delete owner role
      if (groupData.tempRoleId) {
        const ownerRole = guild.roles.cache.get(groupData.tempRoleId);
        if (ownerRole) {
          await ownerRole.delete('Friend group disbanded');
          results.ownerRole = true;
        }
      }

      // Remove from accepted groups
      this.acceptedGroups.delete(ownerId);
      this.saveGroupData();

      return { success: true, results };
    } catch (error) {
      console.error('[FriendGroupSystem] Error disbanding group:', error);
      return { success: false, error: error.message, results };
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalApplications = 0;
    let pendingApplications = 0;
    let approvedApplications = 0;
    let deniedApplications = 0;

    for (const [id, application] of this.activeApplications) {
      totalApplications++;
      if (application.status === 'pending') pendingApplications++;
      else if (application.status === 'approved') approvedApplications++;
      else if (application.status === 'denied') deniedApplications++;
    }

    return {
      totalApplications,
      pendingApplications,
      approvedApplications,
      deniedApplications,
      activeGroups: this.acceptedGroups.size
    };
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    this.configLoader.set('friendGroup', this.config);
    return this.configLoader.save();
  }
}