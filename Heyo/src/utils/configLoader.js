"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigLoader = void 0;
var fs = require("fs");
var js_yaml_1 = require("js-yaml");
var ConfigLoader = /** @class */ (function () {
    function ConfigLoader(configPath) {
        if (configPath === void 0) { configPath = 'config.yaml'; }
        if (!fs.existsSync(configPath)) {
            throw new Error("Config file not found: ".concat(configPath));
        }
        var fileContents = fs.readFileSync(configPath, 'utf8');
        this.config = js_yaml_1.default.load(fileContents);
    }
    ConfigLoader.prototype.get = function (key) {
        return this.config[key];
    };
    return ConfigLoader;
}());
exports.ConfigLoader = ConfigLoader;
