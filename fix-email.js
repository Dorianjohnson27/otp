require('dotenv').config();
const Imap = require('imap');

console.log('🔧 Email Credentials Fix Helper');
console.log('================================\n');

console.log('📧 Current Email Configuration:');
console.log(`   Host: ${process.env.EMAIL_HOST}`);
console.log(`   Port: ${process.env.EMAIL_PORT}`);
console.log(`   User: ${process.env.EMAIL_USER}`);
console.log(`   Password: ${process.env.EMAIL_PASSWORD ? '***' : 'NOT SET'}`);
console.log(`   Folder: ${process.env.EMAIL_FOLDER}\n`);

console.log('🔍 Testing email connection...');

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
    console.log('🎉 Your email credentials are working correctly.');
    imap.end();
});

imap.once('error', (err) => {
    console.log('❌ Email connection failed:', err.message);
    console.log('\n🔧 To fix this issue:');
    console.log('1. Go to https://myaccount.google.com/security');
    console.log('2. Enable 2-Step Verification if not already enabled');
    console.log('3. Go to "App passwords"');
    console.log('4. Select "Mail" and generate a new password');
    console.log('5. Copy the 16-character password');
    console.log('6. Update EMAIL_PASSWORD in your .env file');
    console.log('\n📝 Example:');
    console.log('   EMAIL_PASSWORD=abcd efgh ijkl mnop');
    console.log('   (remove spaces when adding to .env)');
});

imap.connect(); 