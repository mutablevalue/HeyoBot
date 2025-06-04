"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRegistry = void 0;
const rest_1 = require("@discordjs/rest");
const v10_1 = require("discord-api-types/v10");
class CommandRegistry {
    constructor(token) {
        this.commands = [];
        this.rest = new rest_1.REST({ version: '10' }).setToken(token);
    }
    /**
     * Add a command to the registry
     */
    addCommand(command) {
        this.commands.push(command);
        console.log(`Added command to registry: ${command.data.name}`);
    }
    /**
     * Register all commands at once
     */
    async registerCommands(clientId, guildId) {
        const commandData = this.commands.map(cmd => cmd.data.toJSON());
        console.log('Commands to register:', commandData.map(cmd => ({
            name: cmd.name,
            description: cmd.description
        })));
        try {
            if (guildId) {
                const result = await this.rest.put(v10_1.Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
                console.log(`Successfully registered ${commandData.length} slash commands to guild ${guildId}.`);
                console.log('API Response:', result);
            }
            else {
                const result = await this.rest.put(v10_1.Routes.applicationCommands(clientId), { body: commandData });
                console.log(`Successfully registered ${commandData.length} slash commands globally.`);
                console.log('API Response:', result);
            }
            // Log registered commands
            console.log('Registered commands:', commandData.map(cmd => cmd.name).join(', '));
        }
        catch (error) {
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
    async clearCommands(clientId, guildId) {
        try {
            if (guildId) {
                await this.rest.put(v10_1.Routes.applicationGuildCommands(clientId, guildId), { body: [] });
                console.log(`Cleared all guild commands for guild ${guildId}.`);
            }
            else {
                await this.rest.put(v10_1.Routes.applicationCommands(clientId), { body: [] });
                console.log('Cleared all global commands.');
            }
        }
        catch (error) {
            console.error('Error clearing commands:', error);
            throw error;
        }
    }
    /**
     * Get registered commands (useful for debugging)
     */
    async getRegisteredCommands(clientId, guildId) {
        try {
            if (guildId) {
                const commands = await this.rest.get(v10_1.Routes.applicationGuildCommands(clientId, guildId));
                return commands;
            }
            else {
                const commands = await this.rest.get(v10_1.Routes.applicationCommands(clientId));
                return commands;
            }
        }
        catch (error) {
            console.error('Error fetching commands:', error);
            throw error;
        }
    }
}
exports.CommandRegistry = CommandRegistry;
