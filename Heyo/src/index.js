// src/index.js
// Entry point for your Discord bot (ESM).
// This version reflects that vclock.js and vcreject.js have been removed.
// Only vc.js remains for voice‐channel actions.

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import { Client, Collection, Events } from "discord.js";
import { ConfigLoader } from "./utils/configLoader.js";
import { CommandRegistry } from "./utils/commandRegistry.js";
import AntiNuke from "./systems/antiNuke.js";
import { J2CManager } from "./systems/j2cManager.js";
import { botIntents } from "./intents.js";
import * as setupJ2CCommand from "./commands/setupj2c.js";
import * as vcCommand from "./commands/vc.js";     // Only vc.js remains
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

  // 3) Initialize AntiNuke and J2CManager
  const antiNuke   = new AntiNuke(client, config);
  const j2cManager = new J2CManager(client, config);

  // 4) Pass J2CManager into any commands that need it
  import("./commands/antinuke.js").then(mod => {
    if (typeof mod.setAntiNuke === "function") {
      mod.setAntiNuke(antiNuke);
    }
  });
  setupJ2CCommand.setJ2CManager(j2cManager);

  // Only vc.js remains—no vclock or vcreject
  vcCommand.setJ2CManager(j2cManager);

  // 5) Prepare client.commands collection
  client.commands = new Collection();

  // 6) Dynamically load all .js files in /commands
  const commandsDir  = resolve(__dirname, "commands");
  const commandFiles = fs
    .readdirSync(commandsDir)
    .filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath      = resolve(commandsDir, file);
    const moduleUrl     = pathToFileURL(filePath).href;
    const commandModule = await import(moduleUrl);

    if (!commandModule.data || typeof commandModule.execute !== "function") {
      console.warn(`Skipping ${file} – it does not export both 'data' and 'execute'.`);
      continue;
    }

    client.commands.set(commandModule.data.name, {
      data: commandModule.data,
      execute: commandModule.execute
    });
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
  });

  // 9) Handle slash command interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

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
  });

  // 10) Example prefix-based “enqueue” listener
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
