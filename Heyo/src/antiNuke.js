// antiNuke.js
// Anti-nuke system for Discord bot with whitelist management commands

import {
  Collection,
  PermissionsBitField,
  AuditLogEvent
} from "discord.js";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";

class AntiNuke {
  constructor(client, configPath) {
    this.client = client;
    this.configPath = configPath;
    this.config = this.loadConfig(configPath);

    // Track recent admin actions (timestamps) per user ID
    this.adminActionLogs = new Collection();
    
    // Track recent messages (timestamps) per user ID for spam detection
    this.messageSpamLogs = new Collection();
    
    // Track channel operations
    this.channelCreateLogs = new Collection();
    this.channelDeleteLogs = new Collection();
    
    // Track role operations
    this.roleCreateLogs = new Collection();
    this.roleDeleteLogs = new Collection();

    // We no longer register commands here - it's handled by CommandRegistry
    
    // Handle incoming interactions for admin commands
    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      
      // Handle any admin command that's not antinuke
      if (interaction.commandName !== "antinuke") {
        await this.handleAdminCommand(interaction);
      }
    });

    // Detect ban events
    this.client.on("guildBanAdd", (ban) => {
      this.handleBan(ban);
    });

    // Detect kicks via member removal
    this.client.on("guildMemberRemove", (member) => {
      this.handleKick(member);
    });
    
    // Detect message spam
    this.client.on("messageCreate", (message) => {
      if (message.author.bot) return;
      this.handleMessageSpam(message);
    });
    
    // Detect channel creation
    this.client.on("channelCreate", (channel) => {
      this.handleChannelCreate(channel);
    });
    
    // Detect channel deletion
    this.client.on("channelDelete", (channel) => {
      this.handleChannelDelete(channel);
    });
    
    // Detect role creation
    this.client.on("roleCreate", (role) => {
      this.handleRoleCreate(role);
    });
    
    // Detect role deletion
    this.client.on("roleDelete", (role) => {
      this.handleRoleDelete(role);
    });
  }

  loadConfig(configPath) {
    try {
      const file = fs.readFileSync(path.resolve(configPath), "utf8");
      const full = yaml.load(file);
      const config = full.antiNuke || {};
      
      // Ensure all required config sections exist with defaults
      return {
        whitelist: config.whitelist || { users: [], roles: [] },
        adminRoles: config.adminRoles || [],
        adminUsers: config.adminUsers || [],
        limits: {
          commands: config.limits?.commands || { maxActions: 5, timeWindowSeconds: 60 },
          bans: config.limits?.bans || { maxActions: 3, timeWindowSeconds: 120 },
          kicks: config.limits?.kicks || { maxActions: 5, timeWindowSeconds: 120 },
          messages: config.limits?.messages || { maxMessages: 10, timeWindowSeconds: 10, timeoutDuration: "5m" },
          channelCreate: config.limits?.channelCreate || { maxActions: 3, timeWindowSeconds: 60 },
          channelDelete: config.limits?.channelDelete || { maxActions: 2, timeWindowSeconds: 60 },
          roleCreate: config.limits?.roleCreate || { maxActions: 3, timeWindowSeconds: 60 },
          roleDelete: config.limits?.roleDelete || { maxActions: 2, timeWindowSeconds: 60 }
        },
        adminLogChannel: config.adminLogChannel,
        abuseLogChannel: config.abuseLogChannel
      };
    } catch (e) {
      console.error("[AntiNuke] Failed to load config:", e);
      return {
        whitelist: { users: [], roles: [] },
        adminRoles: [],
        adminUsers: [],
        limits: {
          commands: { maxActions: 5, timeWindowSeconds: 60 },
          bans: { maxActions: 3, timeWindowSeconds: 120 },
          kicks: { maxActions: 5, timeWindowSeconds: 120 },
          messages: { maxMessages: 10, timeWindowSeconds: 10, timeoutDuration: "5m" },
          channelCreate: { maxActions: 3, timeWindowSeconds: 60 },
          channelDelete: { maxActions: 2, timeWindowSeconds: 60 },
          roleCreate: { maxActions: 3, timeWindowSeconds: 60 },
          roleDelete: { maxActions: 2, timeWindowSeconds: 60 }
        }
      };
    }
  }

  saveConfig() {
    try {
      const fullFile = fs.readFileSync(path.resolve(this.configPath), "utf8");
      const full = yaml.load(fullFile);
      
      // Preserve existing structure but update antiNuke section
      full.antiNuke = {
        whitelist: this.config.whitelist,
        adminUsers: this.config.adminUsers,
        adminRoles: this.config.adminRoles,
        limits: this.config.limits,
        adminLogChannel: this.config.adminLogChannel,
        abuseLogChannel: this.config.abuseLogChannel
      };
      
      const output = yaml.dump(full, { lineWidth: -1 });
      fs.writeFileSync(path.resolve(this.configPath), output, "utf8");
    } catch (e) {
      console.error("[AntiNuke] Failed to save config:", e);
    }
  }

  parseTimeoutDuration(duration) {
    // Parse "5m" or "60s" format
    if (typeof duration === 'string') {
      const match = duration.match(/^(\d+)(m|s)$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        return unit === 'm' ? value * 60 * 1000 : value * 1000;
      }
    }
    // Default to 5 minutes if invalid format
    return 5 * 60 * 1000;
  }

  formatTimeoutDuration(duration) {
    // Format milliseconds to human readable
    if (typeof duration === 'string') return duration;
    const seconds = Math.floor(duration / 1000);
    if (seconds >= 60) {
      return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) > 1 ? 's' : ''}`;
    }
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  isWhitelisted(userId, roleIds = []) {
    const { whitelist } = this.config;
    if (!whitelist) return false;
    if (whitelist.users?.includes(userId)) return true;
    if (whitelist.roles) {
      for (const r of roleIds) {
        if (whitelist.roles.includes(r)) return true;
      }
    }
    return false;
  }

  hasAdminRole(member) {
    // Check if user is the server owner
    if (member.guild.ownerId === member.id) return true;
    
    // Check if user is in adminUsers list
    const { adminUsers = [] } = this.config;
    if (adminUsers.includes(member.id)) return true;
    
    // Check if user has an admin role
    const { adminRoles = [] } = this.config;
    return member.roles.cache.some((r) => adminRoles.includes(r.id));
  }

  async handleAntinukeCommand(interaction) {
    const member = interaction.member;
    if (!this.hasAdminRole(member)) {
      return interaction.reply({
        content: "❌ You lack permission to manage Anti-Nuke.",
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'whitelist') {
      const action = interaction.options.getString("action");
      const type = interaction.options.getString("type");
      const id = interaction.options.getString("id");

      if (action === "list") {
        const usersList = this.config.whitelist.users
          ?.map((u) => `<@${u}>`)
          .join(", ") || "None";
        const rolesList = this.config.whitelist.roles
          ?.map((r) => `<@&${r}>`)
          .join(", ") || "None";
        return interaction.reply({
          content: `**Whitelisted Users:** ${usersList}\n**Whitelisted Roles:** ${rolesList}`,
          ephemeral: true,
        });
      }

      if (!type || !id) {
        return interaction.reply({
          content: "❌ You must provide both **type** and **id** when using add/remove actions.",
          ephemeral: true,
        });
      }

      if (action === "add") {
        if (type === "user") {
          if (!this.config.whitelist.users) {
            this.config.whitelist.users = [];
          }
          if (!this.config.whitelist.users.includes(id)) {
            this.config.whitelist.users.push(id);
            this.saveConfig();
            return interaction.reply(`✅ Added user <@${id}> to whitelist.`);
          }
          return interaction.reply({
            content: "⚠️ User already whitelisted.",
            ephemeral: true,
          });
        } else {
          if (!this.config.whitelist.roles) {
            this.config.whitelist.roles = [];
          }
          if (!this.config.whitelist.roles.includes(id)) {
            this.config.whitelist.roles.push(id);
            this.saveConfig();
            return interaction.reply(`✅ Added role <@&${id}> to whitelist.`);
          }
          return interaction.reply({
            content: "⚠️ Role already whitelisted.",
            ephemeral: true,
          });
        }
      } else if (action === "remove") {
        if (type === "user") {
          if (!this.config.whitelist.users) {
            this.config.whitelist.users = [];
          }
          const idx = this.config.whitelist.users.indexOf(id);
          if (idx > -1) {
            this.config.whitelist.users.splice(idx, 1);
            this.saveConfig();
            return interaction.reply(`✅ Removed user <@${id}> from whitelist.`);
          }
          return interaction.reply({
            content: "⚠️ User not found in whitelist.",
            ephemeral: true,
          });
        } else {
          if (!this.config.whitelist.roles) {
            this.config.whitelist.roles = [];
          }
          const idx = this.config.whitelist.roles.indexOf(id);
          if (idx > -1) {
            this.config.whitelist.roles.splice(idx, 1);
            this.saveConfig();
            return interaction.reply(`✅ Removed role <@&${id}> from whitelist.`);
          }
          return interaction.reply({
            content: "⚠️ Role not found in whitelist.",
            ephemeral: true,
          });
        }
      }
    }

    return interaction.reply({
      content: "❌ Invalid subcommand.",
      ephemeral: true,
    });
  }

  async handleAdminCommand(interaction) {
    const userId = interaction.user.id;
    const member = interaction.member;
    const guild = interaction.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${member.user.tag} used /${interaction.commandName}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.adminActionLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.commands?.timeWindowSeconds || 60;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.commands?.maxActions || 5)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `spamming commands (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${member.user.tag} used /${interaction.commandName}`
    );
  }

  async handleBan(ban) {
    const executor = await this.fetchAuditExecutor(ban.guild, "BAN_ADD");
    if (!executor) return;
    const userId = executor.id;
    const guild = ban.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(userId);
    if (!member) return;

    if (
      this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))
    ) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} banned ${ban.user.tag}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.adminActionLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.bans?.timeWindowSeconds || 120;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.bans?.maxActions || 3)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid bans detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} banned ${ban.user.tag}`
    );
  }

  async handleKick(member) {
    const executor = await this.fetchAuditExecutor(member.guild, "MEMBER_KICK");
    if (!executor) return;
    const userId = executor.id;
    const guild = member.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const executorMember = guild.members.cache.get(userId);
    if (!executorMember) return;

    if (
      this.isWhitelisted(userId, executorMember.roles.cache.map((r) => r.id))
    ) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} kicked ${member.user.tag}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.adminActionLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.kicks?.timeWindowSeconds || 120;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.kicks?.maxActions || 5)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid kicks detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} kicked ${member.user.tag}`
    );
  }

  async handleMessageSpam(message) {
    const userId = message.author.id;
    const member = message.member;
    const guild = message.guild;
    
    if (!guild || !member) return;
    
    // Skip if user is whitelisted
    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) return;
    
    // Skip if user has admin access (can manage anti-nuke)
    if (this.hasAdminRole(member)) return;
    
    const abuseLogChannelId = this.config.abuseLogChannel;
    
    const now = Date.now();
    let timestamps = this.messageSpamLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.messages?.timeWindowSeconds || 10;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.messageSpamLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.messages?.maxMessages || 10)) {
      // Different actions based on whether user has admin permissions
      if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        // Admins get roles stripped
        await this.takeMitigationAction(
          guild,
          userId,
          `message spam detected (${timestamps.length} messages in ${windowSeconds} seconds)`,
          abuseLogChannelId
        );
      } else {
        // For regular users, timeout with configurable duration
        try {
          const timeoutDuration = this.parseTimeoutDuration(this.config.limits?.messages?.timeoutDuration || "5m");
          await member.timeout(timeoutDuration, "Message spam detected");
          const abuseChannel = guild.channels.cache.get(abuseLogChannelId);
          if (abuseChannel?.isTextBased()) {
            abuseChannel.send(
              `⚠️ **Message Spam Detected** ⚠️\nUser: ${member.user.tag}\nAction: ${this.formatTimeoutDuration(this.config.limits?.messages?.timeoutDuration || "5m")} timeout\nReason: ${timestamps.length} messages in ${windowSeconds} seconds`
            );
          }
        } catch (e) {
          console.error("[AntiNuke] Failed to timeout user:", e);
        }
      }
      
      // Clear the logs after taking action
      this.messageSpamLogs.delete(userId);
    }
  }

  async handleChannelCreate(channel) {
    const executor = await this.fetchAuditExecutor(channel.guild, "CHANNEL_CREATE");
    if (!executor) return;
    const userId = executor.id;
    const guild = channel.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(userId);
    if (!member) return;

    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} created channel #${channel.name}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.channelCreateLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.channelCreate?.timeWindowSeconds || 60;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.channelCreateLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.channelCreate?.maxActions || 3)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid channel creation detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} created channel #${channel.name}`
    );
  }

  async handleChannelDelete(channel) {
    const executor = await this.fetchAuditExecutor(channel.guild, "CHANNEL_DELETE");
    if (!executor) return;
    const userId = executor.id;
    const guild = channel.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(userId);
    if (!member) return;

    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} deleted channel #${channel.name}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.channelDeleteLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.channelDelete?.timeWindowSeconds || 60;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.channelDeleteLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.channelDelete?.maxActions || 2)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid channel deletion detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} deleted channel #${channel.name}`
    );
  }

  async handleRoleCreate(role) {
    const executor = await this.fetchAuditExecutor(role.guild, "ROLE_CREATE");
    if (!executor) return;
    const userId = executor.id;
    const guild = role.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(userId);
    if (!member) return;

    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} created role @${role.name}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.roleCreateLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.roleCreate?.timeWindowSeconds || 60;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.roleCreateLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.roleCreate?.maxActions || 3)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid role creation detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} created role @${role.name}`
    );
  }

  async handleRoleDelete(role) {
    const executor = await this.fetchAuditExecutor(role.guild, "ROLE_DELETE");
    if (!executor) return;
    const userId = executor.id;
    const guild = role.guild;
    const adminLogChannelId = this.config.adminLogChannel;
    const abuseLogChannelId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(userId);
    if (!member) return;

    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(
        guild,
        adminLogChannelId,
        `${executor.tag} deleted role @${role.name}`
      );
      return;
    }

    const now = Date.now();
    let timestamps = this.roleDeleteLogs.get(userId) || [];
    const windowSeconds = this.config.limits?.roleDelete?.timeWindowSeconds || 60;
    const windowMillis = windowSeconds * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.roleDeleteLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.limits?.roleDelete?.maxActions || 2)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid role deletion detected (${timestamps.length} in ${windowSeconds} seconds)`,
        abuseLogChannelId
      );
      return;
    }

    this.logAdminAction(
      guild,
      adminLogChannelId,
      `${executor.tag} deleted role @${role.name}`
    );
  }

  async takeMitigationAction(guild, userId, reason, abuseLogChannelId) {
    try {
      const member = await guild.members.fetch(userId);
      const rolesToRemove = member.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => r.id);
      await member.roles.remove(rolesToRemove, "Anti-nuke mitigation");
      const abuseChannel = guild.channels.cache.get(abuseLogChannelId);
      if (abuseChannel?.isTextBased()) {
        abuseChannel.send(
          `⚠️ **Admin Abuse Detected** ⚠️\nUser: ${member.user.tag}\nReason: ${reason}\nAction: Roles stripped`
        );
      }
    } catch (e) {
      console.error("[AntiNuke] Mitigation failed:", e);
    }
  }

  logAdminAction(guild, channelId, message) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
      channel.send(`📝 **Admin Log:** ${message}`);
    }
  }

  /**
   * Fetches the user who performed the most recent audit-log action of the given type.
   * @param {Guild} guild
   * @param {string} actionKey  A string such as "ROLE_CREATE", "CHANNEL_DELETE", etc.
   * @returns {Promise<User|null>}
   */
  async fetchAuditExecutor(guild, actionKey) {
    try {
      let auditType;

      switch (actionKey) {
        case "ROLE_CREATE":
          auditType = AuditLogEvent.RoleCreate;
          break;
        case "ROLE_DELETE":
          auditType = AuditLogEvent.RoleDelete;
          break;
        case "CHANNEL_CREATE":
          auditType = AuditLogEvent.ChannelCreate;
          break;
        case "CHANNEL_DELETE":
          auditType = AuditLogEvent.ChannelDelete;
          break;
        case "MEMBER_KICK":
          auditType = AuditLogEvent.MemberKick;
          break;
        case "BAN_ADD":
          auditType = AuditLogEvent.MemberBanAdd;
          break;
        default:
          console.error(`[AntiNuke] Unknown audit‐log action key: ${actionKey}`);
          return null;
      }

      const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType });
      const entry = logs.entries.first();
      return entry?.executor ?? null;
    } catch (e) {
      console.error("[AntiNuke] Fetch audit executor failed:", e);
      return null;
    }
  }
}

export default AntiNuke;
