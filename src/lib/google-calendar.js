// Takus — Google Calendar (smart event matching)
import { GoogleAuth } from './google-auth.js';

export class GoogleCalendar {
  constructor() {
    this.auth = GoogleAuth.getInstance();
  }

  /**
   * Find the most likely calendar event that matches this recording session.
   * Uses a ±2 hour window around the recording time and prioritizes
   * events with Google Meet conference links.
   */
  async findMatchingEvent(recordingStartTime) {
    try {
      await this.auth.loadAPI('calendar', 'v3');

      const windowMs = 2 * 60 * 60 * 1000; // 2 hours
      const start = new Date(recordingStartTime - windowMs);
      const end = new Date(recordingStartTime + windowMs);

      const resp = await window.gapi.client.calendar.events.list({
        calendarId: 'primary',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
      });

      const events = resp.result.items || [];
      if (events.length === 0) return null;

      // Score events by relevance
      const scored = events.map(ev => {
        let score = 0;
        const evStart = new Date(ev.start?.dateTime || ev.start?.date).getTime();
        const timeDiff = Math.abs(evStart - recordingStartTime);

        // Closer in time = higher score (max 50 pts)
        score += Math.max(0, 50 - (timeDiff / 60000));

        // Has Google Meet link = +30 pts
        if (ev.conferenceData?.entryPoints?.some(e => e.uri?.includes('meet.google.com'))) {
          score += 30;
        }
        if (ev.hangoutLink) score += 20;

        // Has video-related words = +10 pts
        const summary = (ev.summary || '').toLowerCase();
        if (['meet', 'call', 'sync', 'standup', 'review', 'interview', 'demo'].some(w => summary.includes(w))) {
          score += 10;
        }

        return { event: ev, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored[0]?.event || null;
    } catch (e) {
      // Calendar is non-critical — don't block the upload flow
      console.warn('[Calendar] Could not match event:', e.message || e);
      return null;
    }
  }

  /**
   * Add recording link to a calendar event's description.
   */
  async addRecordingLink(eventId, driveLink, filename) {
    try {
      await this.auth.loadAPI('calendar', 'v3');

      const eventResp = await window.gapi.client.calendar.events.get({
        calendarId: 'primary',
        eventId: eventId,
      });

      const event = eventResp.result;
      const existing = event.description || '';
      const note = `\n\n📹 Recording: ${driveLink}\n📝 File: ${filename}\n🕐 Uploaded: ${new Date().toLocaleString()}`;

      await window.gapi.client.calendar.events.patch({
        calendarId: 'primary',
        eventId: eventId,
        resource: { description: existing + note },
      });
    } catch (e) {
      console.warn('[Calendar] Could not add recording link:', e.message || e);
    }
  }
}
