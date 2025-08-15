import { fileURLToPath, pathToFileURL } from "url";
import { dirname, resolve } from "path";
import fs from "fs";
import { Client, Collection, Events, ActivityType, Partials, PermissionsBitField } from "discord.js";
import { ConfigLoader } from "./utils/configLoader.js";
import { CommandRegistry } from "./utils/commandRegistry.js";
import { EmbedLoader } from "./utils/embedLoader.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import AntiNuke from "./systems/antiNuke.js"; // Now includes permissions & moderation
import { J2CManager } from "./systems/j2cManager.js";
import { VanityManager } from "./systems/vanityManager.js";
import { AfkManager } from "./systems/afkManager.js";
// LinkProtection is now integrated into AntiNuke
import { WelcomeSystem } from "./systems/welcomeSystem.js";
import { RoleTracker } from "./systems/roleTracker.js";
import { LeaderboardSystem } from "./systems/leaderboardSystem.js";
import { EventHostingSystem } from "./systems/eventHostingSystem.js";
import { BoosterSystem } from "./systems/boosterSystem.js";
// FilterSystem is now integrated into AntiNuke
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

  // 3) Initialize systems with unified security architecture
  console.log('\n=== Initializing Bot Systems ===');
  
  // First: Core utilities
  const embedLoader = new EmbedLoader(config);
  console.log('✓ EmbedLoader initialized');
  
  // Second: Unified Security System (AntiNuke + Permissions + Moderation)
  const antiNuke = new AntiNuke(client, config);
  antiNuke.setEmbedLoader(embedLoader);
  console.log('✓ Unified Security System initialized');
  console.log('  ├─ AntiNuke Protection: Active');
  console.log('  ├─ Permission Management: Integrated');
  console.log('  └─ Moderation System: Integrated');
  
  // Third: Rate Limiter (uses AntiNuke's permission system)
  const rateLimiterConfig = config.get("rateLimit");
  const rateLimiter = new RateLimiter(rateLimiterConfig);
  // Connect to AntiNuke's internal permission system
  rateLimiter.getPermissionLevel = (member) => antiNuke.getPermissionLevel(member);
  console.log('✓ Rate Limiter initialized');
  
  // Fourth: All other systems
  const j2cManager = new J2CManager(client, config);
  const vanityManager = new VanityManager(client, config);
  const afkManager = new AfkManager(client, config);
  afkManager.embedLoader = embedLoader;
  
  const friendGroupSystem = new FriendGroupSystem(client, config, antiNuke); // Uses antiNuke instead of moderationSystem
  friendGroupSystem.embedLoader = embedLoader;
  
  // LinkProtection is now integrated into AntiNuke's moderation modules
  
  const welcomeSystem = new WelcomeSystem(client, config);
  const roleTracker = new RoleTracker(client, config, embedLoader);
  const leaderboardSystem = new LeaderboardSystem(client, config);
  const eventHostingSystem = new EventHostingSystem(client, config, leaderboardSystem);
  const boosterSystem = new BoosterSystem(client, config, antiNuke); // Pass antiNuke as moderationSystem
  boosterSystem.embedLoader = embedLoader;
  
  // FilterSystem is now integrated into AntiNuke's moderation modules
  
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
  const genderVerifySystem = new GenderVerifySystem(client, config, antiNuke); // Pass antiNuke as moderationSystem
  genderVerifySystem.embedLoader = embedLoader;
  const giveawaySystem = new GiveawaySystem(client, config, embedLoader);
  const birthdaySystem = new BirthdaySystem(client, config);
  birthdaySystem.embedLoader = embedLoader;
  
  // Initialize Music System
  const musicSystem = new MusicSystem(client, config);
  musicSystem.setEmbedLoader(embedLoader);
  musicSystem.setPermissionSystem(antiNuke); // Pass antiNuke as permissionSystem
  console.log('✓ Music System initialized');
  
  console.log('✓ All subsystems initialized');
  console.log('================================\n');

  // 4) Pass systems into commands that need them
  
  // Core permission commands now use antiNuke
  permissionsCommand.setPermissionSystem(antiNuke); // Use existing method name
  permissionsCommand.setModerationSystem(antiNuke); // Use existing method name
  permissionsCommand.setEmbedLoader(embedLoader);
  
  antiNukeCommand.setAntiNuke(antiNuke);
  antiNukeCommand.setEmbedLoader(embedLoader);
  
  // Moderation commands now use antiNuke
  moderationCommands.setModerationSystem(antiNuke); // Use existing method name
  moderationCommands.setEmbedLoader(embedLoader);
  moderationCommands.setAntiNukeInstance(antiNuke); // For multi-user detection
  
  // Music commands
  musicCommands.setMusicSystem(musicSystem);
  musicCommands.setEmbedLoader(embedLoader);
  musicCommands.setPermissionSystem(antiNuke); // Use existing method name
  
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
  
  // Channel commands need both AntiNuke, RoleTracker, and EmbedLoader
  channelCommands.setModerationSystem(antiNuke); // Use existing method name
  channelCommands.setRoleTracker(roleTracker);
  channelCommands.setEmbedLoader(embedLoader);
  
  leaderboardCommands.setLeaderboardSystem(leaderboardSystem);
  leaderboardCommands.setEmbedLoader(embedLoader);
  eventCommands.setEventHostingSystem(eventHostingSystem);
  eventCommands.setLeaderboardSystem(leaderboardSystem);
  eventCommands.setEmbedLoader(embedLoader);
  boosterCommands.setBoosterSystem(boosterSystem);
  boosterCommands.setEmbedLoader(embedLoader);
  filterCommands.setFilterSystem(antiNuke.filterSystem); // Pass the filter module directly
  filterCommands.setEmbedLoader(embedLoader);
  banAppealCommands.setBanAppealSystem(banAppealSystem);
  banAppealCommands.setEmbedLoader(embedLoader);
  ticketCommands.setTicketSystem(ticketSystem);
  confessCommands.setConfessSystem(confessSystem);
  confessCommands.setEmbedLoader(embedLoader);
  
  // Skullboard commands need all three systems
  skullboardCommands.setSkullboardSystem(skullboardSystem);
  skullboardCommands.setModerationSystem(antiNuke); // Use existing method name
  skullboardCommands.setEmbedLoader(embedLoader);
  
  // Snipe commands need both SnipeSystem and EmbedLoader
  snipeCommands.setSnipeSystem(snipeSystem);
  snipeCommands.setEmbedLoader(embedLoader);
  
  socialCommands.setSocialLookupSystem(socialLookupSystem);
  socialCommands.setEmbedLoader(embedLoader);
  setupEntranceCommand.setEntranceSystem(entranceSystem);
  setupEntranceCommand.setEmbedLoader(embedLoader);
  emojiCommand.setModerationSystem(antiNuke); // Use existing method name
  emojiCommand.setEmbedLoader(embedLoader);
  genderVerifyCommands.setGenderVerifySystem(genderVerifySystem);
  genderVerifyCommands.setModerationSystem(antiNuke); // Use existing method name
  messageCommand.setModerationSystem(antiNuke); // Use existing method name
  messageCommand.setAntiNuke(antiNuke); // Keep this one if it needs actual AntiNuke
  messageCommand.setEmbedLoader(embedLoader);
  messageCommand.setPermissionSystem(antiNuke); // Use existing method name
  friendGroupCommands.setFriendGroupSystem(friendGroupSystem);
  friendGroupCommands.setModerationSystem(antiNuke); // Use existing method name
  birthdayCommands.setBirthdaySystem(birthdaySystem);
  birthdayCommands.setEmbedLoader(embedLoader);
  ticketSystem.setEmbedLoader(embedLoader);

  activeWebhooksCommand.setEmbedLoader(embedLoader);
  activeWebhooksCommand.setPermissionSystem(antiNuke); // Use existing method name

  inviteLinksCommand.setEmbedLoader(embedLoader);
  inviteLinksCommand.setPermissionSystem(antiNuke); // Use existing method name

  
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
  client.antiNuke = antiNuke; // Main reference
  client.permissionSystem = antiNuke; // Backwards compatibility

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
      antiNuke.cleanup(); // Now handles all cleanup (antinuke, permissions, moderation)
      rateLimiter.cleanup();
      musicSystem.cleanup().catch(() => {}); // Refresh play-dl tokens
    }, 60000); // Run cleanup every minute

    const registry = new CommandRegistry(config.get("token"));
    for (const [, cmd] of client.commands) {
      registry.addCommand(cmd);
    }

    // Environment-based command registration
    const environment = config.get("environment") || "development";
    const guildId = config.get("developmentGuildId");
    const guild = client.guilds.cache.get(guildId);

    try {
      if (environment === "development") {
        if (guild) {
          await registry.registerCommands(client.user.id, guildId);
          console.log(`\n🚧 DEVELOPMENT MODE: Registered ${client.commands.size} commands to guild ${guild.name}.`);
        } else {
          console.error(`\n❌ Development guild ${guildId} not found. Skipping command registration.`);
          console.error(`Please ensure the bot is in the guild and the developmentGuildId is correct.`);
        }
      } else if (environment === "production") {
        await registry.registerCommands(client.user.id);
        console.log(`\n🌐 PRODUCTION MODE: Registered ${client.commands.size} commands globally.`);
        console.log(`Note: Global commands may take up to 1 hour to propagate.`);
      } else {
        console.error(`\n❌ Unknown environment: ${environment}. Use 'development' or 'production'.`);
      }
    } catch (err) {
      console.error("Error registering slash commands:", err);
    }

    // Log system status
    console.log('\n=== System Status ===');
    console.log(`ENVIRONMENT: ${environment.toUpperCase()}`);
    console.log('UNIFIED SECURITY SYSTEM:');
    console.log('  Permission Hierarchy:');
    console.log('    Level 6: Bot Owner (Highest)');
    console.log('    Level 5: Server Owner (if bypass enabled)');
    console.log('    Level 4: AntiNuke Admin');
    console.log('    Level 3: Administrator');
    console.log('    Level 2: Whitelisted');
    console.log('    Level 1: Moderator');
    console.log('    Level 0: Regular User');
    console.log('---');
    
    const stats = antiNuke.getStats();
    console.log(`Owner Bypass: ${config.get('moderation.ownerBypass') ? 'ENABLED' : 'DISABLED'}`);
    console.log(`High Alert: ${stats.highAlert ? 'ACTIVE' : 'Inactive'}`);
    console.log(`AntiNuke Admins: ${stats.permissions.antiNukeAdmins}`);
    console.log(`Administrators: ${stats.permissions.administrators}`);
    console.log(`Moderators: ${stats.permissions.moderators}`);
    console.log(`Total Whitelisted: ${stats.permissions.whitelisted}`);
    console.log(`Active Cooldowns: ${stats.activeCooldowns.commands}`);
    console.log('---');
    
    console.log('CORE SYSTEMS:');
    console.log('✓ Unified Security System: Active');
    console.log('  ├─ AntiNuke Protection: ' + 
      (antiNuke.config.highAlert?.enabled ? '[HIGH ALERT] ' : '') +
      (antiNuke.config.contentModeration?.enabled ? '+ Content Mod ' : '') + 
      (antiNuke.config.multiUserDetection?.enabled ? '+ Multi-User' : ''));
    console.log('  ├─ Permission Management: Integrated');
    console.log('  └─ Moderation System: Integrated');
    console.log('✓ EmbedLoader: Active (Unified Visual System)');
    console.log(`✓ Rate Limiter: Active (Window: ${rateLimiterConfig.windowMs}ms)`);
    console.log('---');
    
    console.log('SUBSYSTEMS:');
    console.log('✓ J2C Manager: Active');
    console.log(`✓ Vanity Manager: ${vanityManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ AFK Manager: ${afkManager.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Link Protection: ${antiNuke.linkProtection.config.enabled ? 'Active' : 'Disabled'} (Integrated in Security System)`);
    console.log(`✓ Welcome System: ${welcomeSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Role Tracker: ${roleTracker.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Leaderboard System: ${leaderboardSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Event Hosting: ${eventHostingSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Booster System: ${boosterSystem.config.enabled ? 'Active' : 'Disabled'}`);
    console.log(`✓ Filter System: ${antiNuke.filterSystem.config.enabled ? 'Active' : 'Disabled'} (Integrated in Security System)`);
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

  // 10) Message-based commands handler - allows slash commands to work as chat commands
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    
    const prefix = config.get("prefix") || ",";
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    
    // Check if this is a registered slash command
    const command = client.commands.get(commandName);
    if (!command) {
      // Handle the original enqueue command
      if (commandName === "enqueue") {
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
      return;
    }
    
    // Create an interaction-like adapter for the message
    const adapter = {
      // Core properties
      commandName,
      user: message.author,
      member: message.member,
      guild: message.guild,
      channel: message.channel,
      client: message.client,
      guildId: message.guild?.id,
      channelId: message.channel.id,
      
      // State tracking
      replied: false,
      deferred: false,
      lastReply: null,
      
      // Reply methods
      async reply(options) {
        if (this.replied) {
          return this.editReply(options);
        }
        this.replied = true;
        
        if (typeof options === 'string') {
          this.lastReply = await message.reply(options);
          return this.lastReply;
        }
        
        const replyOptions = { ...options };
        if (options.ephemeral) {
          // Can't do ephemeral in regular messages, so delete after a delay
          const sent = await message.reply(replyOptions);
          setTimeout(() => sent.delete().catch(() => {}), 10000);
          this.lastReply = sent;
          return sent;
        }
        
        this.lastReply = await message.reply(replyOptions);
        return this.lastReply;
      },
      
      async editReply(options) {
        if (!this.lastReply) return;
        
        if (typeof options === 'string') {
          return await this.lastReply.edit(options);
        }
        
        return await this.lastReply.edit(options);
      },
      
      async deferReply(options = {}) {
        if (this.deferred || this.replied) return;
        this.deferred = true;
        
        // Send a "thinking" message
        this.lastReply = await message.reply({
          embeds: [embedLoader.info("Processing command...")]
        });
        
        return this.lastReply;
      },
      
      async followUp(options) {
        if (typeof options === 'string') {
          return await message.channel.send(options);
        }
        return await message.channel.send(options);
      },
      
      async deleteReply() {
        if (this.lastReply) {
          return await this.lastReply.delete();
        }
      },
      
      // Permission checking
      memberPermissions: message.member?.permissions || new PermissionsBitField(),
      
      // Option parsing for slash command arguments
      options: {
        data: new Map(),
        
        getString(name, required = false) {
          const commandDef = command.data.toJSON ? command.data.toJSON() : command.data;
          const optionDefs = commandDef.options || [];
          
          // Find the option index
          let optionIndex = optionDefs.findIndex(opt => opt.name === name);
          
          // Handle subcommands and subcommand groups
          if (optionIndex === -1) {
            // Check if first arg is a subcommand
            const firstArg = args[0];
            const subcommand = optionDefs.find(opt => 
              opt.type === 1 && opt.name === firstArg
            );
            
            if (subcommand) {
              // Remove subcommand from args temporarily for parsing
              const subcommandName = args[0];
              const subArgs = args.slice(1);
              const subOptions = subcommand.options || [];
              optionIndex = subOptions.findIndex(opt => opt.name === name);
              
              if (optionIndex !== -1) {
                const value = subArgs[optionIndex];
                if (!value && required) throw new Error(`Option ${name} is required`);
                return value || null;
              }
            }
          }
          
          const value = args[optionIndex];
          if (!value && required) throw new Error(`Option ${name} is required`);
          return value || null;
        },
        
        getUser(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          
          // Parse user mention or ID
          const match = value.match(/^<@!?(\d+)>$/) || value.match(/^(\d+)$/);
          if (match) {
            return message.client.users.cache.get(match[1]) || null;
          }
          return null;
        },
        
        getMember(name, required = false) {
          const user = this.getUser(name, required);
          if (!user) return null;
          return message.guild?.members.cache.get(user.id) || null;
        },
        
        getChannel(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          
          // Parse channel mention or ID
          const match = value.match(/^<#(\d+)>$/) || value.match(/^(\d+)$/);
          if (match) {
            return message.guild?.channels.cache.get(match[1]) || null;
          }
          return null;
        },
        
        getRole(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          
          // Parse role mention or ID
          const match = value.match(/^<@&(\d+)>$/) || value.match(/^(\d+)$/);
          if (match) {
            return message.guild?.roles.cache.get(match[1]) || null;
          }
          
          // Try to find by name
          return message.guild?.roles.cache.find(r => 
            r.name.toLowerCase() === value.toLowerCase()
          ) || null;
        },
        
        getInteger(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          const parsed = parseInt(value);
          return isNaN(parsed) ? null : parsed;
        },
        
        getNumber(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          const parsed = parseFloat(value);
          return isNaN(parsed) ? null : parsed;
        },
        
        getBoolean(name, required = false) {
          const value = this.getString(name, required);
          if (!value) return null;
          return ['true', 'yes', '1', 'on'].includes(value.toLowerCase());
        },
        
        getSubcommand() {
          const commandDef = command.data.toJSON ? command.data.toJSON() : command.data;
          const optionDefs = commandDef.options || [];
          
          // Check if first arg matches a subcommand
          const firstArg = args[0];
          const subcommand = optionDefs.find(opt => 
            opt.type === 1 && opt.name === firstArg
          );
          
          return subcommand ? subcommand.name : null;
        },
        
        getSubcommandGroup() {
          const commandDef = command.data.toJSON ? command.data.toJSON() : command.data;
          const optionDefs = commandDef.options || [];
          
          // Check if first arg matches a subcommand group
          const firstArg = args[0];
          const subGroup = optionDefs.find(opt => 
            opt.type === 2 && opt.name === firstArg
          );
          
          if (subGroup && args[1]) {
            // Store subcommand for later retrieval
            this._subcommandFromGroup = args[1];
            return subGroup.name;
          }
          
          return null;
        },
        
        // Additional helper for getting attachment URLs from messages
        getAttachment(name, required = false) {
          // In messages, attachments come from message.attachments
          const attachment = message.attachments.first();
          if (!attachment && required) throw new Error(`Attachment ${name} is required`);
          return attachment || null;
        }
      },
      
      // Additional properties that might be needed
      isCommand: () => true,
      isChatInputCommand: () => true,
      isContextMenuCommand: () => false,
      isMessageContextMenuCommand: () => false,
      isUserContextMenuCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => false,
      isSelectMenu: () => false,
      isRepliable: () => true,
      
      // Support for showing modals (won't work in messages)
      async showModal() {
        throw new Error("Modals are not supported in message commands. Use slash commands for this feature.");
      }
    };
    
    // Check rate limit using permission-based limits
    if (message.member && rateLimiter) {
      const rateLimitCheck = await rateLimiter.checkLimit(message.member);
      if (!rateLimitCheck.allowed) {
        const cooldownMessage = rateLimiter.getCooldownMessage(rateLimitCheck.timeLeft);
        const embed = embedLoader.error(cooldownMessage);
        return message.reply({ embeds: [embed] });
      }
    }
    
    try {
      await command.execute(adapter);
    } catch (err) {
      console.error(`Error executing ${prefix}${commandName}:`, err);
      const errorEmbed = embedLoader.error("There was an error while executing this command.");
      await message.reply({ embeds: [errorEmbed] });
    }
  });

  // 11) Finally, log in
  await client.login(config.get("token"));
}

main().catch((err) => {
  console.error("Fatal error in main():", err);
});
