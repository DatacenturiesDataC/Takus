// Takus — Google Docs Integration
import { GoogleAuth } from './google-auth.js';

export class GoogleDocs {
  constructor() {
    this.auth = GoogleAuth.getInstance();
  }

  /**
   * Creates a beautifully formatted Google Doc containing the meeting summary and transcript.
   * @param {string} title 
   * @param {string} summary 
   * @param {string} transcript 
   * @param {string} videoLink 
   * @returns {Promise<string>} The URL of the created Google Doc
   */
  async createMeetingDoc(title, summary, transcript, videoLink) {
    await this.auth.loadAPI('docs', 'v1');
    const token = await this.auth.ensureValidToken();

    // 1. Create a blank document
    const createResp = await fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: `${title} — Meeting Notes` })
    });

    if (!createResp.ok) {
      throw new Error(`Failed to create Google Doc: ${await createResp.text()}`);
    }

    const doc = await createResp.json();
    const documentId = doc.documentId;

    // 2. Build the document content
    const dateStr = new Date().toLocaleString();
    let textToInsert = `Takus Meeting Notes\n\n`;
    textToInsert += `Date: ${dateStr}\n`;
    if (videoLink) {
      textToInsert += `Recording Link: ${videoLink}\n`;
    }
    textToInsert += `\n---\n\n`;
    
    if (summary) {
      textToInsert += `Summary & Action Items\n`;
      textToInsert += `${summary}\n\n`;
      textToInsert += `---\n\n`;
    }
    
    if (transcript) {
      textToInsert += `Full Transcript\n`;
      textToInsert += `${transcript}\n`;
    }

    // 3. Batch update to insert text and apply basic formatting
    const requests = [
      {
        insertText: {
          location: { index: 1 },
          text: textToInsert
        }
      },
      // Format Title
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 20 }, // "Takus Meeting Notes"
          paragraphStyle: { namedStyleType: 'HEADING_1' },
          fields: 'namedStyleType'
        }
      }
    ];

    await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests })
    });

    return `https://docs.google.com/document/d/${documentId}/edit`;
  }
}
