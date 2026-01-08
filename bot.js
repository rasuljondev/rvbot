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

    // Download media using yt-dlp - remove format selection to let yt-dlp auto-detect
    // This works better for Instagram images and videos
    const ytDlpArgs = [
      messageText,
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
    
    const stdout = await ytDlpWrap.execPromise(ytDlpArgs);
    
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
    greetingMessage = `👋 Hello Admin!\n\n📊 Bot Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nPlease share an Instagram link to download.`;
    await ctx.reply(greetingMessage, createAdminStatusKeyboard());
  } else if (userType === 'existing') {
    greetingMessage = `👋 Welcome back!\n\nI can help you download Instagram videos and images.\n\nPlease share an Instagram link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else if (userType === 'new') {
    greetingMessage = `👋 Welcome! Nice to meet you!\n\nI'm a bot that can help you download Instagram videos and images.\n\nPlease share an Instagram link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else {
    // Fallback for general users
    greetingMessage = `Hi! I can help you download Instagram videos and images.\n\nPlease share an Instagram link to download.`;
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


// Message handler for Instagram links and admin status button
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

  // Check if it's an Instagram URL pattern (auto-detect)
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
  const isInstagramLink = instagramUrlPattern.test(messageText);

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

