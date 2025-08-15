
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

export class CommandRegistry {
  constructor(token) {
    this.commands = [];
    this.rest = new REST({ version: '10' }).setToken(token);
  }

  /**
   * Add a command to the registry
   */
  addCommand(command) {
    this.commands.push(command);
    console.log(`Added command to registry: ${command.data.name}`);
  }

  /**
   * Validate command structure before registration
   */
  validateCommand(commandData) {
    const issues = [];
    
    // Check main command options
    if (commandData.options) {
      this.validateOptions(commandData.options, `/${commandData.name}`, issues);
    }
    
    // Check subcommands and subcommand groups
    if (commandData.options) {
      for (const option of commandData.options) {
        if (option.type === 1) { // SUB_COMMAND
          if (option.options) {
            this.validateOptions(option.options, `/${commandData.name} ${option.name}`, issues);
          }
        } else if (option.type === 2) { // SUB_COMMAND_GROUP
          if (option.options) {
            for (const subCmd of option.options) {
              if (subCmd.options) {
                this.validateOptions(subCmd.options, `/${commandData.name} ${option.name} ${subCmd.name}`, issues);
              }
            }
          }
        }
      }
    }
    
    return issues;
  }

  validateOptions(options, commandPath, issues) {
    let foundOptional = false;
    
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      
      // Skip subcommands and subcommand groups
      if (option.type === 1 || option.type === 2) continue;
      
      if (!option.required && option.required !== undefined) {
        foundOptional = true;
      } else if (option.required && foundOptional) {
        issues.push({
          command: commandPath,
          issue: `Required option "${option.name}" comes after optional options at position ${i + 1}`
        });
      }
    }
  }

  async registerCommands(clientId, guildId) {
    const commandData = this.commands.map(cmd => cmd.data.toJSON());
    
    console.log('\n=== VALIDATING COMMANDS BEFORE REGISTRATION ===');
    
    // Validate all commands first
    const allIssues = [];
    for (const cmd of commandData) {
      const issues = this.validateCommand(cmd);
      if (issues.length > 0) {
        allIssues.push({ command: cmd.name, issues });
      }
    }
    
    if (allIssues.length > 0) {
      console.error('\n X COMMAND VALIDATION FAILED:');
      allIssues.forEach(({ command, issues }) => {
        console.error(`\nCommand: /${command}`);
        issues.forEach(issue => {
          console.error(`  - ${issue.command}: ${issue.issue}`);
        });
      });
      console.error('\nSkipping registration due to validation errors.\n');
      return;
    }
    
    console.log(' All commands validated successfully!');
    console.log('\nCommands to register:', commandData.map(cmd => cmd.name).join(', '));
    
    try {
      if (guildId) {
        const result = await this.rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: commandData }
        );
        console.log(`\n Successfully registered ${commandData.length} slash commands to guild ${guildId}.`);
      } else {
        const result = await this.rest.put(
          Routes.applicationCommands(clientId),
          { body: commandData }
        );
        console.log(`\n Successfully registered ${commandData.length} slash commands globally.`);
      }
    } catch (error) {
      console.error('\n Error registering commands:', error);
      
      // Try to identify which command caused the error
      if (error.rawError && error.rawError.errors) {
        console.error('\nDetailed error information:');
        const parseErrors = (obj, path = '') => {
          for (const key in obj) {
            const currentPath = path ? `${path}.${key}` : key;
            if (obj[key]._errors) {
              console.error(`  ${currentPath}:`, obj[key]._errors);
            } else if (typeof obj[key] === 'object') {
              parseErrors(obj[key], currentPath);
            }
          }
        };
        parseErrors(error.rawError.errors);
      }
      
      throw error;
    }
  }

  async clearCommands(clientId, guildId) {
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

  async getRegisteredCommands(clientId, guildId) {
    try {
      if (guildId) {
        const commands = await this.rest.get(
          Routes.applicationGuildCommands(clientId, guildId)
        );
        return commands;
      } else {
        const commands = await this.rest.get(
          Routes.applicationCommands(clientId)
        );
        return commands;
      }
    } catch (error) {
      console.error('Error fetching commands:', error);
      throw error;
    }
  }
}
