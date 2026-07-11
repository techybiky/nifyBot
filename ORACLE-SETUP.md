# 🚀 Deploy Nifty Bot on Oracle Cloud (Always Free)

Complete setup guide for deploying the bot on Oracle Cloud Always Free tier.

---

## ✅ Prerequisites

- Oracle Cloud account (free tier)
- Ubuntu 24.04 LTS VM on Oracle Cloud
- SSH access to VM

---

## 📋 Step 1: Create Oracle Cloud VM (If Not Done)

See `VM-CREATION-DETAILED-GUIDE.md` for complete VM setup.

**Quick summary:**
```
VM Shape: VM.Standard.E2.1.Micro (Always Free)
OS: Ubuntu 24.04 LTS
Storage: 200 GB
Cost: FREE
```

---

## 📋 Step 2: SSH Into Your VM

```bash
ssh -i "C:\Keys\oracle-key.pem" ubuntu@YOUR_PUBLIC_IP
```

---

## 📋 Step 3: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install nodejs -y

# Verify
node -v
npm -v
```

---

## 📋 Step 4: Clone/Upload Project

### Option A: Clone from GitHub (if you pushed code)

```bash
git clone https://github.com/techybiky/nifty-sensex-bot.git
cd nifty-sensex-bot
```

### Option B: Upload ZIP File

**From your local computer:**

```powershell
scp -i "C:\Keys\oracle-key.pem" "C:\path\to\nifty-bot.zip" ubuntu@YOUR_IP:/home/ubuntu/

# Then on VM:
unzip nifty-bot.zip
cd nifty-bot
```

---

## 📋 Step 5: Setup Bot

```bash
# Go to bot directory
cd nifty-bot

# Install dependencies
npm install

# Create .env file
nano .env
```

**Paste this (add your keys):**

```
NEWS_API_KEY=your_newsapi_key_here
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

Save: Ctrl+X → y → Enter

---

## 📋 Step 6: Test Bot

```bash
# Run once to verify
npm start

# You should see:
# ✅ Nifty/Sensex Prediction Bot Started
# ✅ Fetched X news articles
# ... signal outputs
```

---

## 📋 Step 7: Setup Automation

### Install PM2

```bash
# Install globally
sudo npm install -g pm2

# Start bot with PM2
pm2 start src/main.js --name nifty-bot

# Save config
pm2 save

# Enable auto-startup
pm2 startup
```

**PM2 will output a command. Run it:**

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

---

### Setup Cron Scheduling

```bash
# Edit crontab
crontab -e

# Add these lines (runs 9:30 AM & 3:30 PM IST on weekdays):

# Morning run (9:30 AM IST)
30 9 * * 1-5 cd /home/ubuntu/nifty-bot && /usr/bin/npm start >> logs/bot.log 2>&1

# Evening run (3:30 PM IST)
30 15 * * 1-5 cd /home/ubuntu/nifty-bot && /usr/bin/npm start >> logs/bot.log 2>&1

# Auto-update code daily at 8 AM
0 8 * * 1-5 cd /home/ubuntu/nifty-bot && git pull >> logs/git-pull.log 2>&1
```

Save: Ctrl+X → y → Enter

---

## ✅ Verification

### Check Bot Status

```bash
# Check if running
pm2 list

# Should show: nifty-bot online

# View logs
pm2 logs nifty-bot
```

### Check Cron Schedule

```bash
# View scheduled jobs
crontab -l

# Should show your 3 cron jobs
```

### Test Database

```bash
# Check database exists
ls -la data/signals.db

# View recent signals
sqlite3 data/signals.db "SELECT * FROM signals ORDER BY timestamp DESC LIMIT 5;"
```

---

## 📊 Monitor Your Bot

### View Live Logs

```bash
# Real-time logs
pm2 logs nifty-bot

# Last 100 lines
tail -100 logs/bot.log

# Today's logs
tail -f logs/bot.log
```

### Check Performance

```bash
# Database stats
sqlite3 data/signals.db

# Get all signals
SELECT COUNT(*) as total, direction FROM signals GROUP BY direction;

# Get today's signals
SELECT * FROM signals WHERE DATE(timestamp) = DATE('now') ORDER BY timestamp DESC;

# Exit sqlite
.exit
```

---

## 🔄 Update Code

```bash
# SSH into VM
ssh -i "C:\Keys\oracle-key.pem" ubuntu@YOUR_IP

# Go to bot directory
cd nifty-bot

# Pull latest code
git pull

# Restart bot
pm2 restart nifty-bot
```

---

## 🆘 Troubleshooting

### Bot Not Running

```bash
# Check error
pm2 logs nifty-bot

# Restart
pm2 restart nifty-bot

# If still fails, check manually
npm start
```

### Cron Not Running

```bash
# Check cron logs
grep CRON /var/log/syslog | tail -20

# Verify npm path
which npm

# Update cron with full path if needed
```

### Telegram Not Sending

```bash
# Test connection
curl -I https://api.telegram.org

# Verify credentials in .env
cat .env | grep TELEGRAM

# Test with:
node -e "
const TelegramAlert = require('./src/telegramAlert');
new TelegramAlert().sendAlert({
  direction: 'BUY',
  score: 0.65,
  confidence: 0.65,
  sentimentScore: 0.5,
  momentumScore: 0.8,
  newsCount: 10,
  positiveNews: 8,
  negativeNews: 2,
  reasoning: 'Test'
}, 'NIFTY');
"
```

---

## 📈 What's Next

1. ✅ Bot running on schedule
2. ✅ Telegram alerts working
3. ✅ Database tracking signals
4. ✅ Logs showing results

**Monitor for 1-2 weeks**, then:
- Analyze signal accuracy
- Fine-tune parameters
- Add to your trading system

---

## 💰 Cost

```
Oracle Cloud VM:    ₹0 (Always Free)
News API:           ₹0 (Free tier: 100/day)
Telegram:           ₹0 (Free)
Database:           ₹0 (SQLite)

TOTAL:              ₹0/month
```

---

## ✅ Daily Checklist

```
☐ Bot running (pm2 list)
☐ Cron jobs scheduled (crontab -l)
☐ Recent signals in DB (sqlite3 query)
☐ Telegram alerts working
☐ Logs being created (tail logs/bot.log)
```

---

**Your Nifty bot is now live 24/7 on Oracle Cloud!** 🚀
