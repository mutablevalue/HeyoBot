"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency');
async function execute(interaction) {
    const latency = Math.round(interaction.client.ws.ping);
    await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
}
