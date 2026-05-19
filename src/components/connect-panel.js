
// Modal for configuring Slack, GitHub, Linear, Jira, Notion + built-in Calendar, Email, Drive.
// Credentials are encrypted via the Identity Vault before storage.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { saveSetting } from '../lib/storage.js';
import { saveCredential, clearCredential } from '../lib/identity-vault.js';
import { postToSlack } from '../lib/integrations/slack.js';
import { verifyGitHubToken } from '../lib/integrations/github.js';
import { verifyLinearKey } from '../lib/integrations/linear.js';
import { saveJiraConfig, clearJiraConfig, verifyJiraConnection } from '../lib/integrations/jira.js';
import { saveNotionConfig, clearNotionConfig, verifyNotionConnection } from '../lib/integrations/notion.js';
import { toast } from './toast.js';
import { confirmAsync } from '../lib/dialog-utils.js';

// Re-export from lib/ so existing consumers don't break
export { getIntegrationConfig } from '../lib/integration-config.js';
import { getIntegrationConfig } from '../lib/integration-config.js';

// ── Modal ─────────────────────────────────────────────────────────────────────

export async function openConnectModal() {
  document.getElementById('connect-overlay')?.remove();

  const [slackCfg, githubCfg, linearCfg, jiraCfg, notionCfg] = await Promise.all([
    getIntegrationConfig('slack'),
    getIntegrationConfig('github'),
    getIntegrationConfig('linear'),
    getIntegrationConfig('jira'),
    getIntegrationConfig('notion'),
  ]);

  const overlay = document.createElement('div');
  overlay.id = 'connect-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Connect integrations');
  overlay.style.cssText = [
    'position:fixed;inset:0;',
    'background:rgba(0,0,0,0.7);',
    'display:flex;align-items:flex-start;justify-content:center;',
    'z-index:var(--z-modal);',
    'padding:var(--space-4);',
    'overflow-y:auto;',
    'backdrop-filter:blur(6px);',
  ].join('');

  overlay.innerHTML = `
    <div class="card animate-in" style="width:100%;max-width:540px;margin-top:var(--space-8);">
      <div class="card-header" style="position:sticky;top:0;background:var(--color-bg-surface);backdrop-filter:blur(8px);z-index:1;">
        <h3 style="display:flex;align-items:center;gap:var(--space-2);">${icons.link(16)} Connect integrations</h3>
        <button class="btn btn-ghost btn-icon btn-sm" id="connect-close" aria-label="Close">${icons.x(16)}</button>
      </div>
      <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4);">
        <p style="font-size:var(--font-xs);color:var(--color-text-muted);">
          Route tasks directly to your tools. Credentials are encrypted with AES-GCM and stored only in your browser.
        </p>

        <!-- Slack -->
        ${_integrationCard({
          id: 'slack',
          name: 'Slack',
          icon: icons.send(16),
          color: '#4A154B',
          configured: slackCfg.configured,
          description: 'Post TL;DRs and draft messages directly to a Slack channel.',
          fields: [
            { key: 'slack_webhookUrl', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/…', type: 'url', encrypted: true, value: slackCfg.webhookUrl ? '••••••••' : '' },
          ],
          helpText: 'Slack → Your App → Incoming Webhooks → Add New Webhook to Workspace',
        })}

        <!-- GitHub -->
        ${_integrationCard({
          id: 'github',
          name: 'GitHub',
          icon: icons.terminal(16),
          color: '#6e40c9',
          configured: githubCfg.configured,
          description: 'Open issues directly from bug-report tasks with full context.',
          fields: [
            { key: 'github_token',  label: 'Personal Access Token', placeholder: 'ghp_…', type: 'password', encrypted: true, value: githubCfg.token ? '••••••••' : '' },
            { key: 'github_owner',  label: 'Owner (user or org)',    placeholder: 'myorg',  type: 'text',     encrypted: false, value: githubCfg.owner },
            { key: 'github_repo',   label: 'Repository name',        placeholder: 'my-app', type: 'text',     encrypted: false, value: githubCfg.repo  },
          ],
          helpText: 'Settings → Developer settings → Personal access tokens → repo scope',
        })}

        <!-- Linear -->
        ${_integrationCard({
          id: 'linear',
          name: 'Linear',
          icon: icons.zap(16),
          color: '#5E6AD2',
          configured: linearCfg.configured,
          description: 'Create Linear issues from bug reports and ticket-update tasks.',
          fields: [
            { key: 'linear_apiKey', label: 'API Key', placeholder: 'lin_api_…', type: 'password', encrypted: true, value: linearCfg.apiKey ? '••••••••' : '' },
            { key: 'linear_teamId', label: 'Team ID', placeholder: 'xxxxxxxx-xxxx-…', type: 'text', encrypted: false, value: linearCfg.teamId, hint: 'Settings → [Your Team] → General → scroll to API' },
          ],
          helpText: 'Linear → Settings → API → Personal API Keys',
        })}

        <!-- Jira -->
        ${_integrationCard({
          id: 'jira',
          name: 'Jira Cloud',
          icon: icons.checkSquare(16),
          color: '#0052CC',
          configured: jiraCfg.configured,
          description: 'Create Jira issues from tasks, bug reports, and action items.',
          fields: [
            { key: 'jira_host',    label: 'Jira Host',    placeholder: 'yourorg.atlassian.net', type: 'text',     encrypted: false, value: jiraCfg.host || '' },
            { key: 'jira_email',   label: 'Email',        placeholder: 'you@company.com',       type: 'email',    encrypted: false, value: jiraCfg.email || '' },
            { key: 'jira_token',   label: 'API Token',    placeholder: 'ATATT…',                type: 'password', encrypted: true,  value: jiraCfg.token ? '••••••••' : '' },
            { key: 'jira_project', label: 'Project Key',  placeholder: 'PROJ',                  type: 'text',     encrypted: false, value: jiraCfg.project || '', hint: 'The short key for your Jira project (e.g. PROJ)' },
          ],
          helpText: 'Atlassian → Security → Create API token',
        })}

        <!-- Notion -->
        ${_integrationCard({
          id: 'notion',
          name: 'Notion',
          icon: icons.edit(16),
          color: '#000000',
          configured: notionCfg.configured,
          description: 'Log decisions, notes, and summaries directly to a Notion database.',
          fields: [
            { key: 'notion_apikey', label: 'Integration Token', placeholder: 'ntn_…', type: 'password', encrypted: true,  value: notionCfg.apiKey ? '••••••••' : '' },
            { key: 'notion_dbid',   label: 'Database ID',       placeholder: 'xxxxxxxx-xxxx-…', type: 'text', encrypted: false, value: notionCfg.databaseId || '', hint: 'Open database as full page → copy ID from URL' },
          ],
          helpText: 'Notion → Settings → Integrations → Create new integration',
        })}

        <!-- Built-in integrations (no config required) -->
        <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;margin-top:var(--space-2);">Built-in — No Setup Required</div>

        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          <div style="flex:1;min-width:140px;border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-lg);padding:var(--space-3);background:rgba(255,255,255,0.02);">
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:4px;">
              <span style="color:#10b981;">${icons.calendar(14)}</span>
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);">Calendar</span>
              <span style="font-size:8px;padding:1px 5px;border-radius:8px;background:rgba(16,185,129,0.12);color:#10b981;font-weight:600;margin-left:auto;">Active</span>
            </div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Opens Google Calendar with task details pre-filled.</div>
          </div>
          <div style="flex:1;min-width:140px;border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-lg);padding:var(--space-3);background:rgba(255,255,255,0.02);">
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:4px;">
              <span style="color:#0ea5e9;">${icons.send(14)}</span>
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);">Email</span>
              <span style="font-size:8px;padding:1px 5px;border-radius:8px;background:rgba(14,165,233,0.12);color:#0ea5e9;font-weight:600;margin-left:auto;">Active</span>
            </div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Opens default email client with subject and body prefilled.</div>
          </div>
          <div style="flex:1;min-width:140px;border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-lg);padding:var(--space-3);background:rgba(255,255,255,0.02);">
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:4px;">
              <span style="color:#f59e0b;">${icons.cloud(14)}</span>
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);">Drive</span>
              <span style="font-size:8px;padding:1px 5px;border-radius:8px;background:rgba(245,158,11,0.12);color:#f59e0b;font-weight:600;margin-left:auto;">Active</span>
            </div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Copies file details to clipboard for manual upload.</div>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const closeModal = () => { overlay.remove(); document.removeEventListener('keydown', _esc); };
  const _esc = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', _esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('#connect-close').addEventListener('click', closeModal);

  // ── Bind each integration ─────────────────────────────────────────────────
  _bindIntegration(overlay, 'slack',  slackCfg);
  _bindIntegration(overlay, 'github', githubCfg);
  _bindIntegration(overlay, 'linear', linearCfg);
  _bindIntegration(overlay, 'jira',   jiraCfg);
  _bindIntegration(overlay, 'notion', notionCfg);
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function _integrationCard({ id, name, icon, color, configured, description, fields, helpText }) {
  const statusDot   = configured
    ? `<span style="width:7px;height:7px;border-radius:50%;background:var(--color-success);display:inline-block;flex-shrink:0;"></span> <span style="color:var(--color-success);">Connected</span>`
    : `<span style="width:7px;height:7px;border-radius:50%;background:var(--color-text-disabled);display:inline-block;flex-shrink:0;"></span> <span style="color:var(--color-text-disabled);">Not configured</span>`;

  const fieldsHtml = fields.map(f => `
    <div class="input-group">
      <label for="connect-${esc(f.key)}">${esc(f.label)}</label>
      <input
        class="input"
        type="${f.type}"
        id="connect-${esc(f.key)}"
        data-field-key="${esc(f.key)}"
        data-encrypted="${f.encrypted ? '1' : '0'}"
        value="${esc(f.value || '')}"
        placeholder="${esc(f.placeholder || '')}"
        autocomplete="off"
      />
      ${f.hint ? `<div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">${esc(f.hint)}</div>` : ''}
    </div>`).join('');

  return `
    <div class="connect-card" data-integration="${id}">
      <div class="connect-card-header" data-toggle="${id}">
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <div style="width:32px;height:32px;border-radius:var(--radius-md);background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;color:${color};flex-shrink:0;">${icon}</div>
          <div>
            <div style="font-size:var(--font-sm);font-weight:var(--weight-semi);">${esc(name)}</div>
            <div style="font-size:10px;display:flex;align-items:center;gap:4px;margin-top:2px;">${statusDot}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          ${configured ? `<button class="btn btn-ghost btn-sm connect-disconnect" data-integration="${id}" style="font-size:10px;color:var(--color-danger);">${icons.x(10)} Disconnect</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm connect-toggle" data-integration="${id}" title="${configured ? 'Edit' : 'Configure'}" style="transition:transform 0.2s ease;">${icons.arrowRight(14)}</button>
        </div>
      </div>
      <div class="connect-card-body hidden" data-body="${id}">
        <p style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">${esc(description)}</p>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          ${fieldsHtml}
        </div>
        <div style="font-size:10px;color:var(--color-text-disabled);margin-top:var(--space-2);padding-top:var(--space-2);border-top:1px solid rgba(255,255,255,0.05);">
          ${icons.info(10)} ${esc(helpText)}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-3);">
          <button class="btn btn-ghost btn-sm connect-test" data-integration="${id}">Test connection</button>
          <button class="btn btn-primary btn-sm connect-save" data-integration="${id}">Save</button>
        </div>
      </div>
    </div>`;
}

// ── Per-integration bindings ──────────────────────────────────────────────────

function _bindIntegration(overlay, id, cfg) {
  const card   = overlay.querySelector(`.connect-card[data-integration="${id}"]`);
  const body   = overlay.querySelector(`.connect-card-body[data-body="${id}"]`);
  const toggle = overlay.querySelector(`.connect-toggle[data-integration="${id}"]`);

  // Toggle expand/collapse
  const doToggle = () => {
    const open = body.classList.toggle('hidden') === false;
    toggle.style.transform = open ? 'rotate(90deg)' : '';
  };
  toggle?.addEventListener('click', doToggle);
  // Also allow clicking the header row to expand
  overlay.querySelector(`.connect-card-header[data-toggle="${id}"]`)?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // don't double-fire on buttons
    doToggle();
  });

  // Auto-expand if not yet configured
  if (!cfg.configured) doToggle();

  // Disconnect
  card?.querySelector('.connect-disconnect')?.addEventListener('click', async () => {
    if (!(await confirmAsync(`Disconnect ${id}? Saved credentials will be erased.`, { confirmLabel: 'Disconnect', destructive: true }))) return;
    try {
      await _disconnectIntegration(id);
      toast.info(`${id} disconnected`);
    } catch (e) {
      toast.error('Disconnect failed', e.message);
    }
    openConnectModal(); // re-render
  });

  // Test
  card?.querySelector('.connect-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div>`;
    try {
      const fields = _readFields(card);
      await _testIntegration(id, fields, cfg);
    } catch (e) {
      toast.error('Test failed', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  // Save
  card?.querySelector('.connect-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const fields = _readFields(card);

    // ── Client-side validation ──
    const validationError = _validateFields(id, fields, cfg);
    if (validationError) {
      toast.warning('Validation', validationError);
      return;
    }

    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div> Saving…`;
    try {
      await _saveIntegration(id, fields, cfg);
      toast.success('Saved', `${id} credentials saved and encrypted.`);
      openConnectModal(); // re-render with updated status
    } catch (e) {
      toast.error('Save failed', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
}

function _readFields(card) {
  const result = {};
  card.querySelectorAll('input[data-field-key]').forEach(input => {
    // If the value is the masked placeholder (••••••••), treat as unchanged (null)
    const val = input.value.trim();
    result[input.dataset.fieldKey] = val === '••••••••' ? null : val;
    result[`_encrypted_${input.dataset.fieldKey}`] = input.dataset.encrypted === '1';
  });
  return result;
}

/**
 * Client-side validation for integration credentials.
 * Returns an error message string, or null if valid.
 */
function _validateFields(id, fields, existingCfg) {
  switch (id) {
    case 'slack': {
      const url = fields['slack_webhookUrl'];
      if (url && !url.startsWith('https://hooks.slack.com/')) {
        return 'Slack Webhook URL must start with https://hooks.slack.com/';
      }
      if (url && url.split('/').length < 6) {
        return 'Slack Webhook URL appears incomplete. Expected format: https://hooks.slack.com/services/T.../B.../xxx';
      }
      break;
    }
    case 'github': {
      const token = fields['github_token'];
      if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        return 'GitHub token should start with "ghp_" or "github_pat_"';
      }
      const owner = fields['github_owner'] ?? existingCfg.owner;
      const repo = fields['github_repo'] ?? existingCfg.repo;
      if (token && (!owner || !repo)) {
        return 'Owner and Repository are required when setting a GitHub token';
      }
      break;
    }
    case 'linear': {
      const apiKey = fields['linear_apiKey'];
      if (apiKey && !apiKey.startsWith('lin_api_')) {
        return 'Linear API key should start with "lin_api_"';
      }
      break;
    }
    case 'jira': {
      const host = fields['jira_host'] ?? existingCfg.host;
      const email = fields['jira_email'] ?? existingCfg.email;
      const token = fields['jira_token'];
      const project = fields['jira_project'] ?? existingCfg.project;

      if (host && !host.includes('.atlassian.net') && !host.includes('jira.')) {
        return 'Jira host should be like "yourorg.atlassian.net"';
      }
      if (email && !email.includes('@')) {
        return 'Please enter a valid email address for Jira';
      }
      if (token && (!host || !email)) {
        return 'Host and Email are required when setting a Jira token';
      }
      if (project && !/^[A-Z][A-Z0-9_]*$/.test(project)) {
        return 'Project key should be uppercase letters (e.g. "PROJ")';
      }
      break;
    }
    case 'notion': {
      const apiKey = fields['notion_apikey'];
      if (apiKey && !apiKey.startsWith('ntn_') && !apiKey.startsWith('secret_')) {
        return 'Notion token should start with "ntn_" or "secret_"';
      }
      const dbId = fields['notion_dbid'] ?? existingCfg.databaseId;
      if (apiKey && !dbId) {
        return 'Database ID is required when setting a Notion token';
      }
      break;
    }
  }
  return null; // Valid
}

async function _saveIntegration(id, fields, existingCfg) {
  switch (id) {
    case 'slack': {
      const url = fields['slack_webhookUrl'];
      if (url !== null) await saveCredential('slack_webhookUrl', url);
      break;
    }
    case 'github': {
      if (fields['github_token'] !== null) await saveCredential('github_token', fields['github_token']);
      if (fields['github_owner'] !== null) await saveSetting('connect_github_owner', fields['github_owner']);
      if (fields['github_repo']  !== null) await saveSetting('connect_github_repo',  fields['github_repo']);
      break;
    }
    case 'linear': {
      if (fields['linear_apiKey'] !== null) await saveCredential('linear_apiKey', fields['linear_apiKey']);
      if (fields['linear_teamId'] !== null) await saveSetting('connect_linear_teamId', fields['linear_teamId']);
      break;
    }
    case 'jira': {
      const host = fields['jira_host'];
      const email = fields['jira_email'];
      const token = fields['jira_token'];
      const project = fields['jira_project'];
      await saveJiraConfig({
        host: host !== null ? host : existingCfg.host,
        email: email !== null ? email : existingCfg.email,
        token: token !== null ? token : existingCfg.token,
        project: project !== null ? project : existingCfg.project,
      });
      break;
    }
    case 'notion': {
      const apiKey = fields['notion_apikey'];
      const dbId = fields['notion_dbid'];
      await saveNotionConfig({
        apiKey: apiKey !== null ? apiKey : existingCfg.apiKey,
        databaseId: dbId !== null ? dbId : existingCfg.databaseId,
      });
      break;
    }
  }
}

async function _testIntegration(id, fields, existingCfg) {
  switch (id) {
    case 'slack': {
      const url = fields['slack_webhookUrl'] ?? existingCfg.webhookUrl;
      if (!url) throw new Error('Enter a Slack Incoming Webhook URL first.');
      await postToSlack(url, { text: '✅ Takus connection test — your Slack integration is working!' });
      toast.success('Slack connected', 'Test message sent to your channel.');
      break;
    }
    case 'github': {
      const token = fields['github_token'] ?? existingCfg.token;
      if (!token) throw new Error('Enter a GitHub Personal Access Token first.');
      const login = await verifyGitHubToken(token);
      toast.success('GitHub connected', `Authenticated as @${login}`);
      break;
    }
    case 'linear': {
      const apiKey = fields['linear_apiKey'] ?? existingCfg.apiKey;
      if (!apiKey) throw new Error('Enter a Linear API key first.');
      const name = await verifyLinearKey(apiKey);
      toast.success('Linear connected', `Authenticated as ${name}`);
      break;
    }
    case 'jira': {
      const host = fields['jira_host'] ?? existingCfg.host;
      const email = fields['jira_email'] ?? existingCfg.email;
      const token = fields['jira_token'] ?? existingCfg.token;
      if (!host || !email || !token) throw new Error('Fill in host, email, and API token first.');
      const result = await verifyJiraConnection({ host, email, token });
      if (result.error) throw new Error(result.error);
      toast.success('Jira connected', `Authenticated as ${result.displayName}`);
      break;
    }
    case 'notion': {
      const apiKey = fields['notion_apikey'] ?? existingCfg.apiKey;
      if (!apiKey) throw new Error('Enter a Notion integration token first.');
      const result = await verifyNotionConnection({ apiKey });
      if (result.error) throw new Error(result.error);
      toast.success('Notion connected', `Authenticated as ${result.name}`);
      break;
    }
  }
}

async function _disconnectIntegration(id) {
  switch (id) {
    case 'slack':
      await clearCredential('slack_webhookUrl');
      break;
    case 'github':
      await clearCredential('github_token');
      await saveSetting('connect_github_owner', null);
      await saveSetting('connect_github_repo', null);
      break;
    case 'linear':
      await clearCredential('linear_apiKey');
      await saveSetting('connect_linear_teamId', null);
      await saveSetting('connect_linear_teamName', null);
      break;
    case 'jira':
      await clearJiraConfig();
      break;
    case 'notion':
      await clearNotionConfig();
      break;
  }
}

/**
 * Render integrations inline into a container (for tab-panel usage).
 * Same content as the modal, without the overlay wrapper.
 */
export async function renderConnectInline(container) {
  const [slackCfg, githubCfg, linearCfg, jiraCfg, notionCfg] = await Promise.all([
    getIntegrationConfig('slack'),
    getIntegrationConfig('github'),
    getIntegrationConfig('linear'),
    getIntegrationConfig('jira'),
    getIntegrationConfig('notion'),
  ]);

  const allApps = [
    { id: 'slack',  name: 'Slack',      icon: icons.send(18),        color: '#4A154B', configured: slackCfg.configured,  desc: 'Post TL;DRs to channels' },
    { id: 'github', name: 'GitHub',     icon: icons.terminal(18),    color: '#6e40c9', configured: githubCfg.configured, desc: 'Create issues from bugs' },
    { id: 'linear', name: 'Linear',     icon: icons.zap(18),         color: '#5E6AD2', configured: linearCfg.configured, desc: 'Track issues & tickets' },
    { id: 'jira',   name: 'Jira Cloud', icon: icons.checkSquare(18), color: '#0052CC', configured: jiraCfg.configured,   desc: 'Create & sync Jira issues' },
    { id: 'notion', name: 'Notion',     icon: icons.edit(18),        color: '#000000', configured: notionCfg.configured, desc: 'Log decisions & notes' },
  ];

  const connectedCount = allApps.filter(a => a.configured).length;
  const builtInApps = [
    { name: 'Calendar', icon: icons.calendar(14), color: '#10b981' },
    { name: 'Email',    icon: icons.send(14),     color: '#0ea5e9' },
    { name: 'Drive',    icon: icons.cloud(14),    color: '#f59e0b' },
  ];

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4);">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.grid(14)} Connected Apps</span>
            <span style="font-size:var(--font-xs);color:var(--color-text-muted);">${connectedCount} of ${allApps.length} integrations connected</span>
          </div>
          <button class="btn btn-primary btn-sm" id="apps-connect-new" style="display:flex;align-items:center;gap:4px;">
            ${icons.plus(12)} Connect App
          </button>
        </div>

        <!-- Connected Apps Grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--space-3);">
          ${allApps.map(app => `
            <div class="apps-tile${app.configured ? ' apps-tile-active' : ''}" data-app="${app.id}" style="
              border:1px solid ${app.configured ? app.color + '44' : 'rgba(255,255,255,0.08)'};
              border-radius:var(--radius-lg);
              padding:var(--space-3);
              background:${app.configured ? app.color + '0a' : 'rgba(255,255,255,0.02)'};
              cursor:pointer;
              transition:all 0.2s ease;
              position:relative;
              overflow:hidden;
            ">
              <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:6px;">
                <div style="
                  width:28px;height:28px;border-radius:var(--radius-md);
                  background:${app.color}22;border:1px solid ${app.color}44;
                  display:flex;align-items:center;justify-content:center;
                  color:${app.color};flex-shrink:0;
                ">${app.icon}</div>
                <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${esc(app.name)}</div>
              </div>
              <div style="font-size:10px;color:var(--color-text-disabled);margin-bottom:6px;">${esc(app.desc)}</div>
              <div style="display:flex;align-items:center;gap:4px;font-size:10px;">
                <span style="
                  width:6px;height:6px;border-radius:50%;
                  background:${app.configured ? 'var(--color-success)' : 'var(--color-text-disabled)'};
                  display:inline-block;flex-shrink:0;
                "></span>
                <span style="color:${app.configured ? 'var(--color-success)' : 'var(--color-text-disabled)'};">
                  ${app.configured ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Built-in Apps Section -->
        <div>
          <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-2);">Built-in — No Setup Required</div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            ${builtInApps.map(app => `
              <div style="
                flex:1;min-width:100px;
                border:1px solid ${app.color}33;border-radius:var(--radius-lg);
                padding:var(--space-2) var(--space-3);
                background:${app.color}08;
                display:flex;align-items:center;gap:var(--space-2);
              ">
                <span style="color:${app.color};">${app.icon}</span>
                <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);">${app.name}</span>
                <span style="font-size:8px;padding:1px 5px;border-radius:8px;background:${app.color}18;color:${app.color};font-weight:600;margin-left:auto;">Active</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Security Notice -->
        <div style="font-size:10px;color:var(--color-text-disabled);display:flex;align-items:center;gap:4px;">
          ${icons.shield(10)} Credentials are encrypted with AES-GCM and stored only in your browser.
        </div>
      </div>
    </div>`;

  // "Connect New App" button → opens the full config modal
  container.querySelector('#apps-connect-new')?.addEventListener('click', () => {
    openConnectModal();
  });

  // Clicking any app tile → opens the config modal (pre-focused on that integration)
  container.querySelectorAll('.apps-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      openConnectModal();
    });

    // Hover effect
    tile.addEventListener('mouseenter', () => {
      tile.style.transform = 'translateY(-2px)';
      tile.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    });
    tile.addEventListener('mouseleave', () => {
      tile.style.transform = '';
      tile.style.boxShadow = '';
    });
  });
}
