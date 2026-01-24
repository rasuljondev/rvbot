require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Start HTTP server IMMEDIATELY for Render/Railway port detection
// This must be done before any other code that might fail
console.log(`[${new Date().toISOString()}] 🚀 Starting MusicBot...`);
const PORT = process.env.PORT || 3000;
console.log(`[${new Date().toISOString()}] Using PORT: ${PORT}`);
let botRunning = false;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: botRunning ? 'running' : 'starting',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MusicBot is running! Send /start to your bot on Telegram.');
  }
});

// Start server immediately - don't wait for anything
console.log(`[${new Date().toISOString()}] Starting HTTP server on port ${PORT}...`);
try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[${new Date().toISOString()}] ✅ HTTP server listening on 0.0.0.0:${PORT}`);
    console.log(`[${new Date().toISOString()}] Health check: http://0.0.0.0:${PORT}/health`);

    // Start the bot AFTER the server is listening
    // This ensures Render can detect the port before the bot starts
    setTimeout(() => {
      if (typeof launchBotWithRetry === 'function') {
        launchBotWithRetry().then(() => {
          botRunning = true;
          console.log(`[${new Date().toISOString()}] Bot startup completed`);
        }).catch((err) => {
          console.error(`[${new Date().toISOString()}] Bot startup failed:`, err);
          // Don't exit - keep the HTTP server running so Render knows the service is up
        });
      } else {
        console.error(`[${new Date().toISOString()}] launchBotWithRetry function not found`);
      }
    }, 1000); // Small delay to ensure server is fully ready
  });
} catch (err) {
  console.error(`[${new Date().toISOString()}] ❌ Failed to start HTTP server:`, err);
  process.exit(1);
}

server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] ❌ HTTP server error:`, err);
  process.exit(1);
});

// Create a custom HTTPS agent with longer timeout and keep-alive
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  timeout: 120000, // 120 seconds timeout
  // Connection timeout
  connectTimeout: 30000, // 30 seconds to establish connection
  // Allow self-signed certificates if needed (for corporate proxies)
  rejectUnauthorized: true
});

// Get bot token from environment (support both BOT_TOKEN and TELEGRAM_BOT_TOKEN)
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error(`[${new Date().toISOString()}] ERROR: BOT_TOKEN or TELEGRAM_BOT_TOKEN not set in environment variables`);
  process.exit(1);
}

// Configure bot with timeout and retry settings
const bot = new Telegraf(BOT_TOKEN, {
  telegram: {
    // Set timeout for API requests (300 seconds - 5 minutes for large file uploads)
    timeout: 300000,
    // Retry configuration
    retryAfter: 3000, // Wait 3 seconds before retry
    // Maximum number of retries
    maxRetries: 5, // Increased retries
    // Use custom HTTPS agent for better connection handling
    agent: httpsAgent,
    apiRoot: 'https://api.telegram.org',
    // Additional options
    webhookReply: false // Use polling, not webhooks
  }
});

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

  // First, check virtualenv bin directory (for Render and other venv environments)
  if (process.env.VIRTUAL_ENV) {
    const venvBin = path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp');
    if (fs.existsSync(venvBin)) {
      try {
        execSync(`"${venvBin}" --version`, { stdio: 'ignore' });
        console.log(`[${new Date().toISOString()}] Found yt-dlp in virtualenv: ${venvBin}`);
        return venvBin;
      } catch (e) {
        // File exists but not executable, continue
      }
    }
  }

  // Second, check bin directory in project root (for Render builds)
  const projectBinDir = path.join(__dirname, 'bin');
  const ytDlpInBin = path.join(projectBinDir, 'yt-dlp');
  if (fs.existsSync(ytDlpInBin)) {
    try {
      // Try to make it executable if it's not
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(ytDlpInBin, 0o755);
        } catch (chmodErr) {
          // Ignore chmod errors
        }
      }
      // Use absolute path without quotes for Linux
      const execPath = process.platform === 'win32' ? `"${ytDlpInBin}"` : ytDlpInBin;
      execSync(`${execPath} --version`, { stdio: 'ignore', timeout: 5000 });
      console.log(`[${new Date().toISOString()}] Found yt-dlp in bin directory: ${ytDlpInBin}`);
      return ytDlpInBin;
    } catch (e) {
      console.log(`[${new Date().toISOString()}] yt-dlp exists at ${ytDlpInBin} but execution failed: ${e.message}`);
      // File exists but not executable, continue
    }
  }

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
        } catch (e) { }
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

  // Fallback: try python -m yt_dlp or python3 -m yt_dlp
  try {
    execSync('python3 -m yt_dlp --version', { stdio: 'ignore' });
    console.log(`[${new Date().toISOString()}] Using python3 -m yt_dlp`);
    return 'python3';
  } catch (e) {
    // python3 not found, try python
    try {
      execSync('python -m yt_dlp --version', { stdio: 'ignore' });
      console.log(`[${new Date().toISOString()}] Using python -m yt_dlp`);
      return 'python';
    } catch (e2) {
      // Not found
    }
  }

  return null;
}

// Add common installation paths to PATH (for Render and other cloud platforms)
// IMPORTANT: Do this BEFORE calling findYtDlpPath() so it can find yt-dlp in these locations
if (process.env.HOME) {
  const localBin = path.join(process.env.HOME, '.local', 'bin');
  if (fs.existsSync(localBin) && !process.env.PATH.includes(localBin)) {
    process.env.PATH = `${localBin}:${process.env.PATH}`;
  }
}

// Add virtualenv bin directory to PATH (for Render and other platforms using venv)
if (process.env.VIRTUAL_ENV) {
  const venvBin = path.join(process.env.VIRTUAL_ENV, 'bin');
  if (fs.existsSync(venvBin) && !process.env.PATH.includes(venvBin)) {
    process.env.PATH = `${venvBin}:${process.env.PATH}`;
    console.log(`[${new Date().toISOString()}] Added virtualenv bin to PATH: ${venvBin}`);
  }
}

// Add bin directory in project root (for Render builds)
const projectBinDir = path.join(__dirname, 'bin');
if (fs.existsSync(projectBinDir) && !process.env.PATH.includes(projectBinDir)) {
  process.env.PATH = `${projectBinDir}:${process.env.PATH}`;
  // Also check for yt-dlp in this directory
  const ytDlpInBin = path.join(projectBinDir, 'yt-dlp');
  if (fs.existsSync(ytDlpInBin)) {
    console.log(`[${new Date().toISOString()}] Found yt-dlp in bin directory: ${ytDlpInBin}`);
  }
}

// Debug: Log environment info
console.log(`[${new Date().toISOString()}] Current working directory: ${process.cwd()}`);
console.log(`[${new Date().toISOString()}] __dirname: ${__dirname}`);
console.log(`[${new Date().toISOString()}] VIRTUAL_ENV: ${process.env.VIRTUAL_ENV || 'not set'}`);
console.log(`[${new Date().toISOString()}] PATH: ${process.env.PATH}`);

// Check if bin directory exists
const debugBinDir = path.join(__dirname, 'bin');
console.log(`[${new Date().toISOString()}] Checking bin directory: ${debugBinDir}`);
if (fs.existsSync(debugBinDir)) {
  const files = fs.readdirSync(debugBinDir);
  console.log(`[${new Date().toISOString()}] Files in bin directory: ${files.join(', ')}`);
  const ytDlpInBin = path.join(debugBinDir, 'yt-dlp');
  if (fs.existsSync(ytDlpInBin)) {
    const stats = fs.statSync(ytDlpInBin);
    console.log(`[${new Date().toISOString()}] yt-dlp file exists: ${ytDlpInBin}, size: ${stats.size}, mode: ${stats.mode.toString(8)}`);
  } else {
    console.log(`[${new Date().toISOString()}] yt-dlp file NOT found at: ${ytDlpInBin}`);
  }
} else {
  console.log(`[${new Date().toISOString()}] bin directory does NOT exist: ${debugBinDir}`);
}

const ytDlpPath = findYtDlpPath();
if (!ytDlpPath) {
  console.error(`[${new Date().toISOString()}] yt-dlp not found. Please install it: pip install yt-dlp`);
  console.error(`[${new Date().toISOString()}] On Render: The build script should install it automatically.`);
  console.error(`[${new Date().toISOString()}] If this persists, check that Python and pip are available.`);
  console.error(`[${new Date().toISOString()}] Searched locations:`);
  console.error(`[${new Date().toISOString()}]   - Virtualenv: ${process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp') : 'N/A'}`);
  console.error(`[${new Date().toISOString()}]   - Project bin: ${debugBinDir}/yt-dlp`);
  console.error(`[${new Date().toISOString()}]   - PATH: ${process.env.PATH}`);
  process.exit(1);
}

// If we found python/python3, try to find the actual binary in virtualenv first
if ((ytDlpPath === 'python' || ytDlpPath === 'python3') && process.env.VIRTUAL_ENV) {
  const venvYtDlp = path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp');
  if (fs.existsSync(venvYtDlp)) {
    try {
      const { execSync } = require('child_process');
      execSync(`${venvYtDlp} --version`, { stdio: 'ignore', timeout: 5000 });
      console.log(`[${new Date().toISOString()}] Found yt-dlp binary in virtualenv: ${venvYtDlp}`);
      ytDlpPath = venvYtDlp;
    } catch (e) {
      // Keep python command as fallback
    }
  }
}

const finalYtDlpPath = ytDlpPath;
console.log(`[${new Date().toISOString()}] Using yt-dlp at: ${finalYtDlpPath}`);

// Create yt-dlp-wrap instance
// Note: yt-dlp-wrap expects a binary path, not a python command
// If we have python command, we'll need to handle it differently
const ytDlpWrap = new YTDlpWrap(finalYtDlpPath, {
  timeout: 600000 // 10 minutes timeout for yt-dlp operations
});


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
    await safeReply(ctx, 'Please send a valid Instagram link. Example: https://www.instagram.com/p/...');
    return;
  }

  console.log(`[${new Date().toISOString()}] Valid Instagram URL received: ${messageText}`);

  // Send processing message
  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  // Generic URL detection (if not YT/Insta) - defined early but used in handler
  // We'll handle this in the main handler logic, but let's check here if we need specific generic logic inside this function
  // Actually, this function is specific to Instagram. We need a separate function for Generic.

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
      if (processingMsg && processingMsg.message_id) {
        try {
          await safeTelegramCall(
            ctx.telegram.editMessageText.bind(ctx.telegram),
            ctx.chat.id,
            processingMsg.message_id,
            null,
            'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
          );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending media to user...`);

    // Send media file based on type
    // Use longer timeout for larger files
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small

    if (actualIsImage) {
      await safeTelegramCall(
        ctx.telegram.sendPhoto.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          reply_to_message_id: ctx.message.message_id
        }
      );
      console.log(`[${new Date().toISOString()}] Image sent successfully`);
    } else {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          reply_to_message_id: ctx.message.message_id
        }
      );
      console.log(`[${new Date().toISOString()}] Video sent successfully`);
    }

    // Delete processing message
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    // Show success message
    const mediaType = actualIsImage ? 'Image' : 'Video';
    await safeReply(ctx, `✅ ${mediaType} downloaded successfully!\n\nSend another Instagram link to download more.`);

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
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.'
        );
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error editing message:`, err);
        await safeReply(ctx, 'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.');
    }
  }
}

// Helper function to download generic media from any URL
async function downloadGenericMedia(ctx, url) {
  console.log(`[${new Date().toISOString()}] Downloading generic media from: ${url}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `generic_media_${timestamp}.%(ext)s`);

    const ytDlpArgs = [
      url,
      '-o', outputPath,
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    console.log(`[${new Date().toISOString()}] Running yt-dlp for generic URL with args:`, ytDlpArgs);

    await ytDlpWrap.execPromise(ytDlpArgs);

    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`generic_media_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('Media file was not downloaded for generic URL');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] Generic file downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
          await safeTelegramCall(
            ctx.telegram.editMessageText.bind(ctx.telegram),
            ctx.chat.id,
            processingMsg.message_id,
            null,
            'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
          );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending generic media to user...`);
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small

    const fileExtension = path.extname(actualOutputPath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendPhoto.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp4', '.webm', '.mkv', '.avi'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp3', '.ogg', '.wav', '.flac'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      // Fallback to document for unknown types
      await safeTelegramCall(
        ctx.telegram.sendDocument.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    await safeReply(ctx, `✅ Media downloaded successfully!\n\nSend another link to download more.`);

    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading generic media:`, error);
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.'
        );
      } catch (err) {
        await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
    }
  }
}


// Helper function to get YouTube formats and show them as buttons with Rich UI
async function showYouTubeFormats(ctx, youtubeUrl) {
  console.log(`[${new Date().toISOString()}] Getting YouTube formats for: ${youtubeUrl}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Getting video info... Please wait.');
  } catch (error) {
    processingMsg = null;
  }

  try {
    const youtubeCookiesPath = path.join(__dirname, 'youtube_cookies.txt');
    const hasCookies = fs.existsSync(youtubeCookiesPath);

    // Get full video info AND formats in one go using JSON output
    const infoArgs = [
      youtubeUrl,
      '--dump-json', // Get all info as JSON
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player_client=android'
    ];

    if (hasCookies) {
      infoArgs.push('--cookies', youtubeCookiesPath);
    }

    console.log(`[${new Date().toISOString()}] Running yt-dlp to get video info...`);

    // Increase timeout for info fetching
    const output = await Promise.race([
      ytDlpWrap.execPromise(infoArgs),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 60000))
    ]);

    const videoInfo = JSON.parse(output);
    const videoTitle = videoInfo.title || 'YouTube Video';
    const channelName = videoInfo.uploader || 'Unknown Channel';
    const thumbnail = videoInfo.thumbnail || '';
    const duration = videoInfo.duration_string || '??:??';

    // Process formats to find sizes
    // We want to map: Quality -> {size, format_id}
    const formatMap = new Map(); // quality -> {size, format_id}
    const allFormats = videoInfo.formats || [];

    // Helper to format bytes
    const formatBytes = (bytes) => {
      if (!bytes) return 'Unknown';
      const mb = bytes / (1024 * 1024);
      return `${mb.toFixed(1)}MB`;
    };

    // qualities we care about
    const targetQualities = ['1080p', '720p', '480p', '360p', '240p', '144p'];

    // Find roughly the file size for each target quality
    // Note: YouTube often separates video/audio. The 'filesize' in format list might be video-only.
    // We need to estimate total size (video + audio ~128k).
    // Or, simpler: Just show the video stream size if that's what we have, or best guess.

    // Let's create our "virtual" formats list like before, but try to find real sizes
    const displayFormats = [];

    for (const quality of targetQualities) {
      // Find a format that matches this quality (height)
      const height = parseInt(quality);
      const format = allFormats.find(f => f.height === height && f.ext === 'mp4');

      let sizeStr = 'Unknown';
      if (format) {
        // If we have a direct format, use its size
        // If it's video-only, add ~5-10MB for audio or calculate proper
        let size = format.filesize || format.filesize_approx;
        if (size) {
          // Add 10% overhead for audio/muxing if it's video only (usually distinct format codes like 137, 136)
          // This is a rough heuristic for the UI
          if (format.acodec === 'none') {
            size = size * 1.1;
          }
          sizeStr = formatBytes(size);
        }
      }

      // Only Add to list if we strictly found a matching format entry in the JSON
      // OR we can just always show the option (yt-dlp will convert if needed)
      // To be safe and show REAL info: only show if we found a format source
      if (format) {
        displayFormats.push({
          quality: quality,
          size: sizeStr,
          id: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`
        });
      }
    }

    // If no formats found (weird), fallback to standard list
    if (displayFormats.length === 0) {
      targetQualities.slice(0, 4).forEach(q => {
        displayFormats.push({ quality: q, size: 'Unknown', id: `bestvideo[height<=${parseInt(q)}]+bestaudio/best[height<=${parseInt(q)}]` });
      });
    }

    // Construct Caption
    let caption = `📺 <b>${videoTitle}</b>\n`;
    caption += `👤 ${channelName}\n`;
    caption += `⏱ ${duration}\n\n`;
    caption += `<b>Available Formats:</b>\n`;

    const buttons = [];
    let currentRow = [];

    displayFormats.forEach((f) => {
      const icon = parseInt(f.quality) >= 720 ? '⚡' : '📹';
      caption += `${icon} <b>${f.quality}</b>: ${f.size}\n`;

      // Add button
      currentRow.push(Markup.button.text(`${icon} ${f.quality}`));
      if (currentRow.length === 2) {
        buttons.push(currentRow);
        currentRow = [];
      }
    });

    if (currentRow.length > 0) buttons.push(currentRow);

    // Add Audio Option
    caption += `\n🎧 <b>Audio (MP3)</b>: Available`;
    buttons.push([Markup.button.text('🎧 Audio Only (MP3)')]);

    // Store user state
    const formatMapping = {};
    displayFormats.forEach(f => {
      formatMapping[`${parseInt(f.quality) >= 720 ? '⚡' : '📹'} ${f.quality}`] = f.id;
    });
    formatMapping['🎧 Audio Only (MP3)'] = 'audio_mp3';

    userStates.set(ctx.from.id, {
      type: 'youtube_format_selection',
      url: youtubeUrl,
      formats: formatMapping,
      title: videoTitle
    });

    // Delete processing message
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (e) { }

    // Send Photo with Caption and Buttons
    // Use channel logo if video thumb fails? just use thumb.
    if (thumbnail) {
      await ctx.replyWithPhoto(thumbnail, {
        caption: caption,
        parse_mode: 'HTML',
        ...Markup.keyboard(buttons).resize().oneTime()
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: 'HTML',
        ...Markup.keyboard(buttons).resize().oneTime()
      });
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting YouTube formats:`, error);

    // Check if it's a bot detection error or DPAPI error
    const errorMessage = error.message || '';
    const errorStderr = error.stderr || '';
    const isBotDetection = errorMessage.includes('Sign in to confirm') ||
      errorMessage.includes('not a bot') ||
      errorStderr.includes('Sign in to confirm') ||
      errorStderr.includes('not a bot');
    const isDPAPIError = errorMessage.includes('Failed to decrypt with DPAPI') ||
      errorStderr.includes('Failed to decrypt with DPAPI');

    let errorMsg = 'Sorry, I couldn\'t get the available formats. ';
    if (isDPAPIError) {
      errorMsg += '❌ Cookie decryption failed. Please export YouTube cookies manually:\n\n';
      errorMsg += '1. Install browser extension: "Get cookies.txt LOCALLY"\n';
      errorMsg += '2. Go to youtube.com and export cookies\n';
      errorMsg += '3. Save as "youtube_cookies.txt" in the bot folder\n\n';
      errorMsg += 'Or try downloading without format selection.';
    } else if (isBotDetection) {
      errorMsg += '❌ YouTube is blocking requests. You need to add YouTube cookies:\n\n';
      errorMsg += '1. Export cookies from your browser\n';
      errorMsg += '2. Save as "youtube_cookies.txt" in the bot folder\n\n';
      errorMsg += 'Or try downloading without format selection.';
    } else {
      errorMsg += 'Please check if the link is valid.';
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          ctx.chat.id,
          processingMsg.message_id,
          null,
          errorMsg
        );
      } catch (err) {
        await safeReply(ctx, errorMsg);
      }
    } else {
      await safeReply(ctx, errorMsg);
    }

    // If bot detection, try direct download as fallback
    if (isBotDetection) {
      console.log(`[${new Date().toISOString()}] YouTube bot detection detected, attempting direct download...`);
      try {
        await downloadYouTubeVideo(ctx, 'best', youtubeUrl, 'YouTube Video');
      } catch (downloadError) {
        console.error(`[${new Date().toISOString()}] Direct download also failed:`, downloadError.message);
      }
    }
  }
}

// Helper function to download YouTube video with selected format
async function downloadYouTubeVideo(ctx, formatId, youtubeUrl, videoTitle) {
  console.log(`[${new Date().toISOString()}] Downloading YouTube video with format: ${formatId}`);

  const processingMsg = await ctx.reply('Downloading video... Please wait.');

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `youtube_${timestamp}.mp4`);

    // Check for YouTube cookies
    const youtubeCookiesPath = path.join(__dirname, 'youtube_cookies.txt');
    const hasCookies = fs.existsSync(youtubeCookiesPath);

    // Use better format selector - if formatId is 'best', don't specify format and let yt-dlp auto-select
    const ytDlpArgs = [
      youtubeUrl,
      '-o', outputPath,
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player_client=android' // Use Android client to bypass bot detection
    ];

    // Audio Only Logic
    if (formatId === 'audio_mp3') {
      console.log(`[${new Date().toISOString()}] Audio mode: ${videoTitle}`);
      // Change extension to .mp3
      ytDlpArgs[2] = outputPath.replace('.mp4', '.%(ext)s');

      // Remove merge-output-format if it was added (it's not yet, but good to be explicit)
      // For audio, we don't want --merge-output-format mp4
      // The original code had it here: '--merge-output-format', 'mp4',
      // So we need to ensure it's not present for audio.
      // The current ytDlpArgs construction doesn't add it until later, so no removal needed here.

      // Add extract audio args
      ytDlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      // Video mode
      // Add format selector (if not 'best')
      if (formatId && formatId !== 'best') {
        ytDlpArgs.splice(1, 0, '-f', formatId);
      }
      // Force MP4 container for better phone compatibility for video
      ytDlpArgs.push('--merge-output-format', 'mp4');
    }

    // Add cookies if available
    if (hasCookies) {
      ytDlpArgs.push('--cookies', youtubeCookiesPath);
      console.log(`[${new Date().toISOString()}] Using YouTube cookies file: ${youtubeCookiesPath}`);
    } else {
      console.log(`[${new Date().toISOString()}] No YouTube cookies file found. YouTube may block requests.`);
    }

    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);

    // Increase timeout for YouTube downloads (10 minutes for large videos)
    const stdout = await Promise.race([
      ytDlpWrap.execPromise(ytDlpArgs),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
      )
    ]);
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
      if (processingMsg && processingMsg.message_id) {
        try {
          await safeTelegramCall(
            ctx.telegram.editMessageText.bind(ctx.telegram),
            ctx.chat.id,
            processingMsg.message_id,
            null,
            'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
          );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending video to user...`);
    console.log(`[${new Date().toISOString()}] Video size: ${fileSizeInMB.toFixed(2)} MB - this may take a while to upload...`);

    // Send video file using safe wrapper with longer timeout for large files
    // Large files need more time to upload - use 5 minutes for files over 5MB
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small
    console.log(`[${new Date().toISOString()}] Using upload timeout: ${uploadTimeout / 1000} seconds`);


    // Send video or audio
    if (formatId === 'audio_mp3' || downloadedFile.endsWith('.mp3')) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          title: videoTitle,
          caption: `🎧 ${videoTitle}`,
          reply_to_message_id: ctx.message.message_id
        }
      );
    } else {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          caption: `📹 ${videoTitle}`,
          reply_to_message_id: ctx.message.message_id
        }
      );
    }

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

// Helper function to download generic media
async function downloadGenericMedia(ctx, url) {
  console.log(`[${new Date().toISOString()}] Downloading generic media from: ${url}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `generic_media_${timestamp}.%(ext)s`);

    const ytDlpArgs = [
      url,
      '-o', outputPath,
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    console.log(`[${new Date().toISOString()}] Running yt-dlp for generic URL with args:`, ytDlpArgs);

    await ytDlpWrap.execPromise(ytDlpArgs);

    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`generic_media_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('Media file was not downloaded for generic URL');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] Generic file downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
          await safeTelegramCall(
            ctx.telegram.editMessageText.bind(ctx.telegram),
            ctx.chat.id,
            processingMsg.message_id,
            null,
            'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
          );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending generic media to user...`);
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small

    const fileExtension = path.extname(actualOutputPath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendPhoto.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp4', '.webm', '.mkv', '.avi'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp3', '.ogg', '.wav', '.flac'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      // Fallback to document for unknown types
      await safeTelegramCall(
        ctx.telegram.sendDocument.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    await safeReply(ctx, `✅ Media downloaded successfully!\n\nSend another link to download more.`);

    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading generic media:`, error);
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.'
        );
      } catch (err) {
        await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
    }
  }
}

// Helper function to safely send messages with retry and timeout handling
async function safeReply(ctx, message, extra = {}) {
  const maxRetries = 5;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create a promise with timeout
      const replyPromise = ctx.reply(message, extra);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Reply timeout after 120 seconds')), 120000)
      );

      await Promise.race([replyPromise, timeoutPromise]);
      return true;
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' ||
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT') ||
        error.errno === 'ETIMEDOUT';

      console.warn(`[${new Date().toISOString()}] Failed to send message (attempt ${attempt}/${maxRetries}):`, error.message);

      // If it's a timeout/connection error and we have retries left, wait and retry
      if (attempt < maxRetries && isTimeout) {
        const waitTime = Math.min(3000 * attempt, 15000); // Exponential backoff, max 15 seconds
        console.log(`[${new Date().toISOString()}] Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If it's not a timeout or we're out of retries, break
      if (!isTimeout) {
        break; // Non-timeout errors don't retry
      }
    }
  }

  console.error(`[${new Date().toISOString()}] Failed to send message after ${maxRetries} attempts:`, lastError);
  return false;
}

// Helper function to safely send Telegram API calls with retry and timeout handling
// Usage: safeTelegramCall(method, timeoutMs, ...args) or safeTelegramCall(method, ...args) with default timeout
async function safeTelegramCall(telegramMethod, timeoutOrFirstArg, ...restArgs) {
  // Check if second argument is a number (timeout) or first arg
  let timeoutMs = 300000; // Default 5 minutes
  let args;

  if (typeof timeoutOrFirstArg === 'number') {
    // timeoutMs provided as second argument
    timeoutMs = timeoutOrFirstArg;
    args = restArgs;
  } else {
    // No timeout provided, use default and treat timeoutOrFirstArg as first arg
    args = [timeoutOrFirstArg, ...restArgs];
  }

  const maxRetries = 3; // Reduced retries for file uploads (they take long)
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create a promise with timeout
      const callPromise = telegramMethod(...args);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`API call timeout after ${timeoutMs / 1000} seconds`)), timeoutMs)
      );

      return await Promise.race([callPromise, timeoutPromise]);
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' ||
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT') ||
        error.errno === 'ETIMEDOUT';

      console.warn(`[${new Date().toISOString()}] Failed Telegram API call (attempt ${attempt}/${maxRetries}):`, error.message);

      // If it's a timeout/connection error and we have retries left, wait and retry
      if (attempt < maxRetries && isTimeout) {
        const waitTime = Math.min(3000 * attempt, 15000); // Exponential backoff, max 15 seconds
        console.log(`[${new Date().toISOString()}] Retrying API call in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If it's not a timeout or we're out of retries, break
      if (!isTimeout) {
        break; // Non-timeout errors don't retry
      }
    }
  }

  console.error(`[${new Date().toISOString()}] Failed Telegram API call after ${maxRetries} attempts:`, lastError);
  throw lastError;
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
  try {
    // Safety checks
    if (!ctx || !ctx.message || !ctx.message.text) {
      console.warn(`[${new Date().toISOString()}] Received text update without message text`);
      return;
    }

    if (!ctx.from || !ctx.from.id) {
      console.warn(`[${new Date().toISOString()}] Received text update without user info`);
      return;
    }

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
      return;
    }

    // Generic URL detection (if not YT/Insta)
    const isUrl = /^https?:\/\//i.test(messageText);
    if (isUrl) {
      console.log(`[${new Date().toISOString()}] Detected generic URL from user ${userId}`);
      await downloadGenericMedia(ctx, messageText);
      return;
    }

    // Search functionality (if text is not a URL and not a command)
    if (messageText && !messageText.startsWith('/') && messageText.length > 2) {
      console.log(`[${new Date().toISOString()}] Treating as search query: ${messageText}`);
      const searchUrl = `ytsearch1:${messageText}`;
      await showYouTubeFormats(ctx, searchUrl);
      return;
    }

    // If message is not a link and not a command, provide helpful message
    // Only respond if it looks like they might be trying to send a link
    if (messageText && messageText.length > 10 && !messageText.startsWith('/')) {
      await ctx.reply('Please send a valid Instagram or YouTube link to download media.\n\nExamples:\n• Instagram: https://www.instagram.com/p/...\n• YouTube: https://www.youtube.com/watch?v=...');
    }
  } catch (error) {
    // Log error but don't let it crash the bot
    console.error(`[${new Date().toISOString()}] Error in text message handler:`, error);
    console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);
    // Error will be caught by bot.catch() handler
    throw error;
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`[${new Date().toISOString()}] ========== BOT ERROR ==========`);
  console.error(`[${new Date().toISOString()}] Error type:`, err.constructor.name);
  console.error(`[${new Date().toISOString()}] Error message:`, err.message);
  console.error(`[${new Date().toISOString()}] Error stack:`, err.stack);
  if (ctx) {
    console.error(`[${new Date().toISOString()}] User ID:`, ctx.from?.id);
    console.error(`[${new Date().toISOString()}] Username:`, ctx.from?.username);
    console.error(`[${new Date().toISOString()}] Chat ID:`, ctx.chat?.id);
    console.error(`[${new Date().toISOString()}] Message text:`, ctx.message?.text);
    console.error(`[${new Date().toISOString()}] Update type:`, ctx.updateType);
  }
  console.error(`[${new Date().toISOString()}] ====================================`);

  // Try to send a more helpful error message
  try {
    if (ctx && ctx.reply) {
      ctx.reply('An error occurred. Please try again. If the problem persists, make sure you\'re sending a valid Instagram or YouTube link.');
    }
  } catch (replyError) {
    console.error(`[${new Date().toISOString()}] Failed to send error message:`, replyError);
  }
});

// Retry function for bot launch
async function launchBotWithRetry(maxRetries = 5, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] Attempting to start bot (attempt ${attempt}/${maxRetries})...`);
      await bot.launch();
      console.log(`[${new Date().toISOString()}] Bot is running...`);
      console.log(`[${new Date().toISOString()}] yt-dlp binary path: ${ytDlpWrap.getBinaryPath()}`);

      // Set empty bot commands menu so no commands are visible to users
      // Stats is only available to admin via Reply Keyboard Markup button
      try {
        await bot.telegram.setMyCommands([]);
        console.log(`[${new Date().toISOString()}] Bot commands menu configured`);
      } catch (cmdError) {
        console.warn(`[${new Date().toISOString()}] Warning: Could not set bot commands:`, cmdError.message);
      }

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
      return; // Success, exit function
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error starting bot (attempt ${attempt}/${maxRetries}):`, err.message);

      if (attempt < maxRetries) {
        console.log(`[${new Date().toISOString()}] Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Exponential backoff - increase delay for next retry
        delay = Math.min(delay * 1.5, 30000); // Max 30 seconds
      } else {
        console.error(`[${new Date().toISOString()}] Failed to start bot after ${maxRetries} attempts.`);
        console.error(`[${new Date().toISOString()}] Last error:`, err);
        // Don't exit - keep HTTP server running for Render port detection
        // The bot will be in a failed state, but the service will stay up
        console.error(`[${new Date().toISOString()}] Bot failed to start, but HTTP server will continue running`);
        throw err; // Re-throw so caller knows it failed
      }
    }
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Shutting down...`);
  server.close();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Shutting down...`);
  server.close();
  bot.stop('SIGTERM');
});

