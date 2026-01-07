# RVBot Auto-Deployment Setup with GitHub Actions

This guide sets up automatic deployment for rvbot using GitHub Actions. This approach is simpler and doesn't require webhook services or Nginx configuration changes.

## How It Works

```
GitHub Push → GitHub Actions → SSH to VPS → Run deploy.sh → PM2 Restart
```

## Prerequisites

- VPS server with SSH access
- PM2 installed and running
- Node.js installed
- Git installed on VPS
- GitHub repository: https://github.com/rasuljondev/rvbot.git

## Step 1: Prepare VPS Directory Structure

```bash
# Create directory
sudo mkdir -p /var/www/rvbot

# Set ownership (replace 'your-user' with your actual username)
sudo chown -R your-user:your-user /var/www/rvbot
```

## Step 2: Clone and Setup rvbot Repository

```bash
cd /var/www/rvbot

# Clone the repository (if not already cloned)
git clone https://github.com/rasuljondev/rvbot.git .

# Or if already cloned, ensure it's up to date
git pull origin main

# Install dependencies
npm install --production

# Create .env file if it doesn't exist
# Copy your existing .env file or create a new one with:
# TELEGRAM_BOT_TOKEN=your_token_here
# ADMIN_ID=your_admin_id_here
```

## Step 3: Create Deployment Script

Copy the deployment script to the VPS:

```bash
# Copy deploy.sh from this repository to VPS
# You can use scp from your local machine:
# scp deployment/rvbot-deploy.sh user@your-vps:/var/www/rvbot/deploy.sh

# Or create it directly on the VPS:
nano /var/www/rvbot/deploy.sh
# Paste the contents from deployment/rvbot-deploy.sh

# Make it executable
chmod +x /var/www/rvbot/deploy.sh
```

## Step 4: Start rvbot with PM2 (if not already running)

```bash
cd /var/www/rvbot

# Start the bot
pm2 start npm --name rvbot -- start

# Save PM2 configuration
pm2 save
```

## Step 5: Configure GitHub Secrets

1. Go to your GitHub repository: https://github.com/rasuljondev/rvbot
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add the following secrets:

### Required Secrets:

**VPS_HOST**
- Name: `VPS_HOST`
- Value: Your VPS IP address or domain (e.g., `192.168.1.100` or `vps.example.com`)

**VPS_USER**
- Name: `VPS_USER`
- Value: Your SSH username (e.g., `root` or `ubuntu`)

**VPS_SSH_KEY**
- Name: `VPS_SSH_KEY`
- Value: Your private SSH key content
  - To get your private key: `cat ~/.ssh/id_rsa` (or your key file)
  - Copy the entire key including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`

**VPS_PORT** (Optional)
- Name: `VPS_PORT`
- Value: SSH port (default is 22, only add this if you use a custom port)

### How to Generate SSH Key (if you don't have one):

```bash
# On your local machine or VPS
ssh-keygen -t rsa -b 4096 -C "github-actions"

# Copy public key to VPS authorized_keys
ssh-copy-id -i ~/.ssh/id_rsa.pub user@your-vps

# Copy private key content for GitHub secret
cat ~/.ssh/id_rsa
```

## Step 6: Test the Setup

### Test 1: Manual Deployment
```bash
# SSH into your VPS
ssh user@your-vps

# Run deployment script manually
cd /var/www/rvbot
./deploy.sh
```

### Test 2: GitHub Actions Deployment
1. Make a small change to your repository:
```bash
# On your local machine
echo "# Test deployment" >> README.md
git add README.md
git commit -m "Test GitHub Actions deployment"
git push origin main
```

2. Check GitHub Actions:
   - Go to your repository on GitHub
   - Click on **Actions** tab
   - You should see a workflow run for "Deploy RVBot to VPS"
   - Click on it to see the deployment progress

3. Check if deployment succeeded:
```bash
# SSH into VPS
ssh user@your-vps

# Check PM2 status
pm2 list
pm2 logs rvbot
```

## Monitoring and Troubleshooting

### Check GitHub Actions Logs
- Go to repository → **Actions** tab
- Click on the latest workflow run
- View the logs for each step

### Check VPS Logs
```bash
# SSH into VPS
ssh user@your-vps

# Check PM2 status
pm2 status
pm2 list

# Check rvbot logs
pm2 logs rvbot

# Check deployment script output
cd /var/www/rvbot
./deploy.sh
```

### Common Issues

1. **SSH Connection Failed**
   - Verify `VPS_HOST`, `VPS_USER`, and `VPS_PORT` are correct
   - Check that SSH key is properly formatted (include BEGIN/END lines)
   - Ensure VPS firewall allows SSH connections
   - Test SSH connection manually: `ssh -i ~/.ssh/id_rsa user@your-vps`

2. **Permission Denied**
   - Check file permissions: `chmod +x /var/www/rvbot/deploy.sh`
   - Verify user has permissions to `/var/www/rvbot` directory
   - Check that git repository is properly initialized

3. **PM2 Command Not Found**
   - Ensure PM2 is installed globally: `npm install -g pm2`
   - Or use full path: Update `deploy.sh` to use `/usr/bin/pm2` or `~/.npm-global/bin/pm2`

4. **Git Pull Fails**
   - Verify git repository is properly initialized
   - Check that remote origin is set: `git remote -v`
   - Ensure branch name matches (main vs master)

5. **Deployment Script Not Found**
   - Verify script exists: `ls -la /var/www/rvbot/deploy.sh`
   - Check script is executable: `chmod +x /var/www/rvbot/deploy.sh`

## Security Best Practices

- Use SSH keys instead of passwords
- Restrict SSH key permissions: `chmod 600 ~/.ssh/id_rsa`
- Consider using a dedicated deployment user with limited permissions
- Regularly rotate SSH keys
- Monitor GitHub Actions logs for any suspicious activity

## Advantages of GitHub Actions Approach

✅ No additional services needed on VPS  
✅ No Nginx configuration changes  
✅ No webhook receiver service to maintain  
✅ Built-in logging and monitoring in GitHub  
✅ Easy to see deployment history  
✅ Can add additional steps (notifications, tests, etc.)  
✅ Free for public repositories  

## Next Steps

Once everything is working:
- Monitor the first few deployments to ensure stability
- Consider adding deployment notifications (Telegram, email, etc.)
- Add pre-deployment checks if needed (tests, linting, etc.)
- When ready, set up rvkino using the same pattern

