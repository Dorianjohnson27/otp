require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');

console.log('🔍 Testing OTP Extraction Fix');
console.log('==============================\n');

const targetEmail = 'danarobinson5268@bigboyent.xyz';

// Email checking function
async function checkEmailsForOTP(targetEmail) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: process.env.EMAIL_USER,
            password: process.env.EMAIL_PASSWORD,
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 60000,
            authTimeout: 30000
        });

        const emails = [];

        imap.once('ready', () => {
            console.log('✅ Connected to email server');
            imap.openBox(process.env.EMAIL_FOLDER, false, (err, box) => {
                if (err) {
                    console.error('❌ Error opening inbox:', err);
                    reject(err);
                    return;
                }

                console.log(`📧 Opened inbox, searching for emails to: ${targetEmail}`);
                
                // Search for emails to the specific address
                const searchCriteria = [
                    ['TO', targetEmail],
                    ['SINCE', new Date(Date.now() - (24 * 60 * 60 * 1000))] // Last 24 hours
                ];

                imap.search(searchCriteria, (err, results) => {
                    if (err) {
                        console.error('❌ Search error:', err);
                        reject(err);
                        return;
                    }

                    console.log(`📬 Found ${results.length} emails to ${targetEmail}`);

                    if (results.length === 0) {
                        imap.end();
                        resolve([]);
                        return;
                    }

                    const fetch = imap.fetch(results, { bodies: '' });

                    fetch.on('message', (msg, seqno) => {
                        console.log(`📨 Processing email ${seqno}`);
                        msg.on('body', (stream) => {
                            simpleParser(stream, (err, parsed) => {
                                if (err) {
                                    console.error('❌ Error parsing email:', err);
                                    return;
                                }
                                
                                const emailContent = {
                                    subject: parsed.subject,
                                    from: parsed.from.text,
                                    to: parsed.to ? parsed.to.text : '',
                                    text: parsed.text,
                                    html: parsed.html,
                                    date: parsed.date
                                };
                                
                                console.log(`📧 Email: Subject="${emailContent.subject}", To="${emailContent.to}"`);
                                emails.push(emailContent);
                            });
                        });
                    });

                    fetch.once('error', (err) => {
                        console.error('❌ Fetch error:', err);
                        reject(err);
                    });

                    fetch.once('end', () => {
                        console.log(`✅ Finished processing ${emails.length} emails`);
                        imap.end();
                        resolve(emails);
                    });
                });
            });
        });

        imap.once('error', (err) => {
            console.error('❌ IMAP connection error:', err.message);
            reject(err);
        });

        imap.connect();
    });
}

// Extract OTP codes from email content - using the same logic as the main bot
function extractOTPCodes(emailContent, targetEmail) {
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
    
    console.log(`🔍 Checking email: Subject="${emailContent.subject}"`);
    console.log(`   Is Uber email: ${isUberVerificationEmail}`);
    console.log(`   To: ${emailContent.to}`);
    console.log(`   Target: ${targetEmail}`);
    
    if (isUberVerificationEmail) {
        console.log(`📝 Email text preview: ${emailContent.text.substring(0, 300)}...`);
        
        // Try priority patterns first (more specific)
        let foundPriorityMatch = false;
        for (const pattern of priorityPatterns) {
            const matches = emailContent.text.match(pattern);
            if (matches) {
                console.log(`✅ Found ${matches.length} matches with priority pattern: ${pattern}`);
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
                    console.log(`✅ Found ${matches.length} matches with general pattern: ${pattern}`);
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
        
        console.log(`📊 Extracted ${otpCodes.length} OTP codes from email`);
    } else {
        console.log(`❌ Not a Uber verification email`);
    }

    return otpCodes;
}

// Main test function
async function testOTPExtraction() {
    try {
        console.log('🔍 Starting OTP extraction test...\n');
        
        const emails = await checkEmailsForOTP(targetEmail);
        console.log(`\n📧 Found ${emails.length} emails to process\n`);
        
        const allOTPs = [];
        for (const email of emails) {
            console.log(`\n🔍 Processing email: ${email.subject}`);
            const otps = extractOTPCodes(email, targetEmail);
            allOTPs.push(...otps);
        }

        console.log(`\n🎉 Final Results:`);
        console.log(`   Total emails found: ${emails.length}`);
        console.log(`   Total OTP codes found: ${allOTPs.length}`);
        
        if (allOTPs.length > 0) {
            // Sort by date to get the most recent OTP
            allOTPs.sort((a, b) => new Date(b.date) - new Date(a.date));
            const mostRecentOTP = allOTPs[0];
            
            console.log(`\n📋 Most Recent OTP:`);
            console.log(`   Code: ${mostRecentOTP.code}`);
            console.log(`   Pattern: ${mostRecentOTP.pattern}`);
            console.log(`   Date: ${mostRecentOTP.date}`);
            console.log(`   Subject: ${mostRecentOTP.subject}`);
        } else {
            console.log(`\n❌ No OTP codes found for ${targetEmail}`);
        }
        
    } catch (error) {
        console.error('❌ Error during test:', error);
    }
}

// Run the test
testOTPExtraction(); 