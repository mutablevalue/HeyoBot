import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js';

let moderationSystem = null;

export function setModerationSystem(system) {
  moderationSystem = system;
}

// Create compound slash command with all moderation commands
export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderation commands')
  // Lock channel subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('lockchannel')
      .setDescription('Lock the current channel (disable sending messages)')
  )
  // Unlock channel subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unlockchannel')
      .setDescription('Unlock the current channel (restore sending messages)')
  )
  // Nuke subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('nuke')
      .setDescription('Clone and delete the current channel')
      .addBooleanOption(option =>
        option
          .setName('confirm')
          .setDescription('Confirm channel nuke')
          .setRequired(true)
      )
  )
  // Ban subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('ban')
      .setDescription('Ban a user from the server')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to ban')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for ban')
          .setRequired(false)
      )
  )
  // Kick subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('kick')
      .setDescription('Kick a user from the server')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to kick')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for kick')
          .setRequired(false)
      )
  )
  // Unban subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unban')
      .setDescription('Unban a user')
      .addStringOption(option =>
        option
          .setName('user')
          .setDescription('User ID or tag to unban')
          .setRequired(true)
      )
  )
  // Timeout subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('timeout')
      .setDescription('Timeout a user')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to timeout')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('duration')
          .setDescription('Duration (e.g., 5m, 1h, 1d)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for timeout')
          .setRequired(false)
      )
  )
  // Role subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('role')
      .setDescription('Give or remove a role from a user')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('Target user')
          .setRequired(true)
      )
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('Role to give/remove')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('Give or remove the role')
          .setRequired(true)
          .addChoices(
            { name: 'Give', value: 'give' },
            { name: 'Remove', value: 'remove' }
          )
      )
  )
  // Force nickname subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('forcenickname')
      .setDescription('Force a nickname on a user that they cannot change')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to force nickname on')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('nickname')
          .setDescription('Nickname to force (32 chars max)')
          .setRequired(true)
      )
  )
  // Unforce nickname subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('unforcenickname')
      .setDescription('Remove forced nickname from a user')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to remove forced nickname from')
          .setRequired(true)
      )
  )
  // Setup permissions subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('setupperms')
      .setDescription('Create moderation roles with specific permissions')
  );

// Additional individual slash commands for convenience
export const lockChannelData = new SlashCommandBuilder()
  .setName('lockchannel')
  .setDescription('Lock the current channel (disable sending messages)');

export const unlockChannelData = new SlashCommandBuilder()
  .setName('unlockchannel')
  .setDescription('Unlock the current channel (restore sending messages)');

export const nukeData = new SlashCommandBuilder()
  .setName('nuke')
  .setDescription('Clone and delete the current channel')
  .addBooleanOption(option =>
    option
      .setName('confirm')
      .setDescription('Confirm channel nuke')
      .setRequired(true)
  );

export const banData = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a user from the server')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to ban')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for ban')
      .setRequired(false)
  );

export const kickData = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a user from the server')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to kick')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for kick')
      .setRequired(false)
  );

export const unbanData = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user')
  .addStringOption(option =>
    option
      .setName('user')
      .setDescription('User ID or tag to unban')
      .setRequired(true)
  );

export const timeoutData = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Timeout a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to timeout')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('duration')
      .setDescription('Duration (e.g., 5m, 1h, 1d)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for timeout')
      .setRequired(false)
  );

export const roleData = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Give or remove a role from a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('Target user')
      .setRequired(true)
  )
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Role to give/remove')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('Give or remove the role')
      .setRequired(true)
      .addChoices(
        { name: 'Give', value: 'give' },
        { name: 'Remove', value: 'remove' }
      )
  );

export const forceNicknameData = new SlashCommandBuilder()
  .setName('forcenickname')
  .setDescription('Force a nickname on a user that they cannot change')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to force nickname on')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('nickname')
      .setDescription('Nickname to force (32 chars max)')
      .setRequired(true)
  );

export const unforceNicknameData = new SlashCommandBuilder()
  .setName('unforcenickname')
  .setDescription('Remove forced nickname from a user')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('User to remove forced nickname from')
      .setRequired(true)
  );

export const setupPermsData = new SlashCommandBuilder()
  .setName('setupperms')
  .setDescription('Create moderation roles with specific permissions');

// Main execute function for compound command
export async function execute(interaction) {
  if (!moderationSystem) {
    return interaction.reply({ content: '❌ Moderation system not loaded.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  
  // Check permissions for the specific subcommand
  const permCheck = moderationSystem.checkPermission(interaction.member, subcommand);
  if (!permCheck.allowed) {
    return interaction.reply({ 
      content: `❌ ${permCheck.reason}`, 
      ephemeral: true 
    });
  }

  // Check cooldown
  const cooldownCheck = moderationSystem.checkCooldown(interaction.user.id, subcommand);
  if (cooldownCheck.onCooldown) {
    return interaction.reply({
      content: `⏰ Please wait ${cooldownCheck.timeLeft} seconds before using this command again.`,
      ephemeral: true
    });
  }

  switch (subcommand) {
    case 'lockchannel':
      return executeLockChannel(interaction);
    case 'unlockchannel':
      return executeUnlockChannel(interaction);
    case 'nuke':
      return executeNuke(interaction);
    case 'ban':
      return executeBan(interaction);
    case 'kick':
      return executeKick(interaction);
    case 'unban':
      return executeUnban(interaction);
    case 'timeout':
      return executeTimeout(interaction);
    case 'role':
      return executeRole(interaction);
    case 'forcenickname':
      return executeForceNickname(interaction);
    case 'unforcenickname':
      return executeUnforceNickname(interaction);
    case 'setupperms':
      return executeSetupPerms(interaction);
  }
}

// Helper function for standalone commands
async function checkPermissionAndCooldown(interaction, commandName) {
  if (!moderationSystem) {
    await interaction.reply({ content: '❌ Moderation system not loaded.', ephemeral: true });
    return false;
  }

  const permCheck = moderationSystem.checkPermission(interaction.member, commandName);
  if (!permCheck.allowed) {
    await interaction.reply({ 
      content: `❌ ${permCheck.reason}`, 
      ephemeral: true 
    });
    return false;
  }

  const cooldownCheck = moderationSystem.checkCooldown(interaction.user.id, commandName);
  if (cooldownCheck.onCooldown) {
    await interaction.reply({
      content: `⏰ Please wait ${cooldownCheck.timeLeft} seconds before using this command again.`,
      ephemeral: true
    });
    return false;
  }

  return true;
}

// Individual execute functions for standalone commands
export async function executeLockChannel(interaction) {
  // Check if called as standalone command
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'lockchannel')) return;
  }

  const channel = interaction.channel;
  
  try {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false
    });

    const embed = new EmbedBuilder()
      .setTitle('🔒 Channel Locked')
      .setDescription(`${channel} has been locked.`)
      .setColor(0xff0000)
      .setFooter({ text: `Locked by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Log the action
    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Lock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`,
      color: 0xff0000
    });
  } catch (error) {
    console.error('Error locking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to lock the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeUnlockChannel(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'unlockchannel')) return;
  }

  const channel = interaction.channel;
  
  try {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: null
    });

    const embed = new EmbedBuilder()
      .setTitle('🔓 Channel Unlocked')
      .setDescription(`${channel} has been unlocked.`)
      .setColor(0x00ff00)
      .setFooter({ text: `Unlocked by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Unlock',
      moderator: interaction.user,
      target: `${channel} (${channel.id})`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error unlocking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to unlock the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeNuke(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'nuke')) return;
  }

  const confirm = interaction.options.getBoolean('confirm');
  
  if (!confirm) {
    return interaction.reply({ 
      content: '❌ Channel nuke cancelled. Set confirm to true to proceed.', 
      ephemeral: true 
    });
  }

  const channel = interaction.channel;
  
  try {
    // Clone the channel
    const newChannel = await channel.clone({
      name: channel.name,
      parent: channel.parent,
      topic: channel.topic,
      nsfw: channel.nsfw,
      rateLimitPerUser: channel.rateLimitPerUser,
      position: channel.position,
      permissionOverwrites: channel.permissionOverwrites.cache,
      reason: `Channel nuked by ${interaction.user.tag}`
    });

    // Send confirmation in new channel
    const embed = new EmbedBuilder()
      .setTitle('💥 Channel Nuked')
      .setDescription('This channel has been nuked and recreated.')
      .setColor(0xffa500)
      .setFooter({ text: `Nuked by ${interaction.user.tag}` })
      .setTimestamp();

    await newChannel.send({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Channel Nuke',
      moderator: interaction.user,
      target: `#${channel.name} (${channel.id})`,
      color: 0xffa500
    });

    // Delete old channel
    await channel.delete(`Nuked by ${interaction.user.tag}`);
  } catch (error) {
    console.error('Error nuking channel:', error);
    await interaction.reply({ 
      content: '❌ Failed to nuke the channel. Make sure I have the necessary permissions.', 
      ephemeral: true 
    });
  }
}

export async function executeBan(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'ban')) return;
  }

  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    // Check if target is bannable
    if (!member.bannable) {
      return interaction.reply({ 
        content: '❌ I cannot ban this user. They may have higher permissions than me.', 
        ephemeral: true 
      });
    }

    // Check role hierarchy
    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You cannot ban someone with an equal or higher role.', 
        ephemeral: true 
      });
    }

    await member.ban({ reason: `${reason} - Banned by ${interaction.user.tag}` });

    const embed = new EmbedBuilder()
      .setTitle('🔨 User Banned')
      .setDescription(`${user.tag} has been banned from the server.`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason }
      )
      .setColor(0xff0000)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Ban',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      reason: reason,
      color: 0xff0000
    });
  } catch (error) {
    console.error('Error banning user:', error);
    await interaction.reply({ 
      content: '❌ Failed to ban the user.', 
      ephemeral: true 
    });
  }
}

export async function executeKick(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'kick')) return;
  }

  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    // Check if target is kickable
    if (!member.kickable) {
      return interaction.reply({ 
        content: '❌ I cannot kick this user. They may have higher permissions than me.', 
        ephemeral: true 
      });
    }

    // Check role hierarchy
    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You cannot kick someone with an equal or higher role.', 
        ephemeral: true 
      });
    }

    await member.kick(`${reason} - Kicked by ${interaction.user.tag}`);

    const embed = new EmbedBuilder()
      .setTitle('👢 User Kicked')
      .setDescription(`${user.tag} has been kicked from the server.`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason }
      )
      .setColor(0xffa500)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Kick',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      reason: reason,
      color: 0xffa500
    });
  } catch (error) {
    console.error('Error kicking user:', error);
    await interaction.reply({ 
      content: '❌ Failed to kick the user.', 
      ephemeral: true 
    });
  }
}

export async function executeUnban(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'unban')) return;
  }

  const userInput = interaction.options.getString('user');

  try {
    // Try to parse as user ID first
    let userId = userInput;
    
    // If it's a user tag, try to find in ban list
    if (userInput.includes('#')) {
      const bans = await interaction.guild.bans.fetch();
      const bannedUser = bans.find(ban => ban.user.tag === userInput);
      
      if (!bannedUser) {
        return interaction.reply({ 
          content: '❌ User not found in ban list.', 
          ephemeral: true 
        });
      }
      
      userId = bannedUser.user.id;
    }

    await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);

    const embed = new EmbedBuilder()
      .setTitle('✅ User Unbanned')
      .setDescription(`User has been unbanned from the server.`)
      .addFields(
        { name: 'User ID', value: userId, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unban',
      moderator: interaction.user,
      target: `User ID: ${userId}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error unbanning user:', error);
    await interaction.reply({ 
      content: '❌ Failed to unban the user. Make sure the user ID is correct and they are banned.', 
      ephemeral: true 
    });
  }
}

export async function executeTimeout(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'timeout')) return;
  }

  const user = interaction.options.getUser('user');
  const duration = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  // Parse duration
  const durationMs = parseDuration(duration);
  if (!durationMs) {
    return interaction.reply({ 
      content: '❌ Invalid duration format. Use formats like: 5m, 1h, 1d', 
      ephemeral: true 
    });
  }

  // Check if duration is within Discord's limits (max 28 days)
  if (durationMs > 28 * 24 * 60 * 60 * 1000) {
    return interaction.reply({ 
      content: '❌ Timeout duration cannot exceed 28 days.', 
      ephemeral: true 
    });
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    // Check role hierarchy
    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You cannot timeout someone with an equal or higher role.', 
        ephemeral: true 
      });
    }

    // Check if bot can timeout the member
    if (!member.moderatable) {
      return interaction.reply({ 
        content: '❌ I cannot timeout this user. They may have higher permissions than me.', 
        ephemeral: true 
      });
    }

    await member.timeout(durationMs, `${reason} - Timed out by ${interaction.user.tag}`);

    const embed = new EmbedBuilder()
      .setTitle('⏰ User Timed Out')
      .setDescription(`${user.tag} has been timed out.`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Duration', value: duration, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason }
      )
      .setColor(0xffff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Timeout',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      reason: reason,
      additional: `Duration: ${duration}`,
      color: 0xffff00
    });
  } catch (error) {
    console.error('Error timing out user:', error);
    await interaction.reply({ 
      content: '❌ Failed to timeout the user.', 
      ephemeral: true 
    });
  }
}

export async function executeRole(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'role')) return;
  }

  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  const action = interaction.options.getString('action');

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    // Check if invoker's highest role is above the target role
    if (role.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You can only manage roles below your highest role.', 
        ephemeral: true 
      });
    }

    // Check if bot can manage the role
    const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ I cannot manage this role. It\'s higher than my highest role.', 
        ephemeral: true 
      });
    }

    if (action === 'give') {
      if (member.roles.cache.has(role.id)) {
        return interaction.reply({ 
          content: '❌ User already has this role.', 
          ephemeral: true 
        });
      }

      await member.roles.add(role, `Given by ${interaction.user.tag}`);

      const embed = new EmbedBuilder()
        .setTitle('✅ Role Added')
        .setDescription(`Successfully added role to user.`)
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Role', value: `${role}`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      await moderationSystem.logAction(interaction.guild, {
        action: 'Role Add',
        moderator: interaction.user,
        target: `${user.tag} (${user.id})`,
        additional: `Role: ${role.name}`,
        color: 0x00ff00
      });
    } else {
      if (!member.roles.cache.has(role.id)) {
        return interaction.reply({ 
          content: '❌ User doesn\'t have this role.', 
          ephemeral: true 
        });
      }

      await member.roles.remove(role, `Removed by ${interaction.user.tag}`);

      const embed = new EmbedBuilder()
        .setTitle('✅ Role Removed')
        .setDescription(`Successfully removed role from user.`)
        .addFields(
          { name: 'User', value: `${user.tag}`, inline: true },
          { name: 'Role', value: `${role}`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true }
        )
        .setColor(0xff0000)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      await moderationSystem.logAction(interaction.guild, {
        action: 'Role Remove',
        moderator: interaction.user,
        target: `${user.tag} (${user.id})`,
        additional: `Role: ${role.name}`,
        color: 0xff0000
      });
    }
  } catch (error) {
    console.error('Error managing role:', error);
    await interaction.reply({ 
      content: '❌ Failed to manage the role.', 
      ephemeral: true 
    });
  }
}

export async function executeForceNickname(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'forcenickname')) return;
  }

  const user = interaction.options.getUser('user');
  const nickname = interaction.options.getString('nickname');

  // Validate nickname length
  if (nickname.length > 32) {
    return interaction.reply({ 
      content: '❌ Nickname must be 32 characters or less.', 
      ephemeral: true 
    });
  }

  try {
    const member = await interaction.guild.members.fetch(user.id);
    
    // Check if bot can manage the member
    if (!member.manageable) {
      return interaction.reply({ 
        content: '❌ I cannot manage this user\'s nickname. They may have higher permissions than me.', 
        ephemeral: true 
      });
    }

    // Check role hierarchy
    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ 
        content: '❌ You cannot force a nickname on someone with an equal or higher role.', 
        ephemeral: true 
      });
    }

    // Force the nickname
    const success = await moderationSystem.forceNickname(interaction.guild.id, user.id, nickname);

    if (!success) {
      return interaction.reply({ 
        content: '❌ Failed to force nickname.', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📝 Nickname Forced')
      .setDescription(`Forced nickname on ${user.tag}`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Forced Nickname', value: nickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x9b59b6)
      .setFooter({ text: 'User cannot change this nickname - permission removed' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Force Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Nickname: ${nickname} - Change nickname permission removed`,
      color: 0x9b59b6
    });
  } catch (error) {
    console.error('Error forcing nickname:', error);
    await interaction.reply({ 
      content: '❌ Failed to force nickname.', 
      ephemeral: true 
    });
  }
}

export async function executeUnforceNickname(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'unforcenickname')) return;
  }

  const user = interaction.options.getUser('user');

  try {
    // Check if user has a forced nickname
    const forcedNickname = moderationSystem.getForcedNickname(user.id);
    if (!forcedNickname) {
      return interaction.reply({ 
        content: '❌ This user does not have a forced nickname.', 
        ephemeral: true 
      });
    }

    // Remove the forced nickname
    const success = await moderationSystem.removeForcedNickname(interaction.guild.id, user.id);

    if (!success) {
      return interaction.reply({ 
        content: '❌ Failed to remove forced nickname.', 
        ephemeral: true 
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Forced Nickname Removed')
      .setDescription(`Removed forced nickname from ${user.tag}`)
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Previous Forced Nickname', value: forcedNickname, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true }
      )
      .setColor(0x00ff00)
      .setFooter({ text: 'User can now change their nickname freely - permissions restored' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Unforce Nickname',
      moderator: interaction.user,
      target: `${user.tag} (${user.id})`,
      additional: `Previous nickname: ${forcedNickname} - Change nickname permission restored`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error removing forced nickname:', error);
    await interaction.reply({ 
      content: '❌ Failed to remove forced nickname.', 
      ephemeral: true 
    });
  }
}

export async function executeSetupPerms(interaction) {
  if (!interaction.options._subcommand) {
    if (!await checkPermissionAndCooldown(interaction, 'setupperms')) return;
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    const createdRoles = [];

    // Create VC role
    const vcRole = await guild.roles.create({
      name: 'VC Perms',
      color: 0x3498db,
      permissions: [
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.MoveMembers
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(vcRole);

    // Create Pic role
    const picRole = await guild.roles.create({
      name: 'Pic Perms',
      color: 0xe74c3c,
      permissions: [
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(picRole);

    // Create Link role
    const linkRole = await guild.roles.create({
      name: 'Link Perms',
      color: 0x2ecc71,
      permissions: [
        PermissionFlagsBits.EmbedLinks
      ],
      reason: `Setup by ${interaction.user.tag}`
    });
    createdRoles.push(linkRole);

    // Save role IDs to moderation system
    await moderationSystem.updatePermRoles({
      vc: vcRole.id,
      pic: picRole.id,
      link: linkRole.id
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Permission Roles Created')
      .setDescription('Successfully created moderation permission roles.')
      .addFields(
        { 
          name: 'VC Perms', 
          value: `${vcRole}\nMute, Deafen, Move Members`, 
          inline: true 
        },
        { 
          name: 'Pic Perms', 
          value: `${picRole}\nSend Images/Embeds`, 
          inline: true 
        },
        { 
          name: 'Link Perms', 
          value: `${linkRole}\nSend Links`, 
          inline: true 
        }
      )
      .setColor(0x00ff00)
      .setFooter({ text: 'Assign these roles to users who need the permissions' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    await moderationSystem.logAction(interaction.guild, {
      action: 'Setup Permissions',
      moderator: interaction.user,
      target: 'Created permission roles',
      additional: `VC: ${vcRole.id}, Pic: ${picRole.id}, Link: ${linkRole.id}`,
      color: 0x00ff00
    });
  } catch (error) {
    console.error('Error setting up permission roles:', error);
    await interaction.editReply({ 
      content: '❌ Failed to create permission roles. Make sure I have the necessary permissions.' 
    });
  }
}

// Helper function to parse duration strings
function parseDuration(duration) {
  const regex = /^(\d+)([smhd])$/;
  const match = duration.match(regex);
  
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  
  return value * multipliers[unit];
}

export const commands = [
  { data: lockChannelData, execute: executeLockChannel },
  { data: unlockChannelData, execute: executeUnlockChannel },
  { data: nukeData, execute: executeNuke },
  { data: banData, execute: executeBan },
  { data: kickData, execute: executeKick },
  { data: unbanData, execute: executeUnban },
  { data: timeoutData, execute: executeTimeout },
  { data: roleData, execute: executeRole },
  { data: forceNicknameData, execute: executeForceNickname },
  { data: unforceNicknameData, execute: executeUnforceNickname },
  { data: setupPermsData, execute: executeSetupPerms }
];