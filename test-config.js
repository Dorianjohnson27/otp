require('dotenv').config();
const { Client, Intents } = require('discord.js');
const Imap = require('imap');

console.log('🧪 Testing Discord OTP Finder Bot Configuration');
console.log('==============================================\n');

// Test environment variables
function testEnvironmentVariables() {
    console.log('📋 Checking environment variables...');
    
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

    let allPresent = true;
    for (const varName of requiredVars) {
        if (!process.env[varName] || process.env[varName].includes('your_') || process.env[varName].includes('here')) {
            console.log(`❌ Missing or default: ${varName}`);
            allPresent = false;
        } else {
            console.log(`✅ ${varName}: ${varName.includes('PASSWORD') ? '***' : process.env[varName]}`);
        }
    }

    if (allPresent) {
        console.log('\n✅ All required environment variables are set!');
    } else {
        console.log('\n❌ Please configure all required environment variables in .env file');
    }

    return allPresent;
}

// Test Discord connection
async function testDiscordConnection() {
    console.log('\n🤖 Testing Discord connection...');
    
            const client = new Client({
            intents: [
                Intents.FLAGS.GUILDS,
                Intents.FLAGS.GUILD_MESSAGES,
                Intents.FLAGS.GUILD_MESSAGE_REACTIONS
            ]
        });

    try {
        await client.login(process.env.DISCORD_TOKEN);
        console.log('✅ Discord connection successful!');
        console.log(`   Bot: ${client.user.tag}`);
        
        const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
        if (guild) {
            console.log(`   Server: ${guild.name}`);
        } else {
            console.log('❌ Could not find the specified Discord server');
        }

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (channel) {
            console.log(`   Channel: #${channel.name}`);
        } else {
            console.log('❌ Could not find the specified Discord channel');
        }

        await client.destroy();
        return true;
    } catch (error) {
        console.log('❌ Discord connection failed:', error.message);
        return false;
    }
}

// Test email connection
function testEmailConnection() {
    console.log('\n📧 Testing email connection...');
    
    const imap = new Imap({
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });

    return new Promise((resolve) => {
        imap.once('ready', () => {
            console.log('✅ Email connection successful!');
            imap.end();
            resolve(true);
        });

        imap.once('error', (err) => {
            console.log('❌ Email connection failed:', err.message);
            resolve(false);
        });

        imap.connect();
    });
}

// Main test function
async function runTests() {
    const envOk = testEnvironmentVariables();
    
    if (!envOk) {
        console.log('\n❌ Please fix environment variables before running other tests');
        return;
    }

    const discordOk = await testDiscordConnection();
    const emailOk = await testEmailConnection();

    console.log('\n📊 Test Results:');
    console.log(`   Environment Variables: ${envOk ? '✅' : '❌'}`);
    console.log(`   Discord Connection: ${discordOk ? '✅' : '❌'}`);
    console.log(`   Email Connection: ${emailOk ? '✅' : '❌'}`);

    if (envOk && discordOk && emailOk) {
        console.log('\n🎉 All tests passed! Your bot is ready to run.');
        console.log('   Run: npm start');
    } else {
        console.log('\n⚠️  Some tests failed. Please check your configuration.');
    }
}

// Run tests
runTests().catch(console.error); 