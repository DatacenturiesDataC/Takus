class GoogleDriveAPI {
    constructor() {
        this.isInitialized = false;
        this.isAuthenticated = false;
        this.gapi = null;

        // Get configuration from config.js
        this.CLIENT_ID = window.CONFIG?.GOOGLE?.CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
        this.API_KEY = window.CONFIG?.GOOGLE?.API_KEY || 'YOUR_GOOGLE_API_KEY';
        this.SCOPES = window.CONFIG?.GOOGLE?.SCOPES?.join(' ') || 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar';

        this.initializeGoogleAPI();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const connectBtn = document.getElementById('connectDriveBtn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => this.authenticate());
        }
    }

    async initializeGoogleAPI() {
        try {
            console.log('🔧 Initializing Google API with new Identity Services...');
            console.log('Client ID:', this.CLIENT_ID);
            console.log('Scopes:', this.SCOPES);

            // Load Google API scripts if not already loaded
            if (!window.gapi || !window.google?.accounts) {
                console.log('📦 Loading Google API scripts...');
                await this.loadGoogleAPIScript();
            }

            this.gapi = window.gapi;
            console.log('✅ Google scripts loaded');

            // Just load the client library, don't initialize yet
            console.log('🚀 Loading client library...');
            await new Promise((resolve, reject) => {
                this.gapi.load('client', {
                    callback: resolve,
                    onerror: reject
                });
            });
            console.log('✅ Client library loaded');

            // Initialize the new Google Identity Services OAuth client
            console.log('🆔 Initializing OAuth client...');
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.CLIENT_ID,
                scope: this.SCOPES,
                callback: (response) => {
                    if (response.error) {
                        console.error('❌ OAuth callback error:', response);
                        this.updateConnectionStatus(false, `Auth error: ${response.error}`);
                    } else {
                        console.log('✅ OAuth token received');
                        this.isAuthenticated = true;
                        this.accessToken = response.access_token;

                        // Now initialize the API client with the token
                        this.initializeAPIClient().then(() => {
                            this.updateConnectionStatus(true);
                            console.log('✅ Google Drive API ready');
                        }).catch((error) => {
                            console.error('❌ Failed to initialize API client:', error);
                            this.updateConnectionStatus(false, 'Failed to load Drive API');
                        });
                    }
                }
            });

            this.isInitialized = true;
            console.log('✅ Google Identity Services initialized successfully');

            // Check if we have a stored token (basic check)
            this.updateConnectionStatus(false, 'Ready to connect');
            console.log('👤 Ready for authentication');

        } catch (error) {
            console.error('❌ Failed to initialize Google API:', error);
            console.error('Error details:', error.message || 'Unknown error');
            console.error('Full error object:', JSON.stringify(error, null, 2));

            let errorMessage = 'Initialization failed';
            if (error.message) {
                errorMessage = error.message;
            } else if (error.details) {
                errorMessage = error.details;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            this.updateConnectionStatus(false, errorMessage);
        }
    }

    async loadGoogleAPIScript() {
        // Load the new Google Identity Services library
        const gisPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.onload = () => {
                console.log('✅ Google Identity Services loaded');
                resolve();
            };
            script.onerror = (error) => {
                console.error('❌ Failed to load Google Identity Services:', error);
                reject(new Error('Failed to load Google Identity Services'));
            };
            document.head.appendChild(script);
        });

        // Load the Google API client library
        const gapiPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.onload = () => {
                console.log('✅ Google API client loaded');
                resolve();
            };
            script.onerror = (error) => {
                console.error('❌ Failed to load Google API client:', error);
                reject(new Error('Failed to load Google API client'));
            };
            document.head.appendChild(script);
        });

        // Wait for both scripts to load
        await Promise.all([gisPromise, gapiPromise]);
    }

    async initializeAPIClient() {
        try {
            console.log('🔐 Initializing API client with authentication...');

            // Initialize the client with minimal config
            await this.gapi.client.init({});
            console.log('✅ API client initialized');

            // Set the access token
            this.gapi.client.setToken({
                access_token: this.accessToken
            });
            console.log('✅ Access token set');

            // Load the APIs we need
            console.log('📋 Loading Google APIs...');
            await this.gapi.client.load('drive', 'v3');
            await this.gapi.client.load('calendar', 'v3');
            console.log('✅ Google APIs loaded');

        } catch (error) {
            console.error('❌ Failed to initialize API client:', error);
            throw error;
        }
    }

    async authenticate() {
        if (!this.isInitialized) {
            this.updateConnectionStatus(false, 'Google API not initialized');
            return;
        }

        try {
            console.log('🔐 Starting authentication with Google Identity Services...');

            // Request access token using the new OAuth 2.0 flow
            this.updateConnectionStatus(false, 'Requesting permissions...');
            this.tokenClient.requestAccessToken({
                prompt: 'consent' // Always show consent screen for new permissions
            });

            // The callback in initializeGoogleAPI will handle the response

        } catch (error) {
            console.error('❌ Authentication failed:', error);
            console.error('Error details:', error.message || 'Unknown auth error');

            let errorMessage = 'Authentication failed';
            if (error.message) {
                errorMessage = error.message;
            }

            this.updateConnectionStatus(false, errorMessage);
        }
    }

    async uploadFile(fileBlob, filename) {
        if (!this.isAuthenticated || !this.accessToken) {
            throw new Error('Not authenticated with Google Drive');
        }

        try {
            // Ensure we have a valid token set
            this.gapi.client.setToken({
                access_token: this.accessToken
            });

            // Make sure Drive API is loaded
            if (!this.gapi.client.drive) {
                console.log('📋 Loading Drive API for upload...');
                await this.gapi.client.load('drive', 'v3');
            }

            // Create a folder for recordings if it doesn't exist
            const folderId = await this.ensureRecordingsFolder();

            // Prepare file metadata
            const metadata = {
                name: filename,
                parents: [folderId],
                description: `Google Meet recording uploaded on ${new Date().toLocaleString()}`
            };

            // Convert blob to base64
            const base64Data = await this.blobToBase64(fileBlob);

            // Upload file
            const response = await this.gapi.client.request({
                path: 'https://www.googleapis.com/upload/drive/v3/files',
                method: 'POST',
                params: {
                    uploadType: 'multipart'
                },
                headers: {
                    'Content-Type': 'multipart/related; boundary="foo_bar_baz"'
                },
                body: this.createMultipartBody(metadata, base64Data, fileBlob.type)
            });

            const fileId = response.result.id;

            // Make file shareable
            await this.makeFileShareable(fileId);

            // Get shareable link
            const shareableLink = `https://drive.google.com/file/d/${fileId}/view`;

            // Try to add to calendar if possible
            try {
                await this.addToCalendar(filename, shareableLink);
            } catch (calendarError) {
                console.warn('Could not add to calendar:', calendarError);
            }

            return {
                fileId: fileId,
                shareableLink: shareableLink,
                fileName: filename
            };

        } catch (error) {
            console.error('Upload failed:', error);
            throw new Error(`Upload failed: ${error.message}`);
        }
    }

    async ensureRecordingsFolder() {
        try {
            // Search for existing folder
            const response = await this.gapi.client.drive.files.list({
                q: "name='Google Meet Recordings' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                spaces: 'drive'
            });

            if (response.result.files.length > 0) {
                return response.result.files[0].id;
            }

            // Create folder if it doesn't exist
            const folderResponse = await this.gapi.client.drive.files.create({
                resource: {
                    name: 'Google Meet Recordings',
                    mimeType: 'application/vnd.google-apps.folder'
                }
            });

            return folderResponse.result.id;

        } catch (error) {
            console.error('Failed to create recordings folder:', error);
            // Return null to upload to root directory
            return null;
        }
    }

    async makeFileShareable(fileId) {
        try {
            await this.gapi.client.drive.permissions.create({
                fileId: fileId,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
        } catch (error) {
            console.warn('Could not make file publicly shareable:', error);
        }
    }

    async addToCalendar(recordingTitle, shareableLink) {
        try {
            // Make sure Calendar API is loaded
            if (!this.gapi.client.calendar) {
                console.log('📅 Loading Calendar API...');
                await this.gapi.client.load('calendar', 'v3');
            }

            // Get today's events to find the meeting
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

            const response = await this.gapi.client.calendar.events.list({
                calendarId: 'primary',
                timeMin: todayStart.toISOString(),
                timeMax: todayEnd.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            // Find a meeting that might match
            const events = response.result.items || [];
            const meetingEvent = events.find(event =>
                event.summary && (
                    event.summary.toLowerCase().includes('meet') ||
                    event.conferenceData?.entryPoints?.some(entry =>
                        entry.uri && entry.uri.includes('meet.google.com')
                    )
                )
            );

            if (meetingEvent) {
                // Update the event description with the recording link
                const currentDescription = meetingEvent.description || '';
                const recordingNote = `\n\n📹 Recording: ${shareableLink}\n(Uploaded: ${new Date().toLocaleString()})`;

                await this.gapi.client.calendar.events.patch({
                    calendarId: 'primary',
                    eventId: meetingEvent.id,
                    resource: {
                        description: currentDescription + recordingNote
                    }
                });

                console.log('Recording link added to calendar event');
            }

        } catch (error) {
            console.error('Failed to add to calendar:', error);
            throw error;
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    createMultipartBody(metadata, data, contentType) {
        const delimiter = 'foo_bar_baz';
        const close_delim = `\r\n--${delimiter}--`;

        let body = `--${delimiter}\r\n`;
        body += 'Content-Type: application/json\r\n\r\n';
        body += JSON.stringify(metadata) + '\r\n';
        body += `--${delimiter}\r\n`;
        body += `Content-Type: ${contentType}\r\n`;
        body += 'Content-Transfer-Encoding: base64\r\n\r\n';
        body += data;
        body += close_delim;

        return body;
    }

    updateConnectionStatus(isConnected, message = '') {
        const indicator = document.getElementById('driveIndicator');
        const status = document.getElementById('driveStatus');
        const connectBtn = document.getElementById('connectDriveBtn');

        if (isConnected) {
            indicator.classList.add('connected');
            status.textContent = 'Connected';
            connectBtn.textContent = '✓ Connected to Google Drive';
            connectBtn.disabled = true;
        } else {
            indicator.classList.remove('connected');
            status.textContent = message || 'Not connected';
            connectBtn.textContent = 'Connect Google Drive';
            connectBtn.disabled = false;
        }
    }

    isConnected() {
        return this.isAuthenticated;
    }

    disconnect() {
        if (this.isAuthenticated) {
            // Revoke the access token
            if (this.accessToken) {
                google.accounts.oauth2.revoke(this.accessToken, () => {
                    console.log('🔓 Access token revoked');
                });
            }

            // Clear the token from the API client
            this.gapi.client.setToken(null);

            this.isAuthenticated = false;
            this.accessToken = null;
            this.updateConnectionStatus(false, 'Disconnected');
            console.log('👤 User signed out');
        }
    }
}

// Configuration helper
class GoogleAPIConfig {
    static showSetupInstructions() {
        const instructions = `
🚀 Google API Setup Instructions:

1. Go to the Google Cloud Console: https://console.cloud.google.com/
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google Drive API
   - Google Calendar API
4. Create credentials (OAuth 2.0 Client IDs):
   - Application type: Web application
   - Authorized JavaScript origins: Add your domain (e.g., https://yourusername.github.io)
5. Replace the placeholder values in google-api.js:
   - CLIENT_ID: Your OAuth 2.0 Client ID
   - API_KEY: Your API key (if needed)

📋 Required Scopes:
- https://www.googleapis.com/auth/drive.file
- https://www.googleapis.com/auth/calendar

💡 For GitHub Pages deployment:
- https://yourusername.github.io
- https://your-custom-domain.com

⚠️  Make sure to add your HTTPS domain to authorized origins in the Google Cloud Console!
        `;

        console.log(instructions);
        alert('Google API setup required! Check the console for detailed instructions.');
    }

    static validateConfig() {
        // Check if CONFIG is available and properly configured
        if (!window.CONFIG ||
            !window.CONFIG.GOOGLE ||
            window.CONFIG.GOOGLE.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE' ||
            !window.CONFIG.GOOGLE.CLIENT_ID) {
            return false;
        }
        return true;
    }

    static showTroubleshootingHelp() {
        const help = `
🔍 Google API Troubleshooting:

COMMON ISSUES:

1. "Google API not initialized":
   ✅ Check: Is your Client ID correct in config.js?
   ✅ Check: Are the required APIs enabled in Google Cloud Console?
   ✅ Check: Is your HTTPS domain added to Authorized JavaScript origins?
   ✅ Check: Updated to use new Google Identity Services (not deprecated auth2)

2. Domain not authorized:
   🔧 Solution: Add your HTTPS domain to your OAuth 2.0 client configuration

3. API not enabled:
   🔧 Solution: Enable Google Drive API and Google Calendar API in Google Cloud Console

4. Network issues:
   🔧 Solution: Check internet connection and firewall settings

🌐 Google Cloud Console: https://console.cloud.google.com/
📍 APIs & Services > Credentials > OAuth 2.0 Client IDs

Need help? Check the browser console (F12) for detailed error messages.
        `;

        console.log(help);
        alert('Check the console for troubleshooting help!');
    }
}

// Initialize Google Drive API when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM loaded, checking configuration...');

    // Check if configuration is set up
    if (!GoogleAPIConfig.validateConfig()) {
        console.log('❌ Configuration not valid');
        GoogleAPIConfig.showSetupInstructions();

        // Update UI to show setup needed
        const driveStatus = document.getElementById('driveStatus');
        const connectBtn = document.getElementById('connectDriveBtn');

        if (driveStatus) driveStatus.textContent = 'Setup required';
        if (connectBtn) {
            connectBtn.textContent = '⚙️ Setup Required';
            connectBtn.onclick = () => GoogleAPIConfig.showSetupInstructions();
        }

        // Add troubleshooting button
        const troubleshootBtn = document.createElement('button');
        troubleshootBtn.className = 'btn btn-info';
        troubleshootBtn.innerHTML = '<i class="fas fa-question-circle"></i> Troubleshoot';
        troubleshootBtn.onclick = () => GoogleAPIConfig.showTroubleshootingHelp();
        if (connectBtn && connectBtn.parentNode) {
            connectBtn.parentNode.appendChild(troubleshootBtn);
        }
    } else {
        console.log('✅ Configuration valid, initializing API...');
        // Initialize the API
        window.GoogleDriveAPI = new GoogleDriveAPI();
    }
}); 