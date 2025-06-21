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
  .setName('invitelinks')
  .setDescription('View all active invite links and their creators')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption(option =>
    option
      .setName('show-uses')
      .setDescription('Show detailed usage statistics')
      .setRequired(false)
  );

export async function execute(interaction) {
  // Check if user has permission (Moderator+)
  if (permissionSystem) {
    const permLevel = permissionSystem.getPermissionLevel(interaction.member);
    if (permLevel < permissionSystem.LEVELS.MODERATOR) {
      const embed = embedLoader.error('You need Moderator permissions to view invite links.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  await interaction.deferReply({ ephemeral: true });

  const showUses = interaction.options.getBoolean('show-uses') || false;

  try {
    // Fetch all invites
    const invites = await interaction.guild.invites.fetch();
    
    if (invites.size === 0) {
      const embed = embedLoader.createEmbed({
        title: 'Active Invite Links',
        description: 'No invite links found in this server.',
        timestamp: true
      });
      return interaction.editReply({ embeds: [embed] });
    }

    // Try to fetch audit logs for recent invite creations
    const inviteCreators = new Map();
    try {
      const auditLogs = await interaction.guild.fetchAuditLogs({
        type: AuditLogEvent.InviteCreate,
        limit: 100
      });

      for (const [id, entry] of auditLogs.entries) {
        if (entry.target && entry.target.code) {
          inviteCreators.set(entry.target.code, {
            executor: entry.executor,
            createdAt: entry.createdAt
          });
        }
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }

    // Sort invites by uses (most used first)
    const sortedInvites = Array.from(invites.values()).sort((a, b) => b.uses - a.uses);

    // Build the response
    const fields = [];
    let totalUses = 0;
    let permanentCount = 0;
    let temporaryCount = 0;

    for (const invite of sortedInvites) {
      totalUses += invite.uses;
      if (invite.maxAge === 0) permanentCount++;
      else temporaryCount++;

      const channel = invite.channel ? `#${invite.channel.name}` : 'Unknown Channel';
      const creator = inviteCreators.get(invite.code)?.executor || invite.inviter || { tag: 'Unknown' };
      
      let fieldValue = `**discord.gg/${invite.code}**\n`;
      fieldValue += `Channel: ${channel}\n`;
      fieldValue += `Creator: ${creator.tag}\n`;
      
      if (showUses) {
        fieldValue += `Uses: ${invite.uses}${invite.maxUses ? `/${invite.maxUses}` : ''}\n`;
        fieldValue += `Type: ${invite.maxAge === 0 ? 'Permanent' : `Expires <t:${Math.floor((invite.createdTimestamp + invite.maxAge * 1000) / 1000)}:R>`}\n`;
        fieldValue += `Created: <t:${Math.floor(invite.createdTimestamp / 1000)}:R>\n`;
      } else {
        fieldValue += `Uses: ${invite.uses}\n`;
      }

      fields.push({
        name: `Invite #${fields.length + 1}`,
        value: fieldValue,
        inline: true
      });

      // Discord has a limit of 25 fields per embed
      if (fields.length >= 24) break;
    }

    const statsField = {
      name: 'Statistics',
      value: `Total Invites: **${invites.size}**\n` +
             `Total Uses: **${totalUses}**\n` +
             `Permanent: **${permanentCount}**\n` +
             `Temporary: **${temporaryCount}**`,
      inline: false
    };

    fields.push(statsField);

    const embed = embedLoader.createEmbed({
      title: 'Active Invite Links',
      description: showUses ? 'Showing detailed usage statistics' : 'Use `show-uses: true` for detailed stats',
      fields,
      timestamp: true,
      footer: { text: 'Only showing active invites' }
    });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Error fetching invites:', error);
    const embed = embedLoader.error('Failed to fetch invites. Make sure I have the "Manage Guild" permission.');
    await interaction.editReply({ embeds: [embed] });
  }
}