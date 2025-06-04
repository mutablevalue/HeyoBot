"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.setRateLimiter = setRateLimiter;
exports.execute = execute;
const discord_js_1 = require("discord.js");
let rateLimiterInstance;
function setRateLimiter(rateLimiter) {
    rateLimiterInstance = rateLimiter;
}
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('ratelimit')
    .setDescription('Check your rate limit status');
async function execute(interaction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }
    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member)
        return;
    const status = rateLimiterInstance.getUserStatus(member);
    const embed = new discord_js_1.EmbedBuilder()
        .setTitle('Rate Limit Status')
        .setColor(status.remaining > 0 ? 0x00ff00 : 0xff0000)
        .addFields({ name: 'Your Limit', value: status.limit === 0 ? 'Unlimited' : `${status.limit} commands/minute`, inline: true }, { name: 'Commands Used', value: status.used.toString(), inline: true }, { name: 'Remaining', value: status.limit === 0 ? 'Unlimited' : status.remaining.toString(), inline: true })
        .setFooter({ text: status.resetIn > 0 ? `Resets in ${status.resetIn} seconds` : 'No active cooldown' })
        .setTimestamp();
    // Add permission info
    if (member.id === interaction.guild.ownerId) {
        embed.setDescription('You are the server owner - no rate limits!');
    }
    else if (member.permissions.has(discord_js_1.PermissionFlagsBits.Administrator)) {
        embed.setDescription('You have Administrator permission - no rate limits!');
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
}
