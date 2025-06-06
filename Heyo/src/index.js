import {
  Client,
  Collection,
  Events,
} from 'discord.js';
import { ConfigLoader } from './utils/configLoader.js';
import { QueueManager } from './utils/queueManager.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { CommandRegistry } from './utils/commandRegistry.js';
import { J2CManager } from './utils/j2cManager.js';
import { botIntents } from './intents.js';
import * as pingCommand from './commands/ping.js';
import * as rateLimitCommand from './commands/ratelimit.js';
import * as antiNukeCommand from './commands/antinuke.js';
import * as setupJ2CCommand from './commands/setupj2c.js';
import * as vcCommand from './commands/vc.js';
import * as vcLockCommand from './commands/vclock.js';
import * as vcRejectCommand from './commands/vcreject.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import AntiNuke from "./systems/antiNuke.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const config = new ConfigLoader(path.resolve(__dirname, '../config.yaml'));
  const token = config.get('token');
  const prefix = config.get('prefix');
  const queueCfg = config.get('queue');
  const rateLimitCfg = config.get('rateLimit');
  
  const client = new Client({
    intents: botIntents,
  });
  
  const queueManager = new QueueManager(
    queueCfg.maxSize,
    queueCfg.workerCount,
    queueCfg.retryDelaySeconds
  );
  
  const rateLimiter = new RateLimiter(rateLimitCfg);
  
  // Initialize AntiNuke
  const antiNuke = new AntiNuke(client, path.resolve(__dirname, '../config.yaml'));
  
  // Initialize J2C Manager
  const j2cManager = new J2CManager(client, config.get('j2c') || {});
  
  // Pass rateLimiter to commands that need it
  rateLimitCommand.setRateLimiter(rateLimiter);
  
  // Pass antiNuke instance to the command
  antiNukeCommand.setAntiNuke(antiNuke);
  
  // Pass j2cManager to commands that need it
  setupJ2CCommand.setJ2CManager(j2cManager);
  vcCommand.setJ2CManager(j2cManager);
  vcLockCommand.setJ2CManager(j2cManager);
  vcRejectCommand.setJ2CManager(j2cManager);
  
  async function exampleWorker(item) {
    console.log(`Processing item from queue: ${item}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`Finished processing item: ${item}`);
  }
  
  queueManager.startWorkers(exampleWorker);
  
  client.commands = new Collection();
  client.commands.set(pingCommand.data.name, {
    data: pingCommand.data,
    execute: pingCommand.execute,
  });
  client.commands.set(rateLimitCommand.data.name, {
    data: rateLimitCommand.data,
    execute: rateLimitCommand.execute,
  });
  client.commands.set(antiNukeCommand.data.name, {
    data: antiNukeCommand.data,
    execute: antiNukeCommand.execute,
  });
  client.commands.set(setupJ2CCommand.data.name, {
    data: setupJ2CCommand.data,
    execute: setupJ2CCommand.execute,
  });
  client.commands.set(vcCommand.data.name, {
    data: vcCommand.data,
    execute: vcCommand.execute,
  });
  client.commands.set(vcLockCommand.data.name, {
    data: vcLockCommand.data,
    execute: vcLockCommand.execute,
  });
  client.commands.set(vcRejectCommand.data.name, {
    data: vcRejectCommand.data,
    execute: vcRejectCommand.execute,
  });
  
  // Listen to J2C events for logging
  j2cManager.on('channelCreated', ({ channel, owner, guild }) => {
    console.log(`[J2C] Created channel "${channel.name}" for ${owner.user.tag} in ${guild.name}`);
  });
  
  j2cManager.on('channelDeleted', ({ channelId, ownerId }) => {
    console.log(`[J2C] Deleted empty channel ${channelId} (owner: ${ownerId})`);
  });
  
  j2cManager.on('ownershipTransferred', ({ channel, oldOwner, newOwner }) => {
    console.log(`[J2C] Transferred ownership of "${channel.name}" from ${oldOwner.user.tag} to ${newOwner.user.tag}`);
  });
  
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    const clientId = client.user.id;
    
    // Create CommandRegistry and add all commands
    const commandRegistry = new CommandRegistry(token);
    commandRegistry.addCommand(pingCommand);
    commandRegistry.addCommand(rateLimitCommand);
    commandRegistry.addCommand(antiNukeCommand);
    commandRegistry.addCommand(setupJ2CCommand);
    commandRegistry.addCommand(vcCommand);
    commandRegistry.addCommand(vcLockCommand);
    commandRegistry.addCommand(vcRejectCommand);
    
    // Register all commands at once
    const guildId = config.get('developmentGuildId');
    
    // Debug: Check if bot is in the guild
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`Bot is not in guild ${guildId}. Available guilds:`);
      client.guilds.cache.forEach(g => {
        console.log(`- ${g.name} (${g.id})`);
      });
      
      // Try to register globally instead
      console.log('Attempting to register commands globally instead...');
      await commandRegistry.registerCommands(clientId);
    } else {
      console.log(`Registering commands to guild: ${guild.name} (${guild.id})`);
      await commandRegistry.registerCommands(clientId, guildId);
    }
    
    console.log('All slash commands registered successfully.');
  });
  
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    
    try {
      // Check rate limit for guild commands (except antinuke and vc commands)
      const exemptCommands = ['antinuke', 'setupj2c', 'vc', 'vclock', 'vcreject'];
      
      if (interaction.guild && interaction.member && !exemptCommands.includes(interaction.commandName)) {
        const guildMember = interaction.guild.members.cache.get(interaction.user.id);
        if (guildMember) {
          const { allowed, timeLeft } = await rateLimiter.checkLimit(guildMember);
          
          if (!allowed && timeLeft) {
            await interaction.reply({
              content: rateLimiter.getCooldownMessage(timeLeft),
              ephemeral: true
            });
            return;
          }
        }
      }
      
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
      }
    }
  });
  
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();
    
    if (cmd === 'enqueue') {
      const item = args.join(' ');
      if (item) {
        const success = queueManager.enqueue(item);
        if (success) {
          await message.reply(`Enqueued: ${item}`);
        } else {
          await message.reply('Queue is full.');
        }
      }
    }
  });
  
  await client.login(token);
}

main().catch(console.error);