// Takus — Email Inbound Adapter
//
// Pulls emails into the Takus knowledge graph via provider-specific APIs.
// Supports Gmail (Google API) and Outlook (Microsoft Graph API).
// Leverages existing auth infrastructure from google-auth.js and microsoft-auth.js.
//
// Phase C: Bidirectional Integration Framework

import { InboundAdapter } from '../inbound-adapter.js';

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const GRAPH_API = 'https://graph.microsoft.com/v1.0/me';

export class EmailInboundAdapter extends InboundAdapter {
  constructor() {
    super({
      id: 'email',
      name: 'Email',
      icon: '📧',
      description: 'Import emails from Gmail or Outlook into your knowledge base.',
    });
    this._provider = null; // 'google' | 'microsoft'
    this._lastSyncTime = null;
  }

  /**
   * Connect using the existing cloud provider auth.
   * @param {{ provider: 'google'|'microsoft', auth: object, query?: string, maxResults?: number }} config
   */
  async connect(config) {
    if (!config?.provider) throw new Error('Email provider is required (google or microsoft)');
    if (!config?.auth) throw new Error('Auth instance is required');

    this._provider = config.provider;
    this._config = {
      auth: config.auth,
      query: config.query || 'is:starred',       // Gmail: starred; Outlook: flagged
      maxResults: config.maxResults ?? 20,
      labelFilter: config.labelFilter || null,    // Gmail label ID filter
    };

    // Validate auth by testing a minimal API call
    const token = await config.auth.ensureValidToken();
    if (!token) throw new Error('Auth token unavailable');

    this._connected = true;
  }

  /**
   * Poll for new emails.
   * @returns {Promise<object[]>} Raw email objects
   */
  async poll() {
    if (!this._connected) return [];

    return this._provider === 'google'
      ? this._pollGmail()
      : this._pollOutlook();
  }

  /**
   * Normalize an email into a NormalizedContent object.
   * @param {object} email — Raw email (provider-specific)
   * @returns {import('../inbound-adapter.js').NormalizedContent}
   */
  normalize(email) {
    const subject = email.subject || 'No Subject';
    const body = email.body || '';
    const sender = email.from || '';
    const recipients = email.to || [];
    const timestamp = email.date || Date.now();

    return {
      title: subject,
      content: _buildEmailContent(sender, recipients, subject, body),
      type: 'email',
      source: 'email',
      sourceKey: `email:${email.messageId || email.id}`,
      metadata: {
        provider: this._provider,
        messageId: email.messageId || email.id,
        from: sender,
        to: recipients,
        cc: email.cc || [],
        threadId: email.threadId || null,
        labels: email.labels || [],
        isStarred: email.isStarred || false,
      },
      tags: ['email', `from:${_extractEmailAddr(sender)}`],
      timestamp,
    };
  }

  // ── Gmail Implementation ─────────────────────────────────────────────────

  async _pollGmail() {
    const { auth, query, maxResults } = this._config;
    const token = await auth.ensureValidToken();

    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
    });
    if (this._lastSyncTime) {
      params.set('q', `${query} after:${Math.floor(this._lastSyncTime / 1000)}`);
    }

    const listRes = await fetch(`${GMAIL_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    if (!listData.messages?.length) return [];

    const emails = [];
    // Fetch each message (batch would be better but adds complexity)
    for (const stub of listData.messages.slice(0, maxResults)) {
      try {
        const msgRes = await fetch(`${GMAIL_API}/messages/${stub.id}?format=full`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const msg = await msgRes.json();
        emails.push(_parseGmailMessage(msg));
      } catch (e) {
        console.warn(`[Email] Failed to fetch Gmail message ${stub.id}:`, e.message);
      }
    }

    this._lastSyncTime = Date.now();
    return emails;
  }

  // ── Outlook Implementation ───────────────────────────────────────────────

  async _pollOutlook() {
    const { auth, maxResults } = this._config;
    const token = await auth.ensureValidToken();

    let filter = "flag/flagStatus eq 'flagged'";
    if (this._lastSyncTime) {
      const since = new Date(this._lastSyncTime).toISOString();
      filter += ` and receivedDateTime ge ${since}`;
    }

    const params = new URLSearchParams({
      $filter: filter,
      $top: String(maxResults),
      $select: 'id,subject,from,toRecipients,ccRecipients,body,receivedDateTime,conversationId,flag',
      $orderby: 'receivedDateTime desc',
    });

    const res = await fetch(`${GRAPH_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.value?.length) return [];

    this._lastSyncTime = Date.now();

    return data.value.map(msg => ({
      id: msg.id,
      messageId: msg.id,
      subject: msg.subject || 'No Subject',
      from: msg.from?.emailAddress?.address || '',
      to: (msg.toRecipients || []).map(r => r.emailAddress?.address || ''),
      cc: (msg.ccRecipients || []).map(r => r.emailAddress?.address || ''),
      body: msg.body?.content || '',
      date: new Date(msg.receivedDateTime).getTime(),
      threadId: msg.conversationId || null,
      isStarred: msg.flag?.flagStatus === 'flagged',
      labels: [],
    }));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a Gmail API message into a normalized shape.
 */
function _parseGmailMessage(msg) {
  const headers = msg.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  let body = '';
  // Attempt to extract plain text body
  if (msg.payload?.body?.data) {
    body = _decodeBase64Url(msg.payload.body.data);
  } else if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = _decodeBase64Url(textPart.body.data);
    } else {
      // Fallback to HTML part, strip tags
      const htmlPart = msg.payload.parts.find(p => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        body = _decodeBase64Url(htmlPart.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  const toAddresses = getHeader('To').split(',').map(a => a.trim()).filter(Boolean);
  const ccAddresses = getHeader('Cc').split(',').map(a => a.trim()).filter(Boolean);

  return {
    id: msg.id,
    messageId: getHeader('Message-ID') || msg.id,
    subject: getHeader('Subject'),
    from: getHeader('From'),
    to: toAddresses,
    cc: ccAddresses,
    body,
    date: parseInt(msg.internalDate, 10) || Date.now(),
    threadId: msg.threadId || null,
    isStarred: (msg.labelIds || []).includes('STARRED'),
    labels: msg.labelIds || [],
  };
}

/**
 * Decode base64url-encoded string (Gmail API format).
 */
function _decodeBase64Url(str) {
  try {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch {
    return str;
  }
}

/**
 * Build a rich email content string for the knowledge pipeline.
 */
function _buildEmailContent(from, to, subject, body) {
  const lines = [
    `From: ${from}`,
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    `Subject: ${subject}`,
    '',
    body,
  ];
  return lines.join('\n');
}

/**
 * Extract a bare email address from a "Name <email>" string.
 */
function _extractEmailAddr(str) {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str;
}
