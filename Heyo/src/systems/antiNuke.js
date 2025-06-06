import {
  Collection,
  PermissionsBitField,
  AuditLogEvent
} from "discord.js";

class AntiNuke {
  /**
   * @param {import("discord.js").Client} client
   * @param {import("../utils/configLoader.js").ConfigLoader} configLoader
   */
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;

    // Load the nested "antiNuke" block from config.yaml (or fall back to defaults)
    const full = this.configLoader.get("antiNuke") || {};
    this.config = {
      whitelist: full.whitelist || { users: [], roles: [] },
      adminRoles: full.adminRoles || [],
      adminUsers: full.adminUsers || [],
      limits: {
        commands:     full.limits?.commands     || { maxActions: 5, timeWindowSeconds: 60 },
        bans:         full.limits?.bans         || { maxActions: 3, timeWindowSeconds: 120 },
        kicks:        full.limits?.kicks        || { maxActions: 5, timeWindowSeconds: 120 },
        messages:     full.limits?.messages     || { maxMessages: 10, timeWindowSeconds: 10, timeoutDuration: "5m" },
        channelCreate: full.limits?.channelCreate || { maxActions: 3, timeWindowSeconds: 60 },
        channelDelete: full.limits?.channelDelete || { maxActions: 2, timeWindowSeconds: 60 },
        roleCreate:    full.limits?.roleCreate    || { maxActions: 3, timeWindowSeconds: 60 },
        roleDelete:    full.limits?.roleDelete    || { maxActions: 2, timeWindowSeconds: 60 }
      },
      adminLogChannel: full.adminLogChannel || null,
      abuseLogChannel: full.abuseLogChannel || null
    };

    // In‐memory rate‐tracking collections
    this.adminActionLogs   = new Collection(); // userId => [ timestamps ]
    this.messageSpamLogs   = new Collection(); // userId => [ timestamps ]
    this.channelCreateLogs = new Collection();
    this.channelDeleteLogs = new Collection();
    this.roleCreateLogs    = new Collection();
    this.roleDeleteLogs    = new Collection();

    // Register event listeners exactly as before:
    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      // If it's NOT /antinuke itself, we treat it as an "admin command" to be rate‐limited
      if (interaction.commandName !== "antinuke") {
        await this.handleAdminCommand(interaction);
      }
    });
    this.client.on("guildBanAdd", (ban) => this.handleBan(ban));
    this.client.on("guildMemberRemove", (member) => this.handleKick(member));
    this.client.on("messageCreate", (message) => {
      if (message.author.bot) return;
      this.handleMessageSpam(message);
    });
    this.client.on("channelCreate", (channel) => this.handleChannelCreate(channel));
    this.client.on("channelDelete", (channel) => this.handleChannelDelete(channel));
    this.client.on("roleCreate", (role) => this.handleRoleCreate(role));
    this.client.on("roleDelete", (role) => this.handleRoleDelete(role));
  }

  /**
   * Replace old loadConfig(path) → we already loaded via ConfigLoader in constructor.
   * If config needs to change on‐disk, call saveConfig().
   */
  saveConfig() {
    // Overwrite just the "antiNuke" block in the root of configLoader’s data,
    // then write YAML back to disk.
    this.configLoader.set("antiNuke", {
      whitelist: this.config.whitelist,
      adminUsers: this.config.adminUsers,
      adminRoles: this.config.adminRoles,
      limits: this.config.limits,
      adminLogChannel: this.config.adminLogChannel,
      abuseLogChannel: this.config.abuseLogChannel
    });
    return this.configLoader.save();
  }

  parseTimeoutDuration(duration) {
    // same as your old code
    if (typeof duration === "string") {
      const match = duration.match(/^(\d+)(m|s)$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        return unit === "m" ? value * 60 * 1000 : value * 1000;
      }
    }
    return 5 * 60 * 1000;
  }

  formatTimeoutDuration(duration) {
    if (typeof duration === "string") return duration;
    const seconds = Math.floor(duration / 1000);
    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    return `${seconds} second${seconds > 1 ? "s" : ""}`;
  }

  isWhitelisted(userId, roleIds = []) {
    const { whitelist } = this.config;
    if (!whitelist) return false;
    if (whitelist.users.includes(userId)) return true;
    for (const rid of roleIds) {
      if (whitelist.roles.includes(rid)) return true;
    }
    return false;
  }

  hasAdminRole(member) {
    // Always allow server owner
    if (member.guild.ownerId === member.id) return true;
    // Check configured adminUsers
    if (this.config.adminUsers.includes(member.id)) return true;
    // Check configured adminRoles
    return member.roles.cache.some((r) => this.config.adminRoles.includes(r.id));
  }

  // ────────────────────────────────────────────────────────────────────
  // Slash‐command handler for /antinuke subcommands (e.g. /antinuke whitelist add/remove/list)
  async handleAntinukeCommand(interaction) {
    const member = interaction.member;
    if (!this.hasAdminRole(member)) {
      return interaction.reply({ content: "❌ You lack permission to manage Anti‐Nuke.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "whitelist") {
      const action = interaction.options.getString("action");
      const type   = interaction.options.getString("type");
      const id     = interaction.options.getString("id");

      if (action === "list") {
        const usersList = this.config.whitelist.users
          .map((u) => `<@${u}>`)
          .join(", ") || "None";
        const rolesList = this.config.whitelist.roles
          .map((r) => `<@&${r}>`)
          .join(", ") || "None";
        return interaction.reply({
          content: `**Whitelisted Users:** ${usersList}\n**Whitelisted Roles:** ${rolesList}`,
          ephemeral: true
        });
      }

      if (!type || !id) {
        return interaction.reply({
          content: "❌ You must provide both **type** and **id** when using add/remove.",
          ephemeral: true
        });
      }

      if (action === "add") {
        if (type === "user") {
          if (!this.config.whitelist.users.includes(id)) {
            this.config.whitelist.users.push(id);
            await this.saveConfig();
            return interaction.reply(`✅ Added user <@${id}> to whitelist.`);
          } else {
            return interaction.reply({ content: "⚠️ User already whitelisted.", ephemeral: true });
          }
        } else {
          if (!this.config.whitelist.roles.includes(id)) {
            this.config.whitelist.roles.push(id);
            await this.saveConfig();
            return interaction.reply(`✅ Added role <@&${id}> to whitelist.`);
          } else {
            return interaction.reply({ content: "⚠️ Role already whitelisted.", ephemeral: true });
          }
        }
      } else if (action === "remove") {
        if (type === "user") {
          const idx = this.config.whitelist.users.indexOf(id);
          if (idx > -1) {
            this.config.whitelist.users.splice(idx, 1);
            await this.saveConfig();
            return interaction.reply(`✅ Removed user <@${id}> from whitelist.`);
          } else {
            return interaction.reply({ content: "⚠️ User not in whitelist.", ephemeral: true });
          }
        } else {
          const idx = this.config.whitelist.roles.indexOf(id);
          if (idx > -1) {
            this.config.whitelist.roles.splice(idx, 1);
            await this.saveConfig();
            return interaction.reply(`✅ Removed role <@&${id}> from whitelist.`);
          } else {
            return interaction.reply({ content: "⚠️ Role not in whitelist.", ephemeral: true });
          }
        }
      }
    }

    return interaction.reply({ content: "❌ Invalid subcommand.", ephemeral: true });
  }

  // ────────────────────────────────────────────────────────────────────
  // Any slash command (except /antinuke) that requires "Administrator" perms is rate‐limited here
  async handleAdminCommand(interaction) {
    const userId = interaction.user.id;
    const member = interaction.member;
    const guild  = interaction.guild;
    const logId  = this.config.adminLogChannel;
    const abuseId= this.config.abuseLogChannel;

    // Only administrators can do this
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    // If whitelisted, just log and return
    if (this.isWhitelisted(userId, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${member.user.tag} used /${interaction.commandName}`);
      return;
    }

    // Rate‐limit logic for "admin commands"
    const now = Date.now();
    let timestamps = this.adminActionLogs.get(userId) || [];
    const windowSec   = this.config.limits.commands.timeWindowSeconds;
    const windowMs    = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    // If over the limit, mitigate
    if (timestamps.length > this.config.limits.commands.maxActions) {
      await this.takeMitigationAction(
        guild,
        userId,
        `spamming commands (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    // Otherwise, just log the normal admin action
    this.logAdminAction(guild, logId, `${member.user.tag} used /${interaction.commandName}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleBan(ban) {
    const executor = await this.fetchAuditExecutor(ban.guild, "BAN_ADD");
    if (!executor) return;

    const uid   = executor.id;
    const guild = ban.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(uid);
    if (!member) return;

    // If whitelisted, just log
    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} banned ${ban.user.tag}`);
      return;
    }

    // Rate‐limit ban actions
    const now = Date.now();
    let timestamps = this.adminActionLogs.get(uid) || [];
    const windowSec = this.config.limits.bans.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.adminActionLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.bans.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid bans detected (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} banned ${ban.user.tag}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleKick(member) {
    const executor = await this.fetchAuditExecutor(member.guild, "MEMBER_KICK");
    if (!executor) return;

    const uid   = executor.id;
    const guild = member.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const execMember = guild.members.cache.get(uid);
    if (!execMember) return;

    if (this.isWhitelisted(uid, execMember.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} kicked ${member.user.tag}`);
      return;
    }

    // Rate‐limit kick actions
    const now = Date.now();
    let timestamps = this.adminActionLogs.get(uid) || [];
    const windowSec = this.config.limits.kicks.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.adminActionLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.kicks.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid kicks detected (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} kicked ${member.user.tag}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleMessageSpam(message) {
    const uid    = message.author.id;
    const member = message.member;
    const guild  = message.guild;
    if (!guild || !member) return;

    // Skip whitelisted or admins
    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) return;
    if (this.hasAdminRole(member)) return;

    const abuseId = this.config.abuseLogChannel;
    const now     = Date.now();
    let timestamps = this.messageSpamLogs.get(uid) || [];
    const windowSec = this.config.limits.messages.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.messageSpamLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.messages.maxMessages) {
      // If the user is an administrator, strip roles; else timeout
      if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await this.takeMitigationAction(
          guild,
          uid,
          `message spam (${timestamps.length} in ${windowSec}s)`,
          abuseId
        );
      } else {
        try {
          const timeoutDur = this.parseTimeoutDuration(this.config.limits.messages.timeoutDuration);
          await member.timeout(timeoutDur, "Message spam detected");
          const abuseChannel = guild.channels.cache.get(abuseId);
          if (abuseChannel?.isTextBased()) {
            abuseChannel.send(
              `⚠️ **Message Spam Detected** ⚠️\nUser: ${member.user.tag}\nAction: ${this.formatTimeoutDuration(this.config.limits.messages.timeoutDuration)} timeout\nReason: ${timestamps.length} messages in ${windowSec}s`
            );
          }
        } catch (e) {
          console.error("[AntiNuke] Failed to timeout user:", e);
        }
      }
      this.messageSpamLogs.delete(uid);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  async handleChannelCreate(channel) {
    const executor = await this.fetchAuditExecutor(channel.guild, "CHANNEL_CREATE");
    if (!executor) return;

    const uid   = executor.id;
    const guild = channel.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(uid);
    if (!member) return;

    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} created channel #${channel.name}`);
      return;
    }

    // Rate‐limit channel creation
    const now = Date.now();
    let timestamps = this.channelCreateLogs.get(uid) || [];
    const windowSec = this.config.limits.channelCreate.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.channelCreateLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.channelCreate.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid channel creation (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} created channel #${channel.name}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleChannelDelete(channel) {
    const executor = await this.fetchAuditExecutor(channel.guild, "CHANNEL_DELETE");
    if (!executor) return;

    const uid   = executor.id;
    const guild = channel.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(uid);
    if (!member) return;

    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} deleted channel #${channel.name}`);
      return;
    }

    // Rate‐limit channel deletion
    const now = Date.now();
    let timestamps = this.channelDeleteLogs.get(uid) || [];
    const windowSec = this.config.limits.channelDelete.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.channelDeleteLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.channelDelete.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid channel deletion (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} deleted channel #${channel.name}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleRoleCreate(role) {
    const executor = await this.fetchAuditExecutor(role.guild, "ROLE_CREATE");
    if (!executor) return;

    const uid   = executor.id;
    const guild = role.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(uid);
    if (!member) return;

    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} created role @${role.name}`);
      return;
    }

    // Rate‐limit role creation
    const now = Date.now();
    let timestamps = this.roleCreateLogs.get(uid) || [];
    const windowSec = this.config.limits.roleCreate.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.roleCreateLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.roleCreate.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid role creation (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} created role @${role.name}`);
  }

  // ────────────────────────────────────────────────────────────────────
  async handleRoleDelete(role) {
    const executor = await this.fetchAuditExecutor(role.guild, "ROLE_DELETE");
    if (!executor) return;

    const uid   = executor.id;
    const guild = role.guild;
    const logId = this.config.adminLogChannel;
    const abuseId = this.config.abuseLogChannel;

    const member = guild.members.cache.get(uid);
    if (!member) return;

    if (this.isWhitelisted(uid, member.roles.cache.map((r) => r.id))) {
      this.logAdminAction(guild, logId, `${executor.tag} deleted role @${role.name}`);
      return;
    }

    // Rate‐limit role deletion
    const now = Date.now();
    let timestamps = this.roleDeleteLogs.get(uid) || [];
    const windowSec = this.config.limits.roleDelete.timeWindowSeconds;
    const windowMs  = windowSec * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMs);
    timestamps.push(now);
    this.roleDeleteLogs.set(uid, timestamps);

    if (timestamps.length > this.config.limits.roleDelete.maxActions) {
      await this.takeMitigationAction(
        guild,
        uid,
        `rapid role deletion (${timestamps.length} in ${windowSec}s)`,
        abuseId
      );
      return;
    }

    this.logAdminAction(guild, logId, `${executor.tag} deleted role @${role.name}`);
  }

  // ────────────────────────────────────────────────────────────────────
  /**
   * Called whenever we detect “admin abuse” (too many actions in a short time).
   * We strip all roles that the bot can manage (i.e. botHighestRole.position > role.position).
   */
  async takeMitigationAction(guild, userId, reason, abuseLogChannelId) {
    try {
      const member = await guild.members.fetch(userId);
      if (!member) return;

      const botMember = await guild.members.fetch(guild.client.user.id);

      // Build a list of role IDs that are strictly lower than the bot’s top role
      const rolesToRemove = member.roles.cache
        .filter((r) => {
          if (r.id === guild.id) return false; 
          return botMember.roles.highest.position > r.position;
        })
        .map((r) => r.id);

      // If nothing to remove, log and bail
      if (rolesToRemove.length === 0) {
        const abuseChannel = guild.channels.cache.get(abuseLogChannelId);
        if (abuseChannel?.isTextBased()) {
          abuseChannel.send(
            `⚠️ **Admin Abuse Detected** ⚠️\n` +
            `User: ${member.user.tag}\n` +
            `Reason: ${reason}\n` +
            `Action: (no removable roles found—check bot’s role hierarchy)`
          );
        }
        return;
      }

      // Remove all manageable roles
      await member.roles.remove(rolesToRemove, "Anti-nuke mitigation");

      // Log exactly which roles we stripped
      const abuseChannel = guild.channels.cache.get(abuseLogChannelId);
      if (abuseChannel?.isTextBased()) {
        abuseChannel.send(
          `⚠️ **Admin Abuse Detected** ⚠️\n` +
          `User: ${member.user.tag}\n` +
          `Reason: ${reason}\n` +
          `Action: Stripped roles: ${rolesToRemove.map((id) => `<@&${id}>`).join(", ")}`
        );
      }
    } catch (e) {
      console.error("[AntiNuke] Mitigation failed:", e);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  logAdminAction(guild, channelId, message) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
      channel.send(`📝 **Admin Log:** ${message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  /**
   * Fetch the user who performed the most recent audit log entry of the given type.
   * Example actionKey: "ROLE_CREATE", "CHANNEL_DELETE", "MEMBER_KICK", "BAN_ADD"
   * @returns {Promise<import("discord.js").User|null>}
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
