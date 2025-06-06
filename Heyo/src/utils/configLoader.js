import * as fs from 'fs';
import * as yaml from 'js-yaml';
import path from "path";

export class ConfigLoader {
  /**
   * @param {string} configPath  Absolute or relative path to config.yaml
   */
  constructor(configPath) {
    this.configPath = path.resolve(configPath);
    this._loadFromDisk();
  }

  _loadFromDisk() {
    const fileContents = fs.readFileSync(this.configPath, 'utf8');
    this.config = yaml.load(fileContents) || {};
  }

  /**
   * Retrieve a nested value by dot-notation. 
   * e.g. get("j2c.j2cChannelId") → returns either the channel ID string or null.
   *
   * @param {string} pathString 
   * @returns {any}
   */
  get(pathString) {
    const keys = pathString.split(".");
    let node = this.config;
    for (const k of keys) {
      if (node == null || typeof node !== "object") return null;
      node = node[k];
    }
    return node === undefined ? null : node;
  }

  /**
   * Set a nested value by dot-notation, creating intermediate objects if needed.
   * e.g. set("j2c.j2cChannelId", "123456789012345678")
   *
   * @param {string} pathString 
   * @param {any} value 
   */
  set(pathString, value) {
    const keys = pathString.split(".");
    let node = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (node[k] == null || typeof node[k] !== "object") {
        node[k] = {};
      }
      node = node[k];
    }
    node[keys[keys.length - 1]] = value;
  }

  /**
   * Write the current in-memory `this.config` back out to disk in YAML form.
   */
  async save() {
    try {
      const yamlString = yaml.dump(this.config, { lineWidth: -1 });
      fs.writeFileSync(this.configPath, yamlString, "utf8");
    } catch (err) {
      console.error("[ConfigLoader] Failed to save config:", err);
    }
  }
}
