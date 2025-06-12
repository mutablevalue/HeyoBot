// src/commands/genderverify.js
/**
 * Gender Verification System Commands
 * 
 * Permission Tiers:
 * - Server Owner → Can configure & bypass verification
 * - AntiNuke Admin → Can configure & bypass verification  
 * - System Admin → Can configure & bypass verification
 * - System Moderator → Can review verifications only
 * - Regular User → Must complete verification
 */
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

let genderVerifySystem = null;
let moderationSystem = null;

export function setGenderVerifySystem(system) {
  genderVerifySystem = system;
}

export function setModerationSystem(system) {
  moderationSystem = system;
}

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('setupgenderverify')
      .setDescription('Setup the gender verification system (Owner/AntiNuke/Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(option =>
        option.setName('category_name')
          .setDescription('Name for the main verification category')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('female_role_name')
          .setDescription('Name for the verified female role')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('male_role_name')
          .setDescription('Name for the verified male role')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('verify_channel_name')
          .setDescription('Name for the verification channel')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('female_channel_name')
          .setDescription('Name for the female-only channel')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('male_channel_name')
          .setDescription('Name for the male-only channel')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('verified_channel_name')
          .setDescription('Name for the verified members chat')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('verified_vc_name')
          .setDescription('Name for the verified members voice channel')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('message_description')
          .setDescription('Custom description for the verification message')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('message_footer')
          .setDescription('Custom footer for the verification message')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('button_label')
          .setDescription('Custom label for the verification button')
          .setRequired(false))
      .addBooleanOption(option =>
        option.setName('force')
          .setDescription('Force recreate even if already set up')
          .setRequired(false)),
    
    async execute(interaction) {
      if (!genderVerifySystem) {
        return interaction.reply({
          content: 'Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy: Owner > AntiNuke > Administration > Moderation
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const isSystemAdmin = moderationSystem.config.permissions.administrator.users.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => 
          moderationSystem.config.permissions.administrator.roles.includes(role.id)
        );
      
      // Check permissions in order: Owner > AntiNuke > Admin
      const hasPermission = (isOwner && ownerBypassEnabled) || isAntiNukeAdmin || isSystemAdmin;
      
      if (!hasPermission) {
        let errorMessage = 'You do not have permission to configure the gender verification system.\n\n';
        errorMessage += 'Required permissions (any of the following):\n';
        errorMessage += '• Server Owner (with `ownerBypass` enabled in config)\n';
        errorMessage += '• AntiNuke Administrator\n';
        errorMessage += '• System Administrator';
        
        return interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      }

      await interaction.deferReply();

      // Debug log for permission check
      console.log(`[GenderVerify] Setup attempt by ${interaction.user.tag}:`, {
        isOwner,
        ownerBypassEnabled,
        isAntiNukeAdmin,
        isSystemAdmin,
        hasPermission
      });

      // Get options
      const options = {
        mainCategoryName: interaction.options.getString('category_name'),
        femaleRoleName: interaction.options.getString('female_role_name'),
        maleRoleName: interaction.options.getString('male_role_name'),
        verifyChannelName: interaction.options.getString('verify_channel_name'),
        femaleChannelName: interaction.options.getString('female_channel_name'),
        maleChannelName: interaction.options.getString('male_channel_name'),
        verifiedChannelName: interaction.options.getString('verified_channel_name'),
        verifiedVCName: interaction.options.getString('verified_vc_name'),
        messageDescription: interaction.options.getString('message_description'),
        messageFooter: interaction.options.getString('message_footer'),
        buttonLabel: interaction.options.getString('button_label'),
        force: interaction.options.getBoolean('force') || false
      };

      // Setup the system
      const result = await genderVerifySystem.setupGenderVerification(interaction.guild, options);

      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;

      if (result.success) {
        const embed = embedLoader.system(
          'Gender Verification',
          result.message
        ).addFields(
          { name: 'Category', value: `All channels created in **${options.mainCategoryName || 'Gender Verification'}** category`, inline: false },
          { name: 'Female Role', value: `<@&${result.setup.roles.female}>`, inline: true },
          { name: 'Male Role', value: `<@&${result.setup.roles.male}>`, inline: true },
          { name: 'Verify Channel', value: `<#${result.setup.channels.verify}>`, inline: true },
          { name: 'Female Channel', value: `<#${result.setup.channels.female}>`, inline: true },
          { name: 'Male Channel', value: `<#${result.setup.channels.male}>`, inline: true },
          { name: 'Verified Chat', value: `<#${result.setup.channels.verified}>`, inline: true },
          { name: 'Verified VC', value: `<#${result.setup.channels.verifiedVC}>`, inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

        // Log the setup with permission level
        if (moderationSystem) {
          let permissionLevel = 'Unknown';
          if (isOwner && ownerBypassEnabled) {
            permissionLevel = 'Server Owner';
          } else if (isAntiNukeAdmin) {
            permissionLevel = 'AntiNuke Administrator';
          } else if (isSystemAdmin) {
            permissionLevel = 'System Administrator';
          }
          
          await moderationSystem.logAction(interaction.guild, {
            action: 'Gender Verification Setup',
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
      .setName('verifystats')
      .setDescription('View gender verification statistics')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
      if (!genderVerifySystem) {
        return interaction.reply({
          content: 'Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy for stats viewing
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const modPerms = moderationSystem.config.permissions;
      const hasModPerms = interaction.member.roles.cache.some(role => 
        modPerms.administrator.roles.includes(role.id) || 
        modPerms.moderator.roles.includes(role.id)
      ) || modPerms.administrator.users.includes(interaction.user.id) || 
        modPerms.moderator.users.includes(interaction.user.id);
      
      if (!((isOwner && ownerBypassEnabled) || isAntiNukeAdmin || hasModPerms || 
            interaction.member.permissions.has(PermissionFlagsBits.ManageRoles))) {
        return interaction.reply({
          content: 'You do not have permission to view verification stats.',
          ephemeral: true
        });
      }

      const stats = genderVerifySystem.getStats();
      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
      
      const embed = embedLoader.createEmbed({
        description: 'Gender verification system statistics',
        fields: [
          { name: 'Total Submitted', value: String(stats.totalSubmitted), inline: true },
          { name: 'Total Approved', value: String(stats.totalApproved), inline: true },
          { name: 'Total Denied', value: String(stats.totalDenied), inline: true },
          { name: 'Pending Reviews', value: String(stats.activePending), inline: true },
          { name: 'Approval Rate', value: stats.totalSubmitted > 0 
            ? `${Math.round((stats.totalApproved / stats.totalSubmitted) * 100)}%` 
            : 'N/A', inline: true }
        ]
      });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('verifyuser')
      .setDescription('Manually verify a user without review process (Owner/AntiNuke/Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to verify')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('gender')
          .setDescription('Gender to assign')
          .setRequired(true)
          .addChoices(
            { name: 'Female', value: 'female' },
            { name: 'Male', value: 'male' }
          )),
    
    async execute(interaction) {
      if (!genderVerifySystem) {
        return interaction.reply({
          content: 'Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy: Owner > AntiNuke > Administration > Moderation
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const isSystemAdmin = moderationSystem.config.permissions.administrator.users.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => 
          moderationSystem.config.permissions.administrator.roles.includes(role.id)
        );
      
      // Check permissions in order: Owner > AntiNuke > Admin
      const hasPermission = (isOwner && ownerBypassEnabled) || isAntiNukeAdmin || isSystemAdmin;
      
      if (!hasPermission) {
        let errorMessage = 'You do not have permission to manually verify users.\n\n';
        errorMessage += 'Required permissions (any of the following):\n';
        errorMessage += '• Server Owner (with `ownerBypass` enabled in config)\n';
        errorMessage += '• AntiNuke Administrator\n';
        errorMessage += '• System Administrator';
        
        return interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      }

      const user = interaction.options.getUser('user');
      const gender = interaction.options.getString('gender');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          content: 'User is not in this server.',
          ephemeral: true
        });
      }

      const guildSetup = genderVerifySystem.config.guilds?.[interaction.guild.id];
      if (!guildSetup) {
        return interaction.reply({
          content: 'Gender verification is not set up in this server.',
          ephemeral: true
        });
      }

      // Check if already verified
      if (member.roles.cache.has(guildSetup.roles.female) || 
          member.roles.cache.has(guildSetup.roles.male)) {
        return interaction.reply({
          content: 'User is already verified.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      try {
        // Assign role
        const roleId = gender === 'female' ? guildSetup.roles.female : guildSetup.roles.male;
        await member.roles.add(roleId, `Manually verified by ${interaction.user.tag}`);

        // Add to accepted users
        genderVerifySystem.acceptedUsers.set(user.id, {
          gender: gender,
          approvedAt: new Date().toISOString(),
          approvedBy: interaction.user.id,
          approverTag: interaction.user.tag,
          guildId: interaction.guild.id
        });
        genderVerifySystem.saveVerificationData();

        const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
        const embed = embedLoader.success(
          `${user} has been verified as ${gender}`
        ).addFields(
          { name: 'Verified by', value: interaction.user.tag, inline: true },
          { name: 'Role assigned', value: `<@&${roleId}>`, inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

        // Log action with permission level
        if (moderationSystem) {
          let permissionLevel = 'Unknown';
          if (isOwner && ownerBypassEnabled) {
            permissionLevel = 'Server Owner';
          } else if (isAntiNukeAdmin) {
            permissionLevel = 'AntiNuke Administrator';
          } else if (isSystemAdmin) {
            permissionLevel = 'System Administrator';
          }
          
          await moderationSystem.logAction(interaction.guild, {
            action: 'Manual Gender Verification',
            moderator: interaction.user,
            target: `${user.tag} (${user.id})`,
            additional: `Verified as ${gender} by ${permissionLevel}`
          });
        }
      } catch (error) {
        console.error('Error in manual verification:', error);
        await interaction.editReply({
          content: 'Failed to verify user. Please check my permissions.'
        });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('verifystatus')
      .setDescription('Check gender verification setup status')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
      if (!genderVerifySystem) {
        return interaction.reply({
          content: 'Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permission hierarchy for status viewing
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const ownerBypassEnabled = moderationSystem.config.ownerBypass;
      const antiNukeConfig = moderationSystem.configLoader.get('antiNuke');
      const isAntiNukeAdmin = antiNukeConfig?.adminUsers?.includes(interaction.user.id) ||
        interaction.member.roles.cache.some(role => antiNukeConfig?.adminRoles?.includes(role.id));
      const modPerms = moderationSystem.config.permissions;
      const hasModPerms = interaction.member.roles.cache.some(role => 
        modPerms.administrator.roles.includes(role.id) || 
        modPerms.moderator.roles.includes(role.id)
      ) || modPerms.administrator.users.includes(interaction.user.id) || 
        modPerms.moderator.users.includes(interaction.user.id);
      
      if (!((isOwner && ownerBypassEnabled) || isAntiNukeAdmin || hasModPerms || 
            interaction.member.permissions.has(PermissionFlagsBits.ManageRoles))) {
        return interaction.reply({
          content: 'You do not have permission to check verification status.',
          ephemeral: true
        });
      }

      // Force reload configs
      genderVerifySystem.reloadGuildConfigs();
      
      const guildSetup = genderVerifySystem.config.guilds?.[interaction.guild.id];
      const acceptedCount = Array.from(genderVerifySystem.acceptedUsers.values())
        .filter(u => u.guildId === interaction.guild.id).length;
      const pendingCount = Array.from(genderVerifySystem.activeVerifications.values())
        .filter(v => v.guildId === interaction.guild.id && v.status === 'pending').length;
      
      const embedLoader = moderationSystem.embedLoader || interaction.client.embedLoader;
      const embed = embedLoader.createEmbed({
        description: guildSetup ? 'Gender verification is set up' : 'Gender verification is not set up'
      });

      if (guildSetup) {
        const guild = interaction.guild;
        const verifyChannel = guild.channels.cache.get(guildSetup.channels.verify);
        const femaleChannel = guild.channels.cache.get(guildSetup.channels.female);
        const maleChannel = guild.channels.cache.get(guildSetup.channels.male);
        const verifiedChannel = guild.channels.cache.get(guildSetup.channels.verified);
        const verifiedVC = guild.channels.cache.get(guildSetup.channels.verifiedVC);
        const mainCategory = guild.channels.cache.get(guildSetup.channels.mainCategory);
        const reviewCategory = guild.channels.cache.get(guildSetup.channels.reviewCategory);
        const femaleRole = guild.roles.cache.get(guildSetup.roles.female);
        const maleRole = guild.roles.cache.get(guildSetup.roles.male);

        embed.addFields(
          { name: 'Setup Date', value: `<t:${Math.floor(new Date(guildSetup.createdAt).getTime() / 1000)}:F>`, inline: false },
          { name: 'Main Category', value: mainCategory ? mainCategory.name : 'Not found', inline: false },
          { name: 'Verify Channel', value: verifyChannel ? `<#${verifyChannel.id}>` : 'Not found', inline: true },
          { name: 'Female Channel', value: femaleChannel ? `<#${femaleChannel.id}>` : 'Not found', inline: true },
          { name: 'Male Channel', value: maleChannel ? `<#${maleChannel.id}>` : 'Not found', inline: true },
          { name: 'Verified Chat', value: verifiedChannel ? `<#${verifiedChannel.id}>` : 'Not found', inline: true },
          { name: 'Verified VC', value: verifiedVC ? `<#${verifiedVC.id}>` : 'Not found', inline: true },
          { name: 'Review Category', value: reviewCategory ? reviewCategory.name : 'Not found', inline: true },
          { name: 'Female Role', value: femaleRole ? `<@&${femaleRole.id}>` : 'Not found', inline: true },
          { name: 'Male Role', value: maleRole ? `<@&${maleRole.id}>` : 'Not found', inline: true },
          { name: 'Accepted Users', value: String(acceptedCount), inline: true },
          { name: 'Pending Verifications', value: String(pendingCount), inline: true }
        );
      } else {
        embed.addFields(
          { name: 'Next Step', value: 'An administrator needs to run `/setupgenderverify`' }
        );
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
];