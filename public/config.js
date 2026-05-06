// Takus — Runtime Configuration
// Edit this file to configure your Google and Microsoft OAuth credentials.
// See setup-guide.md for step-by-step instructions.
window.__TAKUS_CONFIG__ = {
  google: {
    clientId: '355589548775-lq746fgnon7krulr18lv1tt7avall91c.apps.googleusercontent.com',
  },
  drive: {
    folderName: 'Takus Recordings',
    makePublic: false,
  },
  calendar: {
    enabled: true,
  },
  microsoft: {
    clientId: '08f421ef-7b08-488a-abdf-5751237e9c33',
    // Tenant-scoped authority — only users in this Entra directory can sign in.
    // Change to 'https://login.microsoftonline.com/common' to allow any
    // work / school / personal Microsoft account, or '/organizations'
    // to allow any work or school account from any tenant.
    authority: 'https://login.microsoftonline.com/68b33d85-a56d-4f39-a4c3-17ec235d73a8',
  },
};
