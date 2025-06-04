"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const configLoader_1 = require("./utils/configLoader");
const queueManager_1 = require("./utils/queueManager");
const rateLimiter_1 = require("./utils/rateLimiter");
const commandRegistry_1 = require("./utils/commandRegistry");
const intents_1 = require("./intents");
const pingCommand = __importStar(require("./commands/ping"));
const rateLimitCommand = __importStar(require("./commands/ratelimit"));
const path = __importStar(require("path"));
const discord_js_2 = require("discord.js");
async function main() {
    const config = new configLoader_1.ConfigLoader(path.resolve(__dirname, '../config.yaml'));
    const token = config.get('token');
    const prefix = config.get('prefix');
    const queueCfg = config.get('queue');
    const rateLimitCfg = config.get('rateLimit');
    const client = new discord_js_1.Client({
        intents: intents_1.botIntents,
    });
    const queueManager = new queueManager_1.QueueManager(queueCfg.maxSize, queueCfg.workerCount, queueCfg.retryDelaySeconds);
    const rateLimiter = new rateLimiter_1.RateLimiter(rateLimitCfg);
    // Pass rateLimiter to commands that need it
    rateLimitCommand.setRateLimiter(rateLimiter);
    async function exampleWorker(item) {
        console.log(`Processing item from queue: ${item}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log(`Finished processing item: ${item}`);
    }
    queueManager.startWorkers(exampleWorker);
    client.commands = new discord_js_2.Collection();
    client.commands.set(pingCommand.data.name, {
        data: pingCommand.data,
        execute: pingCommand.execute,
    });
    client.commands.set(rateLimitCommand.data.name, {
        data: rateLimitCommand.data,
        execute: rateLimitCommand.execute,
    });
    client.once(discord_js_1.Events.ClientReady, async () => {
        console.log(`Logged in as ${client.user?.tag}`);
        const clientId = client.user.id;
        // Register all commands at once
        const commandRegistry = new commandRegistry_1.CommandRegistry(token);
        commandRegistry.addCommand(pingCommand);
        commandRegistry.addCommand(rateLimitCommand);
        await commandRegistry.registerCommands(clientId);
        console.log('All slash commands registered successfully.');
    });
    client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand())
            return;
        const command = client.commands.get(interaction.commandName);
        if (!command)
            return;
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
        }
        catch (error) {
            console.error(error);
            if (interaction.isRepliable()) {
                await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
            }
        }
    });
    client.on('messageCreate', async (message) => {
        if (message.author.bot)
            return;
        if (!message.content.startsWith(prefix))
            return;
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();
        if (cmd === 'enqueue') {
            const item = args.join(' ');
            if (item) {
                const success = queueManager.enqueue(item);
                if (success) {
                    await message.reply(`Enqueued: ${item}`);
                }
                else {
                    await message.reply('Queue is full.');
                }
            }
        }
    });
    await client.login(token);
}
main().catch(console.error);
