const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { app, BrowserWindow } = require('electron');

// You'll need to replace these with your own credentials from Google Cloud Console
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks.readonly'
];

function getUserInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function getAuthClient() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oAuth2Client.setCredentials(token);
    } catch (err) {
        // If no token exists, create it before starting the main app
        if (!fs.existsSync(TOKEN_PATH)) {
            console.log('No token found. Please authenticate first by running: npm run auth');
            app.quit();
            return null;
        }
    }

    return oAuth2Client;
}

async function performAuth() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('Authorize this app by visiting this url:', authUrl);
    
    rl.question('Enter the code from that page here: ', async (code) => {
        rl.close();
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            console.log('Token stored successfully!');
            process.exit(0);
        } catch (err) {
            console.error('Error retrieving access token', err);
            process.exit(1);
        }
    });
}

module.exports = { getAuthClient, performAuth }; 