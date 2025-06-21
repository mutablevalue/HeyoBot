// src/commands/activewebhooks.js
import { SlashCommandBuilder, PermissionFlagsBits, AuditLogEvent } from 'discord.js';

let embedLoader = null;
let permissionSystem = null;

export function setEmbedLoader(loader) {
  embedLoader = loader;
}

export function setPermissionSystem(system) {
  permissionSystem = system;
}

export const data = new SlashCommandBuilder()
  .setName('activewebhooks')
  .setDescription('View all active webhooks and their creators')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks);

export async function execute(interaction) {
  // Check if user has permission (Administrator+)
  if (permissionSystem) {
    const permLevel = permissionSystem.getPermissionLevel(interaction.member);
    if (permLevel < permissionSystem.LEVELS.ADMINISTRATOR) {
      const embed = embedLoader.error('You need Administrator permissions to view webhooks.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch all webhooks in the guild
    const webhooks = await interaction.guild.fetchWebhooks();
    
    if (webhooks.size === 0) {
      const embed = embedLoader.createEmbed({
        title: 'Active Webhooks',
        description: 'No webhooks found in this server.',
        timestamp: true
      });
      return interaction.editReply({ embeds: [embed] });
    }

    // Group webhooks by channel
    const webhooksByChannel = new Map();
    
    for (const [id, webhook] of webhooks) {
      const channelId = webhook.channelId;
      if (!webhooksByChannel.has(channelId)) {
        webhooksByChannel.set(channelId, []);
      }
      webhooksByChannel.get(channelId).push(webhook);
    }

    // Try to fetch audit logs to find creators
    const webhookCreators = new Map();
    try {
      const auditLogs = await interaction.guild.fetchAuditLogs({
        type: AuditLogEvent.WebhookCreate,
        limit: 100
      });

      for (const [id, entry] of auditLogs.entries) {
        if (entry.target && entry.target.id) {
          webhookCreators.set(entry.target.id, {
            executor: entry.executor,
            createdAt: entry.createdAt
          });
        }
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }

    // Build the response
    const fields = [];
    let totalWebhooks = 0;

    for (const [channelId, channelWebhooks] of webhooksByChannel) {
      const channel = interaction.guild.channels.cache.get(channelId);
      const channelName = channel ? `#${channel.name}` : `Unknown Channel (${channelId})`;
      
      let fieldValue = '';
      for (const webhook of channelWebhooks) {
        totalWebhooks++;
        
        const creator = webhookCreators.get(webhook.id);
        const creatorInfo = creator 
          ? `${creator.executor.tag}` 
          : webhook.owner 
            ? `${webhook.owner.tag}`
            : 'Unknown';
        
        const createdDate = webhook.createdAt 
          ? `<t:${Math.floor(webhook.createdAt.getTime() / 1000)}:R>`
          : 'Unknown date';
        
        fieldValue += `**${webhook.name}**\n`;
        fieldValue += `ID: \`${webhook.id}\`\n`;
        fieldValue += `Creator: ${creatorInfo}\n`;
        fieldValue += `Created: ${createdDate}\n`;
        fieldValue += `Avatar: ${webhook.avatar ? '[Link](' + webhook.avatarURL() + ')' : 'None'}\n\n`;
      }

      // Discord has a field value limit of 1024 characters
      if (fieldValue.length > 1024) {
        fieldValue = fieldValue.substring(0, 1021) + '...';
      }

      fields.push({
        name: channelName,
        value: fieldValue || 'No webhooks',
        inline: false
      });

      // Discord has a limit of 25 fields per embed
      if (fields.length >= 25) break;
    }

    const embed = embedLoader.createEmbed({
      title: 'Active Webhooks',
      description: `Total webhooks: **${totalWebhooks}**`,
      fields,
      timestamp: true,
      footer: { text: 'Use audit logs for more detailed history' }
    });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Error fetching webhooks:', error);
    const embed = embedLoader.error('Failed to fetch webhooks. Make sure I have the necessary permissions.');
    await interaction.editReply({ embeds: [embed] });
  }
}
