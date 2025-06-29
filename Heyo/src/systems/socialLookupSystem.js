// src/systems/socialLookupSystem.js
import puppeteer from 'puppeteer';

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
    this.browser = null;
    
    // Browser options
    this.browserOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    };
    
    // Initialize browser on startup
    this.initBrowser();
  }
  
  async initBrowser() {
    try {
      this.browser = await puppeteer.launch(this.browserOptions);
      console.log('[SocialLookupSystem] Browser initialized');
    } catch (error) {
      console.error('[SocialLookupSystem] Failed to initialize browser:', error);
    }
  }
  
  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      await this.initBrowser();
    }
  }
  
  async lookupTikTok(username) {
    // Check cache first
    const cacheKey = `tiktok:${username}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry * 1000) {
      console.log(`[SocialLookupSystem] Using cached TikTok data for @${username}`);
      return cached.data;
    }
    
    await this.ensureBrowser();
    const page = await this.browser.newPage();
    
    try {
      // Clean username (remove @ if present)
      username = username.replace('@', '').toLowerCase();
      
      console.log(`[SocialLookupSystem] Fetching TikTok data for @${username}`);
      
      // Add viewport for better rendering
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Set user agent
      await page.setUserAgent(this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Add console logging from the page
      page.on('console', msg => {
        if (msg.type() === 'log') {
          console.log('[TikTok Page]', msg.text());
        }
      });
      
      // Navigate to TikTok profile
      const response = await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout || 30000
      });
      
      // Check if page exists
      if (response.status() === 404) {
        console.log(`[SocialLookupSystem] TikTok user @${username} not found (404)`);
        return null;
      }
      
      // Wait for profile data to load - try multiple selectors
      try {
        await page.waitForSelector('[data-e2e="user-avatar"], header, main', { timeout: 10000 });
      } catch (e) {
        console.log(`[SocialLookupSystem] Could not find profile elements for @${username}`);
      }
      
      // Extract data using page evaluation
      const data = await page.evaluate(() => {
        // Helper function to extract numbers from text
        const extractNumber = (text) => {
          if (!text) return 0;
          const match = text.match(/(\d+\.?\d*)([KMB]?)/);
          if (!match) return 0;
          
          let num = parseFloat(match[1]);
          const suffix = match[2];
          
          if (suffix === 'K') num *= 1000;
          else if (suffix === 'M') num *= 1000000;
          else if (suffix === 'B') num *= 1000000000;
          
          return Math.floor(num);
        };
        
        // Get username - try multiple selectors
        let username = null;
        const usernameSelectors = ['[data-e2e="user-subtitle"]', 'h2.username', 'span.username'];
        for (const selector of usernameSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            username = el.textContent.replace('@', '').trim();
            break;
          }
        }
        
        // Get display name - try multiple selectors
        let displayName = username;
        const nameSelectors = ['[data-e2e="user-title"]', 'h1', 'h2.nickname'];
        for (const selector of nameSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            displayName = el.textContent.trim();
            break;
          }
        }
        
        // Get bio - try multiple selectors
        let bio = 'No bio available';
        const bioSelectors = ['[data-e2e="user-bio"]', 'h2.description', '.share-desc'];
        for (const selector of bioSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent && el.textContent.trim()) {
            bio = el.textContent.trim();
            break;
          }
        }
        
        // Get avatar - try multiple selectors
        let avatar = null;
        const avatarSelectors = ['[data-e2e="user-avatar"] img', '.avatar img', 'img.avatar'];
        for (const selector of avatarSelectors) {
          const el = document.querySelector(selector);
          if (el && el.src) {
            avatar = el.src;
            break;
          }
        }
        
        // Get stats
        const statsElements = document.querySelectorAll('[data-e2e="followers-count"], [data-e2e="following-count"], [data-e2e="likes-count"]');
        let followers = 0, following = 0, likes = 0;
        
        statsElements.forEach(el => {
          const text = el.textContent;
          const value = extractNumber(text);
          
          if (el.getAttribute('data-e2e') === 'followers-count') followers = value;
          else if (el.getAttribute('data-e2e') === 'following-count') following = value;
          else if (el.getAttribute('data-e2e') === 'likes-count') likes = value;
        });
        
        // Check if verified
        const verified = !!document.querySelector('[data-e2e="user-title"] svg');
        
        // Count videos
        const videoElements = document.querySelectorAll('[data-e2e="user-post-item"]');
        const videos = videoElements.length;
        
        const result = {
          username,
          displayName,
          bio,
          verified,
          avatar,
          followers,
          following,
          likes,
          videos,
          found: !!username
        };
        
        console.log('TikTok data extracted:', result);
        return result;
      });
      
      if (!data.found || !data.username) {
        return null;
      }
      
      // Format the data
      const formattedData = {
        username: data.username,
        displayName: data.displayName || data.username,
        bio: data.bio,
        verified: data.verified,
        avatar: data.avatar,
        url: `https://www.tiktok.com/@${data.username}`,
        followers: this.formatNumber(data.followers),
        following: this.formatNumber(data.following),
        likes: this.formatNumber(data.likes),
        videos: this.formatNumber(data.videos),
        isPrivate: false // TikTok doesn't show private profiles publicly
      };
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: formattedData,
        timestamp: Date.now()
      });
      
      console.log(`[SocialLookupSystem] Successfully fetched TikTok data for @${username}`);
      return formattedData;
      
    } catch (error) {
      console.error(`[SocialLookupSystem] TikTok lookup error for @${username}:`, error.message);
      
      // Check if user not found
      if (error.message.includes('Navigation timeout') || 
          error.message.includes('not found')) {
        return null;
      }
      
      throw error;
    } finally {
      await page.close();
    }
  }
  
  async lookupInstagram(username) {
    // Check cache first
    const cacheKey = `instagram:${username}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry * 1000) {
      console.log(`[SocialLookupSystem] Using cached Instagram data for @${username}`);
      return cached.data;
    }
    
    await this.ensureBrowser();
    const page = await this.browser.newPage();
    
    try {
      // Clean username
      username = username.replace('@', '').toLowerCase();
      
      console.log(`[SocialLookupSystem] Fetching Instagram data for @${username}`);
      
      // Set user agent
      await page.setUserAgent(this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Navigate to Instagram profile
      const response = await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout || 30000
      });
      
      // Check if page exists
      if (response.status() === 404) {
        console.log(`[SocialLookupSystem] Instagram user @${username} not found (404)`);
        return null;
      }
      
      // Wait for profile to load - try multiple selectors
      try {
        await page.waitForSelector('header, main, article', { timeout: 10000 });
      } catch (e) {
        console.log(`[SocialLookupSystem] Could not find profile elements for @${username}`);
      }
      
      // Extract data
      const data = await page.evaluate(() => {
        // Helper function to extract numbers
        const extractNumber = (text) => {
          if (!text) return 0;
          
          // Remove commas and parse
          text = text.replace(/,/g, '').replace(/\s/g, '');
          
          const match = text.match(/(\d+\.?\d*)([KMB]?)/i);
          if (!match) return 0;
          
          let num = parseFloat(match[1]);
          const suffix = match[2].toUpperCase();
          
          if (suffix === 'K') num *= 1000;
          else if (suffix === 'M') num *= 1000000;
          else if (suffix === 'B') num *= 1000000000;
          
          return Math.floor(num);
        };
        
        // Get username from URL or page
        const pathParts = window.location.pathname.split('/').filter(p => p && p.length > 0);
        const username = pathParts[0] || null;
        
        console.log('Path parts:', pathParts, 'Username:', username);
        
        // Get display name - Try multiple selectors
        let displayName = username;
        const nameSelectors = ['header h2', 'header h1', 'section h2', 'section h1'];
        for (const selector of nameSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            displayName = el.textContent.trim();
            break;
          }
        }
        
        // Get bio - Try multiple approaches
        let bio = 'No bio available';
        // Try different possible bio locations
        const bioSelectors = [
          'header section > div > div > span',
          'header section > div span',
          'div[style*="line-height"] span',
          'header div > span'
        ];
        
        for (const selector of bioSelectors) {
          const bioEl = document.querySelector(selector);
          if (bioEl && bioEl.textContent && bioEl.textContent.trim().length > 0) {
            bio = bioEl.textContent.trim();
            break;
          }
        }
        
        // Get avatar
        const avatarEl = document.querySelector('header img, img[alt*="profile picture"]');
        const avatar = avatarEl ? avatarEl.src : null;
        
        // Get stats - More flexible approach
        let posts = 0, followers = 0, following = 0;
        
        // Try to find stats in list items
        const statsLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"], span');
        statsLinks.forEach(el => {
          const text = el.textContent || '';
          if (text.includes('posts') || text.includes('post')) {
            posts = extractNumber(text);
          } else if (text.includes('followers') || text.includes('follower')) {
            followers = extractNumber(text);
          } else if (text.includes('following')) {
            following = extractNumber(text);
          }
        });
        
        // Alternative method - check header section for stats
        if (posts === 0 && followers === 0 && following === 0) {
          const headerStats = document.querySelectorAll('header section ul li, header section div > span');
          let statsFound = [];
          headerStats.forEach(el => {
            const text = el.textContent || '';
            const num = extractNumber(text);
            if (num > 0 || text.match(/\d/)) {
              statsFound.push({ text: text.trim(), num });
              console.log('Found stat:', text.trim(), '-> ', num);
            }
          });
          
          // Usually: posts, followers, following in that order
          if (statsFound.length >= 3) {
            posts = statsFound[0].num;
            followers = statsFound[1].num;
            following = statsFound[2].num;
          }
        }
        
        // Check if verified - Look for SVG checkmark
        const verified = !!document.querySelector('header svg[aria-label="Verified"], header span[title="Verified"]');
        
        // Check if private - Look for private account text
        const isPrivate = !!Array.from(document.querySelectorAll('span, h2')).find(el => 
          el.textContent && (
            el.textContent.includes('This account is private') ||
            el.textContent.includes('This Account is Private')
          )
        );
        
        const result = {
          username,
          displayName,
          bio,
          verified,
          avatar,
          posts,
          followers,
          following,
          isPrivate,
          found: !!username
        };
        
        console.log('Extracted data:', result);
        return result;
      });
      
      if (!data.found || !data.username) {
        return null;
      }
      
      // Format the data
      const formattedData = {
        username: data.username,
        displayName: data.displayName || data.username,
        bio: data.bio,
        verified: data.verified,
        avatar: data.avatar,
        url: `https://www.instagram.com/${data.username}/`,
        followers: this.formatNumber(data.followers),
        following: this.formatNumber(data.following),
        posts: this.formatNumber(data.posts),
        isPrivate: data.isPrivate,
        businessAccount: false, // Would need additional parsing
        categoryName: null,
        externalUrl: null,
        igtv: '0',
        reels: '0',
        highlights: 0
      };
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: formattedData,
        timestamp: Date.now()
      });
      
      console.log(`[SocialLookupSystem] Successfully fetched Instagram data for @${username}`);
      return formattedData;
      
    } catch (error) {
      console.error(`[SocialLookupSystem] Instagram lookup error for @${username}:`, error.message);
      
      // Check if user not found
      if (error.message.includes('Navigation timeout') || 
          error.message.includes('404') ||
          error.message.includes('not found')) {
        return null;
      }
      
      throw error;
    } finally {
      await page.close();
    }
  }
  
  async lookupRoblox(username) {
    // Check cache first
    const cacheKey = `roblox:${username}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.cacheExpiry * 1000) {
      console.log(`[SocialLookupSystem] Using cached Roblox data for ${username}`);
      return cached.data;
    }
    
    try {
      console.log(`[SocialLookupSystem] Fetching Roblox data for ${username}`);
      
      // Use Roblox API to search for user
      const searchResponse = await fetch(`https://users.roblox.com/v1/usernames/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: true
        })
      });
      
      if (!searchResponse.ok) {
        console.error(`[SocialLookupSystem] Roblox API error: ${searchResponse.status}`);
        throw new Error('Failed to search for user');
      }
      
      const searchData = await searchResponse.json();
      
      if (!searchData.data || searchData.data.length === 0) {
        console.log(`[SocialLookupSystem] Roblox user ${username} not found`);
        return null;
      }
      
      // Find exact match (case insensitive)
      const userMatch = searchData.data.find(user => 
        user.name.toLowerCase() === username.toLowerCase()
      );
      
      if (!userMatch) {
        console.log(`[SocialLookupSystem] No exact match for Roblox user ${username}`);
        return null;
      }
      
      const userId = userMatch.id;
      
      // Fetch detailed user info
      const [userInfoResponse, presenceResponse, avatarResponse] = await Promise.all([
        fetch(`https://users.roblox.com/v1/users/${userId}`),
        fetch(`https://presence.roblox.com/v1/presence/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            userIds: [userId]
          })
        }),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`)
      ]);
      
      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info');
      }
      
      const userInfo = await userInfoResponse.json();
      
      // Get presence data
      let presenceData = null;
      if (presenceResponse.ok) {
        const presenceJson = await presenceResponse.json();
        presenceData = presenceJson.userPresences?.[0];
      }
      
      // Get avatar URL
      let avatarUrl = null;
      if (avatarResponse.ok) {
        const avatarJson = await avatarResponse.json();
        avatarUrl = avatarJson.data?.[0]?.imageUrl;
      }
      
      // Get friends count
      let friendsCount = 0;
      try {
        const friendsResponse = await fetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
        if (friendsResponse.ok) {
          const friendsData = await friendsResponse.json();
          friendsCount = friendsData.count || 0;
        }
      } catch (e) {
        console.log('[SocialLookupSystem] Could not fetch friends count');
      }
      
      // Get followers count
      let followersCount = 0;
      try {
        const followersResponse = await fetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
        if (followersResponse.ok) {
          const followersData = await followersResponse.json();
          followersCount = followersData.count || 0;
        }
      } catch (e) {
        console.log('[SocialLookupSystem] Could not fetch followers count');
      }
      
      // Get following count
      let followingCount = 0;
      try {
        const followingResponse = await fetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
        if (followingResponse.ok) {
          const followingData = await followingResponse.json();
          followingCount = followingData.count || 0;
        }
      } catch (e) {
        console.log('[SocialLookupSystem] Could not fetch following count');
      }
      
      // Format join date
      let joinDate = null;
      if (userInfo.created) {
        const date = new Date(userInfo.created);
        joinDate = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
      }
      
      // Determine online status
      const isOnline = presenceData?.userPresenceType === 2; // 2 = InGame, 1 = Online, 0 = Offline
      const lastOnline = presenceData?.lastOnline ? new Date(presenceData.lastOnline) : null;
      
      // Format the data
      const formattedData = {
        username: userInfo.name,
        displayName: userInfo.displayName || userInfo.name,
        bio: userInfo.description || 'No description available',
        verified: userInfo.hasVerifiedBadge || false,
        avatar: avatarUrl,
        url: `https://www.roblox.com/users/${userId}/profile`,
        friends: this.formatNumber(friendsCount),
        followers: this.formatNumber(followersCount),
        following: this.formatNumber(followingCount),
        isOnline: isOnline,
        joinDate: joinDate,
        userId: userId.toString(),
        isBanned: userInfo.isBanned || false,
        lastOnline: lastOnline
      };
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: formattedData,
        timestamp: Date.now()
      });
      
      console.log(`[SocialLookupSystem] Successfully fetched Roblox data for ${username}`);
      return formattedData;
      
    } catch (error) {
      console.error(`[SocialLookupSystem] Roblox lookup error for ${username}:`, error.message);
      
      // Try fallback with Puppeteer if API fails
      console.log(`[SocialLookupSystem] Attempting Puppeteer fallback for ${username}`);
      return this.lookupRobloxFallback(username);
    }
  }
  
  async lookupRobloxFallback(username) {
    await this.ensureBrowser();
    const page = await this.browser.newPage();
    
    try {
      console.log(`[SocialLookupSystem] Using Puppeteer fallback for Roblox user ${username}`);
      
      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Try direct profile URL with username
      const profileUrl = `https://www.roblox.com/users/profile?username=${encodeURIComponent(username)}`;
      const response = await page.goto(profileUrl, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout || 30000
      });
      
      // Check if redirected to a valid profile
      const currentUrl = page.url();
      const userIdMatch = currentUrl.match(/\/users\/(\d+)/);
      
      if (!userIdMatch) {
        console.log(`[SocialLookupSystem] Could not find Roblox user ${username}`);
        return null;
      }
      
      const userId = userIdMatch[1];
      
      // Wait for profile elements
      await page.waitForSelector('[class*="profile-header"], [class*="header-title"], h1', { timeout: 10000 });
      
      // Extract basic data from page
      const data = await page.evaluate(() => {
        // Get display name and username
        const headerEl = document.querySelector('h1, [class*="header-title"] h1');
        const displayName = headerEl ? headerEl.textContent.trim() : null;
        
        const usernameEl = document.querySelector('[class*="header-title"] [class*="text-label"], [class*="profile-name"]');
        const username = usernameEl ? usernameEl.textContent.replace('@', '').trim() : null;
        
        // Get description
        let bio = 'No description available';
        const bioEl = document.querySelector('[class*="profile-about"], [class*="about"]');
        if (bioEl && bioEl.textContent) {
          bio = bioEl.textContent.trim();
        }
        
        // Get avatar
        const avatarEl = document.querySelector('[class*="avatar"] img, img[alt*="avatar"]');
        const avatar = avatarEl ? avatarEl.src : null;
        
        return {
          username,
          displayName,
          bio,
          avatar,
          found: !!(username || displayName)
        };
      });
      
      if (!data.found) {
        return null;
      }
      
      // Format basic data
      const formattedData = {
        username: data.username || username,
        displayName: data.displayName || data.username || username,
        bio: data.bio,
        verified: false, // Can't easily determine from page
        avatar: data.avatar,
        url: `https://www.roblox.com/users/${userId}/profile`,
        friends: '?',
        followers: '?',
        following: '?',
        isOnline: false,
        joinDate: null,
        userId: userId
      };
      
      // Don't cache fallback data as it's incomplete
      console.log(`[SocialLookupSystem] Fetched basic Roblox data for ${username} via fallback`);
      return formattedData;
      
    } catch (error) {
      console.error(`[SocialLookupSystem] Roblox fallback error for ${username}:`, error.message);
      return null;
    } finally {
      await page.close();
    }
  }
  
  formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    
    num = parseInt(num);
    
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
    } else if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
  }
  
  async createTikTokEmbed(data) {
    if (!data) {
      return this.client.embedLoader.error(
        'TikTok User Not Found',
        'Could not find this TikTok user. Please check the username and try again.'
      );
    }
    
    const fields = [
      { name: 'Username', value: `@${data.username}`, inline: true },
      { name: 'Followers', value: data.followers, inline: true },
      { name: 'Following', value: data.following, inline: true },
      { name: 'Likes', value: data.likes, inline: true },
      { name: 'Videos', value: data.videos, inline: true },
      { name: 'Verified', value: data.verified ? 'Yes' : 'No', inline: true }
    ];
    
    if (data.isPrivate) {
      fields.push({ 
        name: 'Private Account', 
        value: 'This account is private', 
        inline: false 
      });
    }
    
    const embed = this.client.embedLoader.createEmbed({
      title: 'TikTok Profile Lookup',
      description: `**${data.displayName}${data.verified ? ' ✓' : ''}**\n[View Profile](${data.url})\n\n${data.bio || 'No bio available'}`,
      fields: fields,
      footer: `TikTok • @${data.username}`,
      formatDescription: false
    });
    
    if (data.avatar) {
      embed.setThumbnail(data.avatar);
    }
    
    // Add branding
    embed.setAuthor({
      name: 'TikTok',
      iconURL: 'https://www.tiktok.com/favicon.ico'
    });
    
    return embed;
  }
  
  async createInstagramEmbed(data) {
    if (!data) {
      return this.client.embedLoader.error(
        'Instagram User Not Found',
        'Could not find this Instagram user. Please check the username and try again.'
      );
    }
    
    const fields = [
      { name: 'Username', value: `@${data.username}`, inline: true },
      { name: 'Followers', value: data.followers, inline: true },
      { name: 'Following', value: data.following, inline: true },
      { name: 'Posts', value: data.posts, inline: true },
      { name: 'Private', value: data.isPrivate ? 'Yes' : 'No', inline: true },
      { name: 'Verified', value: data.verified ? 'Yes' : 'No', inline: true }
    ];
    
    const embed = this.client.embedLoader.createEmbed({
      title: 'Instagram Profile Lookup',
      description: `**${data.displayName}${data.verified ? ' ✓' : ''}**\n[View Profile](${data.url})\n\n${data.bio || 'No bio available'}`,
      fields: fields,
      footer: `Instagram • @${data.username}`,
      formatDescription: false
    });
    
    if (data.avatar) {
      embed.setThumbnail(data.avatar);
    }
    
    // Add branding
    embed.setAuthor({
      name: 'Instagram',
      iconURL: 'https://www.instagram.com/favicon.ico'
    });
    
    return embed;
  }
  
  async createRobloxEmbed(data) {
    if (!data) {
      return this.client.embedLoader.error(
        'Roblox User Not Found',
        'Could not find this Roblox user. Please check the username and try again.'
      );
    }
    
    const fields = [
      { name: 'Username', value: data.username, inline: true },
      { name: 'Display Name', value: data.displayName, inline: true },
      { name: 'User ID', value: data.userId, inline: true },
      { name: 'Friends', value: data.friends, inline: true },
      { name: 'Followers', value: data.followers, inline: true },
      { name: 'Following', value: data.following, inline: true },
      { name: 'Verified', value: data.verified ? 'Yes' : 'No', inline: true },
      { name: 'Status', value: data.isOnline ? '🟢 Online' : '⚪ Offline', inline: true }
    ];
    
    if (data.joinDate) {
      fields.push({ name: 'Join Date', value: data.joinDate, inline: true });
    }
    
    const embed = this.client.embedLoader.createEmbed({
      title: 'Roblox Profile Lookup',
      description: `**${data.displayName}${data.verified ? ' ✓' : ''}**\n[View Profile](${data.url})\n\n${data.bio || 'No description available'}`,
      fields: fields,
      footer: `Roblox • ${data.username}`,
      formatDescription: false
    });
    
    if (data.avatar) {
      embed.setThumbnail(data.avatar);
    }
    
    // Add branding
    embed.setAuthor({
      name: 'Roblox',
      iconURL: 'https://www.roblox.com/favicon.ico'
    });
    
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
    const oldSize = this.cache.size;
    this.cache.clear();
    console.log(`[SocialLookupSystem] Cleared cache (removed ${oldSize} entries)`);
  }
  
  getCacheEntry(platform, username) {
    const cacheKey = `${platform}:${username.replace('@', '').toLowerCase()}`;
    return this.cache.get(cacheKey);
  }
  
  removeCacheEntry(platform, username) {
    const cacheKey = `${platform}:${username.replace('@', '').toLowerCase()}`;
    return this.cache.delete(cacheKey);
  }
  
  getStats() {
    const now = Date.now();
    let expiredEntries = 0;
    let activeEntries = 0;
    
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > this.config.cacheExpiry * 1000) {
        expiredEntries++;
      } else {
        activeEntries++;
      }
    }
    
    return {
      cacheSize: this.cache.size,
      activeEntries: activeEntries,
      expiredEntries: expiredEntries,
      rateLimitedUsers: this.rateLimits.size,
      cacheExpiry: `${this.config.cacheExpiry}s`,
      rateLimit: `${this.config.rateLimitMs / 1000}s`,
      browserConnected: this.browser ? this.browser.isConnected() : false
    };
  }
  
  // Cleanup method for expired cache entries
  cleanupCache() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > this.config.cacheExpiry * 1000) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[SocialLookupSystem] Cleaned up ${removed} expired cache entries`);
    }
  }
  
  // Start periodic cleanup
  startCleanup() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, 5 * 60 * 1000);
  }
  
  // Stop cleanup interval
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  // Close browser on shutdown
  async shutdown() {
    this.stopCleanup();
    if (this.browser) {
      await this.browser.close();
      console.log('[SocialLookupSystem] Browser closed');
    }
  }
}