# How to Export Instagram Cookies for RVBot

Instagram now requires authentication for most video downloads. To fix this, you need to export cookies from your browser.

## Method 1: Using Browser Extension (Easiest)

1. Install "Get cookies.txt LOCALLY" extension in Chrome/Edge:
   - Chrome: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
   - Edge: https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/pdgbckjfkgjpfhcmebpebdkffjbnjknf

2. Go to https://www.instagram.com and make sure you're logged in

3. Click the extension icon → Select "instagram.com" → Click "Export"

4. Save the file as `cookies.txt`

5. Upload `cookies.txt` to your server at `/var/www/rvbot/cookies.txt`

6. Add to `/var/www/rvbot/.env`:
   ```
   INSTAGRAM_COOKIES_FILE=/var/www/rvbot/cookies.txt
   ```

7. Restart the bot: `pm2 restart rvbot`

## Method 2: Using yt-dlp on Your Local Machine

1. On your local computer (where you have a browser), run:
   ```bash
   yt-dlp --cookies-from-browser chrome --cookies cookies.txt "https://www.instagram.com"
   ```

2. This will create `cookies.txt` file

3. Upload it to your server and configure as above

## Method 3: Manual Export (Advanced)

1. Open browser DevTools (F12)
2. Go to Application/Storage → Cookies → https://www.instagram.com
3. Export cookies in Netscape format
4. Save as `cookies.txt` and upload to server

## Notes

- Cookies expire after some time, so you may need to re-export them periodically
- Keep cookies.txt secure - it contains your Instagram session
- Don't commit cookies.txt to git (it's already in .gitignore)
