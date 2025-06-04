import { GatewayIntentBits } from 'discord.js';

export const botIntents = [
  // Guild-related intents
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,              // Privileged
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildEmojisAndStickers,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildPresences,            // Privileged
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.GuildScheduledEvents,
  GatewayIntentBits.GuildMessagePolls,
  
  // Direct Message intents
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
  GatewayIntentBits.DirectMessageTyping,
  GatewayIntentBits.DirectMessagePolls,
  
  // Other intents
  GatewayIntentBits.MessageContent,            // Privileged
  GatewayIntentBits.AutoModerationConfiguration,
  GatewayIntentBits.AutoModerationExecution,
];

/**
 * Intent groups for specific bot functionalities
 */
export const intentGroups = {
  // Basic functionality
  basic: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  
  // Moderation features
  moderation: [
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  
  // Member management
  members: [
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  
  // Voice features
  voice: [
    GatewayIntentBits.GuildVoiceStates,
  ],
  
  // Messaging features
  messaging: [
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.MessageContent,
  ],
};