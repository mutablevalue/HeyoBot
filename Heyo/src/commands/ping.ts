import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const latency = Math.round(interaction.client.ws.ping);
  await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
}