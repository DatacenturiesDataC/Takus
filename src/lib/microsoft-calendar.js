// Takus — Microsoft Outlook Calendar (smart event matching via Graph API)
// Mirrors GoogleCalendar interface for the provider abstraction.

import { MicrosoftAuth } from './microsoft-auth.js';
import { MS_PER_HOUR } from './utils.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class MicrosoftCalendar {
  constructor() {
    this.auth = MicrosoftAuth.getInstance();
  }

  /**
   * Find the most likely Outlook calendar event matching this entry.
   * Uses a ±2 hour window and scores by proximity, Teams links, and keywords.
   */
  async findMatchingEvent(captureStartTime) {
    try {
      const token = await this.auth.ensureValidToken();

      const windowMs = 2 * MS_PER_HOUR;
      const start = new Date(captureStartTime - windowMs).toISOString();
      const end = new Date(captureStartTime + windowMs).toISOString();

      const resp = await fetch(
        `${GRAPH_BASE}/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=20&$select=id,subject,start,end,organizer,onlineMeeting,onlineMeetingUrl,bodyPreview,attendees&$orderby=start/dateTime`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Prefer': 'outlook.timezone="UTC"',
          },
        }
      );

      if (!resp.ok) {
        console.warn('[MS Calendar] Event fetch failed:', resp.status);
        return null;
      }

      const data = await resp.json();
      const events = data.value || [];
      if (events.length === 0) return null;

      // Score events by relevance (same algorithm as Google Calendar)
      const scored = events.map(ev => {
        let score = 0;
        const evStart = new Date(ev.start?.dateTime || ev.start?.date).getTime();
        const timeDiff = Math.abs(evStart - captureStartTime);

        // Closer in time = higher score (max 50 pts)
        score += Math.max(0, 50 - (timeDiff / 60000));

        // Has Teams meeting link = +30 pts
        if (ev.onlineMeeting?.joinUrl || ev.onlineMeetingUrl) {
          score += 30;
        }

        // Has video-related words = +10 pts
        const subject = (ev.subject || '').toLowerCase();
        if (['meet', 'call', 'sync', 'standup', 'review', 'interview', 'demo', 'teams'].some(w => subject.includes(w))) {
          score += 10;
        }

        return { event: ev, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const best = scored[0]?.event;
      if (!best) return null;

      // Normalize to provider-neutral shape, extracting attendees
      return {
        id: best.id,
        summary: best.subject || '',
        start: best.start,
        end: best.end,
        organizer: best.organizer?.emailAddress?.name || best.organizer?.emailAddress?.address || null,
        attendees: (best.attendees || [])
          .filter(a => a.emailAddress?.address && a.type !== 'resource')
          .map(a => ({
            name: a.emailAddress.name || a.emailAddress.address.split('@')[0],
            email: a.emailAddress.address,
          })),
      };
    } catch (e) {
      console.warn('[MS Calendar] Could not match event:', e.message || e);
      return null;
    }
  }

  /**
   * Add entry link to an Outlook calendar event's body.
   */
  async addEntryLink(eventId, driveLink, filename) {
    try {
      const token = await this.auth.ensureValidToken();

      // Fetch existing event to get current body
      const getResp = await fetch(`${GRAPH_BASE}/me/events/${eventId}?$select=body`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!getResp.ok) return;

      const event = await getResp.json();
      const existingBody = event.body?.content || '';
      const contentType = event.body?.contentType || 'html';

      const escLink = driveLink.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const escFilename = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const note = contentType === 'html'
        ? `<br><br>📹 <b>Entry:</b> <a href="${escLink}">${escLink}</a><br>📝 <b>File:</b> ${escFilename}<br>🕐 <b>Uploaded:</b> ${new Date().toLocaleString()}`
        : `\n\n📹 Entry: ${driveLink}\n📝 File: ${filename}\n🕐 Uploaded: ${new Date().toLocaleString()}`;

      await fetch(`${GRAPH_BASE}/me/events/${eventId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: {
            contentType,
            content: existingBody + note,
          },
        }),
      });
    } catch (e) {
      console.warn('[MS Calendar] Could not add entry link:', e.message || e);
    }
  }
}
