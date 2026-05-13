// Takus — Connect Panel (Phase 3 / Phase 15: Full Integration Suite)
// Modal for configuring Slack, GitHub, Linear, Jira, Notion + built-in Calendar, Email, Drive.
// Credentials are encrypted via the Identity Vault before storage.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getSetting, saveSetting } from '../lib/storage.js';
import { saveCredential, loadCredential, clearCredential } from '../lib/identity-vault.js';
import { postToSlack } from '../lib/integrations/slack.js';
import { verifyGitHubToken } from '../lib/integrations/github.js';
import { verifyLinearKey, fetchLinearTeams } from '../lib/integrations/linear.js';
import { getJiraConfig, saveJiraConfig, clearJiraConfig, verifyJiraConnection } from '../lib/integrations/jira.js';
import { getNotionConfig, saveNotionConfig, clearNotionConfig, verifyNotionConnection } from '../lib/integrations/notion.js';
import { toast } from './toast.js';



// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Load the connect config for a named integration.
 * Returns an object with `configured: boolean` and integration-specific fields.
 */
export async function getIntegrationConfig(name) {
  switch (name) {
    case 'slack': {
      const webhookUrl = await loadCredential('slack_webhookUrl');
      return { configured: !!webhookUrl, webhookUrl };
    }
    case 'github': {
      const token = await loadCredential('github_token');
      const owner = await getSetting('connect_github_owner') || '';
      const repo  = await getSetting('connect_github_repo')  || '';
      return { configured: !!(token && owner && repo), token, owner, repo };
    }
    case 'linear': {
      const apiKey = await loadCredential('linear_apiKey');
      const teamId = await getSetting('connect_linear_teamId') || '';
      const teamName = await getSetting('connect_linear_teamName') || '';
      return { configured: !!(apiKey && teamId), apiKey, teamId, teamName };
    }
    case 'jira': {
      return getJiraConfig();
    }
    case 'notion': {
      return getNotionConfig();
    }
    default: return { configured: false };
  }
}

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
    if (!confirm(`Disconnect ${id}? Saved credentials will be erased.`)) return;
    await _disconnectIntegration(id);
    toast.info(`${id} disconnected`);
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
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div> Saving…`;
    try {
      const fields = _readFields(card);
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

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div style="padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);display:flex;align-items:center;gap:var(--space-2);">${icons.link(14)} Connect Integrations</span>
        </div>
        <p style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:calc(-1 * var(--space-2));">
          Route tasks directly to your tools. Credentials are encrypted with AES-GCM and stored only in your browser.
        </p>

        ${_integrationCard({ id: 'slack', name: 'Slack', icon: icons.send(16), color: '#4A154B', configured: slackCfg.configured, description: 'Post TL;DRs and draft messages directly to a Slack channel.', fields: [{ key: 'slack_webhookUrl', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/…', type: 'url', encrypted: true, value: slackCfg.webhookUrl ? '••••••••' : '' }], helpText: 'Slack → Your App → Incoming Webhooks → Add New Webhook to Workspace' })}
        ${_integrationCard({ id: 'github', name: 'GitHub', icon: icons.terminal(16), color: '#6e40c9', configured: githubCfg.configured, description: 'Open issues directly from bug-report tasks with full context.', fields: [{ key: 'github_token', label: 'Personal Access Token', placeholder: 'ghp_…', type: 'password', encrypted: true, value: githubCfg.token ? '••••••••' : '' }, { key: 'github_owner', label: 'Owner (user or org)', placeholder: 'myorg', type: 'text', encrypted: false, value: githubCfg.owner }, { key: 'github_repo', label: 'Repository name', placeholder: 'my-app', type: 'text', encrypted: false, value: githubCfg.repo }], helpText: 'Settings → Developer settings → Personal access tokens → repo scope' })}
        ${_integrationCard({ id: 'linear', name: 'Linear', icon: icons.zap(16), color: '#5E6AD2', configured: linearCfg.configured, description: 'Create Linear issues from bug reports and ticket-update tasks.', fields: [{ key: 'linear_apiKey', label: 'API Key', placeholder: 'lin_api_…', type: 'password', encrypted: true, value: linearCfg.apiKey ? '••••••••' : '' }, { key: 'linear_teamId', label: 'Team ID', placeholder: 'xxxxxxxx-xxxx-…', type: 'text', encrypted: false, value: linearCfg.teamId, hint: 'Settings → [Your Team] → General → scroll to API' }], helpText: 'Linear → Settings → API → Personal API Keys' })}
        ${_integrationCard({ id: 'jira', name: 'Jira Cloud', icon: icons.checkSquare(16), color: '#0052CC', configured: jiraCfg.configured, description: 'Create Jira issues from tasks, bug reports, and action items.', fields: [{ key: 'jira_host', label: 'Jira Host', placeholder: 'yourorg.atlassian.net', type: 'text', encrypted: false, value: jiraCfg.host || '' }, { key: 'jira_email', label: 'Email', placeholder: 'you@company.com', type: 'email', encrypted: false, value: jiraCfg.email || '' }, { key: 'jira_token', label: 'API Token', placeholder: 'ATATT…', type: 'password', encrypted: true, value: jiraCfg.token ? '••••••••' : '' }, { key: 'jira_project', label: 'Project Key', placeholder: 'PROJ', type: 'text', encrypted: false, value: jiraCfg.project || '', hint: 'The short key for your Jira project (e.g. PROJ)' }], helpText: 'Atlassian → Security → Create API token' })}
        ${_integrationCard({ id: 'notion', name: 'Notion', icon: icons.edit(16), color: '#000000', configured: notionCfg.configured, description: 'Log decisions, notes, and summaries directly to a Notion database.', fields: [{ key: 'notion_apikey', label: 'Integration Token', placeholder: 'ntn_…', type: 'password', encrypted: true, value: notionCfg.apiKey ? '••••••••' : '' }, { key: 'notion_dbid', label: 'Database ID', placeholder: 'xxxxxxxx-xxxx-…', type: 'text', encrypted: false, value: notionCfg.databaseId || '', hint: 'Open database as full page → copy ID from URL' }], helpText: 'Notion → Settings → Integrations → Create new integration' })}
      </div>
    </div>`;

  _bindIntegration(container, 'slack',  slackCfg);
  _bindIntegration(container, 'github', githubCfg);
  _bindIntegration(container, 'linear', linearCfg);
  _bindIntegration(container, 'jira',   jiraCfg);
  _bindIntegration(container, 'notion', notionCfg);
}
