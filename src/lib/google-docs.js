// Takus — Google Docs Integration
import { GoogleAuth } from './google-auth.js';
import { getTaskTitle } from './task-helpers.js';

export class GoogleDocs {
  constructor() {
    this.auth = GoogleAuth.getInstance();
  }

  /**
   * Creates a beautifully formatted Google Doc containing the meeting summary,
   * tasks with steps/objectives, and transcript.
   * @param {string} title 
   * @param {string} summary 
   * @param {string} transcript 
   * @param {string} videoLink
   * @param {{ takusTasks?:Array, meTasks?:Array }} [tasks]
   * @returns {Promise<string>} The URL of the created Google Doc
   */
  async createMeetingDoc(title, summary, transcript, videoLink, tasks) {
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

    // 2. Build the document content and track section positions for heading formatting
    const dateStr = new Date().toLocaleString();
    const titleText = title || 'Takus Meeting Notes';
    const summaryHeading = 'Summary & Action Items';
    const transcriptHeading = 'Full Transcript';

    let textToInsert = `${titleText}\n\n`;
    textToInsert += `Date: ${dateStr}\n`;
    if (videoLink) {
      textToInsert += `Recording Link: ${videoLink}\n`;
    }
    textToInsert += `\n---\n\n`;

    // Track heading positions (1-indexed from document start)
    let summaryHeadingStart = -1;
    let transcriptHeadingStart = -1;

    if (summary) {
      summaryHeadingStart = textToInsert.length;
      textToInsert += `${summaryHeading}\n`;
      textToInsert += `${summary}\n\n`;
      textToInsert += `---\n\n`;
    }

    // Tasks section
    let tasksHeadingStart = -1;
    const tasksHeading = 'Tasks & Action Items';
    const allTasks = [...(tasks?.takusTasks || []), ...(tasks?.meTasks || [])];
    if (allTasks.length) {
      tasksHeadingStart = textToInsert.length;
      textToInsert += `${tasksHeading}\n\n`;
      for (const t of allTasks) {
        const statusIcon = t.status === 'done' ? '✅' : t.status === 'ignored' ? '🚫' : '⏳';
        const title = getTaskTitle(t, 'Untitled');
        textToInsert += `${statusIcon} ${title}\n`;
        if (t.objective) textToInsert += `   → Objective: ${t.objective}\n`;
        if (t.steps?.length) {
          for (const step of t.steps) {
            textToInsert += `   ${step.status === 'completed' ? '☑' : '☐'} ${step.text}\n`;
          }
        }
        if (t.output) textToInsert += `   Output: ${t.output}\n`;
        if (t.ignoredReason) textToInsert += `   Reason: ${t.ignoredReason}\n`;
        if (t.integrations?.length) textToInsert += `   Integrations: ${t.integrations.join(', ')}\n`;
        textToInsert += `\n`;
      }
      textToInsert += `---\n\n`;
    }

    if (transcript) {
      transcriptHeadingStart = textToInsert.length;
      textToInsert += `${transcriptHeading}\n`;
      textToInsert += `${transcript}\n`;
    }

    // 3. Batch update to insert text and apply formatting
    const requests = [
      {
        insertText: {
          location: { index: 1 },
          text: textToInsert
        }
      },
      // Format document title as HEADING_1
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 1 + titleText.length + 1 },
          paragraphStyle: { namedStyleType: 'HEADING_1' },
          fields: 'namedStyleType'
        }
      }
    ];

    // Format section headings as HEADING_2 for document outline navigation
    if (summaryHeadingStart >= 0) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: 1 + summaryHeadingStart,
            endIndex: 1 + summaryHeadingStart + summaryHeading.length + 1
          },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType'
        }
      });
    }
    if (tasksHeadingStart >= 0) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: 1 + tasksHeadingStart,
            endIndex: 1 + tasksHeadingStart + tasksHeading.length + 1
          },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType'
        }
      });
    }
    if (transcriptHeadingStart >= 0) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: 1 + transcriptHeadingStart,
            endIndex: 1 + transcriptHeadingStart + transcriptHeading.length + 1
          },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType'
        }
      });
    }

    const formatResp = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests })
    });

    if (!formatResp.ok) {
      console.warn('[Docs] Formatting failed but document was created:', await formatResp.text());
    }

    return `https://docs.google.com/document/d/${documentId}/edit`;
  }
}
