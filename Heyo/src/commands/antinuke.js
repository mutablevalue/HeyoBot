import { SlashCommandBuilder } from 'discord.js';
let antiNukeInstance;
export function setAntiNuke(antiNuke) {
  antiNukeInstance = antiNuke;
}
export const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Manage Anti-Nuke whitelist')
  .addSubcommand(subcommand =>
    subcommand
      .setName('whitelist')
      .setDescription('Allow or remove users/roles')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('What action to perform')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' }
          )
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Type to add/remove (not required for list)')
          .setRequired(false)
          .addChoices(
            { name: 'user', value: 'user' },
            { name: 'role', value: 'role' }
          )
      )
      .addStringOption(option =>
        option
          .setName('id')
          .setDescription('ID of the user or role (not required for list)')
          .setRequired(false)
      )
  );
export async function execute(interaction) {
  if (!antiNukeInstance) {
    return interaction.reply({
      content: '❌ AntiNuke system is not initialized.',
      ephemeral: true
    });
  }
 
  await antiNukeInstance.handleAntinukeCommand(interaction);
}