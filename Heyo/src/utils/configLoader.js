// src/utils/configLoader.js
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { error } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = {};
    this.defaults = this.getDefaultConfig();
    
    // Load config on initialization
    this.load();
  }

  /**
   * Get default configuration
   * @returns {Object}
   */
  getDefaultConfig() {
    return error
  }

  /**
   * Deep merge two objects
   * @param {Object} target 
   * @param {Object} source 
   * @returns {Object}
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          output[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          output[key] = source[key];
        }
      }
    }
    
    return output;
  }

  /**
   * Load configuration from file
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = YAML.parse(fileContent) || {};
        
        // Merge loaded config with defaults
        this.config = this.deepMerge(this.defaults, loadedConfig);
        
        console.log('[ConfigLoader] Configuration loaded successfully');
      } else {
        console.warn('[ConfigLoader] Config file not found, using defaults');
        this.config = { ...this.defaults };
        
        // Create config file with defaults
        this.save();
      }
    } catch (error) {
      console.error('[ConfigLoader] Error loading config:', error);
      this.config = { ...this.defaults };
    }
  }

  /**
   * Save configuration to file
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const yamlStr = YAML.stringify(this.config, {
        indent: 2,
        lineWidth: 0,
        defaultStringType: 'PLAIN',
        defaultKeyType: 'PLAIN'
      });
      
      fs.writeFileSync(this.configPath, yamlStr);
      console.log('[ConfigLoader] Configuration saved successfully');
    } catch (error) {
      console.error('[ConfigLoader] Error saving config:', error);
    }
  }

  /**
   * Get configuration value
   * @param {string} path - Dot notation path (e.g., 'moderation.logChannel')
   * @returns {*}
   */
  get(path) {
    if (!path) return this.config;
    
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  /**
   * Set configuration value
   * @param {string} path - Dot notation path
   * @param {*} value 
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    
    let current = this.config;
    for (const key of keys) {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  /**
   * Reload configuration from file
   */
  reload() {
    this.load();
  }

  /**
   * Validate configuration
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate() {
    const errors = [];
    
    // Check required fields
    if (!this.config.token) {
      errors.push('Missing required field: token');
    }
    
    // Validate types
    if (typeof this.config.developmentGuildId !== 'string' && this.config.developmentGuildId !== null) {
      errors.push('developmentGuildId must be a string or null');
    }
    
    // Add more validation as needed
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}