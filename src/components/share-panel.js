// Takus — Share with Participants Panel
// Self-managing modal overlay: appends to body, removes itself on close.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { toast } from './toast.js';

/**
 * Opens a modal allowing the user to share a entry + summary with
 * calendar participants via their default email client (mailto).
 *
 * @param {Object} opts
 * @param {Array<{name:string, email:string}>} opts.participants
 * @param {string} opts.entryTitle
 * @param {string} opts.driveLink
 * @param {string} opts.aiSummary  — optional; if empty a template is used
 */
export function renderSharePanel({ participants = [], entryTitle = '', driveLink = '', aiSummary = '' }) {
  // Remove any stale instance first
  document.getElementById('share-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'share-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Share entry with participants');
  overlay.style.cssText = [
    'position:fixed;inset:0;',
    'background:rgba(0,0,0,0.65);',
    'display:flex;align-items:center;justify-content:center;',
    'z-index:var(--z-modal);',
    'padding:var(--space-4);',
    'backdrop-filter:blur(4px);',
  ].join('');

  const firstNames = participants.slice(0, 3)
    .map(p => (p.name || p.email || '').split(/[\s@]/)[0])
    .filter(Boolean).join(', ');
  const greeting = firstNames ? `Hi ${firstNames},` : 'Hi everyone,';
  const defaultMessage = _buildMessage(greeting, entryTitle, driveLink, aiSummary);
  const hasManyParticipants = participants.length > 1;

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:580px;max-height:90vh;overflow-y:auto;display:flex;flex-direction:column;">
      <div class="card-header sticky-header flex-shrink-0" >
        <h3 class="flex-center">${icons.users(16)} Share with Participants</h3>
        <button class="btn btn-ghost btn-icon btn-sm" id="share-close" aria-label="Close">${icons.x(16)}</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:var(--space-4);padding-top:var(--space-2);">

        <!-- Recipients -->
        <div>
          <div class="flex-between mb-2">
            <span class="text-sm-secondary fw-semi" >
              Recipients
              <span class="badge badge-neutral" style="margin-left:var(--space-1);">${participants.length}</span>
            </span>
            ${hasManyParticipants ? `
              <div style="display:flex;gap:var(--space-1);">
                <button class="btn btn-ghost btn-sm text-xs" id="share-select-all" >All</button>
                <button class="btn btn-ghost btn-sm text-xs" id="share-none" >None</button>
              </div>
            ` : ''}
          </div>
          <div id="share-recipients" style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2);">
            ${participants.map((p, i) => `
              <label style="display:flex;align-items:center;gap:var(--space-2);padding:6px var(--space-2);border-radius:var(--radius-sm);cursor:pointer;font-size:var(--font-sm);" class="share-recipient-row">
                <input type="checkbox" class="share-chk" data-idx="${i}" checked style="accent-color:var(--color-primary);flex-shrink:0;" />
                <span style="font-weight:var(--weight-medium);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${esc(p.name || p.email.split('@')[0])}</span>
                <span style="color:var(--color-text-muted);font-size:var(--font-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.email)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Message -->
        <div>
          <div class="flex-between mb-2">
            <span class="text-sm-secondary fw-semi" >Message</span>
            <span style="font-size:var(--font-xs);${aiSummary ? 'color:var(--color-primary-light)' : 'color:var(--color-text-muted)'};display:flex;align-items:center;gap:4px;">
              ${aiSummary ? `${icons.zap(11)} AI summary included` : 'Template message'}
            </span>
          </div>
          <textarea id="share-message" class="input" rows="11"
            style="width:100%;resize:vertical;font-size:var(--font-sm);line-height:1.7;font-family:inherit;">${esc(defaultMessage)}</textarea>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:var(--space-3);justify-content:space-between;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="share-copy">${icons.link(14)} Copy Message</button>
          <button class="btn btn-primary" id="share-send">${icons.send(14)} Open in Email</button>
        </div>

        <p style="font-size:var(--font-xs);color:var(--color-text-disabled);text-align:center;margin-top:calc(-1 * var(--space-2));">
          Opens your default email app with recipients and message pre-filled. Nothing is sent automatically.
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Hover effect for recipient rows via CSS class approach (no inline handlers)
  overlay.querySelectorAll('.share-recipient-row').forEach(row => {
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
  });

  const closePanel = () => {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
  };

  const escHandler = (e) => { if (e.key === 'Escape') closePanel(); };
  document.addEventListener('keydown', escHandler);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
  overlay.querySelector('#share-close').addEventListener('click', closePanel);

  // Select All / None
  overlay.querySelector('#share-select-all')?.addEventListener('click', () => {
    overlay.querySelectorAll('.share-chk').forEach(c => { c.checked = true; });
  });
  overlay.querySelector('#share-none')?.addEventListener('click', () => {
    overlay.querySelectorAll('.share-chk').forEach(c => { c.checked = false; });
  });

  // Copy message to clipboard
  overlay.querySelector('#share-copy').addEventListener('click', async () => {
    const msg = overlay.querySelector('#share-message')?.value || '';
    try {
      await navigator.clipboard.writeText(msg);
      const btn = overlay.querySelector('#share-copy');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = `${icons.check(14)} Copied!`;
        setTimeout(() => { if (btn.isConnected) btn.innerHTML = orig; }, 1500);
      }
    } catch {
      toast.info('Copy manually', 'Select the text in the message box and copy.');
    }
  });

  // Open mailto link in email client
  overlay.querySelector('#share-send').addEventListener('click', () => {
    const checks = [...overlay.querySelectorAll('.share-chk')];
    const selectedEmails = checks
      .filter(c => c.checked)
      .map(c => participants[parseInt(c.dataset.idx, 10)]?.email)
      .filter(Boolean);

    if (!selectedEmails.length) {
      toast.warning('No recipients selected', 'Check at least one participant.');
      return;
    }

    const msg = overlay.querySelector('#share-message')?.value || '';
    const subject = entryTitle ? `Takus: ${entryTitle}` : 'Shared from Takus';

    // URLSearchParams produces correctly encoded subject= and body=
    const params = new URLSearchParams({ subject, body: msg });
    const a = document.createElement('a');
    a.href = `mailto:${selectedEmails.join(',')}?${params.toString()}`;
    a.click();

    toast.success(
      'Email client opened',
      `Message ready for ${selectedEmails.length} recipient${selectedEmails.length !== 1 ? 's' : ''}.`
    );
  });

  // Focus the close button so keyboard users can immediately Escape
  setTimeout(() => overlay.querySelector('#share-close')?.focus(), 50);
}

/** Compose the pre-filled email body from available data */
function _buildMessage(greeting, entryTitle, driveLink, aiSummary) {
  const lines = [greeting, ''];
  lines.push(entryTitle
    ? `The entry from "${entryTitle}" is now available:`
    : 'The entry is now available:');
  if (driveLink) lines.push(driveLink);
  lines.push('');

  if (aiSummary) {
    lines.push('─── Meeting Summary ───', '');
    lines.push(_stripMarkdown(aiSummary));
    lines.push('');
  }

  lines.push('Please let me know if you have any questions or feedback.');
  return lines.join('\n');
}

/** Convert GPT markdown to readable plain text suitable for email */
function _stripMarkdown(text) {
  return text
    .replace(/^#{1,3} (.+)$/gm, '$1:')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[*-] /gm, '• ')
    .replace(/^-{3,}$/gm, '─────')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


