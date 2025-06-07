import { EmbedBuilder } from 'discord.js';

  client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (afkMap.has(message.author.id)) {
    const { timestamp } = afkMap.get(message.author.id);
    const timeAway = Date.now() - timestamp;

    const hours = Math.floor(timeAway / (1000 * 60 * 60));
    const minutes = Math.floor((timeAway % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeAway % (1000 * 60)) / 1000);

    const durationParts = [];
    if (hours > 0) durationParts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) durationParts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    if (seconds > 0 || durationParts.length === 0)
      durationParts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

    const embed = new EmbedBuilder()
      .setColor('#00000')
      .setDescription(`<@${message.author.id}>, welcome back! You were away for **${durationParts.join(', ')}**.`);

    afkMap.delete(message.author.id);
    saveAfkData();
    message.reply({ embeds: [embed] });
  }

  for (const [id] of message.mentions.users) {
    if (afkMap.has(id)) {
      const { reason } = afkMap.get(id);
      const embed = new EmbedBuilder()
        .setColor('#00000')
        .setDescription(`<@${id}> is currently AFK: **${reason}**`);
      message.reply({ embeds: [embed] });
    }
  }
});
