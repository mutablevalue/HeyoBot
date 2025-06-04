import {
  Client,
  Collection,
  Interaction,
  Events,
  ChatInputCommandInteraction,
} from 'discord.js';
import { ConfigLoader } from './utils/configLoader';
import { QueueManager } from './utils/queueManager';
import { RateLimiter } from './utils/rateLimiter';
import { CommandRegistry } from './utils/commandRegistry';
import { botIntents } from './intents';
import * as pingCommand from './commands/ping';
import * as rateLimitCommand from './commands/ratelimit';
import * as path from 'path';
import { Collection as DjsCollection } from 'discord.js';

interface CommandModule {
  data: any;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// Extend Client to include commands
declare module 'discord.js' {
  interface Client {
    commands: DjsCollection<string, CommandModule>;
  }
}

async function main() {
  const config = new ConfigLoader(path.resolve(__dirname, '../config.yaml'));
  const token = config.get('token');
  const prefix = config.get('prefix');
  const queueCfg = config.get('queue');
  const rateLimitCfg = config.get('rateLimit');
  
  const client = new Client({
    intents: botIntents,
  });
  
  const queueManager = new QueueManager<string>(
    queueCfg.maxSize,
    queueCfg.workerCount,
    queueCfg.retryDelaySeconds
  );
  
  const rateLimiter = new RateLimiter(rateLimitCfg);
  
  // Pass rateLimiter to commands that need it
  rateLimitCommand.setRateLimiter(rateLimiter);
  
  async function exampleWorker(item: string) {
    console.log(`Processing item from queue: ${item}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`Finished processing item: ${item}`);
  }
  
  queueManager.startWorkers(exampleWorker);
  
  client.commands = new DjsCollection<string, CommandModule>();
  client.commands.set(pingCommand.data.name, {
    data: pingCommand.data,
    execute: pingCommand.execute,
  });
  client.commands.set(rateLimitCommand.data.name, {
    data: rateLimitCommand.data,
    execute: rateLimitCommand.execute,
  });
  
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    const clientId = client.user!.id;
    
    // Register all commands at once
    const commandRegistry = new CommandRegistry(token);
    commandRegistry.addCommand(pingCommand);
    commandRegistry.addCommand(rateLimitCommand);
    await commandRegistry.registerCommands(clientId);
    
    console.log('All slash commands registered successfully.');
  });
  
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    
    try {
      // Check rate limit for guild commands
      if (interaction.guild && interaction.member) {
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
          await message.reply(`✅ Enqueued: ${item}`);
        } else {
          await message.reply('❌ Queue is full.');
        }
      }
    }
  });
  
  await client.login(token);
}

main().catch(console.error);