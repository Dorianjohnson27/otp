# Discord OTP Finder Bot

A Discord bot that automatically finds OTP (One-Time Password) codes from catch-all emails using IMAP and sends them to a Discord channel. Specifically designed to work with `familyfeastadmin.xyz` and `bigboyent.xyz` catch-all domains.

## Features

- 🔍 **Automatic Email Monitoring**: Checks emails periodically for new OTP codes
- 📧 **IMAP Integration**: Connects to email servers to fetch emails
- 🤖 **Discord Integration**: Sends found OTP codes as rich embeds to Discord
- 🎯 **Catch-All Support**: Optimized for familyfeastadmin.xyz and bigboyent.xyz domains
- ⚙️ **Easy Configuration**: Uses environment variables for easy setup
- 📊 **Bot Commands**: Manual checking and status commands

## Setup Instructions

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token
5. Enable the following intents:
   - Message Content Intent
   - Server Members Intent
6. In the "Bot" section, enable "Use Slash Commands"
7. Invite the bot to your server with these permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Read Message History

### 2. Email Configuration

#### For Gmail:
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
3. Use the generated password in your `.env` file

#### For Other Email Providers:
- Update the `EMAIL_HOST` and `EMAIL_PORT` in your `.env` file
- Use your email password or app-specific password

### 3. Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file:
   ```bash
   copy .env.example .env
   ```

4. Edit the `.env` file with your configuration:
   ```env
   # Discord Configuration
   DISCORD_TOKEN=your_discord_bot_token_here
   DISCORD_CLIENT_ID=your_discord_client_id_here
   DISCORD_GUILD_ID=your_discord_server_id_here
   DISCORD_CHANNEL_ID=your_discord_channel_id_here

   # Email Configuration (IMAP)
   EMAIL_HOST=imap.gmail.com
   EMAIL_PORT=993
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASSWORD=your_app_password_here
   EMAIL_FOLDER=INBOX

   # Search Configuration
   TARGET_EMAIL=your_target_email@example.com
   OTP_SEARCH_KEYWORDS=uber,verification,code,otp
   OTP_REGEX_PATTERN=\\b\\d{4,6}\\b

   # Bot Configuration
   CHECK_INTERVAL=30000
   MAX_EMAIL_AGE_HOURS=24
   ```

### 4. Configuration Details

#### Discord Configuration:
- `DISCORD_TOKEN`: Your bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID`: Your bot's client ID
- `DISCORD_GUILD_ID`: Your Discord server ID
- `DISCORD_CHANNEL_ID`: The channel where OTP codes will be sent

#### Email Configuration:
- `EMAIL_HOST`: IMAP server host (e.g., imap.gmail.com)
- `EMAIL_PORT`: IMAP port (usually 993 for SSL)
- `EMAIL_USER`: Your email address
- `EMAIL_PASSWORD`: Your email password or app password
- `EMAIL_FOLDER`: Email folder to check (usually INBOX)

#### Catch-All Email Configuration:
- `SUPPORTED_DOMAINS`: Supported catch-all domains (familyfeastadmin.xyz, bigboyent.xyz)
- `CATCH_ALL_EMAIL`: Your catch-all email address
- `OTP_SEARCH_KEYWORDS`: Keywords to search for in emails (comma-separated)
- `OTP_REGEX_PATTERN`: Regex pattern to extract OTP codes

#### Bot Configuration:
- `CHECK_INTERVAL`: How often to check for new emails (in milliseconds)
- `MAX_EMAIL_AGE_HOURS`: Maximum age of emails to check

### 5. Running the Bot

```bash
# Start the bot
npm start

# Or for development with auto-restart
npm run dev
```

## Bot Commands

Once the bot is running, you can use these slash commands in Discord:

- `/otp [email]` - Fetch OTP codes for a catch-all email
  - `email` (required): The catch-all email address (familyfeastadmin.xyz or bigboyent.xyz)
- `/watchotp [email] [timeout]` - Start watching for OTP codes for a catch-all email
  - `email` (required): The catch-all email address to monitor
  - `timeout` (optional): How long to watch in minutes (default: 10)
- `/checkotp` - Manually check for new OTP codes
- `/stopwatch` - Stop watching for OTP codes
- `/domains` - Show supported catch-all domains
- `/help` - Show help information
- `/status` - Show bot status and configuration

### Usage Examples:

1. **Fetch OTP codes for a catch-all email:**
   ```
   /otp email:user@familyfeastadmin.xyz
   ```
   This immediately fetches and displays any OTP codes found for that catch-all email.

2. **Start watching for OTP codes:**
   ```
   /watchotp email:user@bigboyent.xyz timeout:15
   ```
   This will monitor catch-all emails for 15 minutes and automatically stop when an OTP is found.

3. **Quick check for existing OTP codes:**
   ```
   /checkotp
   ```
   This checks for any recent OTP codes without starting a watcher.

4. **Stop active monitoring:**
   ```
   /stopwatch
   ```
   This stops any active OTP watching for your user.

5. **View supported domains:**
   ```
   /domains
   ```
   This shows all supported catch-all domains.

## How It Works

1. **Email Monitoring**: The bot connects to your email via IMAP
2. **Email Filtering**: Searches for emails to catch-all addresses in supported domains
3. **Content Analysis**: Looks for verification keywords and OTP patterns
4. **Code Extraction**: Uses regex to find 4-6 digit codes
5. **Discord Notification**: Sends found codes as rich embeds to Discord

## Supported Domains

The bot is specifically configured to work with these catch-all email domains:
- **familyfeastadmin.xyz**
- **bigboyent.xyz**

Only emails sent to addresses in these domains will be processed for OTP codes.

## Security Notes

- Never share your `.env` file or bot token
- Use app-specific passwords for email accounts
- The bot only reads emails, it doesn't send or modify them
- Consider using a dedicated email account for this bot

## Troubleshooting

### Common Issues:

1. **Bot not connecting to Discord**
   - Check your bot token is correct
   - Ensure the bot has proper permissions

2. **Email connection issues**
   - Verify your email credentials
   - Check if IMAP is enabled on your email account
   - For Gmail, make sure you're using an app password

3. **No OTP codes found**
   - Check the `TARGET_EMAIL` setting
   - Verify the email contains the expected keywords
   - Adjust the `OTP_REGEX_PATTERN` if needed

4. **Bot not sending to Discord**
   - Check the `DISCORD_CHANNEL_ID` is correct
   - Ensure the bot has permission to send messages in the channel

## License

MIT License - feel free to modify and distribute as needed. 