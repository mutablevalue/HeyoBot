// src/systems/socialLookupSystem.js
import { 
  EmbedBuilder,
  AttachmentBuilder
} from 'discord.js';

export class SocialLookupSystem {
  constructor(client, configLoader) {
    this.client = client;
    this.configLoader = configLoader;
    this.config = this.configLoader.get('socialLookup');
    
    if (!this.config.enabled) {
      console.log('[SocialLookupSystem] System is disabled in config');
      return;
    }
    
    this.cache = new Map(); // username -> { platform, data, timestamp }
    this.rateLimits = new Map(); // userId -> timestamp
  }
  
  async lookupTikTok(username) {
    // Check cache first
    const cacheKey = `tiktok:${username}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry * 1000) {
      return cached.data;
    }
    
    try {
      // Clean username (remove @ if present)
      username = username.replace('@', '');
      
      // Note: TikTok doesn't have a public API, so we'll use a scraping approach
      // In production, you'd want to use a proper API service
      const response = await fetch(`https://www.tiktok.com/@${username}`, {
        headers: {
          'User-Agent': this.config.userAgent
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // Parse basic info from HTML (this is a simplified example)
      // In production, use a proper HTML parser or API
      const data = this.parseTikTokHTML(html, username);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      return data;
      
    } catch (error) {
      console.error('[SocialLookupSystem] TikTok lookup error:', error);
      return null;
    }
  }
  
  parseTikTokHTML(html, username) {
    // This is a simplified parser - in production, use a proper solution
    try {
      // Extract JSON-LD data
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
      if (jsonLdMatch) {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        
        return {
          username: username,
          displayName: jsonData.name || username,
          bio: jsonData.description || 'No bio available',
          verified: html.includes('verified-badge') || false,
          avatar: jsonData.image || null,
          url: `https://www.tiktok.com/@${username}`,
          // These would need proper parsing
          followers: this.extractNumber(html, 'followerCount') || 'N/A',
          following: this.extractNumber(html, 'followingCount') || 'N/A',
          likes: this.extractNumber(html, 'heartCount') || 'N/A',
          videos: this.extractNumber(html, 'videoCount') || 'N/A'
        };
      }
      
      // Fallback basic data
      return {
        username: username,
        displayName: username,
        bio: 'Unable to fetch bio',
        verified: false,
        avatar: null,
        url: `https://www.tiktok.com/@${username}`,
        followers: 'N/A',
        following: 'N/A',
        likes: 'N/A',
        videos: 'N/A'
      };
      
    } catch (error) {
      console.error('[SocialLookupSystem] Error parsing TikTok HTML:', error);
      return null;
    }
  }
  
  async lookupInstagram(username) {
    // Check cache first
    const cacheKey = `instagram:${username}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry * 1000) {
      return cached.data;
    }
    
    try {
      // Clean username
      username = username.replace('@', '');
      
      // Instagram also requires scraping or unofficial APIs
      // This is a simplified example
      const response = await fetch(`https://www.instagram.com/${username}/`, {
        headers: {
          'User-Agent': this.config.userAgent
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      const data = this.parseInstagramHTML(html, username);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      return data;
      
    } catch (error) {
      console.error('[SocialLookupSystem] Instagram lookup error:', error);
      return null;
    }
  }
  
  parseInstagramHTML(html, username) {
    try {
      // Extract shared data
      const sharedDataMatch = html.match(/window\._sharedData = (.+?);<\/script>/);
      if (sharedDataMatch) {
        const sharedData = JSON.parse(sharedDataMatch[1]);
        const user = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user;
        
        if (user) {
          return {
            username: username,
            displayName: user.full_name || username,
            bio: user.biography || 'No bio available',
            verified: user.is_verified || false,
            avatar: user.profile_pic_url_hd || user.profile_pic_url || null,
            url: `https://www.instagram.com/${username}/`,
            followers: this.formatNumber(user.edge_followed_by?.count || 0),
            following: this.formatNumber(user.edge_follow?.count || 0),
            posts: this.formatNumber(user.edge_owner_to_timeline_media?.count || 0),
            isPrivate: user.is_private || false,
            businessAccount: user.is_business_account || false,
            categoryName: user.category_name || null
          };
        }
      }
      
      // Fallback
      return {
        username: username,
        displayName: username,
        bio: 'Unable to fetch bio',
        verified: false,
        avatar: null,
        url: `https://www.instagram.com/${username}/`,
        followers: 'N/A',
        following: 'N/A',
        posts: 'N/A',
        isPrivate: false
      };
      
    } catch (error) {
      console.error('[SocialLookupSystem] Error parsing Instagram HTML:', error);
      return null;
    }
  }
  
  extractNumber(html, key) {
    const regex = new RegExp(`"${key}":(\\d+)`);
    const match = html.match(regex);
    return match ? this.formatNumber(parseInt(match[1])) : null;
  }
  
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
  
  async createTikTokEmbed(data) {
    if (!data) {
      return this.client.embedLoader.error('TikTok User Not Found\nCould not find this TikTok user.');
    }
    
    const fields = [
      { name: 'Username', value: `@${data.username}`, inline: true },
      { name: 'Followers', value: data.followers, inline: true },
      { name: 'Following', value: data.following, inline: true },
      { name: 'Likes', value: data.likes, inline: true },
      { name: 'Videos', value: data.videos, inline: true },
      { name: 'Verified', value: data.verified ? 'Yes' : 'No', inline: true }
    ];
    
    const embed = this.client.embedLoader.createEmbed({
      title: 'Social Lookup System',
      description: `**${data.displayName}${data.verified ? ' ✓' : ''}**\n[View Profile](${data.url})\n\n${data.bio || 'No bio available'}`,
      fields: fields,
      footer: 'TikTok Profile Lookup',
      formatDescription: false
    });
    
    if (data.avatar) {
      embed.setThumbnail(data.avatar);
    }
    
    return embed;
  }
  
  async createInstagramEmbed(data) {
    if (!data) {
      return this.client.embedLoader.error('Instagram User Not Found\nCould not find this Instagram user.');
    }
    
    const fields = [
      { name: 'Username', value: `@${data.username}`, inline: true },
      { name: 'Followers', value: data.followers, inline: true },
      { name: 'Following', value: data.following, inline: true },
      { name: 'Posts', value: data.posts, inline: true },
      { name: 'Private', value: data.isPrivate ? 'Yes' : 'No', inline: true },
      { name: 'Verified', value: data.verified ? 'Yes' : 'No', inline: true }
    ];
    
    if (data.businessAccount && data.categoryName) {
      fields.push({ 
        name: 'Business Category', 
        value: data.categoryName, 
        inline: false 
      });
    }
    
    const embed = this.client.embedLoader.createEmbed({
      title: 'Social Lookup System',
      description: `**${data.displayName}${data.verified ? ' ✓' : ''}**\n[View Profile](${data.url})\n\n${data.bio || 'No bio available'}`,
      fields: fields,
      footer: 'Instagram Profile Lookup',
      formatDescription: false
    });
    
    if (data.avatar) {
      embed.setThumbnail(data.avatar);
    }
    
    return embed;
  }
  
  checkRateLimit(userId) {
    const lastLookup = this.rateLimits.get(userId);
    if (!lastLookup) return true;
    
    const timePassed = Date.now() - lastLookup;
    return timePassed >= this.config.rateLimitMs;
  }
  
  setRateLimit(userId) {
    this.rateLimits.set(userId, Date.now());
    
    // Clean up old rate limits
    setTimeout(() => {
      this.rateLimits.delete(userId);
    }, this.config.rateLimitMs);
  }
  
  getRateLimitRemaining(userId) {
    const lastLookup = this.rateLimits.get(userId);
    if (!lastLookup) return 0;
    
    const timePassed = Date.now() - lastLookup;
    const remaining = this.config.rateLimitMs - timePassed;
    
    return Math.ceil(remaining / 1000); // Return seconds
  }
  
  clearCache() {
    this.cache.clear();
  }
  
  getStats() {
    return {
      cacheSize: this.cache.size,
      rateLimitedUsers: this.rateLimits.size
    };
  }
}