// src/commands/afk.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

let afkManager = null;

export function setAfkManager(manager) {
  afkManager = manager;
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
      content: '❌ AFK system is not initialized.',
      ephemeral: true
    });
  }

  const reason = interaction.options.getString('reason') || 'AFK';
  
  // Set user as AFK
  afkManager.setAfk(interaction.user.id, reason);

  const embed = new EmbedBuilder()
    .setColor(0x808080)
    .setDescription(`✅ You are now AFK: **${reason}**`)
    .setFooter({ text: 'I\'ll notify anyone who mentions you' });

  await interaction.reply({ embeds: [embed] });
}