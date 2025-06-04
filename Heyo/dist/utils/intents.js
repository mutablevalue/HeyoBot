"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intentGroups = exports.botIntents = void 0;
const discord_js_1 = require("discord.js");
exports.botIntents = [
    // Guild-related intents
    discord_js_1.GatewayIntentBits.Guilds,
    discord_js_1.GatewayIntentBits.GuildMembers, // Privileged
    discord_js_1.GatewayIntentBits.GuildModeration,
    discord_js_1.GatewayIntentBits.GuildEmojisAndStickers,
    discord_js_1.GatewayIntentBits.GuildIntegrations,
    discord_js_1.GatewayIntentBits.GuildWebhooks,
    discord_js_1.GatewayIntentBits.GuildInvites,
    discord_js_1.GatewayIntentBits.GuildVoiceStates,
    discord_js_1.GatewayIntentBits.GuildPresences, // Privileged
    discord_js_1.GatewayIntentBits.GuildMessages,
    discord_js_1.GatewayIntentBits.GuildMessageReactions,
    discord_js_1.GatewayIntentBits.GuildMessageTyping,
    discord_js_1.GatewayIntentBits.GuildScheduledEvents,
    discord_js_1.GatewayIntentBits.GuildMessagePolls,
    // Direct Message intents
    discord_js_1.GatewayIntentBits.DirectMessages,
    discord_js_1.GatewayIntentBits.DirectMessageReactions,
    discord_js_1.GatewayIntentBits.DirectMessageTyping,
    discord_js_1.GatewayIntentBits.DirectMessagePolls,
    // Other intents
    discord_js_1.GatewayIntentBits.MessageContent, // Privileged
    discord_js_1.GatewayIntentBits.AutoModerationConfiguration,
    discord_js_1.GatewayIntentBits.AutoModerationExecution,
];
/**
 * Intent groups for specific bot functionalities
 */
exports.intentGroups = {
    // Basic functionality
    basic: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ],
    // Moderation features
    moderation: [
        discord_js_1.GatewayIntentBits.GuildModeration,
        discord_js_1.GatewayIntentBits.AutoModerationConfiguration,
        discord_js_1.GatewayIntentBits.AutoModerationExecution,
    ],
    // Member management
    members: [
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildPresences,
    ],
    // Voice features
    voice: [
        discord_js_1.GatewayIntentBits.GuildVoiceStates,
    ],
    // Messaging features
    messaging: [
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.GuildMessageReactions,
        discord_js_1.GatewayIntentBits.GuildMessageTyping,
        discord_js_1.GatewayIntentBits.DirectMessages,
        discord_js_1.GatewayIntentBits.DirectMessageReactions,
        discord_js_1.GatewayIntentBits.DirectMessageTyping,
        discord_js_1.GatewayIntentBits.MessageContent,
    ],
};
