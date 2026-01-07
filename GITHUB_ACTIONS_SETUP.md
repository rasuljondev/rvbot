# GitHub Actions Setup Guide for RVBot

This guide will walk you through setting up GitHub Actions for automatic deployment to your VPS.

## Quick Setup Steps

### 1. Push Code to GitHub

The code is already set up with the GitHub Actions workflow. Just push it:

```bash
git push -u origin main
```

### 2. Prepare Your VPS

SSH into your VPS and run these commands:

```bash
# Create directory
sudo mkdir -p /var/www/rvbot
sudo chown -R $USER:$USER /var/www/rvbot

# Clone repository
cd /var/www/rvbot
git clone https://github.com/rasuljondev/rvbot.git .

# Copy deployment script
# The deploy.sh is in deployment/rvbot-deploy.sh
# Copy it to /var/www/rvbot/deploy.sh
cp deployment/rvbot-deploy.sh deploy.sh
chmod +x deploy.sh

# Install dependencies
npm install --production

# Create .env file (copy your existing one or create new)
nano .env
# Add: TELEGRAM_BOT_TOKEN=your_token
# Add: ADMIN_ID=your_admin_id

# Start bot with PM2
pm2 start npm --name rvbot -- start
pm2 save
```

### 3. Generate SSH Key for GitHub Actions

On your VPS, generate an SSH key specifically for GitHub Actions:

```bash
# On your VPS
ssh-keygen -t rsa -b 4096 -C "github-actions-rvbot" -f ~/.ssh/github_actions_rvbot

# Add public key to authorized_keys
cat ~/.ssh/github_actions_rvbot.pub >> ~/.ssh/authorized_keys

# Display private key (you'll need this for GitHub Secret)
cat ~/.ssh/github_actions_rvbot
```

**Copy the entire private key output** (including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`)

### 4. Configure GitHub Secrets

Go to your GitHub repository: **https://github.com/rasuljondev/rvbot**

1. Click **Settings** (top menu)
2. Click **Secrets and variables** → **Actions** (left sidebar)
3. Click **New repository secret** and add these 4 secrets:

#### Secret 1: VPS_HOST
- **Name:** `VPS_HOST`
- **Value:** Your VPS IP address or domain
  - Example: `192.168.1.100` or `vps.example.com`

#### Secret 2: VPS_USER
- **Name:** `VPS_USER`
- **Value:** Your SSH username
  - Example: `root` or `ubuntu` or `your-username`

#### Secret 3: VPS_SSH_KEY
- **Name:** `VPS_SSH_KEY`
- **Value:** The private SSH key you copied from step 3
  - Paste the entire key including BEGIN and END lines

#### Secret 4: VPS_PORT (Optional)
- **Name:** `VPS_PORT`
- **Value:** SSH port number (default is 22)
  - Only add this if you use a custom SSH port
  - Example: `2222`

### 5. Test the Deployment

1. Make a small change to your code (or just push the current code)
2. Push to GitHub:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```

3. Check GitHub Actions:
   - Go to your repository
   - Click **Actions** tab
   - You should see "Deploy RVBot to VPS" workflow running
   - Click on it to see the deployment progress

4. Verify on VPS:
   ```bash
   # SSH into VPS
   ssh user@your-vps
   
   # Check PM2 status
   pm2 list
   pm2 logs rvbot
   ```

## What to Stop/Disable in GitHub Actions

### ✅ Keep Enabled (Default)
- **Workflow runs** - This is what deploys your bot
- **Actions permissions** - Needed for the workflow to run

### ⚠️ What You Might Want to Disable

If you want to temporarily stop auto-deployment:

1. **Disable the workflow:**
   - Go to **Actions** tab
   - Click on **Deploy RVBot to VPS** workflow
   - Click **...** (three dots) → **Disable workflow**

2. **Or modify the workflow file:**
   - Edit `.github/workflows/deploy.yml`
   - Comment out the trigger or change the branch

### 🔒 Security Settings to Check

1. **Actions permissions:**
   - Go to **Settings** → **Actions** → **General**
   - Under "Workflow permissions", ensure it's set correctly
   - For public repos, this is usually fine as-is

2. **Branch protection (optional):**
   - Go to **Settings** → **Branches**
   - You can protect the `main` branch if needed
   - This won't affect deployments, just prevents force pushes

## Troubleshooting

### Workflow Fails with "Permission denied"
- Check SSH key is correct in `VPS_SSH_KEY` secret
- Verify the key is in `~/.ssh/authorized_keys` on VPS
- Test SSH manually: `ssh -i ~/.ssh/github_actions_rvbot user@vps`

### Workflow Fails with "Host key verification failed"
- Add this to the workflow (in deploy.yml):
  ```yaml
  script_stop: true
  ```

### Deployment Script Not Found
- Verify `deploy.sh` exists: `ls -la /var/www/rvbot/deploy.sh`
- Check it's executable: `chmod +x /var/www/rvbot/deploy.sh`

### PM2 Command Not Found
- Install PM2 globally: `npm install -g pm2`
- Or update deploy.sh to use full path to PM2

## Monitoring Deployments

- **GitHub Actions tab** - See all deployment runs and logs
- **PM2 logs** - `pm2 logs rvbot` on VPS
- **PM2 status** - `pm2 list` to see if bot is running

## Next Steps

Once everything works:
- ✅ Every push to `main` branch will auto-deploy
- ✅ Monitor the first few deployments
- ✅ Check logs if something goes wrong
- ✅ You can add notifications (Telegram, email) to the workflow later

