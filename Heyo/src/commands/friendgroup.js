// src/commands/friendgroup.js
/**
 * Friend Group System Commands
 * 
 * Permission Tiers:
 * - Server Owner → Can setup system
 * - AntiNuke Admin → Can setup system
 * - System Admin → Can review applications
 * - System Moderator → Can review applications
 * - Friend Group Owner → Can manage their group
 * - Regular User → Can apply for friend group
 */
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';

let friendGroupSystem = null;
let moderationSystem = null;

export function setFriendGroupSystem(system) {
  friendGroupSystem = system;
}

export function setModerationSystem(system) {
  moderationSystem = system;
}

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('setupfg')
      .setDescription('Setup the friend group system (Owner/AntiNuke Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(option =>
        option.setName('review_category')
          .setDescription('Name for the review category')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('fg_category')
          .setDescription('Name for the friend groups category')
          .setRequired(false)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy: Owner > AntiNuke > Admin
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      
      const hasPermission = (isOwner && ownerBypassEnabled) || isAntiNukeAdmin;
      
      if (!hasPermission) {
        return interaction.reply({
          content: 'Only the server owner or AntiNuke administrators can setup the friend group system.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      const options = {
        reviewCategoryName: interaction.options.getString('review_category'),
        fgCategoryName: interaction.options.getString('fg_category')
      };

      const result = await friendGroupSystem.setupFriendGroup(interaction.guild, options);
      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;

      if (result.success) {
        const embed = embedLoader.system(
          'Friend Group System',
          result.message
        ).addFields(
          { name: 'Review Category', value: `Created/Found: **${options.reviewCategoryName || 'Staff Review'}**`, inline: false },
          { name: 'Friend Groups Category', value: `Created/Found: **${options.fgCategoryName || 'Friendgroups'}**`, inline: false }
        );

        await interaction.editReply({ embeds: [embed] });

        // Log the setup
        if (moderationSystem) {
          let permissionLevel = isOwner && ownerBypassEnabled ? 'Server Owner' : 'AntiNuke Administrator';
          
          await moderationSystem.logAction(interaction.guild, {
            action: 'Friend Group System Setup',
            moderator: interaction.user,
            additional: `System configured successfully by ${permissionLevel}`
          });
        }
      } else {
        const embed = embedLoader.error(result.message);

        if (result.error) {
          embed.addFields({ name: 'Error', value: result.error });
        }

        await interaction.editReply({ embeds: [embed] });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('applyfg')
      .setDescription('Apply for a friend group')
      .addStringOption(option =>
        option.setName('members')
          .setDescription('Ping all your group members (minimum required set by server)')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('activity')
          .setDescription('Explain how your group will be active')
          .setRequired(true)
          .setMaxLength(500))
      .addStringOption(option =>
        option.setName('notes')
          .setDescription('Additional notes for staff')
          .setRequired(true)
          .setMaxLength(500)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        // Force reload config to get latest values
        friendGroupSystem.reloadConfig();
        console.log(`[FriendGroup] Current minMembers setting: ${friendGroupSystem.config.minMembers}`);
        
        // Parse member mentions
        const memberString = interaction.options.getString('members');
        const memberMentions = memberString.match(/<@!?(\d+)>/g) || [];
        const memberIds = memberMentions.map(mention => mention.replace(/<@!?|>/g, ''));
        
        // Remove duplicates and filter out the applicant
        const uniqueMembers = [...new Set(memberIds)].filter(id => id !== interaction.user.id);

        const activity = interaction.options.getString('activity');
        const notes = interaction.options.getString('notes');

        // Create application
        const application = await friendGroupSystem.handleApplication(
          interaction,
          uniqueMembers,
          activity,
          notes
        );

        const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
        const embed = embedLoader.success(
          friendGroupSystem.config.messages.applicationSubmitted
        ).addFields(
          { name: 'Application ID', value: `#${application.id.slice(-4)}`, inline: true },
          { name: 'Members', value: `${uniqueMembers.length}`, inline: true },
          { name: 'Status', value: 'Pending Review', inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        // Only log unexpected errors, not user validation errors
        const expectedErrors = [
          friendGroupSystem.config.messages.alreadyHasGroup,
          friendGroupSystem.config.messages.pendingApplication,
          friendGroupSystem.config.messages.setupRequired
        ];
        
        const isExpectedError = expectedErrors.some(msg => 
          error.message.includes(msg) || error.message.includes('You must mention at least')
        );
        
        if (!isExpectedError) {
          console.error('[FriendGroup] Unexpected error in applyfg:', error);
        }
        
        await interaction.editReply({
          content: error.message || friendGroupSystem.config.messages.errorSubmitting
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('renamefg')
      .setDescription('Rename your friend group owner role')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('New name for your owner role')
          .setRequired(true)
          .setMaxLength(100)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      const groupData = friendGroupSystem.acceptedGroups.get(interaction.user.id);
      if (!groupData || groupData.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: 'You do not own a friend group in this server.',
          ephemeral: true
        });
      }

      const newName = interaction.options.getString('name');
      
      try {
        const role = interaction.guild.roles.cache.get(groupData.tempRoleId);
        if (!role) {
          return interaction.reply({
            content: 'Your owner role was not found.',
            ephemeral: true
          });
        }

        await role.setName(newName, `Friend group owner renamed their role`);
        
        // Update group data
        groupData.ownerRoleName = newName;
        friendGroupSystem.saveGroupData();

        const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
        const embed = embedLoader.success(
          `Your owner role has been renamed to **${newName}**`
        );

        await interaction.reply({ embeds: [embed], ephemeral: true });

      } catch (error) {
        console.error('[FriendGroup] Error renaming role:', error);
        await interaction.reply({
          content: 'Failed to rename role. Please try again later.',
          ephemeral: true
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('createfgrole')
      .setDescription('Create your friend group member role')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name for your friend group role')
          .setRequired(true)
          .setMaxLength(100))
      .addStringOption(option =>
        option.setName('color')
          .setDescription('Hex color for the role (e.g., #FF0000)')
          .setRequired(false)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      const groupData = friendGroupSystem.acceptedGroups.get(interaction.user.id);
      if (!groupData || groupData.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: 'You do not own a friend group in this server.',
          ephemeral: true
        });
      }

      if (groupData.memberRoleId) {
        return interaction.reply({
          content: 'You already have a friend group member role.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString('name');
      const colorString = interaction.options.getString('color');
      
      let color = null;
      if (colorString) {
        const hex = colorString.replace('#', '');
        color = parseInt(hex, 16);
        if (isNaN(color)) {
          return interaction.editReply({
            content: 'Invalid color format. Please use hex format like #FF0000'
          });
        }
      }

      try {
        const role = await interaction.guild.roles.create({
          name: name,
          color: color || friendGroupSystem.config.defaultRoleColor,
          mentionable: true,
          reason: `Friend group role created by ${interaction.user.tag}`
        });

        // Give role to owner
        await interaction.member.roles.add(role);

        // Give role to all members from the application
        for (const memberId of groupData.members) {
          try {
            const member = await interaction.guild.members.fetch(memberId);
            await member.roles.add(role, 'Friend group member');
          } catch (error) {
            console.log(`[FriendGroup] Could not add role to member ${memberId}`);
          }
        }

        // Update group data
        groupData.memberRoleId = role.id;
        groupData.memberRoleName = name;
        groupData.status = 'active';
        friendGroupSystem.saveGroupData();

        const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
        const embed = embedLoader.success(
          `Your friend group role <@&${role.id}> has been created!`
        ).addFields(
          { name: 'Role Name', value: name, inline: true },
          { name: 'Members Added', value: `${groupData.members.length + 1} (including you)`, inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('[FriendGroup] Error creating role:', error);
        await interaction.editReply({
          content: 'Failed to create role. Please try again later.'
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('createfgvc')
      .setDescription('Create your friend group voice channel')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name for your voice channel')
          .setRequired(true)
          .setMaxLength(100)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      const groupData = friendGroupSystem.acceptedGroups.get(interaction.user.id);
      if (!groupData || groupData.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: 'You do not own a friend group in this server.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString('name');

      try {
        const voiceChannel = await friendGroupSystem.createVoiceChannel(
          interaction.guild,
          interaction.user.id,
          name
        );

        const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
        const embed = embedLoader.success(
          `Your voice channel ${voiceChannel} has been created!`
        ).addFields(
          { name: 'Channel', value: `${voiceChannel}`, inline: true },
          { name: 'Status', value: 'Locked (viewable by all)', inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('[FriendGroup] Error creating VC:', error);
        await interaction.editReply({
          content: error.message || 'Failed to create voice channel.'
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('fgvc')
      .setDescription('Manage your friend group voice channel permissions')
      .addSubcommand(subcommand =>
        subcommand
          .setName('role')
          .setDescription('Manage role access to your voice channel')
          .addStringOption(option =>
            option.setName('action')
              .setDescription('Allow or deny access')
              .setRequired(true)
              .addChoices(
                { name: 'Allow', value: 'allow' },
                { name: 'Deny', value: 'deny' }
              ))
          .addRoleOption(option =>
            option.setName('role')
              .setDescription('The role to manage')
              .setRequired(true)))
      .addSubcommand(subcommand =>
        subcommand
          .setName('user')
          .setDescription('Manage user access to your voice channel')
          .addStringOption(option =>
            option.setName('action')
              .setDescription('Allow or deny access')
              .setRequired(true)
              .addChoices(
                { name: 'Allow', value: 'allow' },
                { name: 'Deny', value: 'deny' }
              ))
          .addUserOption(option =>
            option.setName('user')
              .setDescription('The user to manage')
              .setRequired(true))),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      const groupData = friendGroupSystem.acceptedGroups.get(interaction.user.id);
      if (!groupData || groupData.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: 'You do not own a friend group in this server.',
          ephemeral: true
        });
      }

      if (!groupData.voiceChannelId) {
        return interaction.reply({
          content: 'You have not created a voice channel yet. Use `/createfgvc` first.',
          ephemeral: true
        });
      }

      const voiceChannel = interaction.guild.channels.cache.get(groupData.voiceChannelId);
      if (!voiceChannel) {
        return interaction.reply({
          content: 'Your voice channel was not found.',
          ephemeral: true
        });
      }

      const subcommand = interaction.options.getSubcommand();
      const action = interaction.options.getString('action');
      const allow = action === 'allow';

      try {
        if (subcommand === 'role') {
          const role = interaction.options.getRole('role');
          
          await voiceChannel.permissionOverwrites.edit(role.id, {
            Connect: allow ? true : false,
            Speak: allow ? true : false,
            Stream: allow ? true : false
          });

          const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
          const embed = embedLoader.success(
            `${allow ? 'Allowed' : 'Denied'} access for role ${role}`
          );

          await interaction.reply({ embeds: [embed], ephemeral: true });

        } else if (subcommand === 'user') {
          const user = interaction.options.getUser('user');
          
          await voiceChannel.permissionOverwrites.edit(user.id, {
            Connect: allow ? true : false,
            Speak: allow ? true : false,
            Stream: allow ? true : false
          });

          const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
          const embed = embedLoader.success(
            `${allow ? 'Allowed' : 'Denied'} access for user ${user}`
          );

          await interaction.reply({ embeds: [embed], ephemeral: true });
        }

      } catch (error) {
        console.error('[FriendGroup] Error managing VC permissions:', error);
        await interaction.reply({
          content: 'Failed to update permissions. Please try again later.',
          ephemeral: true
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('fgstats')
      .setDescription('View friend group statistics')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeWhitelisted = antiNukeConfig?.whitelist?.users?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.whitelist?.roles?.includes(role.id));
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const modPerms = moderationSystem.config.permissions;
      const hasModPerms = interaction.member.roles.cache.some(role => 
        modPerms.administrator.roles.includes(role.id) || 
        modPerms.moderator.roles.includes(role.id)
      ) || modPerms.administrator.users.includes(interaction.user.id) || 
        modPerms.moderator.users.includes(interaction.user.id);
      
      const canView = (isOwner && ownerBypassEnabled) || 
                      isAntiNukeWhitelisted || 
                      isAntiNukeAdmin || 
                      hasModPerms || 
                      interaction.member.permissions.has(PermissionFlagsBits.ManageRoles);
      
      if (!canView) {
        return interaction.reply({
          content: 'You do not have permission to view friend group stats.',
          ephemeral: true
        });
      }

      const stats = friendGroupSystem.getStats();
      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
      
      const embed = embedLoader.createEmbed({
        description: 'Friend group system statistics',
        fields: [
          { name: 'Total Applications', value: String(stats.totalApplications), inline: true },
          { name: 'Pending', value: String(stats.pendingApplications), inline: true },
          { name: 'Approved', value: String(stats.approvedApplications), inline: true },
          { name: 'Denied', value: String(stats.deniedApplications), inline: true },
          { name: 'Active Groups', value: String(stats.activeGroups), inline: true }
        ]
      });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('fglist')
      .setDescription('List all friend groups')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeWhitelisted = antiNukeConfig?.whitelist?.users?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.whitelist?.roles?.includes(role.id));
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const modPerms = moderationSystem.config.permissions;
      const hasModPerms = interaction.member.roles.cache.some(role => 
        modPerms.administrator.roles.includes(role.id) || 
        modPerms.moderator.roles.includes(role.id)
      ) || modPerms.administrator.users.includes(interaction.user.id) || 
        modPerms.moderator.users.includes(interaction.user.id);
      
      const canView = (isOwner && ownerBypassEnabled) || 
                      isAntiNukeWhitelisted || 
                      isAntiNukeAdmin || 
                      hasModPerms || 
                      interaction.member.permissions.has(PermissionFlagsBits.ManageRoles);
      
      if (!canView) {
        return interaction.reply({
          content: 'You do not have permission to view friend groups.',
          ephemeral: true
        });
      }

      const groups = Array.from(friendGroupSystem.acceptedGroups.entries())
        .filter(([, data]) => data.guildId === interaction.guild.id);

      if (groups.length === 0) {
        return interaction.reply({
          content: 'No active friend groups in this server.',
          ephemeral: true
        });
      }

      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
      const embed = embedLoader.createEmbed({
        description: 'Active friend groups in this server'
      });

      for (const [ownerId, data] of groups) {
        const owner = await interaction.guild.members.fetch(ownerId).catch(() => null);
        const ownerName = owner ? owner.user.tag : 'Unknown User';
        
        let value = `Status: ${data.status}\n`;
        value += `Members: ${data.members.length}\n`;
        if (data.memberRoleName) value += `Role: ${data.memberRoleName}\n`;
        if (data.voiceChannelName) value += `VC: ${data.voiceChannelName}`;

        embed.addFields({
          name: ownerName,
          value: value.trim(),
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('fgdebug')
      .setDescription('Debug friend group configuration (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      // Check admin permissions
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      
      if (!isOwner && !isAntiNukeAdmin) {
        return interaction.reply({
          content: 'Only server owner or AntiNuke admins can view debug info.',
          ephemeral: true
        });
      }

      // Reload config to get latest
      friendGroupSystem.reloadConfig();
      
      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
      const embed = embedLoader.createEmbed({
        description: 'Friend group system debug information',
        fields: [
          { name: 'System Enabled', value: `${friendGroupSystem.config.enabled}`, inline: true },
          { name: 'Min Members', value: `${friendGroupSystem.config.minMembers}`, inline: true },
          { name: 'Cooldown', value: `${friendGroupSystem.config.cooldown / 1000 / 60 / 60 / 24} days`, inline: true },
          { name: 'Max Applications', value: `${friendGroupSystem.config.maxApplicationsPerUser}`, inline: true },
          { name: 'Max Active Groups', value: `${friendGroupSystem.config.maxActiveGroups}`, inline: true },
          { name: 'Data File', value: friendGroupSystem.config.dataFile, inline: true },
          { name: 'Review Category', value: friendGroupSystem.config.reviewCategory, inline: true },
          { name: 'FG Category', value: friendGroupSystem.config.friendGroupCategory, inline: true },
          { name: 'Log Channel', value: friendGroupSystem.config.logChannel || 'Using mod log', inline: true }
        ]
      });
      
      // Add guild setup info
      const guildSetup = friendGroupSystem.config.guilds?.[interaction.guild.id];
      if (guildSetup) {
        embed.addFields(
          { name: 'Guild Setup', value: 'Configured', inline: false },
          { name: 'Setup Date', value: new Date(guildSetup.createdAt).toLocaleString(), inline: true },
          { name: 'Review Category ID', value: guildSetup.categories.review || 'Not set', inline: true },
          { name: 'FG Category ID', value: guildSetup.categories.friendGroups || 'Not set', inline: true }
        );
      } else {
        embed.addFields({ name: 'Guild Setup', value: 'Not configured - run /setupfg', inline: false });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('disbandfg')
      .setDescription('Disband a friend group')
      .addUserOption(option =>
        option.setName('owner')
          .setDescription('The friend group owner (leave empty to disband your own)')
          .setRequired(false)),
    
    async execute(interaction) {
      if (!friendGroupSystem) {
        return interaction.reply({
          content: 'Friend group system is not initialized.',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('owner') || interaction.user;
      const isSelf = targetUser.id === interaction.user.id;

      // Get the friend group data
      const groupData = friendGroupSystem.acceptedGroups.get(targetUser.id);
      if (!groupData || groupData.guildId !== interaction.guild.id) {
        return interaction.reply({
          content: `${isSelf ? 'You do not' : 'That user does not'} own a friend group in this server.`,
          ephemeral: true
        });
      }

      // Check permissions if not disbanding own group
      if (!isSelf) {
        // Check permission hierarchy
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        const ownerBypassEnabled = moderationSystem.config.ownerBypass;
        const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
        const isAntiNukeWhitelisted = antiNukeConfig?.whitelist?.users?.includes(interaction.user.id) ||
          interaction.member.roles.cache.some(role => antiNukeConfig?.whitelist?.roles?.includes(role.id));
        const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
          interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
        
        const modPerms = moderationSystem.config.permissions;
        const hasAdminRole = interaction.member.roles.cache.some(role => 
          modPerms.administrator.roles.includes(role.id)
        );
        const isAdminUser = modPerms.administrator.users.includes(interaction.user.id);
        const hasModRole = interaction.member.roles.cache.some(role => 
          modPerms.moderator.roles.includes(role.id)
        );
        const isModUser = modPerms.moderator.users.includes(interaction.user.id);
        
        const canDisband = (isOwner && ownerBypassEnabled) || 
                          isAntiNukeWhitelisted || 
                          isAntiNukeAdmin || 
                          hasAdminRole || 
                          isAdminUser || 
                          hasModRole || 
                          isModUser;
        
        if (!canDisband) {
          return interaction.reply({
            content: 'You do not have permission to disband other users\' friend groups.',
            ephemeral: true
          });
        }
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const result = await friendGroupSystem.disbandGroup(interaction.guild, targetUser.id);

        if (result.success) {
          const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
          const embed = embedLoader.error(
            `${targetUser.tag}'s friend group has been disbanded.`
          ).addFields(
            { name: 'Owner', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
            { name: 'Disbanded by', value: interaction.user.tag, inline: true }
          );

          await interaction.editReply({ embeds: [embed] });

          // Log the action
          if (moderationSystem) {
            await moderationSystem.logAction(interaction.guild, {
              action: 'Friend Group Disbanded',
              moderator: interaction.user,
              target: `${targetUser.tag} (${targetUser.id})`,
              additional: isSelf ? 'Owner disbanded their own group' : 'Disbanded by staff'
            });
          }

          // DM the owner if disbanded by staff
          if (!isSelf && friendGroupSystem.config.notifications.dmResults) {
            try {
              const dmEmbed = embedLoader.error(
                'Your friend group has been disbanded by server staff.'
              ).addFields(
                { name: 'Server', value: interaction.guild.name, inline: true },
                { name: 'Disbanded by', value: interaction.user.tag, inline: true }
              );

              await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
              console.log('[FriendGroup] Could not DM user about disbanding');
            }
          }
        } else {
          await interaction.editReply({
            content: result.error || 'Failed to disband friend group.'
          });
        }

      } catch (error) {
        console.error('[FriendGroup] Error disbanding group:', error);
        await interaction.editReply({
          content: 'An error occurred while disbanding the friend group. Some components may not have been removed.'
        });
      }
    }
  }
];