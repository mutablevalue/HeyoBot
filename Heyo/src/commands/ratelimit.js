// src/commands/ratelimit.js
import { 
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

let rateLimiterInstance;
let embedLoader;

export function setRateLimiter(rateLimiter) {
  rateLimiterInstance = rateLimiter;
}

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export const data = new SlashCommandBuilder()
  .setName('ratelimit')
  .setDescription('Check your rate limit status');

export async function execute(interaction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({ 
      content: embedLoader 
        ? embedLoader.format('This command can only be used in a server.', 'message')
        : 'This command can only be used in a server.', 
      ephemeral: true 
    });
  }

  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member) return;

  const status = rateLimiterInstance.getUserStatus(member);
  
  // Build description based on user status
  let description = '';
  if (member.id === interaction.guild.ownerId) {
    description = 'You are the server owner - no rate limits';
  } else if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    description = 'You have Administrator permission - no rate limits';
  }

  // Create embed using embedLoader
  const embed = embedLoader.createEmbed({
    description: description || `Rate limit status for ${member.user.tag}`,
    fields: [
      { 
        name: 'Your Limit', 
        value: status.limit === 0 ? 'Unlimited' : `${status.limit} commands/minute`, 
        inline: true 
      },
      { 
        name: 'Commands Used', 
        value: status.used.toString(), 
        inline: true 
      },
      { 
        name: 'Remaining', 
        value: status.limit === 0 ? 'Unlimited' : status.remaining.toString(), 
        inline: true 
      }
    ],
    footer: status.resetIn > 0 ? `Resets in ${status.resetIn} seconds` : null
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}