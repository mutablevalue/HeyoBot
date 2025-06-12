// src/utils/embedLoader.js
import { EmbedBuilder } from 'discord.js';

export class EmbedLoader {
  constructor(configLoader) {
    this.configLoader = configLoader;
    
    // Load embed config - no defaults
    const embedConfig = this.configLoader.get('embed');
    if (!embedConfig) {
      throw new Error('[EmbedLoader] No embed configuration found in config');
    }
    
    this.config = {
      color: embedConfig.color,
      formatters: {
        header: embedConfig.formatters?.header,
        footer: embedConfig.formatters?.footer,
        field: embedConfig.formatters?.field,
        message: embedConfig.formatters?.message
      },
      defaults: {
        showFooter: embedConfig.defaults?.showFooter,
        footerText: embedConfig.defaults?.footerText,
        inline: embedConfig.defaults?.inline
      }
    };
    
    // Validate required config
    this.validateConfig();
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    if (!this.config.color) {
      throw new Error('[EmbedLoader] Missing required config: embed.color');
    }
    
    const requiredFormatters = ['header', 'footer', 'field', 'message'];
    for (const formatter of requiredFormatters) {
      if (!this.config.formatters[formatter]) {
        throw new Error(`[EmbedLoader] Missing required config: embed.formatters.${formatter}`);
      }
      if (!this.config.formatters[formatter].hasOwnProperty('prefix') || 
          !this.config.formatters[formatter].hasOwnProperty('suffix')) {
        throw new Error(`[EmbedLoader] Missing prefix/suffix for embed.formatters.${formatter}`);
      }
    }
  }

  /**
   * Format text with specified formatter
   * @param {string} text 
   * @param {'header'|'footer'|'field'|'message'} type 
   * @returns {string}
   */
  format(text, type) {
    if (!text) return text;
    const formatter = this.config.formatters[type];
    if (!formatter) {
      throw new Error(`[EmbedLoader] Unknown formatter type: ${type}`);
    }
    return `${formatter.prefix}${text}${formatter.suffix}`;
  }

  /**
   * Create a standard embed
   * @param {Object} options
   * @param {string} [options.title] - Main title (only for system names)
   * @param {string} [options.description] - Description text
   * @param {Array} [options.fields] - Array of fields
   * @param {string} [options.footer] - Footer text (no timestamp)
   * @param {number} [options.color] - Override color
   * @param {boolean} [options.formatDescription] - Whether to format description
   * @returns {EmbedBuilder}
   */
  createEmbed(options = {}) {
    const embed = new EmbedBuilder()
      .setColor(options.color || this.config.color);

    // Only add title if it's a main system title
    if (options.title) {
      embed.setTitle(this.format(options.title, 'header'));
    }

    // Add description with optional formatting
    if (options.description) {
      const description = options.formatDescription !== false 
        ? this.format(options.description, 'message')
        : options.description;
      embed.setDescription(description);
    }

    // Add fields
    if (options.fields && options.fields.length > 0) {
      const formattedFields = options.fields.map(field => ({
        name: this.format(field.name, 'field'),
        value: field.value,
        inline: field.inline !== undefined ? field.inline : this.config.defaults.inline
      }));
      embed.addFields(formattedFields);
    }

    // Add footer without timestamp
    const footerText = options.footer || (this.config.defaults.showFooter ? this.config.defaults.footerText : null);
    if (footerText) {
      embed.setFooter({ text: this.format(footerText, 'footer') });
    }

    return embed;
  }

  /**
   * Create a success embed
   * @param {string} message 
   * @param {Object} [options] - Additional options
   * @returns {EmbedBuilder}
   */
  success(message, options = {}) {
    return this.createEmbed({
      description: message,
      ...options
    });
  }

  /**
   * Create an error embed
   * @param {string} message 
   * @param {Object} [options] - Additional options
   * @returns {EmbedBuilder}
   */
  error(message, options = {}) {
    return this.createEmbed({
      description: message,
      ...options
    });
  }

  /**
   * Create an info embed
   * @param {string} message 
   * @param {Object} [options] - Additional options
   * @returns {EmbedBuilder}
   */
  info(message, options = {}) {
    return this.createEmbed({
      description: message,
      ...options
    });
  }

  /**
   * Create a warning embed
   * @param {string} message 
   * @param {Object} [options] - Additional options
   * @returns {EmbedBuilder}
   */
  warning(message, options = {}) {
    return this.createEmbed({
      description: message,
      ...options
    });
  }

  /**
   * Create a system embed (with title)
   * @param {string} systemName 
   * @param {string} description 
   * @param {Object} [options] - Additional options
   * @returns {EmbedBuilder}
   */
  system(systemName, description, options = {}) {
    return this.createEmbed({
      title: systemName,
      description: description,
      formatDescription: false, // Don't format system descriptions
      ...options
    });
  }

  /**
   * Update configuration
   * @param {Object} newConfig 
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      formatters: {
        ...this.config.formatters,
        ...newConfig.formatters
      },
      defaults: {
        ...this.config.defaults,
        ...newConfig.defaults
      }
    };
    
    // Revalidate after update
    this.validateConfig();
  }
}