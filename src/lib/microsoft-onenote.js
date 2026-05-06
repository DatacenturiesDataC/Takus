// Takus — Microsoft OneNote Integration (meeting notes via Graph API)
// Mirrors GoogleDocs interface for the provider abstraction.
// OneNote is used instead of Word because Graph API natively accepts HTML for pages.

import { MicrosoftAuth } from './microsoft-auth.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class MicrosoftOneNote {
  constructor() {
    this.auth = MicrosoftAuth.getInstance();
    this._sectionId = null;
  }

  /**
   * Creates a OneNote page with meeting summary and transcript.
   * @param {string} title
   * @param {string} summary
   * @param {string} transcript
   * @param {string} videoLink
   * @returns {Promise<string>} The URL of the created OneNote page
   */
  async createMeetingDoc(title, summary, transcript, videoLink) {
    const token = await this.auth.ensureValidToken();

    // Ensure we have a "Takus Recordings" section
    const sectionId = await this._ensureSection(token);

    // Build HTML page content
    const dateStr = new Date().toLocaleString();
    const safeTitle = escHtml(title);
    const safeSummary = escHtml(summary || '').replace(/\n/g, '<br>');
    const safeTranscript = escHtml(transcript || '').replace(/\n/g, '<br>');
    const safeLink = escHtml(videoLink || '');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${safeTitle} — Meeting Notes</title>
</head>
<body>
  <h1>Takus Meeting Notes</h1>
  <p><strong>Date:</strong> ${escHtml(dateStr)}</p>
  ${videoLink ? `<p><strong>Recording:</strong> <a href="${safeLink}">${safeLink}</a></p>` : ''}
  <hr>
  ${summary ? `
  <h2>Summary &amp; Action Items</h2>
  <p>${safeSummary}</p>
  <hr>
  ` : ''}
  ${transcript ? `
  <h2>Full Transcript</h2>
  <p style="font-size:11px;color:#666;">${safeTranscript}</p>
  ` : ''}
</body>
</html>`;

    // Create the page
    const resp = await fetch(`${GRAPH_BASE}/me/onenote/sections/${sectionId}/pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/html',
      },
      body: html,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`OneNote page creation failed (HTTP ${resp.status}): ${errText}`);
    }

    const page = await resp.json();
    return page.links?.oneNoteWebUrl?.href || page.self || '';
  }

  /**
   * Ensure a "Takus Recordings" section exists in the default notebook.
   * Caches the section ID for subsequent calls.
   */
  async _ensureSection(token) {
    if (this._sectionId) return this._sectionId;

    const SECTION_NAME = 'Takus Recordings';

    // List sections across all notebooks
    const listResp = await fetch(
      `${GRAPH_BASE}/me/onenote/sections?$filter=displayName eq '${SECTION_NAME}'&$select=id,displayName`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (listResp.ok) {
      const data = await listResp.json();
      if (data.value?.length > 0) {
        this._sectionId = data.value[0].id;
        return this._sectionId;
      }
    }

    // Get default notebook (or create one)
    let notebookId = null;
    const nbResp = await fetch(
      `${GRAPH_BASE}/me/onenote/notebooks?$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (nbResp.ok) {
      const nbData = await nbResp.json();
      if (nbData.value?.length > 0) {
        notebookId = nbData.value[0].id;
      }
    }

    if (!notebookId) {
      // Create default notebook
      const createNb = await fetch(`${GRAPH_BASE}/me/onenote/notebooks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: 'Takus' }),
      });
      if (!createNb.ok) throw new Error('Could not create OneNote notebook');
      const nb = await createNb.json();
      notebookId = nb.id;
    }

    // Create section
    const createSection = await fetch(`${GRAPH_BASE}/me/onenote/notebooks/${notebookId}/sections`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: SECTION_NAME }),
    });

    if (!createSection.ok) throw new Error('Could not create OneNote section');
    const section = await createSection.json();
    this._sectionId = section.id;
    return this._sectionId;
  }
}

/** Escape HTML to prevent injection in OneNote page content */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
