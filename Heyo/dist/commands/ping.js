"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
exports.registerSlashCommand = registerSlashCommand;
const discord_js_1 = require("discord.js");
const rest_1 = require("@discordjs/rest");
const v10_1 = require("discord-api-types/v10");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency');
async function execute(interaction) {
    const latency = Math.round(interaction.client.ws.ping);
    await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
}
async function registerSlashCommand(clientId, token, guildId) {
    const rest = new rest_1.REST({ version: '10' }).setToken(token);
    try {
        if (guildId) {
            await rest.put(v10_1.Routes.applicationGuildCommands(clientId, guildId), {
                body: [exports.data.toJSON()],
            });
            console.log('Registered ping slash command to guild.');
        }
        else {
            await rest.put(v10_1.Routes.applicationCommands(clientId), {
                body: [exports.data.toJSON()],
            });
            console.log('Registered ping slash command globally.');
        }
    }
    catch (error) {
        console.error(error);
    }
}
