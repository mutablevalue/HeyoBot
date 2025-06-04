import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const latency = Math.round(interaction.client.ws.ping);
  await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
}

export async function registerSlashCommand(
  clientId: string,
  token: string,
  guildId?: string
) {
  const rest = new REST({ version: '10' }).setToken(token);
  
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: [data.toJSON()],
      });
      console.log('Registered ping slash command to guild.');
    } else {
      await rest.put(Routes.applicationCommands(clientId), {
        body: [data.toJSON()],
      });
      console.log('Registered ping slash command globally.');
    }
  } catch (error) {
    console.error(error);
  }
}