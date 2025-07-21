const fs = require('fs');
const path = require('path');

console.log('🤖 Discord OTP Finder Bot Setup');
console.log('================================\n');

// Check if .env already exists
if (fs.existsSync('.env')) {
    console.log('⚠️  .env file already exists!');
    console.log('Please edit the existing .env file manually or delete it to run this setup again.\n');
    process.exit(0);
}

// Create .env file from template
const envTemplate = `# Discord Configuration
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
`;

fs.writeFileSync('.env', envTemplate);

console.log('✅ Created .env file successfully!');
console.log('\n📝 Next steps:');
console.log('1. Edit the .env file with your configuration');
console.log('2. Install dependencies: npm install');
console.log('3. Start the bot: npm start');
console.log('\n📖 For detailed setup instructions, see README.md');
console.log('\n🔧 Configuration guide:');
console.log('- DISCORD_TOKEN: Get from Discord Developer Portal');
console.log('- EMAIL_PASSWORD: Use app password for Gmail');
console.log('- TARGET_EMAIL: The email you want to monitor');
console.log('- DISCORD_CHANNEL_ID: Right-click channel → Copy ID'); 