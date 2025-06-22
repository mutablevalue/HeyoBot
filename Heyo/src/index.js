// src/index.js
// Entry point for your Discord bot (ESM).
// Complete file with unified permission system and music system

import { fileURLToPath, pathToFileURL } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import { Client, Collection, Events, ActivityType, Partials } from "discord.js";
import { ConfigLoader } from "./utils/configLoader.js";
import { CommandRegistry } from "./utils/commandRegistry.js";
import { EmbedLoader } from "./utils/embedLoader.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import { UnifiedPermissionSystem } from "./systems/unifiedPermissions.js";
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
import { BoosterSystem } from "./systems/boosterSystem.js";
import { FilterSystem } from "./systems/filterSystem.js";
import { BanAppealSystem } from "./systems/banAppealSystem.js";
import { TicketSystem } from "./systems/ticketSystem.js";
import { ConfessSystem } from "./systems/confessSystem.js";
import { SkullboardSystem } from "./systems/skullboardSystem.js";
import { SnipeSystem } from "./systems/snipeSystem.js";
import { SocialLookupSystem } from "./systems/socialLookupSystem.js";
import { EntranceSystem } from "./systems/entranceSystem.js";
import { GenderVerifySystem } from "./systems/genderVerifySystem.js";
import { FriendGroupSystem } from "./systems/friendGroupSystem.js";
import { GiveawaySystem } from "./systems/giveawaySystem.js";
import { BirthdaySystem } from "./systems/birthdaySystem.js";
import { MusicSystem } from "./systems/musicSystem.js";
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
import * as boosterCommands from "./commands/booster.js";
import * as filterCommands from "./commands/filter.js";
import * as banAppealCommands from "./commands/banappeal.js";
import * as ticketCommands from "./commands/ticket.js";
import * as confessCommands from "./commands/confess.js";
import * as setStatusCommand from "./commands/setstatus.js";
import * as skullboardCommands from "./commands/skullboard.js";
import * as snipeCommands from "./commands/snipe.js";
import * as socialCommands from "./commands/social.js";
import * as setupEntranceCommand from "./commands/setupentrance.js";
import * as antiNukeCommand from "./commands/antinuke.js";
import * as emojiCommand from "./commands/emoji.js";
import * as genderVerifyCommands from "./commands/genderverify.js";
import * as messageCommand from "./commands/message.js";
import * as friendGroupCommands from "./commands/friendgroup.js";
import * as giveawayCommands from "./commands/giveaway.js";
import * as birthdayCommands from "./commands/birthday.js";
import * as rateLimitCommand from "./commands/ratelimit.js";
import * as pingCommand from "./commands/ping.js";
import * as permissionsCommand from "./commands/permissions.js";
import * as musicCommands from "./commands/music.js";
import { QueueManager } from "./utils/queueManager.js";
import * as activeWebhooksCommand from "./commands/activewebhooks.js";
import * as inviteLinksCommand from "./commands/invitelinks.js";


// ─────────────────────────────────────────────────────────────────────────────
// Polyfill __dirname and __filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 1) Load config.yaml via ConfigLoader
  const configPath = resolve(__dirname, "../config.yaml");
  const config     = new ConfigLoader(configPath);

  // 2) Create Discord Client with specified intents and partials
  const client = new Client({ 
    intents: botIntents,
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember
    ]
  });

  // 3) Initialize systems with proper hierarchy
  console.log('\n=== Initializing Bot Systems ===');
  
  // First: Core utilities
  const embedLoader = new EmbedLoader(config);
  console.log('✓ EmbedLoader initialized');
  
  // Second: Unified Permission System (manages all permissions)
  const permissionSystem = new UnifiedPermissionSystem(config);
  console.log('✓ Unified Permission System initialized');
  
  // Third: Rate Limiter (uses permission levels)
  const rateLimiterConfig = config.get("rateLimit");
  const rateLimiter = new RateLimiter(rateLimiterConfig);
  rateLimiter.setPermissionSystem(permissionSystem); // Connect to permission system
  console.log('✓ Rate Limiter initialized');
  
  // Fourth: AntiNuke (uses permission system)
  const antiNuke = new AntiNuke(client, config);
  antiNuke.embedLoader = embedLoader;
  antiNuke.setPermissionSystem(permissionSystem);
  console.log('✓ AntiNuke System initialized');
  
  // Fifth: ModerationSystem (uses permission system)
  const moderationSystem = new ModerationSystem(client, config);
  moderationSystem.setAntiNuke(antiNuke);
  moderationSystem.setEmbedLoader(embedLoader);
  moderationSystem.setPermissionSystem(permissionSystem);
  console.log('✓ Moderation System initialized');
  
  // Sixth: All other systems
  const j2cManager = new J2CManager(client, config);
  const vanityManager = new VanityManager(client, config);
  const afkManager = new AfkManager(client, config);
  afkManager.embedLoader = embedLoader;
  
  const friendGroupSystem = new FriendGroupSystem(client, config, moderationSystem);
  friendGroupSystem.embedLoader = embedLoader;
  
  const linkProtection = new LinkProtection(client, config);
  linkProtection.setModerationSystem(moderationSystem);
  linkProtection.setEmbedLoader(embedLoader);
  
  const welcomeSystem = new WelcomeSystem(client, config);
  const roleTracker = new RoleTracker(client, config, embedLoader);
  const leaderboardSystem = new LeaderboardSystem(client, config);
  const eventHostingSystem = new EventHostingSystem(client, config, leaderboardSystem);
  const boosterSystem = new BoosterSystem(client, config, moderationSystem);
  boosterSystem.embedLoader = embedLoader;
  
  const filterSystem = new FilterSystem(client, config);
  filterSystem.setModerationSystem(moderationSystem);
  filterSystem.setEmbedLoader(embedLoader);
  
  const banAppealSystem = new BanAppealSystem(client, config);
  banAppealSystem.embedLoader = embedLoader;
  const ticketSystem = new TicketSystem(client, config);
  const confessSystem = new ConfessSystem(client, config);
  confessSystem.setEmbedLoader(embedLoader);
  const skullboardSystem = new SkullboardSystem(client, config, embedLoader, antiNuke);
  const snipeSystem = new SnipeSystem(client, config, embedLoader);
  const socialLookupSystem = new SocialLookupSystem(client, config);
  const entranceSystem = new EntranceSystem(client, config);
  entranceSystem.setEmbedLoader(embedLoader);
  const genderVerifySystem = new GenderVerifySystem(client, config, moderationSystem);
  genderVerifySystem.embedLoader = embedLoader;
  const giveawaySystem = new GiveawaySystem(client, config, embedLoader);
  const birthdaySystem = new BirthdaySystem(client, config);
  birthdaySystem.embedLoader = embedLoader;
  
  // Initialize Music System
  const musicSystem = new MusicSystem(client, config);
  musicSystem.setEmbedLoader(embedLoader);
  musicSystem.setPermissionSystem(permissionSystem);
  console.log('✓ Music System initialized');
  
  console.log('✓ All subsystems initialized');
  console.log('================================\n');

  // 4) Pass systems into commands that need them
  
  // Core permission commands
  permissionsCommand.setPermissionSystem(permissionSystem);
  permissionsCommand.setModerationSystem(moderationSystem);
  permissionsCommand.setEmbedLoader(embedLoader);
  
  antiNukeCommand.setAntiNuke(antiNuke);
  antiNukeCommand.setEmbedLoader(embedLoader);
  antiNukeCommand.setPermissionSystem(permissionSystem);
  
  // Moderation commands
  moderationCommands.setModerationSystem(moderationSystem);
  moderationCommands.setEmbedLoader(embedLoader);
  moderationCommands.setAntiNukeInstance(antiNuke); // For multi-user detection
  
  // Music commands
  musicCommands.setMusicSystem(musicSystem);
  musicCommands.setEmbedLoader(embedLoader);
  musicCommands.setPermissionSystem(permissionSystem);
  
  // Other system commands
  setupJ2CCommand.setJ2CManager(j2cManager);
  setupJ2CCommand.setEmbedLoader(embedLoader);
  vcCommand.setJ2CManager(j2cManager);
  vcCommand.setEmbedLoader(embedLoader);
  vanityCommand.setVanityManager(vanityManager);
  afkCommand.setAfkManager(afkManager);
  afkCommand.setEmbedLoader(embedLoader);
  welcomeCommand.setWelcomeSystem(welcomeSystem);
  giveawayCommands.setGiveawaySystem(giveawaySystem);
  giveawayCommands.setEmbedLoader(embedLoader);
  
  // Channel commands need both ModerationSystem, RoleTracker, and EmbedLoader
  channelCommands.setModerationSystem(moderationSystem);
  channelCommands.setRoleTracker(roleTracker);
  channelCommands.setEmbedLoader(embedLoader);
  
  leaderboardCommands.setLeaderboardSystem(leaderboardSystem);
  leaderboardCommands.setEmbedLoader(embedLoader);
  eventCommands.setEventHostingSystem(eventHostingSystem);
  eventCommands.setLeaderboardSystem(leaderboardSystem);
  eventCommands.setEmbedLoader(embedLoader);
  boosterCommands.setBoosterSystem(boosterSystem);
  boosterCommands.setEmbedLoader(embedLoader);
  filterCommands.setFilterSystem(filterSystem);
  filterCommands.setEmbedLoader(embedLoader);
  banAppealCommands.setBanAppealSystem(banAppealSystem);
  banAppealCommands.setEmbedLoader(embedLoader);
  ticketCommands.setTicketSystem(ticketSystem);
  confessCommands.setConfessSystem(confessSystem);
  confessCommands.setEmbedLoader(embedLoader);
  
  // Skullboard commands need all three systems
  skullboardCommands.setSkullboardSystem(skullboardSystem);
  skullboardCommands.setModerationSystem(moderationSystem);
  skullboardCommands.setEmbedLoader(embedLoader);
  
  // Snipe commands need both SnipeSystem and EmbedLoader
  snipeCommands.setSnipeSystem(snipeSystem);
  snipeCommands.setEmbedLoader(embedLoader);
  
  socialCommands.setSocialLookupSystem(socialLookupSystem);
  socialCommands.setEmbedLoader(embedLoader);
  setupEntranceCommand.setEntranceSystem(entranceSystem);
  setupEntranceCommand.setEmbedLoader(embedLoader);
  emojiCommand.setModerationSystem(moderationSystem);
  emojiCommand.setEmbedLoader(embedLoader);
  genderVerifyCommands.setGenderVerifySystem(genderVerifySystem);
  genderVerifyCommands.setModerationSystem(moderationSystem);
  messageCommand.setModerationSystem(moderationSystem);
  messageCommand.setAntiNuke(antiNuke);
  messageCommand.setEmbedLoader(embedLoader);
  messageCommand.setPermissionSystem(permissionSystem);
  friendGroupCommands.setFriendGroupSystem(friendGroupSystem);
  friendGroupCommands.setModerationSystem(moderationSystem);
  birthdayCommands.setBirthdaySystem(birthdaySystem);
  birthdayCommands.setEmbedLoader(embedLoader);

  activeWebhooksCommand.setEmbedLoader(embedLoader);
activeWebhooksCommand.setPermissionSystem(permissionSystem);

inviteLinksCommand.setEmbedLoader(embedLoader);
inviteLinksCommand.setPermissionSystem(permissionSystem);
  
  // Setup username tracking for fun commands
  funCommands.setupUsernameTracking(client);
  setStatusCommand.setAntiNuke(antiNuke);
  setStatusCommand.setEmbedLoader(embedLoader);
  
  // RateLimiter and other utility commands
  rateLimitCommand.setRateLimiter(rateLimiter);
  rateLimitCommand.setEmbedLoader(embedLoader);
  pingCommand.setEmbedLoader(embedLoader);

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

    // Special handling for files that export multiple commands
    const multiCommandFiles = [
      'moderation.js', 'funcommands.js', 'channels.js', 'leaderboard.js', 
      'events.js', 'booster.js', 'filter.js', 'banappeal.js', 'ticket.js',
      'confess.js', 'skullboard.js', 'snipe.js', 'social.js', 'setupentrance.js',
      'genderverify.js', 'friendgroup.js', 'giveaway.js', 'birthday.js', 'music.js'
    ];
    
    if (multiCommandFiles.includes(file) && commandModule.commands) {
      for (const cmd of commandModule.commands) {
        if (!cmd.data || typeof cmd.execute !== "function") {
          console.warn(`Skipping command in ${file} – missing 'data' or 'execute'.`);
          continue;
        }
        client.commands.set(cmd.data.name, {
          data: cmd.data,
          execute: cmd.execute,
          autocomplete: cmd.autocomplete // Include autocomplete if present
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
        execute: commandModule.execute,
        autocomplete: commandModule.autocomplete
      });
    } else {
      console.warn(`Skipping ${file} – it does not export both 'data' and 'execute'.`);
    }
  }

  client.embedLoader = embedLoader;
  client.permissionSystem = permissionSystem;

  // 7) Initialize and start QueueManager
  const queueCfg     = config.get("queue") || {};
  const queueManager = new QueueManager(
    queueCfg.maxSize,
    queueCfg.workerCount,
    queueCfg.retryDelaySeconds
  );
  const workerFn = async (item) => {
    console.log(`Processing queue item: ${item}`);
    await new Promise((res) => setTimeout(res, 1000));
    console.log(`Finished processing: ${item}`);
  };
  queueManager.startWorkers(workerFn);

  // 8) On ready, register slash commands via CommandRegistry
  client.once(Events.ClientReady, async () => {
    console.log(`\n✅ Logged in as ${client.user.tag}`);

    // Set bot presence (status color and activity)
    const botConfig = config.get("bot");
    
    if (botConfig?.status) {
      const activityTypes = {
        'PLAYING': ActivityType.Playing,
        'WATCHING': ActivityType.Watching,
        'LISTENING': ActivityType.Listening,
        'STREAMING': ActivityType.Streaming,
        'COMPETING': ActivityType.Competing
      };

      const presenceStatus = {
        'GREEN': 'online',     // Green dot
        'YELLOW': 'idle',      // Yellow dot
        'RED': 'dnd',          // Red dot (Do Not Disturb)
        'GRAY': 'invisible',   // Gray dot
        'GREY': 'invisible'    // Alternative spelling
      };

      const activityType = activityTypes[botConfig.status.type] || ActivityType.Playing;
      const activityOptions = {
        name: botConfig.status.text,
        type: activityType
      };

      if (botConfig.status.url && activityType === ActivityType.Streaming) {
        activityOptions.url = botConfig.status.url;
      }

      // Set presence with both activity and status
      const presenceData = {
        activities: [activityOptions],
        status: presenceStatus[botConfig.status.color?.toUpperCase()]
      };

      client.user.setPresence(presenceData);
      console.log(`Bot presence set to: ${presenceData.status} - ${activityOptions.name}`);
    }

    // Setup cleanup intervals
    setInterval(() => {
      if (antiNuke.contentTracking) {
        antiNuke.cleanup();
      }
      permissionSystem.clearCache();
      moderationSystem.cleanupCooldowns();
      musicSystem.cleanup().catch(() => {}); // Refresh play-dl tokens
    }, 60000); // Run cleanup every minute

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
    console.log('PERMISSION HIERARCHY:');
    console.log('  Level 5: Server Owner (if bypass enabled)');
    console.log('  Level 4: AntiNuke Admin (highest normal level)');
    console.log('  Level 3: Administrator');
    console.log('  Level 2: Whitelisted (auto for Moderator+)');
    console.log('  Level 1: Moderator');
    console.log('  Level 0: Regular User');
    console.log('---');
    
    const permStats = permissionSystem.getStats();
    console.log(`Owner Bypass: ${config.get('moderation.ownerBypass') ? 'ENABLED' : 'DISABLED'}`);
    console.log(`AntiNuke Admins: ${permStats.antiNukeAdmins}`);
    console.log(`Administrators: ${permStats.administrators}`);
    console.log(`Moderators: ${permStats.moderators}`);
    console.log(`Total Whitelisted: ${permStats.whitelisted}`);
    console.log('---');
    
    console.log('CORE SYSTEMS:');
    console.log('✓ Unified Permission System: Active');
    console.log('✓ EmbedLoader: Active (Unified Visual System)');
    console.log(`✓ Rate Limiter: Active (Window: ${rateLimiterConfig.windowMs}ms)`);
    console.log('✓ AntiNuke: Active' + 
      (antiNuke.config.highAlert?.enabled ? ' [HIGH ALERT]' : '') +
      (antiNuke.config.contentModeration?.enabled ? ' + Content Moderation' : '') + 
      (antiNuke.config.multiUserDetection?.enabled ? ' + Multi-User Detection' : ''));
    console.log('✓ Moderation System: Active (Using Unified Permissions)');
    console.log('---');
    
    console.log('SUBSYSTEMS:');
    console.log('✓ J2C Manager: Active');
    console.log(`✓ Vanity Manager: ${vanityManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ AFK Manager: ${afkManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Link Protection: ${linkProtection.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Welcome System: ${welcomeSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Role Tracker: ${roleTracker.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Leaderboard System: ${leaderboardSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Event Hosting: ${eventHostingSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Booster System: ${boosterSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Filter System: ${filterSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Ban Appeal System: ${banAppealSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Ticket System: ${ticketSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Confess System: ${confessSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Skullboard System: ${skullboardSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Snipe System: ${snipeSystem.config.enabled ? 'Active' : 'Disabled'}` + 
      (snipeSystem.ghostPingConfig?.enabled ? ' + Ghost Ping Detection' : ''));
    console.log(`✓ Social Lookup System: ${socialLookupSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Entrance System: ${entranceSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Gender Verify System: ${genderVerifySystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Friend Group System: ${friendGroupSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Giveaway System: ${giveawaySystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Birthday System: ${birthdaySystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Music System: ${musicSystem.config.enabled ? 'Active' : 'Disabled'}` +
      (musicSystem.config.soundcloud?.clientId ? ' + SoundCloud' : '') +
      (musicSystem.config.youtube?.enabled ? ' + YouTube' : ''));
    console.log('✓ Fun Commands: Active');
    console.log('====================\n');
  });

  // 9) Handle slash command interactions with unified permission checking
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Check rate limit using permission-based limits
      if (interaction.member && rateLimiter) {
        const rateLimitCheck = await rateLimiter.checkLimit(interaction.member);
        if (!rateLimitCheck.allowed) {
          const message = rateLimiter.getCooldownMessage(rateLimitCheck.timeLeft);
          const embed = embedLoader.error(message);
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }
      }

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`Error executing /${interaction.commandName}:`, err);
        if (interaction.isRepliable()) {
          const errorEmbed = embedLoader.error("There was an error while executing this command.");
          await interaction.reply({
            embeds: [errorEmbed],
            ephemeral: true
          });
        }
      }
    } else if (interaction.isAutocomplete()) {
      // Handle autocomplete interactions
      const command = client.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`Error handling autocomplete for /${interaction.commandName}:`, err);
        // Autocomplete errors should be silent to the user
        await interaction.respond([]).catch(() => {});
      }
    } else if (interaction.isButton()) {
      // Handle button interactions
      if (interaction.customId.startsWith('lb_')) {
        // Leaderboard button interactions
        const { handleButtonInteraction } = await import('./commands/leaderboard.js');
        await handleButtonInteraction(interaction);
      } else if (interaction.customId.startsWith('appeal_')) {
        // Ban appeal button interactions
        await banAppealSystem.handleButtonInteraction(interaction);
      }
      // Other button handlers remain the same...
    } else if (interaction.isModalSubmit()) {
      // Handle modal submissions
      if (interaction.customId.startsWith('appeal_modal_')) {
        await banAppealSystem.handleModalSubmit(interaction);
      }
      // Other modal handlers remain the same...
    }
  });

  // 10) Example prefix-based "enqueue" listener
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const prefix = config.get("prefix");
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