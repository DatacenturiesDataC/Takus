// Takus — Integration Config
// Data-layer helpers for reading configured integration credentials.
// Extracted from connect-panel.js to eliminate lib → component dependency.

import { getSetting } from './storage.js';
import { loadCredential } from './identity-vault.js';
import { getJiraConfig } from './integrations/jira.js';
import { getNotionConfig } from './integrations/notion.js';

/**
 * Load the connect config for a named integration.
 * Returns an object with `configured: boolean` and integration-specific fields.
 * @param {'slack'|'github'|'linear'|'jira'|'notion'} name
 * @returns {Promise<{ configured: boolean, [key: string]: any }>}
 */
export async function getIntegrationConfig(name) {
  try {
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
  } catch (e) {
    console.warn(`[IntegrationConfig] Failed to load ${name}:`, e.message);
    return { configured: false };
  }
}
