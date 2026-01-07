require('dotenv').config();
const { Telegraf } = require('telegraf');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Admin ID from environment variable
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
  return { users: [], newUsersToday: 0, lastResetDate: new Date().toDateString(), totalDownloads: 0 };
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
function addUser(userId, username, firstName, lastName) {
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
    return true; // New user
  }
  
  // Update existing user info
  existingUser.username = username || existingUser.username;
  existingUser.firstName = firstName || existingUser.firstName;
  existingUser.lastName = lastName || existingUser.lastName;
  saveUsers(usersData);
  return false; // Existing user
}

// Increment download counter
function incrementDownloads() {
  const usersData = loadUsers();
  usersData.totalDownloads = (usersData.totalDownloads || 0) + 1;
  saveUsers(usersData);
}

// Get statistics
function getStats() {
  const usersData = loadUsers();
  return {
    totalUsers: usersData.users.length,
    newUsersToday: usersData.newUsersToday,
    totalDownloads: usersData.totalDownloads || 0
  };
}

// Find yt-dlp executable
function findYtDlpPath() {
  const possiblePaths = ['yt-dlp', 'yt-dlp.exe'];
  
  for (const ytDlpPath of possiblePaths) {
    try {
      const { execSync } = require('child_process');
      execSync(`${ytDlpPath} --version`, { stdio: 'ignore' });
      console.log(`[${new Date().toISOString()}] Found yt-dlp: ${ytDlpPath}`);
      return ytDlpPath;
    } catch (e) {
      // Continue to next path
    }
  }
  
  // Fallback: try python -m yt_dlp
  try {
    const { execSync } = require('child_process');
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

const ytDlpWrap = new YTDlpWrap(ytDlpPath === 'python' ? 'yt-dlp' : ytDlpPath);

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Download Instagram video
async function downloadInstagramVideo(ctx, messageText) {
  console.log(`[${new Date().toISOString()}] User ${ctx.from.id} sent: ${messageText}`);
  
  // Validate Instagram URL
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  
  if (!instagramUrlPattern.test(messageText)) {
    ctx.reply('Please send a valid Instagram link. Example: https://www.instagram.com/p/...');
    return;
  }

  // Send processing message
  const processingMsg = await ctx.reply('📥 Downloading video... Please wait.');

  try {
    // Generate unique filename
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `video_${timestamp}.mp4`);
    
    // Download video using yt-dlp
    const ytDlpArgs = [
      messageText,
      '-o', outputPath,
      '--no-playlist'
    ];
    
    // Add cookie support for Instagram
    const cookiesFile = process.env.INSTAGRAM_COOKIES_FILE;
    if (cookiesFile && fs.existsSync(cookiesFile)) {
      ytDlpArgs.push('--cookies', cookiesFile);
      console.log(`[${new Date().toISOString()}] Using cookies file: ${cookiesFile}`);
    } else {
      // Try browser cookies if configured, or try Firefox automatically
      const browserToUse = process.env.INSTAGRAM_BROWSER;
      if (browserToUse) {
        ytDlpArgs.push('--cookies-from-browser', browserToUse);
        console.log(`[${new Date().toISOString()}] Attempting to use cookies from browser: ${browserToUse}`);
      } else {
        // Try Firefox automatically (lighter than Chrome, common on servers)
        try {
          const { execSync } = require('child_process');
          execSync('which firefox', { stdio: 'ignore' });
          ytDlpArgs.push('--cookies-from-browser', 'firefox');
          console.log(`[${new Date().toISOString()}] Attempting to use cookies from Firefox`);
        } catch (e) {
          console.log(`[${new Date().toISOString()}] No cookies configured - trying without cookies`);
        }
      }
    }
    
    // Add user agent
    ytDlpArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await ytDlpWrap.execPromise(ytDlpArgs);
    
    // Check if file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file was not downloaded');
    }

    const stats = fs.statSync(outputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    // Telegram has a 50MB file size limit
    if (fileSizeInMB > 50) {
      fs.unlinkSync(outputPath);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        '❌ Video file is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
      );
      return;
    }

    // Send video file
    await ctx.telegram.sendVideo(
      ctx.chat.id,
      { source: outputPath },
      {
        reply_to_message_id: ctx.message.message_id
      }
    );

    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    
    // Increment download counter
    incrementDownloads();

    // Clean up temporary file
    try {
      fs.unlinkSync(outputPath);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading video:`, error.message);
    
    let errorMessage = '❌ Could not download the video. Please check the link and try again.';
    
    const errorText = (error.message || '').toLowerCase();
    const stderrText = (error.stderr || '').toLowerCase();
    const fullError = errorText + ' ' + stderrText;
    
    if (fullError.includes('could not find') && fullError.includes('cookies')) {
      errorMessage = '❌ Cookie configuration error. Please set INSTAGRAM_COOKIES_FILE in .env or remove INSTAGRAM_BROWSER if browser is not installed.';
    } else if (fullError.includes('login required') || fullError.includes('authentication')) {
      errorMessage = '❌ Instagram requires authentication. Please configure cookies (see COOKIES_GUIDE.md).';
    } else if (fullError.includes('not available') || fullError.includes('unavailable')) {
      errorMessage = '❌ This video is not available. It may have been deleted or is private.';
    } else if (fullError.includes('private') || fullError.includes('restricted')) {
      errorMessage = '❌ This video is private or restricted. Cookies may be required.';
    }
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        errorMessage
      );
    } catch (err) {
      ctx.reply(errorMessage);
    }
  }
}

// Start command - greet and ask for Instagram link
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  addUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  const greeting = '👋 Hi! I\'m an Instagram video downloader bot.\n\n📎 Please send me an Instagram link to download the video.';
  await ctx.reply(greeting);
});

// Status command for admin
bot.command('status', (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('❌ This command is only available for administrators.');
    return;
  }
  
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  const stats = getStats();
  const usersData = loadUsers();
  const recentUsers = usersData.users.slice(-10).reverse();
  
  let message = `📊 Bot Status\n\n`;
  message += `👥 Total Users: ${stats.totalUsers}\n`;
  message += `🆕 New Users Today: ${stats.newUsersToday}\n`;
  message += `📥 Total Downloads: ${stats.totalDownloads}\n`;
  message += `📅 Last Reset Date: ${usersData.lastResetDate}\n\n`;
  
  if (recentUsers.length > 0) {
    message += `👤 Recent Users (last 10):\n`;
    recentUsers.forEach((user, index) => {
      const name = user.firstName || user.username || `User ${user.id}`;
      message += `${index + 1}. ${name} (ID: ${user.id})\n`;
    });
  }
  
  ctx.reply(message);
});

// Handle text messages - auto-detect Instagram links
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text;
  
  addUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  // Check if it's an Instagram URL
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  if (instagramUrlPattern.test(messageText)) {
    await downloadInstagramVideo(ctx, messageText);
  } else {
    ctx.reply('Please send me a valid Instagram link. Example: https://www.instagram.com/p/...');
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Error in bot:', err);
  ctx.reply('An error occurred. Please try again.');
});

// Set up bot commands
bot.telegram.setMyCommands([
  { command: 'status', description: 'View bot status (admin only)' }
]);

// Start the bot
bot.launch().then(async () => {
  console.log(`[${new Date().toISOString()}] Bot is running...`);
  
  // Greet admin when bot starts
  if (ADMIN_ID) {
    try {
      const stats = getStats();
      const greetingMessage = `🤖 Bot Started Successfully!\n\n📊 Current Status:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n• Total Downloads: ${stats.totalDownloads}\n\nUse /status to view detailed statistics.`;
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
