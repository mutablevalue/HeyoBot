// antiNuke.js
// Anti-nuke system for Discord bot with whitelist management commands

import { Collection, PermissionsBitField, Routes, REST } from "discord.js";
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

    // Register slash commands once the bot is ready
    client.once("ready", () => {
      this.registerSlashCommands();
    });

    // Handle incoming interactions (slash commands)
    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "antinuke") {
        await this.handleAntinukeCommand(interaction);
      } else {
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
  }

  loadConfig(configPath) {
    try {
      const file = fs.readFileSync(path.resolve(configPath), "utf8");
      const full = yaml.load(file);
      return full.antiNuke || {
        whitelist: { users: [], roles: [] },
        adminRoles: [],
      };
    } catch (e) {
      console.error("[AntiNuke] Failed to load config:", e);
      return { whitelist: { users: [], roles: [] }, adminRoles: [] };
    }
  }

  saveConfig() {
    try {
      const fullFile = fs.readFileSync(path.resolve(this.configPath), "utf8");
      const full = yaml.load(fullFile);
      full.antiNuke = this.config;
      const output = yaml.dump(full, { lineWidth: -1 });
      fs.writeFileSync(path.resolve(this.configPath), output, "utf8");
    } catch (e) {
      console.error("[AntiNuke] Failed to save config:", e);
    }
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
    const { adminRoles = [] } = this.config;
    return member.roles.cache.some((r) => adminRoles.includes(r.id));
  }

  async registerSlashCommands() {
    const clientId = this.client.user.id;
    const rest = new REST({ version: "10" }).setToken(this.client.token);
    const guildId = this.client.guilds.cache.first().id;

    const commands = [
      {
        name: "antinuke",
        description: "Manage Anti-Nuke whitelist",
        options: [
          {
            name: "whitelist",
            type: 2, // Subcommand
            description: "Allow or remove users/roles",
            options: [
              {
                name: "action",
                type: 3, // STRING
                description: "add or remove or list",
                required: true,
                choices: [
                  { name: "add", value: "add" },
                  { name: "remove", value: "remove" },
                  { name: "list", value: "list" },
                ],
              },
              {
                name: "type",
                type: 3,
                description: "user or role",
                required: false,
                choices: [
                  { name: "user", value: "user" },
                  { name: "role", value: "role" },
                ],
              },
              {
                name: "id",
                type: 3, // STRING
                description: "ID of the user or role",
                required: false,
              },
            ],
          },
        ],
      },
    ];

    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log("[AntiNuke] Registered /antinuke slash command");
    } catch (e) {
      console.error("[AntiNuke] Failed to register slash commands:", e);
    }
  }

  async handleAntinukeCommand(interaction) {
    const member = interaction.member;
    if (!this.hasAdminRole(member)) {
      return interaction.reply({
        content: "❌ You lack permission to manage Anti-Nuke.",
        ephemeral: true,
      });
    }

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
        content: "❌ You must provide both type and id for add/remove.",
        ephemeral: true,
      });
    }

    if (action === "add") {
      if (type === "user") {
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
    const windowMinutes = this.config.spamThreshold.timeWindowMinutes || 1;
    const windowMillis = windowMinutes * 60 * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.spamThreshold.maxActions || 5)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `spamming commands`,
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

    if (
      this.isWhitelisted(userId, executor.roles.cache.map((r) => r.id))
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
    const windowMinutes = this.config.spamThreshold.timeWindowMinutes || 1;
    const windowMillis = windowMinutes * 60 * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.spamThreshold.maxActions || 5)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid bans detected`,
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

    if (
      this.isWhitelisted(userId, executor.roles.cache.map((r) => r.id))
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
    const windowMinutes = this.config.spamThreshold.timeWindowMinutes || 1;
    const windowMillis = windowMinutes * 60 * 1000;
    timestamps = timestamps.filter((ts) => now - ts < windowMillis);
    timestamps.push(now);
    this.adminActionLogs.set(userId, timestamps);

    if (timestamps.length > (this.config.spamThreshold.maxActions || 5)) {
      await this.takeMitigationAction(
        guild,
        userId,
        `rapid kicks detected`,
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

  async fetchAuditExecutor(guild, actionType) {
    try {
      const logs = await guild.fetchAuditLogs({ limit: 1, type: actionType });
      const entry = logs.entries.first();
      return entry?.executor || null;
    } catch (e) {
      console.error("[AntiNuke] Fetch audit executor failed:", e);
      return null;
    }
  }
}

export default AntiNuke;
