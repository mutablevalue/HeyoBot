// src/systems/roleTracker.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RoleTracker {
  constructor(client, configLoader, embedLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.embedLoader = embedLoader;
    
    // Load role tracker config
    this.config = this.configLoader.get('roleTracker');

    // Role history storage
    this.roleHistory = new Map();
    this.dataPath = path.join(__dirname, '../../data', this.config.dataFile);
    this.loadRoleHistory();

    // Setup event listeners
    this.setupEventListeners();

    // Stats
    this.stats = {
      rolesTracked: 0,
      rolesRestored: 0,
      errors: 0
    };
  }

  loadRoleHistory() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.roleHistory = new Map(Object.entries(data));
        console.log(`[RoleTracker] Loaded role history for ${this.roleHistory.size} users`);
      }
    } catch (error) {
      console.error('[RoleTracker] Error loading role history:', error);
    }
  }

  saveRoleHistory() {
    try {
      const data = Object.fromEntries(this.roleHistory);
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[RoleTracker] Error saving role history:', error);
    }
  }

  setupEventListeners() {
    // Track when member leaves
    this.client.on('guildMemberRemove', async (member) => {
      if (!this.config.enabled) return;
      if (!this.config.trackBots && member.user.bot) return;

      await this.trackMemberRoles(member);
    });

    // Track role updates
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      if (!this.config.enabled) return;
      if (!this.config.trackBots && newMember.user.bot) return;

      // Check if roles changed
      const oldRoles = oldMember.roles.cache.map(r => r.id).sort();
      const newRoles = newMember.roles.cache.map(r => r.id).sort();

      if (JSON.stringify(oldRoles) !== JSON.stringify(newRoles)) {
        await this.trackMemberRoles(newMember);
      }
    });

    // Track when member is banned
    this.client.on('guildBanAdd', async (ban) => {
      if (!this.config.enabled) return;
      if (!this.config.trackBots && ban.user.bot) return;

      // Try to get member from cache before they're removed
      const member = ban.guild.members.cache.get(ban.user.id);
      if (member) {
        await this.trackMemberRoles(member);
      }
    });
  }

  async trackMemberRoles(member) {
    try {
      // Get roles excluding @everyone and exempt roles
      const roles = member.roles.cache
        .filter(role => 
          role.id !== member.guild.id && // Not @everyone
          !this.config.exemptRoles.includes(role.id)
        )
        .map(role => ({
          id: role.id,
          name: role.name
        }));

      if (roles.length === 0) return;

      // Create unique key for user in guild
      const key = `${member.guild.id}-${member.user.id}`;

      // Get existing history
      const userHistory = this.roleHistory.get(key) || {
        userId: member.user.id,
        username: member.user.username,
        guildId: member.guild.id,
        history: []
      };

      // Add new entry
      userHistory.history.unshift({
        roles: roles,
        timestamp: new Date().toISOString(),
        reason: 'automatic'
      });

      // Limit history size
      if (userHistory.history.length > this.config.maxHistoryPerUser) {
        userHistory.history = userHistory.history.slice(0, this.config.maxHistoryPerUser);
      }

      // Update username in case it changed
      userHistory.username = member.user.username;

      // Save
      this.roleHistory.set(key, userHistory);
      this.saveRoleHistory();
      this.stats.rolesTracked++;

      // Log if enabled
      await this.logAction(member.guild, {
        action: 'Roles Tracked',
        user: member.user,
        roleCount: roles.length,
        reason: 'Member update/leave'
      });
    } catch (error) {
      console.error('[RoleTracker] Error tracking roles:', error);
      this.stats.errors++;
    }
  }

  getRoleHistory(guildId, userId) {
    const key = `${guildId}-${userId}`;
    return this.roleHistory.get(key) || null;
  }

  async restoreRoles(guild, userId, historyIndex = 0) {
    const key = `${guild.id}-${userId}`;
    const userHistory = this.roleHistory.get(key);

    if (!userHistory || userHistory.history.length === 0) {
      return { 
        success: false, 
        restored: 0, 
        failed: 0, 
        errors: ['No role history found for this user'] 
      };
    }

    if (historyIndex >= userHistory.history.length) {
      return { 
        success: false, 
        restored: 0, 
        failed: 0, 
        errors: ['Invalid history index'] 
      };
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return { 
        success: false, 
        restored: 0, 
        failed: 0, 
        errors: ['User not found in guild'] 
      };
    }

    const historyEntry = userHistory.history[historyIndex];
    const errors = [];
    let restored = 0;
    let failed = 0;

    // Restore each role
    for (const roleData of historyEntry.roles) {
      try {
        const role = guild.roles.cache.get(roleData.id);
        if (!role) {
          errors.push(`Role "${roleData.name}" (${roleData.id}) no longer exists`);
          failed++;
          continue;
        }

        if (this.config.exemptRoles.includes(role.id)) {
          errors.push(`Role "${role.name}" is exempt from restoration`);
          failed++;
          continue;
        }

        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Role restoration');
          restored++;
        }
      } catch (error) {
        errors.push(`Failed to add role "${roleData.name}": ${error.message}`);
        failed++;
      }
    }

    // Update stats
    this.stats.rolesRestored += restored;

    // Log action
    await this.logAction(guild, {
      action: 'Roles Restored',
      user: { id: userId, username: userHistory.username },
      restored: restored,
      failed: failed,
      from: `History from ${new Date(historyEntry.timestamp).toLocaleString()}`
    });

    return { 
      success: restored > 0, 
      restored, 
      failed, 
      errors 
    };
  }

  clearHistory(guildId, userId) {
    const key = `${guildId}-${userId}`;
    if (this.roleHistory.has(key)) {
      this.roleHistory.delete(key);
      this.saveRoleHistory();
      return true;
    }
    return false;
  }

  async logAction(guild, data) {
    if (!this.config.logChannel) return;

    const channel = guild.channels.cache.get(this.config.logChannel);
    if (!channel?.isTextBased()) return;

    const fields = [];

    if (data.user) {
      fields.push({
        name: 'User',
        value: `${data.user.username || 'Unknown'} (${data.user.id})`,
        inline: true
      });
    }

    if (data.roleCount !== undefined) {
      fields.push({
        name: 'Roles Tracked',
        value: data.roleCount.toString(),
        inline: true
      });
    }

    if (data.restored !== undefined) {
      fields.push({
        name: 'Restored',
        value: data.restored.toString(),
        inline: true
      });
    }

    if (data.failed !== undefined) {
      fields.push({
        name: 'Failed',
        value: data.failed.toString(),
        inline: true
      });
    }

    if (data.from) {
      fields.push({
        name: 'Restored From',
        value: data.from,
        inline: false
      });
    }

    if (data.reason) {
      fields.push({
        name: 'Reason',
        value: data.reason,
        inline: false
      });
    }

    const embed = this.embedLoader.createEmbed({
      title: `Role Tracker: ${data.action}`,
      fields: fields
    });

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[RoleTracker] Failed to log action:', error);
    }
  }

  getStats() {
    return {
      usersTracked: this.roleHistory.size,
      rolesTracked: this.stats.rolesTracked,
      rolesRestored: this.stats.rolesRestored,
      errors: this.stats.errors
    };
  }

  async saveConfig() {
    this.configLoader.set('roleTracker', {
      enabled: this.config.enabled,
      dataFile: this.config.dataFile,
      maxHistoryPerUser: this.config.maxHistoryPerUser,
      trackBots: this.config.trackBots,
      exemptRoles: this.config.exemptRoles,
      logChannel: this.config.logChannel
    });
    return this.configLoader.save();
  }
}