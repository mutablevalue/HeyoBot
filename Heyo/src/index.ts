import {
  Client,
  Collection,
  Interaction,
  Events,
  ChatInputCommandInteraction,
} from 'discord.js';
import { ConfigLoader } from './utils/configLoader';
import { QueueManager } from './utils/queueManager';
import { botIntents } from './utils/intents';
import * as pingCommand from './commands/ping';
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
  
  const client = new Client({
    intents: botIntents,
  });
  
  const queueManager = new QueueManager<string>(
    queueCfg.maxSize,
    queueCfg.workerCount,
    queueCfg.retryDelaySeconds
  );
  
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
  
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    const clientId = client.user!.id;
    await pingCommand.registerSlashCommand(clientId, token);
    console.log('Slash commands registered.');
  });
  
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    
    try {
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