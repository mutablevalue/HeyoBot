// src/commands/genderverify.js
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

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
      .setDescription('Setup the gender verification system')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
        option.setName('message_title')
          .setDescription('Custom title for the verification message')
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
          content: '❌ Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permissions using centralized system (includes AntiNuke hierarchy)
      const permCheck = moderationSystem.checkGlobalPermission(
        interaction.member,
        'setupgenderverify',
        { requireModeration: true, command: 'setupgenderverify' }
      );
      
      if (!permCheck.allowed) {
        return interaction.reply({
          content: `❌ ${permCheck.reason}`,
          ephemeral: true
        });
      }

      await interaction.deferReply();

      // Get options
      const options = {
        femaleRoleName: interaction.options.getString('female_role_name'),
        maleRoleName: interaction.options.getString('male_role_name'),
        verifyChannelName: interaction.options.getString('verify_channel_name'),
        femaleChannelName: interaction.options.getString('female_channel_name'),
        maleChannelName: interaction.options.getString('male_channel_name'),
        messageTitle: interaction.options.getString('message_title'),
        messageDescription: interaction.options.getString('message_description'),
        messageFooter: interaction.options.getString('message_footer'),
        buttonLabel: interaction.options.getString('button_label'),
        force: interaction.options.getBoolean('force') || false
      };

      // Setup the system
      const result = await genderVerifySystem.setupGenderVerification(interaction.guild, options);

      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Gender Verification System Setup')
          .setDescription(result.message)
          .setColor(0x00ff00)
          .addFields(
            { name: 'Female Role', value: `<@&${result.setup.roles.female}>`, inline: true },
            { name: 'Male Role', value: `<@&${result.setup.roles.male}>`, inline: true },
            { name: 'Verify Channel', value: `<#${result.setup.channels.verify}>`, inline: true },
            { name: 'Female Channel', value: `<#${result.setup.channels.female}>`, inline: true },
            { name: 'Male Channel', value: `<#${result.setup.channels.male}>`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Log the setup
        if (moderationSystem) {
          await moderationSystem.logAction(interaction.guild, {
            action: 'Gender Verification Setup',
            moderator: interaction.user,
            additional: 'System configured successfully'
          });
        }
      } else {
        const embed = new EmbedBuilder()
          .setTitle('❌ Setup Failed')
          .setDescription(result.message)
          .setColor(0xff0000)
          .setTimestamp();

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
          content: '❌ Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permissions using centralized system
      const permCheck = moderationSystem.checkGlobalPermission(
        interaction.member,
        'verifystats',
        { 
          requireModeration: true, 
          command: 'verifystats',
          customCheck: (member) => member.permissions.has(PermissionFlagsBits.ManageRoles),
          customReason: 'Has ManageRoles permission'
        }
      );
      
      if (!permCheck.allowed) {
        return interaction.reply({
          content: '❌ You do not have permission to view verification stats.',
          ephemeral: true
        });
      }

      const stats = genderVerifySystem.getStats();
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Gender Verification Statistics')
        .setColor(0x0099ff)
        .addFields(
          { name: 'Total Submitted', value: String(stats.totalSubmitted), inline: true },
          { name: 'Total Approved', value: String(stats.totalApproved), inline: true },
          { name: 'Total Denied', value: String(stats.totalDenied), inline: true },
          { name: 'Pending Reviews', value: String(stats.activePending), inline: true },
          { name: 'Approval Rate', value: stats.totalSubmitted > 0 
            ? `${Math.round((stats.totalApproved / stats.totalSubmitted) * 100)}%` 
            : 'N/A', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('verifyuser')
      .setDescription('Manually verify a user (bypass verification process)')
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
          content: '❌ Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permissions using centralized system (includes AntiNuke hierarchy)
      const permCheck = moderationSystem.checkGlobalPermission(
        interaction.member,
        'verifyuser',
        { requireModeration: true, command: 'verifyuser' }
      );
      
      if (!permCheck.allowed) {
        return interaction.reply({
          content: `❌ ${permCheck.reason}`,
          ephemeral: true
        });
      }

      const user = interaction.options.getUser('user');
      const gender = interaction.options.getString('gender');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          content: '❌ User is not in this server.',
          ephemeral: true
        });
      }

      const guildSetup = genderVerifySystem.config.guilds?.[interaction.guild.id];
      if (!guildSetup) {
        return interaction.reply({
          content: '❌ Gender verification is not set up in this server.',
          ephemeral: true
        });
      }

      // Check if already verified
      if (member.roles.cache.has(guildSetup.roles.female) || 
          member.roles.cache.has(guildSetup.roles.male)) {
        return interaction.reply({
          content: '❌ User is already verified.',
          ephemeral: true
        });
      }

      await interaction.deferReply();

      try {
        // Assign role
        const roleId = gender === 'female' ? guildSetup.roles.female : guildSetup.roles.male;
        await member.roles.add(roleId, `Manually verified by ${interaction.user.tag}`);

        const embed = new EmbedBuilder()
          .setTitle('✅ User Manually Verified')
          .setDescription(`${user} has been verified as ${gender}`)
          .setColor(0x00ff00)
          .addFields(
            { name: 'Verified by', value: interaction.user.tag, inline: true },
            { name: 'Role assigned', value: `<@&${roleId}>`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Log action
        if (moderationSystem) {
          await moderationSystem.logAction(interaction.guild, {
            action: 'Manual Gender Verification',
            moderator: interaction.user,
            target: `${user.tag} (${user.id})`,
            additional: `Verified as ${gender}`
          });
        }
      } catch (error) {
        console.error('Error in manual verification:', error);
        await interaction.editReply({
          content: '❌ Failed to verify user. Please check my permissions.'
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
          content: '❌ Gender verification system is not initialized.',
          ephemeral: true
        });
      }

      // Check permissions
      const permCheck = moderationSystem.checkGlobalPermission(
        interaction.member,
        'verifystatus',
        { 
          requireModeration: true, 
          command: 'verifystatus',
          customCheck: (member) => member.permissions.has(PermissionFlagsBits.ManageRoles),
          customReason: 'Has ManageRoles permission'
        }
      );
      
      if (!permCheck.allowed) {
        return interaction.reply({
          content: '❌ You do not have permission to check verification status.',
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
      
      const embed = new EmbedBuilder()
        .setTitle('🔍 Gender Verification Status')
        .setColor(guildSetup ? 0x00ff00 : 0xff0000)
        .setTimestamp();

      if (guildSetup) {
        const guild = interaction.guild;
        const verifyChannel = guild.channels.cache.get(guildSetup.channels.verify);
        const femaleChannel = guild.channels.cache.get(guildSetup.channels.female);
        const maleChannel = guild.channels.cache.get(guildSetup.channels.male);
        const reviewCategory = guild.channels.cache.get(guildSetup.channels.reviewCategory);
        const femaleRole = guild.roles.cache.get(guildSetup.roles.female);
        const maleRole = guild.roles.cache.get(guildSetup.roles.male);

        embed.setDescription('✅ Gender verification is set up')
          .addFields(
            { name: 'Setup Date', value: `<t:${Math.floor(new Date(guildSetup.createdAt).getTime() / 1000)}:F>`, inline: false },
            { name: 'Verify Channel', value: verifyChannel ? `<#${verifyChannel.id}>` : '❌ Not found', inline: true },
            { name: 'Female Channel', value: femaleChannel ? `<#${femaleChannel.id}>` : '❌ Not found', inline: true },
            { name: 'Male Channel', value: maleChannel ? `<#${maleChannel.id}>` : '❌ Not found', inline: true },
            { name: 'Review Category', value: reviewCategory ? reviewCategory.name : '❌ Not found', inline: true },
            { name: 'Female Role', value: femaleRole ? `<@&${femaleRole.id}>` : '❌ Not found', inline: true },
            { name: 'Male Role', value: maleRole ? `<@&${maleRole.id}>` : '❌ Not found', inline: true },
            { name: 'Accepted Users', value: String(acceptedCount), inline: true },
            { name: 'Pending Verifications', value: String(pendingCount), inline: true }
          );
      } else {
        embed.setDescription('❌ Gender verification is not set up')
          .addFields(
            { name: 'Next Step', value: 'An administrator needs to run `/setupgenderverify`' }
          );
      }

      // Debug info
      embed.addFields({
        name: 'Debug Info',
        value: `System Enabled: ${genderVerifySystem.config.enabled}\nTotal Guilds: ${Object.keys(genderVerifySystem.config.guilds || {}).length}\nThis Guild ID: ${interaction.guild.id}`,
        inline: false
      });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
];