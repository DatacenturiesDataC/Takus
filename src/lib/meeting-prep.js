// Takus — Meeting Prep Engine (Knowledge OS: Intelligence Layer)
// Cross-references calendar events with contacts, recordings, and tasks
// to generate structured preparation packages.

import { getContacts, getRecordings, getAllInteractions, getNodesByType } from './storage.js';
import { computeClosenessScore } from './closeness-score.js';
import { getKnowledgeLevelInfo } from './knowledge-level.js';
import { getTaskStatus, getTaskTitle } from './task-helpers.js';

/**
 * Generate a meeting preparation package for an upcoming calendar event.
 *
 * @param {object} calendarEvent  NormalizedEvent from calendar-poller
 * @param {object} options
 * @param {number} options.maxPreviousMeetings  Max related recordings to return (default 5)
 * @param {number} options.maxTasks             Max open tasks to return (default 10)
 * @returns {Promise<MeetingPrepPackage>}
 */
export async function generateMeetingPrep(calendarEvent, options = {}) {
  const maxPrev = options.maxPreviousMeetings || 5;
  const maxTasks = options.maxTasks || 10;

  try {
    const [contacts, recordings, interactions] = await Promise.all([
      getContacts(),
      getRecordings(),
      getAllInteractions(),
    ]);

    // ── Match attendees to contacts ───────────────────────────────────────────
    const attendeeEmails = new Set([
      ...(calendarEvent.attendees || []),
      ...(calendarEvent.organizers || []),
    ].map(e => e.toLowerCase()));

    const matchedContacts = contacts
      .filter(c => c.email && attendeeEmails.has(c.email.toLowerCase()))
      .map(c => {
        const contactInteractions = interactions.filter(i => i.contactId === c.id);
        const closeness = computeClosenessScore(c, contactInteractions);
        const level = c.knowledgeLevel || 'L4';
        return {
          id: c.id,
          name: c.name || c.email,
          email: c.email,
          closenessScore: closeness,
          knowledgeLevel: level,
          knowledgeLevelInfo: getKnowledgeLevelInfo(level),
        };
      })
      .sort((a, b) => b.closenessScore - a.closenessScore);

    // ── Find previous recordings with shared attendees ────────────────────────
    const contactIds = new Set(matchedContacts.map(c => c.id));
    const contactEmails = new Set(matchedContacts.map(c => c.email?.toLowerCase()).filter(Boolean));

    const previousMeetings = recordings
      .filter(r => {
        if (!r.date || new Date(r.date).getTime() >= new Date(calendarEvent.start).getTime()) return false;
        // Check if recording has attendee overlap
        const recAttendees = _extractRecordingAttendees(r);
        return recAttendees.some(email => contactEmails.has(email.toLowerCase()));
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, maxPrev)
      .map(r => ({
        id: r.id,
        title: r.title || 'Untitled',
        date: r.date,
        type: r.type,
        sharedAttendees: _extractRecordingAttendees(r)
          .filter(e => contactEmails.has(e.toLowerCase())),
        hasSummary: !!r.aiSummary,
      }));

    // ── Collect open tasks from matched recordings ────────────────────────────
    const openTasks = [];
    for (const rec of recordings) {
      const tasks = rec.tasks || {};
      for (const list of [tasks.takusTasks || [], tasks.meTasks || []]) {
        for (const task of list) {
          const status = getTaskStatus(task);
          if (status !== 'pending') continue;

          // Include if the task mentions an attendee or came from a shared recording
          const recAttendees = _extractRecordingAttendees(rec);
          const hasOverlap = recAttendees.some(e => contactEmails.has(e.toLowerCase()));
          const assigneeName = (task.assignee || '').toLowerCase();
          const mentionsAttendee = matchedContacts.some(c =>
            c.name?.toLowerCase() === assigneeName ||
            c.email?.toLowerCase() === assigneeName
          );

          if (hasOverlap || mentionsAttendee) {
            openTasks.push({
              text: getTaskTitle(task),
              action: task.action || 'PERSONAL',
              assignee: task.assignee,
              recordingTitle: rec.title || 'Untitled',
              recordingId: rec.id,
            });
            if (openTasks.length >= maxTasks) break;
          }
        }
        if (openTasks.length >= maxTasks) break;
      }
      if (openTasks.length >= maxTasks) break;
    }

    // ── Extract key decisions from previous meetings ──────────────────────────
    const keyDecisions = [];
    for (const prev of previousMeetings) {
      const fullRec = recordings.find(r => r.id === prev.id);
      if (fullRec?.aiSummary) {
        const decisions = _extractDecisions(fullRec.aiSummary);
        for (const d of decisions) {
          keyDecisions.push({
            decision: d,
            recordingTitle: prev.title,
            recordingId: prev.id,
            date: prev.date,
          });
        }
      }
    }

    return {
      event: {
        title: calendarEvent.title,
        start: calendarEvent.start,
        end: calendarEvent.end,
        conferenceUrl: calendarEvent.conferenceUrl,
      },
      attendees: matchedContacts,
      previousMeetings,
      openTasks,
      keyDecisions: keyDecisions.slice(0, 10),
      goalContext: await _getGoalContext(matchedContacts),
      preparedAt: Date.now(),
    };
  } catch (e) {
    console.warn('[MeetingPrep] generateMeetingPrep failed:', e.message);
    return {
      event: { title: calendarEvent?.title || 'Unknown', start: calendarEvent?.start, end: calendarEvent?.end },
      attendees: [], previousMeetings: [], openTasks: [], keyDecisions: [], goalContext: [],
      preparedAt: Date.now(), error: e.message,
    };
  }
}

/**
 * Check if a meeting prep should be shown (event is within the given window).
 * @param {object} calendarEvent
 * @param {number} windowMinutes  Minutes before the event to show prep (default 60)
 * @returns {boolean}
 */
export function shouldShowMeetingPrep(calendarEvent, windowMinutes = 60) {
  if (!calendarEvent?.start) return false;
  const now = Date.now();
  const start = new Date(calendarEvent.start).getTime();
  const diff = start - now;
  return diff > 0 && diff <= windowMinutes * 60 * 1000;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract attendee emails from recording metadata.
 * Recordings store attendees from calendar event matching or AI extraction.
 */
function _extractRecordingAttendees(recording) {
  const attendees = [];

  // From calendar-linked event
  if (recording.calendarEvent?.attendees) {
    attendees.push(...recording.calendarEvent.attendees);
  }

  // From AI-extracted participants
  if (recording.aiParticipants) {
    for (const p of recording.aiParticipants) {
      if (p.email) attendees.push(p.email);
    }
  }

  return [...new Set(attendees.map(e => e.toLowerCase()))];
}

/**
 * Extract decision-like sentences from an AI summary.
 * Looks for common decision markers in meeting summaries.
 */
function _extractDecisions(aiSummary) {
  if (!aiSummary) return [];

  const decisions = [];
  const lines = aiSummary.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Look for decision markers
    if (
      /^[-*]\s*(decided|agreed|approved|confirmed|resolved|committed|will proceed)/i.test(trimmed) ||
      /\b(decision|agreed to|signed off|approved|green.?lit)\b/i.test(trimmed)
    ) {
      decisions.push(trimmed.replace(/^[-*]\s*/, ''));
    }
  }

  return decisions;
}

/**
 * Load goals relevant to meeting attendees.
 * Looks for INVOLVES edges between contacts and goals.
 * Platform-agnostic: goals linked from any source are included.
 */
async function _getGoalContext(attendeeContacts) {
  try {
    const { getEdgesFromNode } = await import('./storage.js');
    const goals = await getNodesByType('goal');
    if (!goals.length || !attendeeContacts.length) return [];

    // Collect INVOLVES edges from each attendee contact
    const involvesEdges = [];
    for (const contact of attendeeContacts) {
      const edges = await getEdgesFromNode('contact', contact.id).catch(() => []);
      for (const e of edges) {
        if (e.edgeType === 'INVOLVES' && e.targetType === 'goal') {
          involvesEdges.push(e);
        }
      }
    }

    if (!involvesEdges.length) return [];

    const goalIds = new Set(involvesEdges.map(e => e.targetId));

    // Include active/at-risk goals linked to attendees
    const openGoals = goals.filter(g => {
      const state = g.properties?.state || 'aspiration';
      if (state === 'achieved' || state === 'abandoned') return false;
      return goalIds.has(g.id);
    });

    return openGoals.map(g => ({
      id: g.id,
      title: g.properties?.title || 'Untitled goal',
      state: g.properties?.state || 'aspiration',
      lastMentionedAt: g.properties?.lastMentionedAt || null,
      linkedContacts: involvesEdges
        .filter(e => e.targetId === g.id)
        .map(e => attendeeContacts.find(c => c.id === e.sourceId)?.name)
        .filter(Boolean),
    }));
  } catch {
    return [];
  }
}
