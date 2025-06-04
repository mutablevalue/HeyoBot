"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// File: src/index.ts
var discord_js_1 = require("discord.js");
var configLoader_1 = require("./utils/configLoader");
var queueManager_1 = require("./utils/queueManager");
var pingCommand = require("./commands/ping");
var path = require("path");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        // Example worker function: just logs the item
        function exampleWorker(item) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            console.log("Processing item from queue: ".concat(item));
                            return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000); })];
                        case 1:
                            _a.sent();
                            console.log("Finished processing item: ".concat(item));
                            return [2 /*return*/];
                    }
                });
            });
        }
        var config, token, prefix, queueCfg, client, queueManager;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    config = new configLoader_1.ConfigLoader(path.resolve(__dirname, '../config.yaml'));
                    token = config.get('token');
                    prefix = config.get('prefix');
                    queueCfg = config.get('queue');
                    client = new discord_js_1.Client({
                        intents: [
                            discord_js_1.GatewayIntentBits.Guilds,
                            discord_js_1.GatewayIntentBits.GuildMessages,
                            discord_js_1.GatewayIntentBits.MessageContent,
                        ],
                    });
                    queueManager = new queueManager_1.QueueManager(queueCfg.maxSize, queueCfg.workerCount, queueCfg.retryDelaySeconds);
                    // Start queue workers
                    queueManager.startWorkers(exampleWorker);
                    // Set up a collection for commands
                    client.commands = new discord_js_1.Collection();
                    client.commands.set(pingCommand.data.name, {
                        data: pingCommand.data,
                        execute: pingCommand.execute,
                    });
                    client.once(discord_js_1.Events.ClientReady, function () { return __awaiter(_this, void 0, void 0, function () {
                        var clientId;
                        var _a;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    console.log("Logged in as ".concat((_a = client.user) === null || _a === void 0 ? void 0 : _a.tag));
                                    clientId = client.user.id;
                                    return [4 /*yield*/, pingCommand.registerSlashCommand(clientId, token)];
                                case 1:
                                    _b.sent();
                                    console.log('Slash commands registered.');
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    client.on(discord_js_1.Events.InteractionCreate, function (interaction) { return __awaiter(_this, void 0, void 0, function () {
                        var command, error_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (!interaction.isChatInputCommand())
                                        return [2 /*return*/];
                                    command = client.commands.get(interaction.commandName);
                                    if (!command)
                                        return [2 /*return*/];
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 6]);
                                    return [4 /*yield*/, command.execute(interaction)];
                                case 2:
                                    _a.sent();
                                    return [3 /*break*/, 6];
                                case 3:
                                    error_1 = _a.sent();
                                    console.error(error_1);
                                    if (!interaction.isRepliable()) return [3 /*break*/, 5];
                                    return [4 /*yield*/, interaction.reply({ content: 'There was an error executing that command.', ephemeral: true })];
                                case 4:
                                    _a.sent();
                                    _a.label = 5;
                                case 5: return [3 /*break*/, 6];
                                case 6: return [2 /*return*/];
                            }
                        });
                    }); });
                    client.on('messageCreate', function (message) { return __awaiter(_this, void 0, void 0, function () {
                        var args, cmd, item, success;
                        var _a;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    if (message.author.bot)
                                        return [2 /*return*/];
                                    if (!message.content.startsWith(prefix))
                                        return [2 /*return*/];
                                    args = message.content.slice(prefix.length).trim().split(/ +/);
                                    cmd = (_a = args.shift()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
                                    if (!(cmd === 'enqueue')) return [3 /*break*/, 4];
                                    item = args.join(' ');
                                    if (!item) return [3 /*break*/, 4];
                                    success = queueManager.enqueue(item);
                                    if (!success) return [3 /*break*/, 2];
                                    return [4 /*yield*/, message.reply("\u2705 Enqueued: ".concat(item))];
                                case 1:
                                    _b.sent();
                                    return [3 /*break*/, 4];
                                case 2: return [4 /*yield*/, message.reply('❌ Queue is full.')];
                                case 3:
                                    _b.sent();
                                    _b.label = 4;
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); });
                    return [4 /*yield*/, client.login(token)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(console.error);
