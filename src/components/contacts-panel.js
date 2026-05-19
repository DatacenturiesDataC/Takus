
// Renders the People tab with contact list, closeness scores,
// knowledge level badges, and contact management.

import { icons } from '../lib/icons.js';
import { esc, getInitials } from '../lib/utils.js';
import { generateId } from '../lib/id.js';
import { getContacts, saveContact, deleteContact, getAllInteractions, getEdgesToNode, removeEdgesForNode } from '../lib/storage.js';
import { isCloseContact, recomputeAllScores } from '../lib/closeness-score.js';
import { getKnowledgeLevelInfo } from '../lib/knowledge-level.js';
import { toast } from './toast.js';

/**
 * Render the People/Contacts panel into a container.
 * @param {HTMLElement} container
 */
export async function renderContactsPanel(container) {
  if (!container) return;

  const contacts = await getContacts().catch(() => []);

  container.innerHTML = `
    <div class="card card-compact animate-in" style="display:flex;flex-direction:column;gap:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-4);">
        <div class="flex-center gap-2">
          <span class="set-section-head">
            ${icons.users(14)} People
            <span style="font-size:var(--font-xs);color:var(--color-text-muted);font-weight:400;">${contacts.length} contact${contacts.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
        <div class="set-flex-row">
          <button class="btn btn-ghost btn-sm" id="contacts-recompute" title="Recompute all closeness scores">${icons.refresh(12)} Refresh</button>
          <button class="btn btn-primary btn-sm" id="contacts-add">${icons.plus(12)} Add Contact</button>
        </div>
      </div>

      <!-- Knowledge Level Legend -->
      <div id="contacts-legend" style="padding:0 var(--space-4) var(--space-3);display:flex;flex-wrap:wrap;gap:var(--space-2);font-size:10px;">
        ${_renderLegend()}
      </div>

      <!-- Search -->
      <div style="padding:0 var(--space-4) var(--space-3);">
        <input class="input" type="search" id="contacts-search" aria-label="Search contacts" placeholder="Search contacts…" autocomplete="off" class="text-xs" />
      </div>

      <!-- Contact List -->
      <div id="contacts-list" style="display:flex;flex-direction:column;max-height:60vh;overflow-y:auto;">
        ${contacts.length ? _renderContacts(contacts) : _renderEmptyState()}
      </div>
    </div>`;

  _bindContactEvents(container);

  // Async: populate entry counts from edge store
  _populateEntryCounts(container).catch(() => {});
}

function _renderLegend() {
  const levels = ['L0', 'L1', 'L2', 'L3', 'L4'];
  return levels.map(level => {
    const info = getKnowledgeLevelInfo(level);
    return `<span style="display:inline-flex;align-items:center;gap:3px;color:var(--color-text-muted);" title="${esc(info.description)}">
      <span style="width:6px;height:6px;border-radius:50%;background:${info.color};display:inline-block;flex-shrink:0;"></span>
      ${level}: ${info.label}
    </span>`;
  }).join('');
}

function _renderContacts(contacts) {
  // Sort by closeness score descending
  const sorted = [...contacts].sort((a, b) => (b.closenessScore || 0) - (a.closenessScore || 0));
  return sorted.map(c => {
    const score = c.closenessScore || 0;
    const close = isCloseContact(score);
    const scoreColor = close ? 'var(--color-success)' : score >= 40 ? 'var(--color-warning)' : 'var(--color-text-muted)';
    const initials = getInitials(c.name || c.email || '?');

    return `
      <div class="contact-row" data-id="${esc(c.id)}" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-top:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,rgba(124,58,237,0.3),rgba(16,185,129,0.2));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--color-text-primary);flex-shrink:0;">
          ${esc(initials)}
        </div>
        <div class="flex-1 min-w-0">
          <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-primary);display:flex;align-items:center;gap:var(--space-2);">
            ${esc(c.name || 'Unknown')}
            ${c.isManualClose ? `<span title="Marked as close" style="font-size:10px;">⭐</span>` : ''}
            ${c.role ? `<span class="text-10-disabled">${esc(c.role)}</span>` : ''}
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${esc(c.email || '')}
            <span class="contact-rec-count" data-email="${esc((c.email || '').toLowerCase())}" style="margin-left:6px;color:var(--color-text-disabled);"></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-shrink:0;">
          <div class="text-right">
            <div style="font-size:var(--font-sm);font-weight:var(--weight-bold);color:${scoreColor};">${score}</div>
            <div style="font-size:9px;color:var(--color-text-disabled);">closeness</div>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm contact-delete" data-id="${esc(c.id)}" aria-label="Delete contact" title="Remove contact">${icons.x(12)}</button>
        </div>
      </div>`;
  }).join('');
}

function _renderEmptyState() {
  return `
    <div style="padding:var(--space-8) var(--space-4);text-align:center;color:var(--color-text-muted);">
      <div style="font-size:28px;margin-bottom:var(--space-3);">👥</div>
      <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-1);">No contacts yet</div>
      <div style="font-size:var(--font-xs);max-width:280px;margin:0 auto;">
        Contacts are automatically created from meeting attendees, or you can add them manually.
        Closeness scores are computed from your interaction history.
      </div>
    </div>`;
}



function _bindContactEvents(root) {
  // Search
  root.querySelector('#contacts-search')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    root.querySelectorAll('.contact-row').forEach(row => {
      const name = row.querySelector('[style*="font-weight:var(--weight-semi)"]')?.textContent?.toLowerCase() || '';
      const email = row.querySelector('[style*="text-overflow"]')?.textContent?.toLowerCase() || '';
      row.style.display = (name.includes(query) || email.includes(query)) ? '' : 'none';
    });
  });

  // Add contact
  root.querySelector('#contacts-add')?.addEventListener('click', () => {
    _openAddContactModal(root);
  });

  // Delete contact
  root.querySelectorAll('.contact-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      try {
        await Promise.all([deleteContact(id), removeEdgesForNode('contact', id).catch(() => {})]);
        toast.success('Contact removed', 'Contact deleted from your list.');
      } catch (e) {
        toast.error('Delete failed', e.message);
      }
      renderContactsPanel(root);
    });
  });

  // Recompute scores
  root.querySelector('#contacts-recompute')?.addEventListener('click', async () => {
    const btn = root.querySelector('#contacts-recompute');
    if (btn) btn.disabled = true;
    try {
      const contacts = await getContacts();
      const interactions = await getAllInteractions();
      const results = recomputeAllScores(contacts, interactions);
      let updated = 0;
      for (const r of results) {
        if (r.changed) {
          const contact = contacts.find(c => c.id === r.contactId);
          if (contact) {
            contact.closenessScore = r.newScore;
            contact.updatedAt = Date.now();
            await saveContact(contact);
            updated++;
          }
        }
      }
      toast.success('Scores refreshed', `Updated ${updated} contact${updated !== 1 ? 's' : ''}.`);
      renderContactsPanel(root);
    } catch (e) {
      toast.error('Refresh failed', e.message);
    }
  });
}

function _openAddContactModal(root) {
  const existing = document.getElementById('add-contact-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'add-contact-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Add Contact');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:var(--z-modal);padding:var(--space-4);backdrop-filter:blur(6px);';

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:400px;">
      <div class="card-header">
        <h3 class="flex-center gap-2">${icons.plus(16)} Add Contact</h3>
        <button class="btn btn-ghost btn-icon btn-sm" id="add-contact-close" aria-label="Close">${icons.x(16)}</button>
      </div>
      <form id="add-contact-form" autocomplete="off" class="pad-stack">
        <div class="input-group">
          <label for="contact-name">Name</label>
          <input class="input" type="text" id="contact-name" placeholder="e.g. Alice Johnson" required autocomplete="off" />
        </div>
        <div class="input-group">
          <label for="contact-email">Email</label>
          <input class="input" type="email" id="contact-email" placeholder="alice@example.com" required autocomplete="off" />
        </div>
        <div class="input-group">
          <label for="contact-role">Role (optional)</label>
          <select class="select" id="contact-role">
            <option value="">None</option>
            <option value="manager">Manager</option>
            <option value="report">Direct Report</option>
            <option value="peer">Peer</option>
            <option value="external">External</option>
          </select>
        </div>
        <div class="input-group" style="flex-direction:row;align-items:center;gap:8px;">
          <input type="checkbox" id="contact-manual-close" />
          <label for="contact-manual-close" class="no-margin">Mark as close contact</label>
        </div>
        <button type="submit" class="btn btn-primary" class="mt-2">Add Contact</button>
      </form>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#add-contact-close').addEventListener('click', close);

  overlay.querySelector('#add-contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = overlay.querySelector('#contact-name').value.trim();
    const email = overlay.querySelector('#contact-email').value.trim();
    const role = overlay.querySelector('#contact-role').value;
    const isManualClose = overlay.querySelector('#contact-manual-close').checked;

    if (!name || !email) {
      toast.warning('Missing fields', 'Name and email are required.');
      return;
    }

    const contact = {
      id: generateId('contact'),
      name,
      email: email.toLowerCase(),
      role: role || null,
      org: null,
      closenessScore: isManualClose ? 10 : 0,
      isManualClose,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await saveContact(contact);
      toast.success('Contact added', `${name} has been added to your contacts.`);
    } catch (e) {
      toast.error('Save failed', e.message);
    }
    close();
    renderContactsPanel(root);
  });

  setTimeout(() => overlay.querySelector('#contact-name')?.focus(), 50);
}

/**
 * Populate entry counts for each contact using edge store queries.
 * Queries PARTICIPATED_IN edges targeting each contact's email.
 */
async function _populateEntryCounts(root) {
  const spans = root.querySelectorAll('.contact-rec-count');
  if (!spans.length) return;

  for (const span of spans) {
    const email = span.dataset.email;
    if (!email) continue;
    try {
      const edges = await getEdgesToNode('contact', email);
      const recEdges = edges.filter(e => e.edgeType === 'PARTICIPATED_IN' && e.sourceType === 'entry');
      if (recEdges.length > 0) {
        span.textContent = `· ${recEdges.length} entry${recEdges.length !== 1 ? 's' : ''}`;
      }
    } catch { /* edge store unavailable */ }
  }
}
