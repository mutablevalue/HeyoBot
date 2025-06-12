// src/commands/afk.js
import { SlashCommandBuilder } from 'discord.js';

let afkManager = null;
let embedLoader = null;

export function setAfkManager(manager) {
  afkManager = manager;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Set your AFK status')
  .addStringOption(option =>
    option
      .setName('reason')
      .setDescription('Reason for being AFK')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!afkManager) {
    return interaction.reply({
      content: 'AFK system is not initialized.',
      ephemeral: true
    });
  }

  const reason = interaction.options.getString('reason') || 'AFK';
  
  // Set user as AFK
  afkManager.setAfk(interaction.user.id, reason);

  const embed = embedLoader.success(`You are now AFK: **${reason}**`);

  await interaction.reply({ embeds: [embed] });
}