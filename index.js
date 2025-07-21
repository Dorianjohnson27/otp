require('dotenv').config();
const { Client, Intents, MessageEmbed } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');

// Initialize Discord client
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
    ]
});

// Store active OTP watchers
const activeWatchers = new Map();

// Email connection management
let emailConnection = null;
let isConnecting = false;
let connectionQueue = [];
let lastConnectionTime = 0;
const CONNECTION_COOLDOWN = 2000; // 2 seconds between connections

// Supported catch-all domains
const SUPPORTED_DOMAINS = process.env.SUPPORTED_DOMAINS ? process.env.SUPPORTED_DOMAINS.split(',') : ['familyfeastadmin.xyz', 'bigboyent.xyz'];

// Define slash commands
const commands = [
    {
        name: 'otp',
        description: 'Fetch OTP codes for a catch-all email',
        options: [
            {
                name: 'email',
                description: 'The catch-all email address (familyfeastadmin.xyz or bigboyent.xyz)',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'watchotp',
        description: 'Start watching for OTP codes for a catch-all email',
        options: [
            {
                name: 'email',
                description: 'The catch-all email address to monitor',
                type: 3, // STRING
                required: true
            },
            {
                name: 'timeout',
                description: 'How long to watch for OTP (in minutes, default: 10)',
                type: 4, // INTEGER
                required: false
            }
        ]
    },
    {
        name: 'checkotp',
        description: 'Manually check for new OTP codes'
    },
    {
        name: 'stopwatch',
        description: 'Stop watching for OTP codes'
    },
    {
        name: 'help',
        description: 'Show help information'
    },
    {
        name: 'status',
        description: 'Show bot status and configuration'
    },
    {
        name: 'domains',
        description: 'Show supported catch-all domains'
    }
];

// Register slash commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Validate catch-all email
function validateCatchAllEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, message: 'Invalid email format' };
    }
    
    const domain = email.split('@')[1];
    if (!SUPPORTED_DOMAINS.includes(domain)) {
        return { 
            valid: false, 
            message: `Only supported domains: ${SUPPORTED_DOMAINS.join(', ')}` 
        };
    }
    
    return { valid: true, domain: domain };
}

// Email checking function with connection management
async function checkEmailsForOTP(targetEmail = null) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        
        // Check if we need to wait due to cooldown
        if (now - lastConnectionTime < CONNECTION_COOLDOWN) {
            const waitTime = CONNECTION_COOLDOWN - (now - lastConnectionTime);
            console.log(`Waiting ${waitTime}ms before next connection...`);
            setTimeout(() => {
                checkEmailsForOTP(targetEmail).then(resolve).catch(reject);
            }, waitTime);
            return;
        }
        
        // If already connecting, queue this request
        if (isConnecting) {
            connectionQueue.push({ targetEmail, resolve, reject });
            return;
        }

        // If we have an active connection, end it first
        if (emailConnection) {
            emailConnection.end();
            emailConnection = null;
        }

        isConnecting = true;
        lastConnectionTime = now;
        
        const imap = new Imap({
            user: process.env.EMAIL_USER,
            password: process.env.EMAIL_PASSWORD,
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 60000, // 60 second timeout
            authTimeout: 30000   // 30 second auth timeout
        });

        emailConnection = imap;
        const emails = [];

        imap.once('ready', () => {
            imap.openBox(process.env.EMAIL_FOLDER, false, (err, box) => {
                if (err) {
                    isConnecting = false;
                    emailConnection = null;
                    reject(err);
                    return;
                }

                // Search for recent emails - if target email is provided, search for that specific email
                // Otherwise, search for all emails from supported domains
                let searchCriteria;
                if (targetEmail) {
                    searchCriteria = [
                        ['TO', targetEmail],
                        ['SINCE', new Date(Date.now() - (parseInt(process.env.MAX_EMAIL_AGE_HOURS) * 60 * 60 * 1000))]
                    ];
                } else {
                    // Search for emails to any address in supported domains
                    searchCriteria = [
                        ['SINCE', new Date(Date.now() - (parseInt(process.env.MAX_EMAIL_AGE_HOURS) * 60 * 60 * 1000))]
                    ];
                }

                imap.search(searchCriteria, (err, results) => {
                    if (err) {
                        isConnecting = false;
                        emailConnection = null;
                        reject(err);
                        return;
                    }

                    if (results.length === 0) {
                        imap.end();
                        isConnecting = false;
                        emailConnection = null;
                        resolve([]);
                        return;
                    }

                    const fetch = imap.fetch(results, { bodies: '' });

                    fetch.on('message', (msg, seqno) => {
                        msg.on('body', (stream) => {
                            simpleParser(stream, (err, parsed) => {
                                if (err) return;
                                
                                // Filter emails to supported domains if no specific target
                                if (!targetEmail) {
                                    const toAddresses = parsed.to ? parsed.to.text : '';
                                    const hasSupportedDomain = SUPPORTED_DOMAINS.some(domain => 
                                        toAddresses.toLowerCase().includes(domain)
                                    );
                                    if (!hasSupportedDomain) return;
                                }
                                
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
                        isConnecting = false;
                        emailConnection = null;
                        reject(err);
                    });

                    fetch.once('end', () => {
                        imap.end();
                        isConnecting = false;
                        emailConnection = null;
                        resolve(emails);
                        
                        // Process queued requests
                        if (connectionQueue.length > 0) {
                            const nextRequest = connectionQueue.shift();
                            setTimeout(() => {
                                checkEmailsForOTP(nextRequest.targetEmail)
                                    .then(nextRequest.resolve)
                                    .catch(nextRequest.reject);
                            }, CONNECTION_COOLDOWN); // Wait 2 seconds between connections
                        }
                    });
                });
            });
        });

        imap.once('error', (err) => {
            console.error('IMAP connection error:', err.message);
            isConnecting = false;
            emailConnection = null;
            
            // If it's a connection limit error, wait longer
            if (err.textCode === 'ALERT' && err.message.includes('Too many simultaneous connections')) {
                console.log('Connection limit reached, waiting 5 seconds...');
                setTimeout(() => {
                    checkEmailsForOTP(targetEmail).then(resolve).catch(reject);
                }, 5000);
            } else {
                reject(err);
            }
        });

        imap.connect();
    });
}

// Extract OTP codes from email content
function extractOTPCodes(emailContent, targetEmail = null) {
    const otpCodes = [];
    
    // Priority patterns for verification codes - more specific for Uber
    const priorityPatterns = [
        /enter this verification code[:\s]*(\d{4,6})/gi, // "enter this verification code: 1234"
        /verification code[:\s]*(\d{4,6})/gi,  // "verification code: 1234"
        /your code[:\s]*(\d{4,6})/gi,          // "your code: 1234"  
        /code[:\s]*(\d{4,6})/gi,               // "code: 1234"
        /enter this verification code[^]*?(\d{4,6})/gi,   // "enter this verification code... 1234"
    ];

    // General patterns - but only if no priority matches found
    const generalPatterns = [
        /\b\d{4}\b/g,                          // 4-digit codes
        /\b\d{6}\b/g,                          // 6-digit codes
    ];
    
    // Check if email subject contains "Your Uber verification code" or "Your Uber account verification code"
    const isUberVerificationEmail = emailContent.subject.toLowerCase().includes('your uber verification code') || 
                                   emailContent.subject.toLowerCase().includes('your uber account verification code');
    
    // If target email is specified, check if the email is sent to that specific address
    const isTargetEmail = targetEmail ? 
        emailContent.to.toLowerCase().includes(targetEmail.toLowerCase()) : 
        true;
    
    if (isUberVerificationEmail && isTargetEmail) {
        console.log(`Processing Uber email: Subject="${emailContent.subject}", To="${emailContent.to}"`);
        
        // Try priority patterns first (more specific)
        let foundPriorityMatch = false;
        for (const pattern of priorityPatterns) {
            const matches = emailContent.text.match(pattern);
            if (matches) {
                console.log(`Found ${matches.length} matches with priority pattern: ${pattern}`);
                // Only take the first match to avoid duplicates
                const match = matches[0];
                const code = match.match(/\d{4,6}/)[0];
                if (code && code.length >= 4 && code.length <= 6) {
                    console.log(`🎯 Extracted priority code: ${code}`);
                    otpCodes.push({
                        code: code,
                        subject: emailContent.subject,
                        to: emailContent.to,
                        date: emailContent.date,
                        targetEmail: targetEmail,
                        pattern: 'priority'
                    });
                }
                foundPriorityMatch = true;
                break; // Stop after finding priority matches
            }
        }
        
        // If no priority matches found, try general patterns
        if (!foundPriorityMatch) {
            for (const pattern of generalPatterns) {
                const matches = emailContent.text.match(pattern);
                if (matches) {
                    console.log(`Found ${matches.length} matches with general pattern: ${pattern}`);
                    // Only take the first match to avoid duplicates
                    const match = matches[0];
                    if (match.length >= 4 && match.length <= 6) {
                        console.log(`🎯 Extracted general code: ${match}`);
                        otpCodes.push({
                            code: match,
                            subject: emailContent.subject,
                            to: emailContent.to,
                            date: emailContent.date,
                            targetEmail: targetEmail,
                            pattern: 'general'
                        });
                    }
                    break; // Stop after finding first general match
                }
            }
        }
        
        console.log(`Extracted ${otpCodes.length} OTP codes from email`);
    }

    return otpCodes;
}

// Send OTP codes to Discord
async function sendOTPToDiscord(otpCodes, interaction = null) {
    if (otpCodes.length === 0) return;

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
                { name: '🎯 Target Email', value: otp.targetEmail || 'All', inline: true },
                { name: '🔍 Pattern', value: otp.pattern || 'Unknown', inline: true },
                { name: '🔍 Source', value: 'Uber Verification Email', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Discord OTP Finder Bot' });

        try {
            await channel.send({ embeds: [embed] });
            console.log(`OTP code ${otp.code} sent to Discord`);
            
            // If this was triggered by an interaction, also reply to the user
            if (interaction) {
                await interaction.followUp({ 
                    content: `✅ Found Uber OTP code: \`${otp.code}\` for ${otp.targetEmail || otp.to}`, 
                    ephemeral: true 
                });
            }
        } catch (error) {
            console.error('Error sending OTP to Discord channel:', error);
            
            // If channel send fails, try to reply to interaction
            if (interaction) {
                try {
                    await interaction.followUp({ 
                        content: `✅ Found Uber OTP code: \`${otp.code}\` for ${otp.targetEmail || otp.to}`, 
                        ephemeral: true 
                    });
                } catch (followUpError) {
                    console.error('Error with interaction followUp:', followUpError);
                }
            }
        }
    }
}

// Main email checking function
async function checkForNewOTPs(targetEmail = null, interaction = null) {
    try {
        console.log(`Checking for new OTP emails${targetEmail ? ` for ${targetEmail}` : ''}...`);
        const emails = await checkEmailsForOTP(targetEmail);
        
        console.log(`Found ${emails.length} emails to check`);
        
        const allOTPs = [];
        for (const email of emails) {
            console.log(`Checking email: Subject="${email.subject}", To="${email.to}"`);
            const otps = extractOTPCodes(email, targetEmail);
            if (otps.length > 0) {
                console.log(`Found ${otps.length} OTP codes in email`);
            }
            allOTPs.push(...otps);
        }

        if (allOTPs.length > 0) {
            // Sort by date to get the most recent OTP
            allOTPs.sort((a, b) => new Date(b.date) - new Date(a.date));
            const mostRecentOTP = allOTPs[0];
            
            console.log(`Found ${allOTPs.length} OTP code(s), most recent: ${mostRecentOTP.code}`);
            
            // Send only the most recent OTP
            await sendOTPToDiscord([mostRecentOTP], interaction);
            return [mostRecentOTP];
        } else {
            console.log('No new OTP codes found');
            if (interaction) {
                await interaction.followUp({ 
                    content: '❌ No OTP codes found in recent emails.', 
                    ephemeral: true 
                });
            }
            return [];
        }
    } catch (error) {
        console.error('Error checking emails:', error);
        if (interaction) {
            await interaction.followUp({ 
                content: '❌ Error checking emails. Please try again.', 
                ephemeral: true 
            });
        }
        return [];
    }
}

// Discord bot events
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready to find OTP codes!');
    console.log(`Supported domains: ${SUPPORTED_DOMAINS.join(', ')}`);
    
    // Register slash commands
    registerCommands();
    
    // Start checking emails periodically for default target
    const checkInterval = parseInt(process.env.CHECK_INTERVAL) || 30000;
    setInterval(() => checkForNewOTPs(), checkInterval);
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
            await interaction.editReply(`🔍 Fetching OTP codes for ${email}...`);
        } catch (error) {
            await interaction.followUp({ content: `🔍 Fetching OTP codes for ${email}...`, ephemeral: true });
        }
        
        try {
            const otps = await checkForNewOTPs(email, interaction);
            
            if (otps.length > 0) {
                const embed = new MessageEmbed()
                    .setColor('#00ff00')
                    .setTitle('🔐 OTP Codes Found!')
                    .setDescription(`Found **${otps.length}** OTP code(s) for **${email}**`)
                    .addFields(
                        ...otps.map((otp, index) => ({
                            name: `Code ${index + 1}`,
                            value: `\`${otp.code}\` - ${otp.subject}`,
                            inline: false
                        }))
                    )
                    .setTimestamp()
                    .setFooter('Discord OTP Finder Bot');

                try {
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    await interaction.followUp({ embeds: [embed], ephemeral: true });
                }
            } else {
                try {
                    await interaction.editReply(`❌ No OTP codes found for ${email} in recent emails.`);
                } catch (error) {
                    await interaction.followUp({ content: `❌ No OTP codes found for ${email} in recent emails.`, ephemeral: true });
                }
            }
        } catch (error) {
            console.error('Error fetching OTP:', error);
            try {
                await interaction.editReply('❌ Error fetching OTP codes. Please try again.');
            } catch (error) {
                await interaction.followUp({ content: '❌ Error fetching OTP codes. Please try again.', ephemeral: true });
            }
        }
    }

    if (commandName === 'watchotp') {
        const email = interaction.options.getString('email');
        const timeout = interaction.options.getInteger('timeout') || 10;
        
        await interaction.deferReply({ ephemeral: true });
        
        // Validate catch-all email
        const validation = validateCatchAllEmail(email);
        if (!validation.valid) {
            await interaction.editReply(`❌ ${validation.message}`);
            return;
        }

        // Start watching for this email
        const userId = interaction.user.id;
        const watcher = {
            email: email,
            timeout: timeout * 60 * 1000, // Convert to milliseconds
            startTime: Date.now(),
            interval: null
        };

        activeWatchers.set(userId, watcher);

        // Set up periodic checking for this specific email
        watcher.interval = setInterval(async () => {
            const otps = await checkForNewOTPs(email, interaction);
            if (otps.length > 0) {
                // Stop watching after finding OTP
                clearInterval(watcher.interval);
                activeWatchers.delete(userId);
            }
        }, 10000); // Check every 10 seconds

        // Set timeout to stop watching
        setTimeout(() => {
            if (activeWatchers.has(userId)) {
                clearInterval(watcher.interval);
                activeWatchers.delete(userId);
                interaction.followUp({ 
                    content: `⏰ Timeout reached. Stopped watching for OTP codes for ${email}`, 
                    ephemeral: true 
                });
            }
        }, watcher.timeout);

        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('👀 Watching for OTP Codes')
            .setDescription(`Now monitoring catch-all emails for: **${email}**`)
            .addFields(
                { name: '⏰ Timeout', value: `${timeout} minutes`, inline: true },
                { name: '🔄 Check Interval', value: 'Every 10 seconds', inline: true },
                { name: '📧 Email Source', value: process.env.EMAIL_USER, inline: true },
                { name: '🏷️ Domain', value: validation.domain, inline: true }
            )
            .setTimestamp()
            .setFooter('Use /stopwatch to stop monitoring');

        await interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'checkotp') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply('🔍 Checking for new OTP codes...');
        await checkForNewOTPs(null, interaction);
    }

    if (commandName === 'stopwatch') {
        const userId = interaction.user.id;
        
        if (activeWatchers.has(userId)) {
            const watcher = activeWatchers.get(userId);
            clearInterval(watcher.interval);
            activeWatchers.delete(userId);
            
            await interaction.reply({ 
                content: `✅ Stopped watching for OTP codes for ${watcher.email}`, 
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: '❌ You are not currently watching for any OTP codes.', 
                ephemeral: true 
            });
        }
    }

    if (commandName === 'domains') {
        const domainsEmbed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('🏷️ Supported Catch-All Domains')
            .setDescription('These are the supported domains for catch-all email OTP fetching:')
            .addFields(
                ...SUPPORTED_DOMAINS.map((domain, index) => ({
                    name: `Domain ${index + 1}`,
                    value: `**${domain}**`,
                    inline: true
                }))
            )
            .addFields(
                { name: '📝 Usage', value: 'Use `/otp email@domain.xyz` to fetch OTP codes', inline: false }
            )
            .setTimestamp()
            .setFooter('Discord OTP Finder Bot');

        await interaction.reply({ embeds: [domainsEmbed], ephemeral: true });
    }

    if (commandName === 'help') {
        const helpEmbed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('🤖 Discord OTP Finder Bot')
            .setDescription('A bot that finds OTP codes from catch-all emails')
            .addFields(
                { name: '/otp', value: 'Fetch OTP codes for a catch-all email', inline: true },
                { name: '/watchotp', value: 'Start watching for OTP codes', inline: true },
                { name: '/checkotp', value: 'Manually check for new OTP codes', inline: true },
                { name: '/stopwatch', value: 'Stop watching for OTP codes', inline: true },
                { name: '/domains', value: 'Show supported catch-all domains', inline: true },
                { name: '/help', value: 'Show this help message', inline: true },
                { name: '/status', value: 'Show bot status and configuration', inline: true }
            )
            .addFields(
                { name: '🏷️ Supported Domains', value: SUPPORTED_DOMAINS.join(', '), inline: false }
            )
            .setTimestamp()
            .setFooter('Discord OTP Finder Bot');

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    if (commandName === 'status') {
        const statusEmbed = new MessageEmbed()
            .setColor('#00ff00')
            .setTitle('📊 Bot Status')
            .addFields(
                { name: '🟢 Status', value: 'Online', inline: true },
                { name: '📧 Email', value: process.env.EMAIL_USER, inline: true },
                { name: '🏷️ Domains', value: SUPPORTED_DOMAINS.join(', '), inline: true },
                { name: '⏰ Check Interval', value: `${parseInt(process.env.CHECK_INTERVAL) / 1000}s`, inline: true },
                { name: '👀 Active Watchers', value: activeWatchers.size.toString(), inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [statusEmbed], ephemeral: true });
    }
});

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Start the bot
client.login(process.env.DISCORD_TOKEN); 