// Takus — Passport App
// Manages the identity of this Takus instance: who it belongs to,
// personal details, and preferences that personalize AI behavior.
//
// The Passport is stored as an 'identity' node in the graph store
// and synced to the cloud as Takus/settings/passport.json.
//
// This is a CORE app — it cannot be deactivated.

import { createAppStub } from '../../lib/app-interface.js';
import { generateId } from '../../lib/id.js';
import { getSetting, saveSetting } from '../../lib/storage.js';
import { esc } from '../../lib/utils.js';

// ── Constants ──────────────────────────────────────────────────────────────

const PASSPORT_KEY = 'takus_passport';

// ── State ──────────────────────────────────────────────────────────────────

let _passport = null;
let _platform = null;

// ── Default passport ──────────────────────────────────────────────────────

function defaultPassport() {
  return {
    id: generateId('passport'),
    instanceName: 'My Takus',
    ownerName: '',
    birthday: '',
    birthplace: '',
    creatorName: '',
    bio: '',
    role: '',
    company: '',
    projects: '',
    avatar: '🧠',
    preferredTone: 'professional',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Data access ────────────────────────────────────────────────────────────

/**
 * Load the passport from IDB.
 * @returns {Promise<object>}
 */
export async function loadPassport() {
  if (_passport) return { ..._passport };
  try {
    const saved = await getSetting(PASSPORT_KEY);
    _passport = saved && typeof saved === 'object'
      ? { ...defaultPassport(), ...saved }
      : defaultPassport();
  } catch { /* non-critical */
    _passport = defaultPassport();
  }
  return { ..._passport };
}

/**
 * Save the passport to IDB.
 * @param {object} updates — partial passport fields to merge
 * @returns {Promise<object>} The updated passport
 */
export async function savePassport(updates) {
  if (!_passport) await loadPassport();
  Object.assign(_passport, updates, { updatedAt: Date.now() });
  await saveSetting(PASSPORT_KEY, _passport);
  return { ..._passport };
}

/**
 * Get the passport synchronously (cached). Returns null if not yet loaded.
 * @returns {object|null}
 */
export function getPassport() {
  return _passport ? { ..._passport } : null;
}

/**
 * Get the display name for AI prompts and UI greeting.
 * @returns {string}
 */
export function getDisplayName() {
  if (_passport?.ownerName) return _passport.ownerName;
  return _passport?.instanceName || 'Takus User';
}

/**
 * Get structured work context from the passport.
 * Returns { role, company, projects: string[] }.
 * @returns {{ role: string, company: string, projects: string[] }}
 */
export function getWorkContext() {
  const role = _passport?.role || '';
  const company = _passport?.company || '';
  const projectsRaw = _passport?.projects || '';
  const projects = projectsRaw
    ? projectsRaw.split(',').map(p => p.trim()).filter(Boolean)
    : [];
  return { role, company, projects };
}

// ── App Manifest ───────────────────────────────────────────────────────────

export const PassportApp = createAppStub({
  id: 'passport',
  name: 'Passport',
  version: '1.0.0',
  description: 'Your Takus identity — name, preferences, and personality that shape your experience.',
  icon: '🪪',
  category: 'core',
  requires: [],

  async activate(platform) {
    _platform = platform;
    await loadPassport();
  },

  async deactivate() {
    _platform = null;
  },

  getSettingsSchema() {
    return [
      { key: 'instanceName', label: 'Takus Name', type: 'text', defaultValue: 'My Takus', description: 'A name for this Takus instance' },
      { key: 'ownerName', label: 'Your Name', type: 'text', defaultValue: '', description: 'Your name — used in AI greetings and summaries', syncable: true },
      { key: 'birthday', label: 'Birthday', type: 'text', defaultValue: '', description: 'Your birthday (optional)' },
      { key: 'birthplace', label: 'Birthplace', type: 'text', defaultValue: '', description: 'Where you\'re from (optional)' },
      { key: 'creatorName', label: 'Creator', type: 'text', defaultValue: '', description: 'Who set up this Takus instance' },
      { key: 'bio', label: 'Bio', type: 'textarea', defaultValue: '', description: 'A short bio — helps Takus understand your context' },
      // Work Context
      { key: 'role', label: 'Role', type: 'text', defaultValue: '', description: 'Your job role (e.g. Product Manager)', group: 'Work Context' },
      { key: 'company', label: 'Company', type: 'text', defaultValue: '', description: 'Your company name (e.g. Acme Corp)', group: 'Work Context' },
      { key: 'projects', label: 'Active Projects', type: 'text', defaultValue: '', description: 'Comma-separated active projects (e.g. Q3 Launch, Mobile App)', group: 'Work Context' },
      { key: 'avatar', label: 'Avatar Emoji', type: 'text', defaultValue: '🧠', description: 'An emoji that represents you' },
      {
        key: 'preferredTone', label: 'AI Tone', type: 'select', defaultValue: 'professional',
        description: 'How should AI summaries and suggestions sound?',
        options: [
          { label: 'Professional', value: 'professional' },
          { label: 'Casual', value: 'casual' },
          { label: 'Academic', value: 'academic' },
          { label: 'Concise', value: 'concise' },
        ],
        syncable: true,
      },
    ];
  },

  getDefaultSettings() {
    return {
      instanceName: 'My Takus',
      ownerName: '',
      birthday: '',
      birthplace: '',
      creatorName: '',
      bio: '',
      role: '',
      company: '',
      projects: '',
      avatar: '🧠',
      preferredTone: 'professional',
    };
  },

  getNavItem() {
    // Passport doesn't have its own tab — it's accessed via Settings
    return null;
  },

  renderPanel(container) {
    _renderPassportPanel(container);
  },

  getNodeTypes() {
    return ['identity'];
  },

  getEdgeTypes() {
    return [];
  },

  getStepTypes() {
    return [];
  },

  canProduceInboxItems: false,
});

// ── UI Rendering ───────────────────────────────────────────────────────────

function _renderPassportPanel(container) {
  const p = _passport || defaultPassport();

  container.innerHTML = `
    <div class="card animate-in passport-card">
      <div class="card-header">
        <h3 class="passport-header">
          <span class="passport-avatar">${esc(p.avatar)}</span>
          Passport
        </h3>
      </div>
      <div class="passport-body">

        <div class="input-group">
          <label for="passport-instanceName">Takus Name</label>
          <input class="input" type="text" id="passport-instanceName" value="${esc(p.instanceName)}" placeholder="My Takus" />
          <div class="passport-hint">A name for this Takus instance</div>
        </div>

        <div class="input-group">
          <label for="passport-ownerName">Your Name</label>
          <input class="input" type="text" id="passport-ownerName" value="${esc(p.ownerName)}" placeholder="Your name" />
          <div class="passport-hint">Used in AI greetings and summaries</div>
        </div>

        <div class="passport-2col">
          <div class="input-group">
            <label for="passport-birthday">Birthday</label>
            <input class="input" type="text" id="passport-birthday" value="${esc(p.birthday)}" placeholder="e.g. June 15" />
          </div>
          <div class="input-group">
            <label for="passport-birthplace">Birthplace</label>
            <input class="input" type="text" id="passport-birthplace" value="${esc(p.birthplace)}" placeholder="e.g. Cairo, Egypt" />
          </div>
        </div>

        <div class="input-group">
          <label for="passport-creatorName">Creator</label>
          <input class="input" type="text" id="passport-creatorName" value="${esc(p.creatorName)}" placeholder="Who set up this Takus" />
        </div>

        <div class="input-group">
          <label for="passport-bio">Bio</label>
          <textarea class="input" id="passport-bio" rows="3" placeholder="A short bio — helps Takus understand your context">${esc(p.bio)}</textarea>
        </div>

        <div class="passport-section-title">
          <h4>💼 Work Context</h4>
        </div>

        <div class="passport-2col">
          <div class="input-group">
            <label for="passport-role">Role</label>
            <input class="input" type="text" id="passport-role" value="${esc(p.role)}" placeholder="e.g. Product Manager" />
          </div>
          <div class="input-group">
            <label for="passport-company">Company</label>
            <input class="input" type="text" id="passport-company" value="${esc(p.company)}" placeholder="e.g. Acme Corp" />
          </div>
        </div>

        <div class="input-group">
          <label for="passport-projects">Active Projects</label>
          <input class="input" type="text" id="passport-projects" value="${esc(p.projects)}" placeholder="e.g. Q3 Launch, Mobile App" />
          <div class="passport-hint">Comma-separated list of active projects</div>
        </div>

        <div class="passport-2col">
          <div class="input-group">
            <label for="passport-avatar">Avatar Emoji</label>
            <input class="input passport-emoji-input" type="text" id="passport-avatar" value="${esc(p.avatar)}" maxlength="4" />
          </div>
          <div class="input-group">
            <label for="passport-tone">AI Tone</label>
            <select class="input" id="passport-tone">
              <option value="professional" ${p.preferredTone === 'professional' ? 'selected' : ''}>Professional</option>
              <option value="casual" ${p.preferredTone === 'casual' ? 'selected' : ''}>Casual</option>
              <option value="academic" ${p.preferredTone === 'academic' ? 'selected' : ''}>Academic</option>
              <option value="concise" ${p.preferredTone === 'concise' ? 'selected' : ''}>Concise</option>
            </select>
          </div>
        </div>

        <button class="btn btn-primary passport-save" id="passport-save">
          Save Passport
        </button>

        <div class="passport-footer">
          🔒 Stored locally. Synced to your cloud drive as Takus/settings/passport.json.
        </div>
      </div>
    </div>`;

  // Bind save
  container.querySelector('#passport-save')?.addEventListener('click', async () => {
    const btn = container.querySelector('#passport-save');
    const orig = btn.textContent;
    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
      await savePassport({
        instanceName: container.querySelector('#passport-instanceName')?.value.trim() || 'My Takus',
        ownerName: container.querySelector('#passport-ownerName')?.value.trim() || '',
        birthday: container.querySelector('#passport-birthday')?.value.trim() || '',
        birthplace: container.querySelector('#passport-birthplace')?.value.trim() || '',
        creatorName: container.querySelector('#passport-creatorName')?.value.trim() || '',
        bio: container.querySelector('#passport-bio')?.value.trim() || '',
        role: container.querySelector('#passport-role')?.value.trim() || '',
        company: container.querySelector('#passport-company')?.value.trim() || '',
        projects: container.querySelector('#passport-projects')?.value.trim() || '',
        avatar: container.querySelector('#passport-avatar')?.value.trim() || '🧠',
        preferredTone: container.querySelector('#passport-tone')?.value || 'professional',
      });

      _platform?.notifications?.toast('Passport saved', 'Your identity has been updated.', 'success');

      // Sync to cloud (best-effort)
      _syncPassportToCloud().catch(() => {});
    } catch (err) {
      _platform?.notifications?.toast('Save failed', err.message, 'error');
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });
}

// ── Cloud sync ─────────────────────────────────────────────────────────────

async function _syncPassportToCloud() {
  try {
    const { CloudProviderManager } = await import('../../lib/cloud-provider.js');
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (!provider?.auth?.isConnected) return;

    const storage = provider.storage;
    if (typeof storage.uploadSmallFile !== 'function') return;

    const upload = typeof storage.upsertSmallFile === 'function'
      ? storage.upsertSmallFile.bind(storage)
      : storage.uploadSmallFile.bind(storage);

    // Save to Takus/settings/passport.json
    const passport = getPassport();
    if (!passport) return;

    // Strip sensitive fields before cloud sync
    const { id: _id, ...syncable } = passport;
    const payload = JSON.stringify(syncable, null, 2);

    if (provider.id === 'google') {
      const folderId = await storage.ensureFolderPath('Takus/settings');
      await upload(folderId, 'passport.json', payload, 'application/json');
    } else {
      await upload('Takus/settings', 'passport.json', payload, 'application/json');
    }
  } catch { /* non-critical */
    // Non-critical — passport is primarily local
  }
}


