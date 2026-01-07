#!/bin/bash
set -e

echo "🚀 RVBot Deployment Script"
echo "================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd /var/www/rvbot

# Fetch and reset to match remote exactly
echo -e "${YELLOW}Pulling latest code...${NC}"
git fetch origin
git reset --hard origin/main

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --production

# Restart with PM2
echo -e "${YELLOW}Restarting bot...${NC}"
if pm2 list | grep -q "rvbot"; then
    pm2 restart rvbot
else
    pm2 start npm --name rvbot -- start
fi

pm2 save

echo -e "${GREEN}✅ RVBot deployed successfully${NC}"

