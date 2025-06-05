import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency');

export async function execute(interaction) {
  const latency = Math.round(interaction.client.ws.ping);
  await interaction.reply(`Pong! Latency: ${latency}ms`);
}