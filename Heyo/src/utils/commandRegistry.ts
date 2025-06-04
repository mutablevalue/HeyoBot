import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from 'discord.js';

interface Command {
  data: SlashCommandBuilder;
}

export class CommandRegistry {
  private commands: Command[] = [];
  private rest: REST;

  constructor(token: string) {
    this.rest = new REST({ version: '10' }).setToken(token);
  }

  /**
   * Add a command to the registry
   */
  addCommand(command: Command): void {
    this.commands.push(command);
    console.log(`Added command to registry: ${command.data.name}`);
  }

  /**
   * Register all commands at once
   */
  async registerCommands(clientId: string, guildId?: string): Promise<void> {
    const commandData = this.commands.map(cmd => cmd.data.toJSON());
    
    console.log('Commands to register:', commandData.map(cmd => ({
      name: cmd.name,
      description: cmd.description
    })));
    
    try {
      if (guildId) {
        const result = await this.rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: commandData }
        );
        console.log(`Successfully registered ${commandData.length} slash commands to guild ${guildId}.`);
        console.log('API Response:', result);
      } else {
        const result = await this.rest.put(
          Routes.applicationCommands(clientId),
          { body: commandData }
        );
        console.log(`Successfully registered ${commandData.length} slash commands globally.`);
        console.log('API Response:', result);
      }
      
      // Log registered commands
      console.log('Registered commands:', commandData.map(cmd => cmd.name).join(', '));
    } catch (error) {
      console.error('Error registering commands:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      throw error; // Re-throw to handle in calling code
    }
  }

  /**
   * Clear all commands (useful for development)
   */
  async clearCommands(clientId: string, guildId?: string): Promise<void> {
    try {
      if (guildId) {
        await this.rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: [] }
        );
        console.log(`Cleared all guild commands for guild ${guildId}.`);
      } else {
        await this.rest.put(
          Routes.applicationCommands(clientId),
          { body: [] }
        );
        console.log('Cleared all global commands.');
      }
    } catch (error) {
      console.error('Error clearing commands:', error);
      throw error;
    }
  }

  /**
   * Get registered commands (useful for debugging)
   */
  async getRegisteredCommands(clientId: string, guildId?: string): Promise<any[]> {
    try {
      if (guildId) {
        const commands = await this.rest.get(
          Routes.applicationGuildCommands(clientId, guildId)
        ) as any[];
        return commands;
      } else {
        const commands = await this.rest.get(
          Routes.applicationCommands(clientId)
        ) as any[];
        return commands;
      }
    } catch (error) {
      console.error('Error fetching commands:', error);
      throw error;
    }
  }
}