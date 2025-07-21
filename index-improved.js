require('dotenv').config();
const { Client, MessageEmbed, Collection } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Configuration
const SUPPORTED_DOMAINS = process.env.SUPPORTED_DOMAINS ? process.env.SUPPORTED_DOMAINS.split(',') : ['familyfeastadmin.xyz', 'bigboyent.xyz'];
const CONNECTION_COOLDOWN = 2000; // 2 seconds between connections
const CONNECTION_LIMIT = 3; // Max 3 simultaneous connections

// Discord client setup
const client = new Client({ 
    intents: ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES'] 
});

// Connection management
let emailConnection = null;
let isConnecting = false;
let connectionQueue = [];

// Email connection class
class EmailConnection {
    constructor() {
        this.imap = null;
        this.isConnected = false;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.imap = new Imap({
                user: process.env.EMAIL_USER,
                password: process.env.EMAIL_PASSWORD,
                host: process.env.EMAIL_HOST,
                port: process.env.EMAIL_PORT,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                connTimeout: 3000,  // Ultra fast connection timeout
                authTimeout: 3000,   // Ultra fast auth timeout
                keepalive: true,     // Keep connection alive
                debug: false,        // Disable debug for speed
                autotls: 'always',   // Always use TLS for speed
                maxRetries: 1        // Minimal retries for speed
            });

            this.imap.once('ready', () => {
                console.log('✅ Connected to email server');
                this.isConnected = true;
                resolve();
            });

            this.imap.once('error', (err) => {
                console.error('❌ IMAP connection error:', err.message);
                this.isConnected = false;
                reject(err);
            });

            this.imap.connect();
        });
    }

    async disconnect() {
        if (this.imap && this.isConnected) {
            this.imap.end();
            this.isConnected = false;
        }
    }

    async searchEmails(searchCriteria) {
        return new Promise((resolve, reject) => {
            this.imap.openBox(process.env.EMAIL_FOLDER, false, (err, box) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.imap.search(searchCriteria, (err, results) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(results);
                });
            });
        });
    }

    async fetchEmails(messageIds) {
        return new Promise((resolve, reject) => {
            const emails = [];
            
            if (messageIds.length === 0) {
                resolve(emails);
                return;
            }

            // Only fetch the newest emails first for speed
            const sortedIds = messageIds.sort((a, b) => b - a).slice(0, 3); // Only check newest 3 emails
            
            const fetch = this.imap.fetch(sortedIds, { 
                bodies: '',
                struct: false, // Skip structure for speed
                envelope: false // Skip envelope for speed
            });

            fetch.on('message', (msg, seqno) => {
                msg.on('body', (stream) => {
                    simpleParser(stream, (err, parsed) => {
                        if (err) return;
                        
                        const emailContent = {
                            subject: parsed.subject,
                            from: parsed.from.text,
                            to: parsed.to ? parsed.to.text : '',
                            text: parsed.text,
                            html: parsed.html,
                            date: parsed.date
                        };
                        emails.push(emailContent);
                    });
                });
            });

            fetch.once('error', (err) => {
                reject(err);
            });

            fetch.once('end', () => {
                resolve(emails);
            });
        });
    }
}

// OTP extraction class
class OTPExtractor {
    static extractVerificationCodes(emailContent, targetEmail = null) {
        const codes = [];
        
        // Priority patterns for verification codes - more specific for Uber
        const priorityPatterns = [
            /enter this verification code[:\s]*(\d{4,6})/gi,  // "enter this verification code: 9155"
            /verification code is[:\s]*(\d{4,6})/gi,          // "verification code is: 1234"
            /verification code[:\s]*(\d{4,6})/gi,             // "verification code: 1234"
            /your code[:\s]*(\d{4,6})/gi,                     // "your code: 1234"  
            /code is[:\s]*(\d{4,6})/gi,                       // "code is: 1234"
            /code[:\s]*(\d{4,6})/gi,                          // "code: 1234"
        ];

        // More specific patterns that look for codes in context
        const specificPatterns = [
            /verification code[^0-9]*(\d{4,6})/gi,           // "verification code... 6584"
            /enter this code[^0-9]*(\d{4,6})/gi,              // "enter this code... 6584"
            /this verification code[^0-9]*(\d{4,6})/gi,       // "this verification code... 6584"
        ];

        // General patterns - but only if no priority matches found
        const generalPatterns = [
            /\b\d{4}\b/g,                          // 4-digit codes (fallback)
            /\b\d{6}\b/g,                          // 6-digit codes (fallback)
        ];
        
        // Check if email subject contains "Your Uber verification code" or "Your Uber account verification code"
        const isUberVerificationEmail = emailContent.subject.toLowerCase().includes('your uber verification code') || 
                                       emailContent.subject.toLowerCase().includes('your uber account verification code');
        
        // Check if email is from admin@uber.com
        const isFromUberAdmin = emailContent.from.toLowerCase().includes('admin@uber.com');
        
        // If target email is specified, check if the email is sent to that specific address
        const isTargetEmail = targetEmail ? 
            emailContent.to.toLowerCase().includes(targetEmail.toLowerCase()) : 
            true;
        
        if (isUberVerificationEmail && isFromUberAdmin && isTargetEmail) {
            console.log(`🔍 Processing Uber email: Subject="${emailContent.subject}", To="${emailContent.to}"`);
            console.log(`📧 Email text preview: ${emailContent.text.substring(0, 200)}...`);
            
            // Try priority patterns first (more specific) - return immediately after first match
            for (const pattern of priorityPatterns) {
                const matches = emailContent.text.match(pattern);
                if (matches) {
                    console.log(`✅ Found ${matches.length} matches with priority pattern: ${pattern}`);
                    // Only take the first match to avoid duplicates
                    const match = matches[0];
                    const code = match.match(/\d{4,6}/)[0];
                    if (code && code.length >= 4 && code.length <= 6) {
                        console.log(`🎯 Extracted priority code: ${code}`);
                        codes.push({
                            code: code,
                            subject: emailContent.subject,
                            to: emailContent.to,
                            date: emailContent.date,
                            targetEmail: targetEmail,
                            pattern: 'priority'
                        });
                        console.log(`Extracted 1 OTP code from email`);
                        return codes; // Return immediately after finding first code
                    }
                }
            }
            
            // Try specific patterns that look for codes in context
            for (const pattern of specificPatterns) {
                const matches = emailContent.text.match(pattern);
                if (matches) {
                    console.log(`✅ Found ${matches.length} matches with specific pattern: ${pattern}`);
                    // Only take the first match to avoid duplicates
                    const match = matches[0];
                    const code = match.match(/\d{4,6}/)[0];
                    if (code && code.length >= 4 && code.length <= 6) {
                        console.log(`🎯 Extracted specific code: ${code}`);
                        codes.push({
                            code: code,
                            subject: emailContent.subject,
                            to: emailContent.to,
                            date: emailContent.date,
                            targetEmail: targetEmail,
                            pattern: 'specific'
                        });
                        console.log(`Extracted 1 OTP code from email`);
                        return codes; // Return immediately after finding first code
                    }
                }
            }
            
            // If no specific matches found, try general patterns as last resort
            for (const pattern of generalPatterns) {
                const matches = emailContent.text.match(pattern);
                if (matches) {
                    console.log(`⚠️ Found ${matches.length} matches with general pattern: ${pattern}`);
                    // Only take the first match to avoid duplicates
                    const match = matches[0];
                    if (match.length >= 4 && match.length <= 6) {
                        console.log(`🎯 Extracted general code: ${match}`);
                        codes.push({
                            code: match,
                            subject: emailContent.subject,
                            to: emailContent.to,
                            date: emailContent.date,
                            targetEmail: targetEmail,
                            pattern: 'general'
                        });
                        console.log(`Extracted 1 OTP code from email`);
                        return codes; // Return immediately after finding first code
                    }
                }
            }
            
            console.log(`❌ No OTP codes found in email - trying general patterns...`);
            
            // If no priority matches found, try general patterns
            for (const pattern of generalPatterns) {
                const matches = emailContent.text.match(pattern);
                if (matches) {
                    console.log(`✅ Found ${matches.length} matches with general pattern: ${pattern}`);
                    // Only take the first match to avoid duplicates
                    const match = matches[0];
                    if (match.length >= 4 && match.length <= 6) {
                        console.log(`🎯 Extracted general code: ${match}`);
                        codes.push({
                            code: match,
                            subject: emailContent.subject,
                            to: emailContent.to,
                            date: emailContent.date,
                            targetEmail: targetEmail,
                            pattern: 'general'
                        });
                        console.log(`Extracted 1 OTP code from email`);
                        return codes; // Return immediately after finding first code
                    }
                }
            }
            
            console.log(`❌ No OTP codes found in email after trying all patterns`);
        } else {
            console.log(`❌ Not a valid Uber verification email: Subject="${emailContent.subject}", From="${emailContent.from}", To="${emailContent.to}"`);
            if (!isUberVerificationEmail) console.log(`   - Subject doesn't match verification pattern`);
            if (!isFromUberAdmin) console.log(`   - Not from admin@uber.com`);
            if (!isTargetEmail) console.log(`   - Wrong target email`);
        }

        return codes;
    }
}

// Main email checking class
class EmailOTPChecker {
    constructor() {
        this.connection = null;
        this.isConnecting = false;
        this.connectionQueue = [];
    }

    async connectImap() {
        if (this.isConnecting) {
            // Wait for existing connection
            return new Promise((resolve, reject) => {
                this.connectionQueue.push({ resolve, reject });
            });
        }

        if (this.connection && this.connection.isConnected) {
            return this.connection;
        }

        this.isConnecting = true;
        
        try {
            this.connection = new EmailConnection();
            await this.connection.connect();
            
            // Process queued requests
            while (this.connectionQueue.length > 0) {
                const queuedRequest = this.connectionQueue.shift();
                queuedRequest.resolve(this.connection);
            }
            
            return this.connection;
        } catch (error) {
            this.isConnecting = false;
            throw error;
        } finally {
            this.isConnecting = false;
        }
    }

    async waitForVerificationEmail(targetEmail, options = {}) {
        const checkInterval = options.checkInterval || 100; // Check every 0.1 seconds (ultra fast)
        const startTime = Date.now();
        
        try {
            console.log(`🔍 Continuously monitoring for NEW verification emails for ${targetEmail}...`);
            
            // Connect to IMAP
            const imap = await this.connectImap();
            
            // First, check for any existing verification emails from the last 30 seconds (very recent)
            console.log(`🔍 Checking for existing verification emails from the last 30 seconds...`);
            const existingSearchCriteria = [
                ['TO', targetEmail],
                ['SINCE', new Date(Date.now() - 30 * 1000)] // Last 30 seconds
            ];
            
            const existingMessageIds = await imap.searchEmails(existingSearchCriteria);
            if (existingMessageIds.length > 0) {
                console.log(`📧 Found ${existingMessageIds.length} existing emails to check...`);
                const existingEmails = await imap.fetchEmails(existingMessageIds);
                
                // Process existing emails in reverse order (newest first)
                for (let i = existingEmails.length - 1; i >= 0; i--) {
                    const email = existingEmails[i];
                    console.log(`📧 Checking existing email: Subject="${email.subject}", From="${email.from}"`);
                    const codes = OTPExtractor.extractVerificationCodes(email, targetEmail);
                    
                    if (codes.length > 0) {
                        const primaryCode = codes[0];
                        const waitTime = Date.now() - startTime;
                        console.log(`🎯 INSTANT: Found existing verification code: ${primaryCode.code} (${waitTime}ms)`);
                        
                        return {
                            success: true,
                            codes: codes,
                            primaryCode: primaryCode,
                            waitTime: waitTime
                        };
                    }
                }
                console.log(`❌ No verification codes found in existing emails`);
            }
            
            // Start continuous polling for new emails
            let lastCheckTime = startTime;
            
            while (true) { // Run forever until code found
                // Search for emails since the last check only
                const searchCriteria = [
                    ['TO', targetEmail],
                    ['SINCE', new Date(lastCheckTime)]
                ];
                
                // Also search for recent emails (last 5 minutes) to catch any missed ones
                const recentSearchCriteria = [
                    ['TO', targetEmail],
                    ['SINCE', new Date(Date.now() - 5 * 60 * 1000)] // Last 5 minutes
                ];
                
                const messageIds = await imap.searchEmails(searchCriteria);
                const elapsed = Math.floor((Date.now() - startTime)/1000);
                
                if (messageIds.length > 0) {
                    console.log(`⚡ Found ${messageIds.length} new emails to ${targetEmail} (${elapsed}s elapsed)`);
                    const emails = await imap.fetchEmails(messageIds);
                    
                    // Process emails in reverse order (newest first) and stop at first code
                    for (let i = emails.length - 1; i >= 0; i--) {
                        const email = emails[i];
                        console.log(`📧 Processing email ${i+1}/${emails.length}: Subject="${email.subject}", From="${email.from}"`);
                        const codes = OTPExtractor.extractVerificationCodes(email, targetEmail);
                        
                        if (codes.length > 0) {
                            const primaryCode = codes[0];
                            const waitTime = Date.now() - startTime;
                            console.log(`🎯 INSTANT: Found verification code: ${primaryCode.code} (${waitTime}ms)`);
                            
                            return {
                                success: true,
                                codes: codes,
                                primaryCode: primaryCode,
                                waitTime: waitTime
                            };
                        }
                    }
                    
                    console.log(`❌ No verification codes found in ${emails.length} new emails`);
                } else {
                    console.log(`⏳ No new emails found, checking again in ${checkInterval/1000}s... (${elapsed}s elapsed)`);
                }
                
                lastCheckTime = Date.now();
                
                // Wait before next check
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }
            
        } catch (error) {
            console.error('Error checking emails:', error);
            return {
                success: false,
                codes: [],
                message: `Error: ${error.message}`
            };
        }
    }

    async disconnect() {
        if (this.connection) {
            await this.connection.disconnect();
        }
    }
}

// Discord bot functions
async function registerCommands() {
    const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);
    
    const commands = [
        {
            name: 'otp',
            description: 'Fetch OTP codes for a specific email',
            options: [{
                name: 'email',
                description: 'Email address to check',
                type: 3, // STRING
                required: true
            }]
        },
        {
            name: 'watchotp',
            description: 'Start monitoring for new OTP codes',
            options: [{
                name: 'email',
                description: 'Email address to monitor',
                type: 3, // STRING
                required: true
            }]
        },
        {
            name: 'checkotp',
            description: 'Check for existing OTP codes',
            options: [{
                name: 'email',
                description: 'Email address to check',
                type: 3, // STRING
                required: true
            }]
        },
        {
            name: 'stopwatch',
            description: 'Stop monitoring for OTP codes'
        },
        {
            name: 'help',
            description: 'Show available commands'
        },
        {
            name: 'status',
            description: 'Show bot status'
        },
        {
            name: 'domains',
            description: 'Show supported domains'
        }
    ];

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

function validateCatchAllEmail(email) {
    if (!email || typeof email !== 'string') {
        return { valid: false, message: 'Email address is required' };
    }

    const domain = email.split('@')[1];
    if (!domain) {
        return { valid: false, message: 'Invalid email format' };
    }

    const isSupported = SUPPORTED_DOMAINS.some(supportedDomain => 
        domain.toLowerCase() === supportedDomain.toLowerCase()
    );

    if (!isSupported) {
        return { 
            valid: false, 
            message: `Email domain not supported. Supported domains: ${SUPPORTED_DOMAINS.join(', ')}` 
        };
    }

    return { valid: true, message: 'Email is valid' };
}

// Send OTP codes to Discord
async function sendOTPToDiscord(otpCodes, interaction = null) {
    if (otpCodes.length === 0) return;

    // If interaction is provided, reply to the interaction
    if (interaction) {
        for (const otp of otpCodes) {
            const embed = new MessageEmbed()
                .setColor('#00ff00')
                .setTitle('🔐 OTP Code Found!')
                .setDescription(`**Code:** \`${otp.code}\``)
                .addFields(
                    { name: '📧 Subject', value: otp.subject, inline: true },
                    { name: '📮 To', value: otp.to, inline: true },
                    { name: '📅 Date', value: otp.date.toLocaleString(), inline: true },
                    { name: '🎯 Pattern', value: otp.pattern, inline: true }
                )
                .setFooter({ text: 'OTP Bot' })
                .setTimestamp();

            try {
                await interaction.editReply({ embeds: [embed] });
                console.log(`Sent OTP code ${otp.code} via interaction`);
            } catch (error) {
                console.error('Error sending OTP via interaction:', error);
                try {
                    await interaction.followUp({ 
                        content: `🔐 **OTP Code Found:** \`${otp.code}\`\n📧 Subject: ${otp.subject}`, 
                        ephemeral: true 
                    });
                } catch (followUpError) {
                    console.error('Error with followUp:', followUpError);
                }
            }
        }
        return;
    }

    // Fallback to channel message if no interaction
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) {
        console.error('Discord channel not found!');
        return;
    }

    for (const otp of otpCodes) {
        const embed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('🔐 OTP Code Found!')
            .setDescription(`**Code:** \`${otp.code}\``)
            .addFields(
                { name: '📧 Subject', value: otp.subject, inline: true },
                { name: '📮 To', value: otp.to, inline: true },
                { name: '📅 Date', value: otp.date.toLocaleString(), inline: true },
                { name: '🎯 Pattern', value: otp.pattern, inline: true }
            )
            .setFooter({ text: 'OTP Bot' })
            .setTimestamp();

        try {
            await channel.send({ embeds: [embed] });
            console.log(`Sent OTP code ${otp.code} to Discord channel`);
        } catch (error) {
            console.error('Error sending OTP to Discord channel:', error);
        }
    }
}

// Main email checking function
async function checkForNewOTPs(targetEmail = null, interaction = null) {
    const emailChecker = new EmailOTPChecker();
    
    try {
        const result = await emailChecker.waitForVerificationEmail(targetEmail, {
            checkInterval: 100   // Check every 0.1 seconds (ultra fast)
        });
        
        if (result.success && result.codes.length > 0) {
            await sendOTPToDiscord([result.primaryCode], interaction);
            return {
                otps: [result.primaryCode],
                waitTime: result.waitTime
            };
        } else {
            console.log('No new OTP codes found');
            if (interaction) {
                await interaction.followUp({ 
                    content: result.message || '❌ No OTP codes found.', 
                    ephemeral: true 
                });
            }
            return { otps: [] };
        }
    } catch (error) {
        console.error('Error checking emails:', error);
        if (interaction) {
            await interaction.followUp({ 
                content: '❌ Error checking emails. Please try again.', 
                ephemeral: true 
            });
        }
        return { otps: [] };
    } finally {
        await emailChecker.disconnect();
    }
}

// Discord bot events
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready to find OTP codes!');
    console.log(`Supported domains: ${SUPPORTED_DOMAINS.join(', ')}`);
    
    // Register slash commands
    registerCommands();
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'otp') {
        const email = interaction.options.getString('email');
        
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (error) {
            console.log('Interaction already acknowledged, continuing...');
        }
        
        // Validate catch-all email
        const validation = validateCatchAllEmail(email);
        if (!validation.valid) {
            try {
                await interaction.editReply(`❌ ${validation.message}`);
            } catch (error) {
                await interaction.followUp({ content: `❌ ${validation.message}`, ephemeral: true });
            }
            return;
        }

        try {
            await interaction.editReply(`🔍 Continuously monitoring for NEW OTP codes for ${email}...`);
        } catch (error) {
            await interaction.followUp({ content: `🔍 Continuously monitoring for NEW OTP codes for ${email}...`, ephemeral: true });
        }
        
        try {
            const result = await checkForNewOTPs(email, interaction);
            const otps = result.otps || [];
            
            if (otps.length > 0) {
                const waitTimeSeconds = Math.floor((result.waitTime || 0) / 1000);
                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setTitle('🔐 OTP Code Found!')
                    .setDescription(`Found OTP code for **${email}** in **${waitTimeSeconds} seconds**`)
                    .addFields(
                        { name: '📧 Email', value: email, inline: true },
                        { name: '🔢 Code', value: `\`${otps[0].code}\``, inline: true },
                        { name: '⏱️ Wait Time', value: `${waitTimeSeconds}s`, inline: true },
                        { name: '📅 Date', value: otps[0].date.toLocaleString(), inline: true }
                    )
                    .setFooter({ text: 'Discord OTP Finder Bot' })
                    .setTimestamp();

                try {
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    await interaction.followUp({ 
                        content: `✅ Found OTP code: \`${otps[0].code}\` for ${email} (found in ${waitTimeSeconds}s)`, 
                        ephemeral: true 
                    });
                }
            }
        } catch (error) {
            console.error('Error processing OTP command:', error);
            try {
                await interaction.editReply('❌ Error processing request. Please try again.');
            } catch (error) {
                await interaction.followUp({ 
                    content: '❌ Error processing request. Please try again.', 
                    ephemeral: true 
                });
            }
        }
    } else if (commandName === 'watchotp') {
        const email = interaction.options.getString('email');
        
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (error) {
            console.log('Interaction already acknowledged, continuing...');
        }
        
        // Validate catch-all email
        const validation = validateCatchAllEmail(email);
        if (!validation.valid) {
            try {
                await interaction.editReply(`❌ ${validation.message}`);
            } catch (error) {
                await interaction.followUp({ content: `❌ ${validation.message}`, ephemeral: true });
            }
            return;
        }

        try {
            await interaction.editReply(`🔍 Starting to monitor for OTP codes for ${email}...`);
        } catch (error) {
            await interaction.followUp({ content: `🔍 Starting to monitor for OTP codes for ${email}...`, ephemeral: true });
        }
        
        // Start monitoring
        const checkInterval = parseInt(process.env.CHECK_INTERVAL) || 30000;
        const monitorInterval = setInterval(async () => {
            try {
                await checkForNewOTPs(email, interaction);
            } catch (error) {
                console.error('Error in monitoring:', error);
            }
        }, checkInterval);

        // Store the interval for later cleanup
        client.monitoringIntervals = client.monitoringIntervals || new Collection();
        client.monitoringIntervals.set(email, monitorInterval);

        try {
            await interaction.followUp({ 
                content: `✅ Now monitoring for OTP codes for ${email}. Use /stopwatch to stop monitoring.`, 
                ephemeral: true 
            });
        } catch (error) {
            console.error('Error with followUp:', error);
        }
    } else if (commandName === 'checkotp') {
        const email = interaction.options.getString('email');
        
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (error) {
            console.log('Interaction already acknowledged, continuing...');
        }
        
        // Validate catch-all email
        const validation = validateCatchAllEmail(email);
        if (!validation.valid) {
            try {
                await interaction.editReply(`❌ ${validation.message}`);
            } catch (error) {
                await interaction.followUp({ content: `❌ ${validation.message}`, ephemeral: true });
            }
            return;
        }

        try {
            await interaction.editReply(`🔍 Checking for existing OTP codes for ${email}...`);
        } catch (error) {
            await interaction.followUp({ content: `🔍 Checking for existing OTP codes for ${email}...`, ephemeral: true });
        }
        
        try {
            const otps = await checkForNewOTPs(email, interaction);
            
            if (otps.length > 0) {
                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setTitle('🔐 Existing OTP Codes Found!')
                    .setDescription(`Found **${otps.length}** existing OTP code(s) for **${email}**`)
                    .addFields(
                        { name: '📧 Email', value: email, inline: true },
                        { name: '🔢 Code', value: `\`${otps[0].code}\``, inline: true },
                        { name: '📅 Date', value: otps[0].date.toLocaleString(), inline: true }
                    )
                    .setFooter({ text: 'Discord OTP Finder Bot' })
                    .setTimestamp();

                try {
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    await interaction.followUp({ 
                        content: `✅ Found existing OTP code: \`${otps[0].code}\` for ${email}`, 
                        ephemeral: true 
                    });
                }
            }
        } catch (error) {
            console.error('Error processing checkotp command:', error);
            try {
                await interaction.editReply('❌ Error processing request. Please try again.');
            } catch (error) {
                await interaction.followUp({ 
                    content: '❌ Error processing request. Please try again.', 
                    ephemeral: true 
                });
            }
        }
    } else if (commandName === 'stopwatch') {
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (error) {
            console.log('Interaction already acknowledged, continuing...');
        }
        
        if (client.monitoringIntervals && client.monitoringIntervals.size > 0) {
            client.monitoringIntervals.forEach((interval, email) => {
                clearInterval(interval);
                console.log(`Stopped monitoring for ${email}`);
            });
            client.monitoringIntervals.clear();
            
            try {
                await interaction.editReply('✅ Stopped monitoring for OTP codes.');
            } catch (error) {
                await interaction.followUp({ 
                    content: '✅ Stopped monitoring for OTP codes.', 
                    ephemeral: true 
                });
            }
        } else {
            try {
                await interaction.editReply('❌ No active monitoring to stop.');
            } catch (error) {
                await interaction.followUp({ 
                    content: '❌ No active monitoring to stop.', 
                    ephemeral: true 
                });
            }
        }
    } else if (commandName === 'help') {
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('🔐 OTP Bot Help')
            .setDescription('Available commands:')
            .addFields(
                { name: '/otp <email>', value: 'Fetch OTP codes for a specific email', inline: false },
                { name: '/watchotp <email>', value: 'Start monitoring for new OTP codes', inline: false },
                { name: '/checkotp <email>', value: 'Check for existing OTP codes', inline: false },
                { name: '/stopwatch', value: 'Stop monitoring for OTP codes', inline: false },
                { name: '/status', value: 'Show bot status', inline: false },
                { name: '/domains', value: 'Show supported domains', inline: false }
            )
            .setFooter({ text: 'Discord OTP Finder Bot' })
            .setTimestamp();

        try {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error sending help:', error);
        }
    } else if (commandName === 'status') {
        const embed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('🤖 Bot Status')
            .setDescription('Bot is running and ready to find OTP codes!')
            .addFields(
                { name: '🟢 Status', value: 'Online', inline: true },
                { name: '📧 Email Server', value: 'Connected', inline: true },
                { name: '🔍 Monitoring', value: client.monitoringIntervals && client.monitoringIntervals.size > 0 ? 'Active' : 'Inactive', inline: true }
            )
            .setFooter({ text: 'Discord OTP Finder Bot' })
            .setTimestamp();

        try {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error sending status:', error);
        }
    } else if (commandName === 'domains') {
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('🌐 Supported Domains')
            .setDescription(`The bot supports catch-all emails from these domains:`)
            .addFields(
                { name: '📧 Domains', value: SUPPORTED_DOMAINS.join('\n'), inline: false }
            )
            .setFooter({ text: 'Discord OTP Finder Bot' })
            .setTimestamp();

        try {
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error sending domains:', error);
        }
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN); 