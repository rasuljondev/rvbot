require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Admin ID from environment variable (can be ADMIN_ID or id)
const ADMIN_ID = parseInt(process.env.ADMIN_ID || process.env.id) || null;

if (!ADMIN_ID) {
  console.warn(`[${new Date().toISOString()}] Warning: ADMIN_ID or id not set in .env file`);
}

// User tracking
const usersFilePath = path.join(__dirname, 'users.json');

// Load users from file
function loadUsers() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const data = fs.readFileSync(usersFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error loading users:`, error);
  }
  return { users: [], newUsersToday: 0, lastResetDate: new Date().toDateString() };
}

// Save users to file
function saveUsers(usersData) {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(usersData, null, 2), 'utf8');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error saving users:`, error);
  }
}

// Add or update user
// Returns: 'admin', 'new', or 'existing'
function addUser(userId, username, firstName, lastName) {
  // Check if user is admin
  if (ADMIN_ID && userId === ADMIN_ID) {
    const usersData = loadUsers();
    const today = new Date().toDateString();
    
    // Reset daily counter if it's a new day
    if (usersData.lastResetDate !== today) {
      usersData.newUsersToday = 0;
      usersData.lastResetDate = today;
    }
    
    // Update admin info if needed
    const existingUser = usersData.users.find(u => u.id === userId);
    if (existingUser) {
      existingUser.username = username || existingUser.username;
      existingUser.firstName = firstName || existingUser.firstName;
      existingUser.lastName = lastName || existingUser.lastName;
      saveUsers(usersData);
    } else {
      // Admin not in users list yet, add them
      usersData.users.push({
        id: userId,
        username: username || null,
        firstName: firstName || null,
        lastName: lastName || null,
        firstSeen: new Date().toISOString()
      });
      saveUsers(usersData);
    }
    
    return 'admin';
  }
  
  const usersData = loadUsers();
  const today = new Date().toDateString();
  
  // Reset daily counter if it's a new day
  if (usersData.lastResetDate !== today) {
    usersData.newUsersToday = 0;
    usersData.lastResetDate = today;
  }
  
  // Check if user already exists
  const existingUser = usersData.users.find(u => u.id === userId);
  if (!existingUser) {
    // New user
    usersData.users.push({
      id: userId,
      username: username || null,
      firstName: firstName || null,
      lastName: lastName || null,
      firstSeen: new Date().toISOString()
    });
    usersData.newUsersToday++;
    saveUsers(usersData);
    return 'new';
  }
  
  // Update existing user info
  existingUser.username = username || existingUser.username;
  existingUser.firstName = firstName || existingUser.firstName;
  existingUser.lastName = lastName || existingUser.lastName;
  saveUsers(usersData);
  return 'existing';
}

// Get statistics
function getStats() {
  const usersData = loadUsers();
  return {
    totalUsers: usersData.users.length,
    newUsersToday: usersData.newUsersToday
  };
}

// Try to find yt-dlp executable
function findYtDlpPath() {
  const { execSync } = require('child_process');
  
  // Try to find yt-dlp in PATH and get full path
  try {
    // On Linux/Mac, use 'which' to get full path
    if (process.platform !== 'win32') {
      try {
        const fullPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
        if (fullPath && fs.existsSync(fullPath)) {
          console.log(`[${new Date().toISOString()}] Found yt-dlp at: ${fullPath}`);
          return fullPath;
        }
      } catch (e) {
        // which failed, continue
      }
    }
    
    // Try executing yt-dlp directly to see if it's in PATH
    try {
      execSync('yt-dlp --version', { stdio: 'ignore' });
      // If it works, try to get the full path
      if (process.platform !== 'win32') {
        try {
          const fullPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
          if (fullPath) return fullPath;
        } catch (e) {}
      }
      console.log(`[${new Date().toISOString()}] Found yt-dlp in PATH: yt-dlp`);
      return 'yt-dlp';
    } catch (e) {
      // Not in PATH
    }
  } catch (e) {
    // Continue to other methods
  }

  // Common Windows locations
  const possiblePaths = [
    'yt-dlp.exe',
    path.join(process.env.APPDATA || '', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    'C:\\Python314\\Scripts\\yt-dlp.exe',
  ];

  for (const ytDlpPath of possiblePaths) {
    try {
      if (fs.existsSync(ytDlpPath)) {
        console.log(`[${new Date().toISOString()}] Found yt-dlp at: ${ytDlpPath}`);
        return ytDlpPath;
      }
    } catch (e) {
      // Continue to next path
    }
  }
  
  // Fallback: try python -m yt_dlp
  try {
    execSync('python -m yt_dlp --version', { stdio: 'ignore' });
    console.log(`[${new Date().toISOString()}] Using python -m yt_dlp`);
    return 'python';
  } catch (e) {
    // Not found
  }
  
  return null;
}

const ytDlpPath = findYtDlpPath();
if (!ytDlpPath) {
  console.error(`[${new Date().toISOString()}] yt-dlp not found. Please install it: pip install yt-dlp`);
  process.exit(1);
}

// If we found the full path, use it; otherwise use the command name
const finalYtDlpPath = (ytDlpPath === 'python') 
  ? path.join(process.env.APPDATA || '', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe')
  : ytDlpPath;

console.log(`[${new Date().toISOString()}] Using yt-dlp at: ${finalYtDlpPath}`);
const ytDlpWrap = new YTDlpWrap(finalYtDlpPath);


// Store user states for YouTube format selection
const userStates = new Map();

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to download Instagram media (images and videos)
async function downloadInstagramMedia(ctx, messageText) {
  console.log(`[${new Date().toISOString()}] User ${ctx.from.id} sent message: ${messageText}`);
  
  // Validate Instagram URL
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  
  if (!instagramUrlPattern.test(messageText)) {
    console.log(`[${new Date().toISOString()}] Invalid Instagram URL format: ${messageText}`);
    ctx.reply('Please send a valid Instagram link. Example: https://www.instagram.com/p/...');
    return;
  }

  console.log(`[${new Date().toISOString()}] Valid Instagram URL received: ${messageText}`);

  // Send processing message
  const processingMsg = await ctx.reply('Downloading media... Please wait.');

  try {
    // Check if yt-dlp binary exists (skip check if it's a command name in PATH)
    const binaryPath = ytDlpWrap.getBinaryPath();
    const isCommandName = !binaryPath.includes('/') && !binaryPath.includes('\\') && !binaryPath.endsWith('.exe');
    if (!isCommandName && !fs.existsSync(binaryPath)) {
      console.error(`[${new Date().toISOString()}] yt-dlp binary not found at: ${binaryPath}`);
      throw new Error(`yt-dlp binary not found at ${binaryPath}. Please install yt-dlp.`);
    }

    // First, get media info to determine if it's an image or video
    const infoArgs = [
      messageText,
      '--print-json',
      '--no-playlist'
    ];
    
    // Add cookies file if it exists
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      infoArgs.push('--cookies', cookiesPath);
      console.log(`[${new Date().toISOString()}] Using cookies file: ${cookiesPath}`);
    }
    
    // Add user-agent for better compatibility
    infoArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`[${new Date().toISOString()}] Getting media info...`);
    let mediaInfo;
    try {
      const infoOutput = await ytDlpWrap.execPromise(infoArgs);
      mediaInfo = JSON.parse(infoOutput);
    } catch (error) {
      // If JSON parsing fails, try to extract from stderr or use fallback
      console.log(`[${new Date().toISOString()}] Could not parse JSON, trying alternative method...`);
      // Continue with download and detect from file extension
      mediaInfo = null;
    }

    // Determine media type (for logging purposes)
    let isImage = false;
    if (mediaInfo) {
      // Check if it's an image based on format or ext
      const ext = mediaInfo.ext || '';
      const format = mediaInfo.format || '';
      isImage = /jpg|jpeg|png|webp/i.test(ext) || /image/i.test(format);
      
      // Also check entries for carousel posts
      if (mediaInfo.entries && mediaInfo.entries.length > 0) {
        const firstEntry = mediaInfo.entries[0];
        const entryExt = firstEntry.ext || '';
        isImage = /jpg|jpeg|png|webp/i.test(entryExt);
      }
    }

    // Generate unique filename - let yt-dlp determine the extension
    const timestamp = Date.now();
    // Use %(ext)s to let yt-dlp determine the file extension automatically
    const outputPath = path.join(tempDir, `media_${timestamp}.%(ext)s`);
    
    console.log(`[${new Date().toISOString()}] Starting download...`);
    console.log(`[${new Date().toISOString()}] URL: ${messageText}`);
    console.log(`[${new Date().toISOString()}] Media type: ${isImage ? 'image' : 'video (or unknown)'}`);
    console.log(`[${new Date().toISOString()}] Output path template: ${outputPath}`);

    // Download media using yt-dlp
    // Use format selector that works for both images and videos on Instagram
    // 'best' format works for both, though yt-dlp warns about it (warning is more relevant for YouTube)
    const ytDlpArgs = [
      messageText,
      '-f', 'best',
      '-o', outputPath,
      '--no-playlist'
    ];
    
    // Add cookies file if it exists
    if (fs.existsSync(cookiesPath)) {
      ytDlpArgs.push('--cookies', cookiesPath);
    }
    
    // Add user-agent for better compatibility
    ytDlpArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);
    
    let stdout;
    try {
      stdout = await ytDlpWrap.execPromise(ytDlpArgs);
    } catch (firstError) {
      // If we get "No video formats found", it's likely an image post
      // Retry without format restriction to let yt-dlp auto-detect images
      const errorMessage = firstError.message || '';
      const stderr = firstError.stderr || '';
      if (errorMessage.includes('No video formats found') || stderr.includes('No video formats found')) {
        console.log(`[${new Date().toISOString()}] No video formats found, retrying without format restriction for images...`);
        
        // Retry without format selection - this should work for images
        const retryArgs = [
          messageText,
          '-o', outputPath,
          '--no-playlist'
        ];
        
        if (fs.existsSync(cookiesPath)) {
          retryArgs.push('--cookies', cookiesPath);
        }
        
        retryArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log(`[${new Date().toISOString()}] Retrying without format restriction:`, retryArgs);
        stdout = await ytDlpWrap.execPromise(retryArgs);
      } else {
        // Re-throw if it's a different error
        throw firstError;
      }
    }
    
    console.log(`[${new Date().toISOString()}] yt-dlp stdout:`, stdout);
    console.log(`[${new Date().toISOString()}] Download completed, checking file...`);

    // Find the actual downloaded file (yt-dlp replaces %(ext)s with actual extension)
    // We need to search for files matching our pattern
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`media_${timestamp}.`));
    
    if (!downloadedFile) {
      console.error(`[${new Date().toISOString()}] Media file was not created. Files in temp:`, files);
      throw new Error('Media file was not downloaded');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    // Detect actual file type from downloaded file
    const actualFileExtension = path.extname(actualOutputPath).toLowerCase().replace('.', '');
    const actualIsImage = /jpg|jpeg|png|webp/i.test(actualFileExtension);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    console.log(`[${new Date().toISOString()}] File downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB, Type: ${actualIsImage ? 'image' : 'video'}`);

    // Telegram has a 50MB file size limit for bots
    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
      );
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending media to user...`);
    
    // Send media file based on type
    if (actualIsImage) {
      await ctx.telegram.sendPhoto(
        ctx.chat.id,
        { source: actualOutputPath },
        {
          reply_to_message_id: ctx.message.message_id
        }
      );
      console.log(`[${new Date().toISOString()}] Image sent successfully`);
    } else {
      await ctx.telegram.sendVideo(
        ctx.chat.id,
        { source: actualOutputPath },
        {
          reply_to_message_id: ctx.message.message_id
        }
      );
      console.log(`[${new Date().toISOString()}] Video sent successfully`);
    }

    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

    // Show success message
    const mediaType = actualIsImage ? 'Image' : 'Video';
    await ctx.reply(`✅ ${mediaType} downloaded successfully!\n\nSend another Instagram link to download more.`);

    // Clean up temporary file
    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading media:`);
    console.error(`[${new Date().toISOString()}] Error type:`, error.constructor.name);
    console.error(`[${new Date().toISOString()}] Error message:`, error.message);
    console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);
    
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    
    // Try to delete processing message
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.'
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error editing message:`, err);
      ctx.reply('Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.');
    }
  }
}


// Helper function to get YouTube formats and show them as buttons
async function showYouTubeFormats(ctx, youtubeUrl) {
  console.log(`[${new Date().toISOString()}] Getting YouTube formats for: ${youtubeUrl}`);
  
  const processingMsg = await ctx.reply('Getting available formats... Please wait.');
  
  try {
    // Get video info and formats
    const infoArgs = [
      youtubeUrl,
      '--list-formats',
      '--no-playlist'
    ];
    
    console.log(`[${new Date().toISOString()}] Running yt-dlp to list formats...`);
    const formatListOutput = await ytDlpWrap.execPromise(infoArgs);
    
    // Parse format list to extract available formats
    const formatLines = formatListOutput.split('\n').filter(line => 
      line.trim() && /^\d+/.test(line.trim())
    );
    
    // Get video info for title
    const infoArgs2 = [
      youtubeUrl,
      '--print-json',
      '--no-playlist'
    ];
    
    let videoTitle = 'YouTube Video';
    try {
      const videoInfo = await ytDlpWrap.execPromise(infoArgs2);
      const info = JSON.parse(videoInfo);
      videoTitle = info.title || 'YouTube Video';
    } catch (e) {
      console.log(`[${new Date().toISOString()}] Could not get video title`);
    }
    
    // Parse formats to detect available qualities
    // YouTube often provides separate video and audio streams, so we'll use format selectors
    // that automatically combine them
    const formats = [];
    const qualityOrder = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
    const availableQualities = new Set();
    
    // Scan format list to see what qualities are available
    for (const line of formatLines) {
      // Match resolution/quality info
      // Example: "137 mp4  1920x1080 1080p, video only"
      // Example: "22 mp4  1280x720 720p"
      const match = line.match(/(\d+x\d+|\d+p)/i);
      if (match) {
        const resolution = match[1];
        let quality = '';
        
        if (resolution.includes('p')) {
          quality = resolution.toUpperCase();
        } else if (resolution.includes('x')) {
          const height = parseInt(resolution.split('x')[1]);
          if (height >= 2160) quality = '2160p';
          else if (height >= 1440) quality = '1440p';
          else if (height >= 1080) quality = '1080p';
          else if (height >= 720) quality = '720p';
          else if (height >= 480) quality = '480p';
          else if (height >= 360) quality = '360p';
          else if (height >= 240) quality = '240p';
          else quality = '144p';
        }
        
        if (quality) {
          availableQualities.add(quality);
        }
      }
    }
    
    // Always use format selectors that combine video+audio automatically
    // These work regardless of whether YouTube provides combined or separate streams
    const allQualities = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];
    
    // Only show qualities that are likely available (or show all common ones)
    for (const quality of allQualities) {
      // Use format selector that combines best video and audio for that quality
      formats.push({ 
        id: `bestvideo[height<=${quality.replace('p', '')}]+bestaudio/best[height<=${quality.replace('p', '')}]`, 
        ext: 'mp4', 
        quality 
      });
    }
    
    // Limit to 6 formats to fit in keyboard
    const displayFormats = formats.slice(0, 6);
    
    // Create keyboard buttons (2 per row)
    const buttons = [];
    for (let i = 0; i < displayFormats.length; i += 2) {
      const row = [];
      row.push(Markup.button.text(displayFormats[i].quality));
      if (i + 1 < displayFormats.length) {
        row.push(Markup.button.text(displayFormats[i + 1].quality));
      }
      buttons.push(row);
    }
    
    // Store format mapping in user state
    const formatMapping = {};
    displayFormats.forEach(f => {
      formatMapping[f.quality] = f.id;
    });
    
    userStates.set(ctx.from.id, {
      type: 'youtube_format_selection',
      url: youtubeUrl,
      formats: formatMapping,
      title: videoTitle
    });
    
    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    
    // Show format selection
    await ctx.reply(
      `📹 ${videoTitle}\n\nSelect a video format:`,
      Markup.keyboard(buttons).resize().oneTime()
    );
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting YouTube formats:`, error);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'Sorry, I couldn\'t get the available formats. Please check if the link is valid.'
      );
    } catch (err) {
      ctx.reply('Sorry, I couldn\'t get the available formats. Please check if the link is valid.');
    }
  }
}

// Helper function to download YouTube video with selected format
async function downloadYouTubeVideo(ctx, formatId, youtubeUrl, videoTitle) {
  console.log(`[${new Date().toISOString()}] Downloading YouTube video with format: ${formatId}`);
  
  const processingMsg = await ctx.reply('Downloading video... Please wait.');
  
  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `youtube_${timestamp}.%(ext)s`);
    
    const ytDlpArgs = [
      youtubeUrl,
      '-f', formatId,
      '-o', outputPath,
      '--no-playlist'
    ];
    
    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);
    
    const stdout = await ytDlpWrap.execPromise(ytDlpArgs);
    console.log(`[${new Date().toISOString()}] yt-dlp stdout:`, stdout);
    
    // Find the downloaded file
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`youtube_${timestamp}.`));
    
    if (!downloadedFile) {
      throw new Error('Video file was not downloaded');
    }
    
    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);
    
    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    console.log(`[${new Date().toISOString()}] File downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);
    
    // Telegram has a 50MB file size limit for bots
    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
      );
      return;
    }
    
    console.log(`[${new Date().toISOString()}] Sending video to user...`);
    
    // Send video file
    await ctx.telegram.sendVideo(
      ctx.chat.id,
      { source: actualOutputPath },
      {
        caption: `📹 ${videoTitle}`,
        reply_to_message_id: ctx.message.message_id
      }
    );
    
    console.log(`[${new Date().toISOString()}] Video sent successfully`);
    
    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    
    // Show success message
    await ctx.reply(`✅ Video downloaded successfully!\n\nSend another link to download more.`, removeKeyboard());
    
    // Clean up temporary file
    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }
    
    // Clear user state
    userStates.delete(ctx.from.id);
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading YouTube video:`);
    console.error(`[${new Date().toISOString()}] Error type:`, error.constructor.name);
    console.error(`[${new Date().toISOString()}] Error message:`, error.message);
    
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'Sorry, I couldn\'t download the video. Please try selecting a different format.'
      );
    } catch (err) {
      ctx.reply('Sorry, I couldn\'t download the video. Please try selecting a different format.');
    }
    
    // Clear user state on error
    userStates.delete(ctx.from.id);
  }
}

// Helper function to create admin status keyboard (Reply Keyboard Markup)
function createAdminStatusKeyboard() {
  return Markup.keyboard([
    ['📊 Bot Status']
  ]).resize();
}

// Helper function to remove keyboard
function removeKeyboard() {
  return Markup.removeKeyboard();
}

// Start command handler
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  const lastName = ctx.from.last_name;
  
  // Add user to tracking and get user type
  const userType = addUser(userId, username, firstName, lastName);
  
  // Personalized greetings based on user type
  let greetingMessage = '';
  
  if (userType === 'admin') {
    const stats = getStats();
    greetingMessage = `👋 Hello Admin!\n\n📊 Bot Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nI can help you download:\n• Instagram videos and images\n• YouTube videos (with format selection)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, createAdminStatusKeyboard());
  } else if (userType === 'existing') {
    greetingMessage = `👋 Welcome back!\n\nI can help you download:\n• Instagram videos and images\n• YouTube videos (with format selection)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else if (userType === 'new') {
    greetingMessage = `👋 Welcome! Nice to meet you!\n\nI'm a bot that can help you download:\n• Instagram videos and images\n• YouTube videos (with format selection)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else {
    // Fallback for general users
    greetingMessage = `Hi! I can help you download:\n• Instagram videos and images\n• YouTube videos (with format selection)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  }
});


// Function to show statistics
function showStats(ctx) {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('This command is only available for administrators.');
    return;
  }
  
  const stats = getStats();
  const usersData = loadUsers();
  const recentUsers = usersData.users.slice(-10).reverse(); // Last 10 users
  
  let message = `📊 Bot Statistics\n\n`;
  message += `👥 Total Users: ${stats.totalUsers}\n`;
  message += `🆕 New Users Today: ${stats.newUsersToday}\n\n`;
  message += `📅 Last Reset Date: ${usersData.lastResetDate}\n\n`;
  
  if (recentUsers.length > 0) {
    message += `👤 Recent Users (last 10):\n`;
    recentUsers.forEach((user, index) => {
      const name = user.firstName || user.username || `User ${user.id}`;
      message += `${index + 1}. ${name} (ID: ${user.id})\n`;
    });
  }
  
  ctx.reply(message, createAdminStatusKeyboard());
}

// Stats command handler (admin only) - hidden from commands menu
// Admin can use the Reply Keyboard button "📊 Bot Status" instead
bot.command('stats', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  // Only show stats if user is admin
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('This command is only available for administrators.');
    return;
  }
  showStats(ctx);
});


// Message handler for Instagram links, YouTube links, and admin status button
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text;

  // Track user
  addUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  // Handle admin status button
  if (ADMIN_ID && userId === ADMIN_ID && messageText === '📊 Bot Status') {
    showStats(ctx);
    return;
  }

  // Check if user is selecting a YouTube format
  const userState = userStates.get(userId);
  if (userState && userState.type === 'youtube_format_selection') {
    const selectedFormat = userState.formats[messageText];
    if (selectedFormat) {
      // User selected a format, download the video
      await downloadYouTubeVideo(ctx, selectedFormat, userState.url, userState.title);
      return;
    } else {
      // Invalid selection, clear state and ask to try again
      userStates.delete(userId);
      ctx.reply('Invalid format selection. Please send a valid YouTube link to try again.', removeKeyboard());
      return;
    }
  }

  // Check if it's a YouTube URL pattern
  const youtubeUrlPattern = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/i;
  const isYouTubeLink = youtubeUrlPattern.test(messageText);

  // Check if it's an Instagram URL pattern (auto-detect)
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  const isInstagramLink = instagramUrlPattern.test(messageText);

  // Handle YouTube links - show format selection
  if (isYouTubeLink) {
    console.log(`[${new Date().toISOString()}] Auto-detected YouTube link from user ${userId}`);
    await showYouTubeFormats(ctx, messageText);
    return;
  }

  // Auto-detect and download Instagram links
  if (isInstagramLink) {
    console.log(`[${new Date().toISOString()}] Auto-detected Instagram link from user ${userId}`);
    // Download the media automatically
    await downloadInstagramMedia(ctx, messageText);
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Error in bot:', err);
  ctx.reply('An error occurred. Please try again.');
});

// Set empty bot commands menu so no commands are visible to users
// Stats is only available to admin via Reply Keyboard Markup button
bot.telegram.setMyCommands([]);

// Start the bot
bot.launch().then(async () => {
  console.log(`[${new Date().toISOString()}] Bot is running...`);
  console.log(`[${new Date().toISOString()}] yt-dlp binary path: ${ytDlpWrap.getBinaryPath()}`);
  
  // Greet admin with statistics
  if (ADMIN_ID) {
    try {
      const stats = getStats();
      const greetingMessage = `🤖 Bot Started Successfully!\n\n📊 Current Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nUse the "📊 Bot Status" button to view detailed statistics.`;
      await bot.telegram.sendMessage(ADMIN_ID, greetingMessage);
      console.log(`[${new Date().toISOString()}] Admin notification sent`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error sending admin notification:`, error);
    }
  } else {
    console.warn(`[${new Date().toISOString()}] ADMIN_ID not set - admin features will be disabled`);
  }
}).catch((err) => {
  console.error(`[${new Date().toISOString()}] Error starting bot:`, err);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

