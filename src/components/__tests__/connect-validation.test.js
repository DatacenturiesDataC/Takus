
// Unit tests for connect-panel field validation logic.
// Tests the _validateFields patterns without requiring DOM or crypto.
import { describe, it, expect } from 'vitest';

// Re-implement the validation logic for isolated testing.
// This mirrors _validateFields from connect-panel.js.
function validateFields(id, fields, existingCfg = {}) {
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
  return null;
}

describe('Connect Panel — Field Validation', () => {
  // ── Slack ──
  describe('Slack', () => {
    it('accepts valid webhook URL', () => {
      expect(validateFields('slack', {
        slack_webhookUrl: 'https://hooks.slack.com/services/T123/B456/xxxyyy',
      })).toBe(null);
    });

    it('rejects non-slack URL', () => {
      expect(validateFields('slack', {
        slack_webhookUrl: 'https://example.com/hook',
      })).toContain('https://hooks.slack.com/');
    });

    it('rejects incomplete webhook URL', () => {
      expect(validateFields('slack', {
        slack_webhookUrl: 'https://hooks.slack.com/services/T123',
      })).toContain('incomplete');
    });

    it('passes when no URL provided (unchanged)', () => {
      expect(validateFields('slack', { slack_webhookUrl: null })).toBe(null);
    });
  });

  // ── GitHub ──
  describe('GitHub', () => {
    it('accepts valid ghp_ token', () => {
      expect(validateFields('github', {
        github_token: 'ghp_abc123',
        github_owner: 'myorg',
        github_repo: 'myrepo',
      })).toBe(null);
    });

    it('accepts github_pat_ token', () => {
      expect(validateFields('github', {
        github_token: 'github_pat_abc123',
        github_owner: 'myorg',
        github_repo: 'myrepo',
      })).toBe(null);
    });

    it('rejects bad token prefix', () => {
      expect(validateFields('github', {
        github_token: 'gho_abc123',
        github_owner: 'myorg',
        github_repo: 'myrepo',
      })).toContain('ghp_');
    });

    it('requires owner and repo with token', () => {
      expect(validateFields('github', {
        github_token: 'ghp_abc123',
        github_owner: null,
        github_repo: null,
      })).toContain('Owner and Repository');
    });
  });

  // ── Linear ──
  describe('Linear', () => {
    it('accepts valid linear key', () => {
      expect(validateFields('linear', { linear_apiKey: 'lin_api_abc123' })).toBe(null);
    });

    it('rejects bad prefix', () => {
      expect(validateFields('linear', { linear_apiKey: 'sk_abc123' })).toContain('lin_api_');
    });
  });

  // ── Jira ──
  describe('Jira', () => {
    it('accepts valid jira config', () => {
      expect(validateFields('jira', {
        jira_host: 'myorg.atlassian.net',
        jira_email: 'me@company.com',
        jira_token: 'ATATT_abc123',
        jira_project: 'PROJ',
      })).toBe(null);
    });

    it('rejects bad host', () => {
      expect(validateFields('jira', {
        jira_host: 'example.com',
        jira_email: 'me@co.com',
        jira_token: null,
        jira_project: null,
      })).toContain('atlassian.net');
    });

    it('rejects bad email', () => {
      expect(validateFields('jira', {
        jira_host: 'org.atlassian.net',
        jira_email: 'notanemail',
        jira_token: null,
        jira_project: null,
      })).toContain('email');
    });

    it('rejects lowercase project key', () => {
      expect(validateFields('jira', {
        jira_host: 'org.atlassian.net',
        jira_email: 'me@co.com',
        jira_token: null,
        jira_project: 'proj',
      })).toContain('uppercase');
    });

    it('requires host and email when setting token', () => {
      expect(validateFields('jira', {
        jira_host: null,
        jira_email: null,
        jira_token: 'ATATT_abc',
        jira_project: null,
      })).toContain('Host and Email');
    });
  });

  // ── Notion ──
  describe('Notion', () => {
    it('accepts ntn_ token', () => {
      expect(validateFields('notion', {
        notion_apikey: 'ntn_abc123',
        notion_dbid: 'some-db-id',
      })).toBe(null);
    });

    it('accepts secret_ token', () => {
      expect(validateFields('notion', {
        notion_apikey: 'secret_abc123',
        notion_dbid: 'some-db-id',
      })).toBe(null);
    });

    it('rejects bad prefix', () => {
      expect(validateFields('notion', {
        notion_apikey: 'bad_token',
        notion_dbid: 'some-db-id',
      })).toContain('ntn_');
    });

    it('requires database ID with token', () => {
      expect(validateFields('notion', {
        notion_apikey: 'ntn_abc123',
        notion_dbid: null,
      })).toContain('Database ID');
    });
  });

  // ── Unknown ──
  it('passes unknown integration types', () => {
    expect(validateFields('unknown', {})).toBe(null);
  });
});
