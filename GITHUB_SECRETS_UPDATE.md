# GitHub Secrets Update Instructions

## ⚠️ IMPORTANT: Update Your GitHub Secrets

The connection timeout error is because your GitHub secrets need to be updated with the correct values.

### Steps to Fix:

1. Go to your GitHub repository: https://github.com/rasuljondev/rvbot
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Update these 4 secrets:

### Secret 1: VPS_HOST
- **Current value:** (Check what it is)
- **Should be:** `188.227.85.39`
- Click **Edit** and update to: `188.227.85.39`

### Secret 2: VPS_PORT
- **Current value:** (Check what it is)
- **Should be:** `22` (or leave empty if using default)
- Click **Edit** and update to: `22`

### Secret 3: VPS_USER
- **Current value:** (Check what it is)
- **Should be:** `root`
- Click **Edit** and update to: `root`

### Secret 4: VPS_SSH_KEY
- **Current value:** (This is the private key)
- **Should be:** The private key generated on the server
- Click **Edit** and paste the entire private key below:

[PRIVATE KEY REMOVED]

**IMPORTANT:** Copy the ENTIRE key including the `-----BEGIN` and `-----END` lines.

### After Updating Secrets:

1. Make a small test commit and push:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```

2. Check GitHub Actions tab to see if deployment works now.

## What Was Fixed:

✅ Generated new SSH key for GitHub Actions on server
✅ Added key to authorized_keys
✅ Updated workflow file with better timeout settings
✅ Verified deploy.sh script is executable
✅ Verified PM2 is running

## Current Server Status:

- ✅ SSH service running on port 22
- ✅ Firewall inactive (no blocking)
- ✅ PM2 running with rvbot process
- ✅ Deploy script ready at `/var/www/rvbot/deploy.sh`
- ✅ Git repository configured correctly

The only remaining issue is updating the GitHub secrets with the correct values above.

