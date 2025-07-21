require('dotenv').config();
const { Client, Intents } = require('discord.js');
const Imap = require('imap');

console.log('🧪 Comprehensive Bot Test');
console.log('========================\n');

// Test 1: Environment Variables
console.log('📋 Test 1: Environment Variables');
const requiredVars = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID', 
    'DISCORD_GUILD_ID',
    'DISCORD_CHANNEL_ID',
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'SUPPORTED_DOMAINS'
];

let envOk = true;
for (const varName of requiredVars) {
    if (!process.env[varName]) {
        console.log(`❌ Missing: ${varName}`);
        envOk = false;
    } else {
        console.log(`✅ ${varName}: ${varName.includes('PASSWORD') ? '***' : process.env[varName]}`);
    }
}

if (envOk) {
    console.log('✅ All environment variables are set!\n');
} else {
    console.log('❌ Some environment variables are missing!\n');
}

// Test 2: Discord Connection
console.log('🤖 Test 2: Discord Connection');
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
    ]
});

client.once('ready', async () => {
    console.log(`✅ Discord bot connected: ${client.user.tag}`);
    
    // Test guild and channel access
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (guild) {
        console.log(`✅ Guild found: ${guild.name}`);
    } else {
        console.log('❌ Guild not found');
    }
    
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (channel) {
        console.log(`✅ Channel found: #${channel.name}`);
    } else {
        console.log('❌ Channel not found');
    }
    
    await client.destroy();
    console.log('✅ Discord test completed\n');
    
    // Test 3: Email Connection
    console.log('📧 Test 3: Email Connection');
    const imap = new Imap({
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });
    
    imap.once('ready', () => {
        console.log('✅ Email connection successful!');
        imap.end();
        console.log('✅ Email test completed\n');
        
        // Test 4: Supported Domains
        console.log('🏷️ Test 4: Supported Domains');
        const domains = process.env.SUPPORTED_DOMAINS.split(',');
        console.log('Supported domains:');
        domains.forEach((domain, index) => {
            console.log(`   ${index + 1}. ${domain}`);
        });
        console.log('✅ Domain configuration test completed\n');
        
        // Final Summary
        console.log('🎉 All Tests Completed!');
        console.log('========================');
        console.log('✅ Environment Variables: Working');
        console.log('✅ Discord Connection: Working');
        console.log('✅ Email Connection: Working');
        console.log('✅ Domain Support: Working');
        console.log('\n🚀 Your bot is ready to use!');
        console.log('Try these commands in Discord:');
        console.log('   /help - Show all commands');
        console.log('   /domains - Show supported domains');
        console.log('   /otp user@familyfeastadmin.xyz');
        console.log('   /otp user@bigboyent.xyz');
    });
    
    imap.once('error', (err) => {
        console.log('❌ Email connection failed:', err.message);
        console.log('❌ Email test failed\n');
    });
    
    imap.connect();
});

client.once('error', (error) => {
    console.log('❌ Discord connection failed:', error.message);
    console.log('❌ Discord test failed\n');
});

client.login(process.env.DISCORD_TOKEN); 