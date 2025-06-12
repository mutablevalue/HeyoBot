// src/commands/ping.js
import { SlashCommandBuilder } from 'discord.js';

let embedLoader;

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency');

export async function execute(interaction) {
  const latency = Math.round(interaction.client.ws.ping);
  
  // If embedLoader is available, use formatted response
  if (embedLoader) {
    const embed = embedLoader.createEmbed({
      description: `Pong! Latency: ${latency}ms`,
      formatDescription: true // Ensure message formatting is applied
    });
    
    await interaction.reply({ embeds: [embed] });
  } else {
    // Fallback to plain text
    await interaction.reply(`Pong! Latency: ${latency}ms`);
  }
}