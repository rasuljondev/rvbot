# RVBot - Telegram Instagram Video Downloader

A Telegram bot that can download and share Instagram videos.

## Features

- Introduction message when bot starts
- Inline keyboard with "Kino" and "Insta" commands
- Instagram video download functionality
- Automatic file cleanup after sending

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Telegram Bot Token (get it from [@BotFather](https://t.me/BotFather))

### Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

4. Edit `.env` and add your Telegram Bot Token:
```
TELEGRAM_BOT_TOKEN=your_actual_bot_token_here
```

5. Make sure `yt-dlp` is installed on your system:
   - **Windows**: Download from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) or install via pip: `pip install yt-dlp`
   - **Linux/Mac**: `pip install yt-dlp` or `brew install yt-dlp`

### Running the Bot

```bash
npm start
```

Or:
```bash
node bot.js
```

## Usage

1. Start a chat with your bot on Telegram
2. Send `/start` command
3. The bot will introduce itself and show command buttons
4. Click "Insta" button
5. Send an Instagram video link when prompted
6. The bot will download and send you the video

## Commands

- `/start` - Start the bot and see introduction message
- **Kino** button - Coming soon (placeholder)
- **Insta** button - Download Instagram videos

## Notes

- The bot can only download public Instagram videos
- Video files larger than 50MB cannot be sent (Telegram bot limitation)
- Temporary files are automatically cleaned up after sending

## Troubleshooting

- **Bot not responding**: Check if your bot token is correct in `.env`
- **Video download fails**: Make sure the Instagram link is valid and the video is public
- **yt-dlp not found**: Install yt-dlp on your system (see Installation section)

