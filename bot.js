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
  // Common Windows locations
  const possiblePaths = [
    'yt-dlp', // Try PATH first
    'yt-dlp.exe',
    path.join(process.env.APPDATA || '', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    'C:\\Python314\\Scripts\\yt-dlp.exe',
  ];

  for (const ytDlpPath of possiblePaths) {
    try {
      // Check if file exists (for full paths) or if command exists (for PATH)
      if (ytDlpPath.includes('\\') || ytDlpPath.includes('/')) {
        if (fs.existsSync(ytDlpPath)) {
          console.log(`[${new Date().toISOString()}] Found yt-dlp at: ${ytDlpPath}`);
          return ytDlpPath;
        }
      } else {
        // Try to execute it to see if it's in PATH
        const { execSync } = require('child_process');
        try {
          execSync(`${ytDlpPath} --version`, { stdio: 'ignore' });
          console.log(`[${new Date().toISOString()}] Found yt-dlp in PATH: ${ytDlpPath}`);
          return ytDlpPath;
        } catch (e) {
          // Not found, continue
        }
      }
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

// If we found the full path, use it; otherwise use the command name
const finalYtDlpPath = (ytDlpPath === 'python') 
  ? path.join(process.env.APPDATA || '', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe')
  : ytDlpPath;

console.log(`[${new Date().toISOString()}] Using yt-dlp at: ${finalYtDlpPath}`);
const ytDlpWrap = new YTDlpWrap(finalYtDlpPath);

// Store user states to track when they're waiting for Instagram links
const userStates = new Map();

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to download Instagram video (reusable)
async function downloadInstagramVideo(ctx, messageText) {
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
  const processingMsg = await ctx.reply('Downloading video... Please wait.');

  try {
    // Generate unique filename
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `video_${timestamp}.mp4`);
    
    console.log(`[${new Date().toISOString()}] Starting download...`);
    console.log(`[${new Date().toISOString()}] URL: ${messageText}`);
    console.log(`[${new Date().toISOString()}] Output path: ${outputPath}`);
    console.log(`[${new Date().toISOString()}] yt-dlp binary path: ${ytDlpWrap.getBinaryPath()}`);

    // Check if yt-dlp binary exists
    const binaryPath = ytDlpWrap.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      console.error(`[${new Date().toISOString()}] yt-dlp binary not found at: ${binaryPath}`);
      throw new Error(`yt-dlp binary not found at ${binaryPath}. Please install yt-dlp.`);
    }

    // Download video using yt-dlp
    const ytDlpArgs = [
      messageText,
      '-f', 'best',
      '-o', outputPath,
      '--no-playlist'
    ];
    
    // Add cookies file if it exists
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      ytDlpArgs.push('--cookies', cookiesPath);
      console.log(`[${new Date().toISOString()}] Using cookies file: ${cookiesPath}`);
    } else {
      console.log(`[${new Date().toISOString()}] No cookies configured - trying without cookies`);
    }
    
    // Add user-agent for better compatibility
    ytDlpArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);
    
    const stdout = await ytDlpWrap.execPromise(ytDlpArgs);
    
    console.log(`[${new Date().toISOString()}] yt-dlp stdout:`, stdout);
    console.log(`[${new Date().toISOString()}] Download completed, checking file...`);

    // Check if file exists and get its size
    if (!fs.existsSync(outputPath)) {
      console.error(`[${new Date().toISOString()}] Video file was not created at: ${outputPath}`);
      throw new Error('Video file was not downloaded');
    }

    const stats = fs.statSync(outputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    console.log(`[${new Date().toISOString()}] File downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    // Telegram has a 50MB file size limit for bots
    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(outputPath);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        'Video file is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
      );
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending video to user...`);
    
    // Send video file
    await ctx.telegram.sendVideo(
      ctx.chat.id,
      { source: outputPath },
      {
        reply_to_message_id: ctx.message.message_id
      }
    );

    console.log(`[${new Date().toISOString()}] Video sent successfully`);

    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

    // Show menu after successful download
    await ctx.reply('✅ Video downloaded successfully!\n\nUse /menu to access the menu again.', createMenuKeyboard(ctx.from.id));

    // Clean up temporary file
    try {
      fs.unlinkSync(outputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${outputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading video:`);
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
        'Sorry, I couldn\'t download the video. Please check if the link is valid and the video is public.'
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error editing message:`, err);
      ctx.reply('Sorry, I couldn\'t download the video. Please check if the link is valid and the video is public.');
    }
  }
}

// Helper function to create menu keyboard
function createMenuKeyboard(userId) {
  const buttons = [
    [Markup.button.callback('📥 Insta', 'menu_insta')],
    [Markup.button.callback('🎬 Kino', 'menu_kino')]
  ];
  
  // Add stats button for admin
  if (ADMIN_ID && userId === ADMIN_ID) {
    buttons.push([Markup.button.callback('📊 Statistics', 'menu_stats')]);
  }
  
  return Markup.inlineKeyboard(buttons);
}

// Start command handler
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  const lastName = ctx.from.last_name;
  
  // Add user to tracking
  const isNewUser = addUser(userId, username, firstName, lastName);
  
  // If admin, show special message
  if (ADMIN_ID && userId === ADMIN_ID) {
    const stats = getStats();
    const adminMessage = `👋 Welcome back, Admin!\n\n📊 Bot Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nUse /menu to access the menu anytime.`;
    await ctx.reply(adminMessage);
  }
  
  const introMessage = 'Hi! I can help you download Instagram videos and movies.\n\nUse the menu buttons below or send an Instagram link directly!';
  await ctx.reply(introMessage, createMenuKeyboard(userId));
});

// Menu command handler
bot.command('menu', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  const menuMessage = '📋 Main Menu\n\nSelect an option:';
  ctx.reply(menuMessage, createMenuKeyboard(ctx.from.id));
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
  
  ctx.reply(message, createMenuKeyboard(ctx.from.id));
}

// Stats command handler (admin only)
bot.command('stats', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  showStats(ctx);
});

// Menu button callback handlers
bot.action('menu_insta', (ctx) => {
  ctx.answerCbQuery();
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  // Set user state to waiting for Instagram link
  userStates.set(ctx.from.id, 'waiting_for_insta_link');
  ctx.reply('Please send me an Instagram video link:');
});

bot.action('menu_kino', (ctx) => {
  ctx.answerCbQuery();
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  ctx.reply('Coming soon', createMenuKeyboard(ctx.from.id));
});

bot.action('menu_stats', (ctx) => {
  ctx.answerCbQuery();
  
  // Check if user is admin
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('This command is only available for administrators.');
    return;
  }
  
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  showStats(ctx);
});

// Kino command handler
bot.command('kino', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  ctx.reply('Coming soon', createMenuKeyboard(ctx.from.id));
});

// Insta command handler
bot.command('insta', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  // Set user state to waiting for Instagram link
  userStates.set(ctx.from.id, 'waiting_for_insta_link');
  ctx.reply('Please send me an Instagram video link:');
});

// Message handler for Instagram links
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  const messageText = ctx.message.text;

  // Track user
  addUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  // Check if it's an Instagram URL pattern
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  const isInstagramLink = instagramUrlPattern.test(messageText);

  // If user used /insta command, they're waiting for a link
  if (userState === 'waiting_for_insta_link') {
    // Reset user state
    userStates.delete(userId);
    
    // Download the video
    await downloadInstagramVideo(ctx, messageText);
  } 
  // If user just shared an Instagram link directly (auto-detect)
  else if (isInstagramLink) {
    console.log(`[${new Date().toISOString()}] Auto-detected Instagram link from user ${userId}`);
    // Download the video automatically
    await downloadInstagramVideo(ctx, messageText);
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Error in bot:', err);
  ctx.reply('An error occurred. Please try again.');
});

// Set up bot commands menu (appears as buttons below message input)
bot.telegram.setMyCommands([
  { command: 'menu', description: 'Open main menu' },
  { command: 'insta', description: 'Download Instagram videos' },
  { command: 'kino', description: 'Download movies (coming soon)' },
  { command: 'stats', description: 'View bot statistics (admin only)' }
]);

// Start the bot
bot.launch().then(async () => {
  console.log(`[${new Date().toISOString()}] Bot is running...`);
  console.log(`[${new Date().toISOString()}] yt-dlp binary path: ${ytDlpWrap.getBinaryPath()}`);
  
  // Greet admin with statistics
  if (ADMIN_ID) {
    try {
      const stats = getStats();
      const greetingMessage = `🤖 Bot Started Successfully!\n\n📊 Current Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nUse /menu or /stats to view detailed statistics.`;
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

