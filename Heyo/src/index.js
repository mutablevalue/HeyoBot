// src/index.js
// Entry point for your Discord bot (ESM).
// Updated to include all systems including LeaderboardSystem and EventHostingSystem

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import { Client, Collection, Events, ActivityType } from "discord.js";
import { ConfigLoader } from "./utils/configLoader.js";
import { CommandRegistry } from "./utils/commandRegistry.js";
import AntiNuke from "./systems/antiNuke.js";
import { J2CManager } from "./systems/j2cManager.js";
import { ModerationSystem } from "./systems/moderationSystem.js";
import { VanityManager } from "./systems/vanityManager.js";
import { AfkManager } from "./systems/afkManager.js";
import { LinkProtection } from "./systems/linkProtection.js";
import { WelcomeSystem } from "./systems/welcomeSystem.js";
import { RoleTracker } from "./systems/roleTracker.js";
import { LeaderboardSystem } from "./systems/leaderboardSystem.js";
import { EventHostingSystem } from "./systems/eventHostingSystem.js";
import { botIntents } from "./intents.js";
import * as setupJ2CCommand from "./commands/setupj2c.js";
import * as vcCommand from "./commands/vc.js";
import * as moderationCommands from "./commands/moderation.js";
import * as vanityCommand from "./commands/vanity.js";
import * as afkCommand from "./commands/afk.js";
import * as funCommands from "./commands/funcommands.js";
import * as welcomeCommand from "./commands/welcome.js";
import * as channelCommands from "./commands/channels.js";
import * as leaderboardCommands from "./commands/leaderboard.js";
import * as eventCommands from "./commands/events.js";
import { QueueManager } from "./utils/queueManager.js";

// ─────────────────────────────────────────────────────────────────────────────
// Polyfill __dirname and __filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 1) Load config.yaml via ConfigLoader
  const configPath = resolve(__dirname, "../config.yaml");
  const config     = new ConfigLoader(configPath);

  // 2) Create Discord Client with specified intents
  const client = new Client({ intents: botIntents });

  // 3) Initialize all systems
  const antiNuke = new AntiNuke(client, config);
  const j2cManager = new J2CManager(client, config);
  const moderationSystem = new ModerationSystem(client, config);
  const vanityManager = new VanityManager(client, config);
  const afkManager = new AfkManager(client, config);
  const linkProtection = new LinkProtection(client, config);
  const welcomeSystem = new WelcomeSystem(client, config);
  const roleTracker = new RoleTracker(client, config);
  const leaderboardSystem = new LeaderboardSystem(client, config);
  const eventHostingSystem = new EventHostingSystem(client, config, leaderboardSystem);

  // 4) Pass systems into commands that need them
  import("./commands/antinuke.js").then(mod => {
    if (typeof mod.setAntiNuke === "function") {
      mod.setAntiNuke(antiNuke);
    }
  });
  
  setupJ2CCommand.setJ2CManager(j2cManager);
  vcCommand.setJ2CManager(j2cManager);
  moderationCommands.setModerationSystem(moderationSystem);
  vanityCommand.setVanityManager(vanityManager);
  afkCommand.setAfkManager(afkManager);
  welcomeCommand.setWelcomeSystem(welcomeSystem);
  channelCommands.setModerationSystem(moderationSystem);
  channelCommands.setRoleTracker(roleTracker);
  leaderboardCommands.setLeaderboardSystem(leaderboardSystem);
  eventCommands.setEventHostingSystem(eventHostingSystem);
  eventCommands.setLeaderboardSystem(leaderboardSystem);

  // Setup username tracking for fun commands
  funCommands.setupUsernameTracking(client);

  // 5) Prepare client.commands collection
  client.commands = new Collection();

  // 6) Dynamically load all .js files in /commands
  const commandsDir  = resolve(__dirname, "commands");
  const commandFiles = fs
    .readdirSync(commandsDir)
    .filter((file) => file.endsWith(".js"));

  // Exclude root.js from loading
  const excludedFiles = ['root.js'];

  for (const file of commandFiles) {
    // Skip excluded files
    if (excludedFiles.includes(file)) {
      console.log(`Skipping ${file} (temporarily disabled)`);
      continue;
    }

    const filePath      = resolve(commandsDir, file);
    const moduleUrl     = pathToFileURL(filePath).href;
    const commandModule = await import(moduleUrl);

    // Special handling for files that export multiple commands
    if ((file === 'moderation.js' || file === 'funcommands.js' || file === 'channels.js' || file === 'leaderboard.js' || file === 'events.js') && commandModule.commands) {
      for (const cmd of commandModule.commands) {
        if (!cmd.data || typeof cmd.execute !== "function") {
          console.warn(`Skipping command in ${file} – missing 'data' or 'execute'.`);
          continue;
        }
        client.commands.set(cmd.data.name, {
          data: cmd.data,
          execute: cmd.execute
        });
      }
    } 
    // Special handling for vanity.js and welcome.js
    else if (file === 'vanity.js' || file === 'welcome.js') {
      const cmd = file === 'vanity.js' ? commandModule.vanityCommand : commandModule;
      if (cmd && cmd.data && typeof cmd.execute === "function") {
        client.commands.set(cmd.data.name, {
          data: cmd.data,
          execute: cmd.execute
        });
      }
    }
    else if (commandModule.data && typeof commandModule.execute === "function") {
      // Regular single command handling
      client.commands.set(commandModule.data.name, {
        data: commandModule.data,
        execute: commandModule.execute
      });
    } else {
      console.warn(`Skipping ${file} – it does not export both 'data' and 'execute'.`);
    }
  }

  // 7) Initialize and start QueueManager
  const queueCfg     = config.get("queue") || {};
  const queueManager = new QueueManager(
    queueCfg.maxSize        ?? 100,
    queueCfg.workerCount    ?? 3,
    queueCfg.retryDelaySeconds ?? 5
  );
  const workerFn = async (item) => {
    console.log(`Processing queue item: ${item}`);
    await new Promise((res) => setTimeout(res, 1000));
    console.log(`Finished processing: ${item}`);
  };
  queueManager.startWorkers(workerFn);

  // 8) On ready, register slash commands via CommandRegistry
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Set bot status from config
    const botConfig = config.get("bot") || {};
    if (botConfig.status) {
      const activityTypes = {
        'PLAYING': ActivityType.Playing,
        'WATCHING': ActivityType.Watching,
        'LISTENING': ActivityType.Listening,
        'STREAMING': ActivityType.Streaming,
        'COMPETING': ActivityType.Competing
      };

      const activityType = activityTypes[botConfig.status.type] || ActivityType.Playing;
      const activityOptions = {
        name: botConfig.status.text || 'with commands',
        type: activityType
      };

      if (botConfig.status.url && activityType === ActivityType.Streaming) {
        activityOptions.url = botConfig.status.url;
      }

      client.user.setActivity(activityOptions);
    }

    const registry = new CommandRegistry(config.get("token"));
    for (const [, cmd] of client.commands) {
      registry.addCommand(cmd);
    }

    const guildId = config.get("developmentGuildId");
    const guild   = client.guilds.cache.get(guildId);

    try {
      if (guild) {
        await registry.registerCommands(client.user.id, guildId);
        console.log(`Registered ${client.commands.size} commands to guild ${guild.name}.`);
      } else {
        await registry.registerCommands(client.user.id);
        console.log(`Registered ${client.commands.size} commands globally.`);
      }
    } catch (err) {
      console.error("Error registering slash commands:", err);
    }

    // Log system status
    console.log('\n=== System Status ===');
    console.log('AntiNuke: Active');
    console.log('J2C Manager: Active');
    console.log('Moderation System: Active');
    console.log(`Vanity Manager: ${vanityManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`AFK Manager: ${afkManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`Link Protection: ${linkProtection.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`Welcome System: ${welcomeSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`Role Tracker: ${roleTracker.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`Leaderboard System: ${leaderboardSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`Event Hosting: ${eventHostingSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log('Fun Commands: Active');
    console.log('====================\n');
  });

  // 9) Handle slash command interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`Error executing /${interaction.commandName}:`, err);
        if (interaction.isRepliable()) {
          await interaction.reply({
            content: "There was an error while executing this command.",
            ephemeral: true
          });
        }
      }
    } else if (interaction.isButton()) {
      // Handle button interactions
      if (interaction.customId.startsWith('lb_')) {
        // Leaderboard button interactions
        const { handleButtonInteraction } = await import('./commands/leaderboard.js');
        await handleButtonInteraction(interaction);
      }
    }
  });

  // 10) Example prefix-based "enqueue" listener
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const prefix = config.get("prefix") || "";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd  = args.shift()?.toLowerCase();
    if (cmd === "enqueue") {
      const item = args.join(" ");
      if (item) {
        const success = queueManager.enqueue(item);
        if (success) {
          await message.reply(`Enqueued: ${item}`);
        } else {
          await message.reply("Queue is full.");
        }
      }
    }
  });

  // 11) Finally, log in
  await client.login(config.get("token"));
}

main().catch((err) => {
  console.error("Fatal error in main():", err);
});