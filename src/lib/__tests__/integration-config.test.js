// Takus — Integration Config Tests
import { describe, it, expect, vi } from 'vitest';

// Mock storage + identity vault + integration sub-modules
vi.mock('../storage.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  saveSetting: vi.fn(),
  openDB: vi.fn(),
}));

vi.mock('../identity-vault.js', () => ({
  loadCredential: vi.fn().mockResolvedValue(null),
}));

vi.mock('../integrations/jira.js', () => ({
  getJiraConfig: vi.fn().mockResolvedValue({ configured: false }),
  createJiraIssue: vi.fn(),
  buildJiraIssuePayload: vi.fn(),
}));

vi.mock('../integrations/notion.js', () => ({
  getNotionConfig: vi.fn().mockResolvedValue({ configured: false }),
  createNotionPage: vi.fn(),
  buildNotionPayload: vi.fn(),
}));

const { getSetting } = await import('../storage.js');
const { loadCredential } = await import('../identity-vault.js');
const { getJiraConfig } = await import('../integrations/jira.js');
const { getNotionConfig } = await import('../integrations/notion.js');
const { getIntegrationConfig } = await import('../integration-config.js');

describe('getIntegrationConfig', () => {
  // ── Slack ──────────────────────────────────────────────────────────────────
  describe('slack', () => {
    it('returns configured=false when no webhook URL', async () => {
      loadCredential.mockResolvedValueOnce(null);
      const result = await getIntegrationConfig('slack');
      expect(result.configured).toBe(false);
      expect(result.webhookUrl).toBeFalsy();
    });

    it('returns configured=true with a webhook URL', async () => {
      loadCredential.mockResolvedValueOnce('https://hooks.slack.com/test');
      const result = await getIntegrationConfig('slack');
      expect(result.configured).toBe(true);
      expect(result.webhookUrl).toBe('https://hooks.slack.com/test');
    });
  });

  // ── GitHub ─────────────────────────────────────────────────────────────────
  describe('github', () => {
    it('returns configured=false when token is missing', async () => {
      loadCredential.mockResolvedValueOnce(null);
      const result = await getIntegrationConfig('github');
      expect(result.configured).toBe(false);
    });

    it('returns configured=false when token present but owner/repo missing', async () => {
      loadCredential.mockResolvedValueOnce('ghp_test_token');
      getSetting.mockResolvedValueOnce('').mockResolvedValueOnce('');
      const result = await getIntegrationConfig('github');
      expect(result.configured).toBe(false);
      expect(result.token).toBe('ghp_test_token');
    });

    it('returns configured=true when token, owner, and repo all present', async () => {
      loadCredential.mockResolvedValueOnce('ghp_test_token');
      getSetting.mockResolvedValueOnce('my-org').mockResolvedValueOnce('my-repo');
      const result = await getIntegrationConfig('github');
      expect(result.configured).toBe(true);
      expect(result.owner).toBe('my-org');
      expect(result.repo).toBe('my-repo');
    });
  });

  // ── Linear ─────────────────────────────────────────────────────────────────
  describe('linear', () => {
    it('returns configured=false when apiKey is missing', async () => {
      loadCredential.mockResolvedValueOnce(null);
      const result = await getIntegrationConfig('linear');
      expect(result.configured).toBe(false);
    });

    it('returns configured=true when apiKey and teamId present', async () => {
      loadCredential.mockResolvedValueOnce('lin_api_key');
      getSetting.mockResolvedValueOnce('team-123').mockResolvedValueOnce('Engineering');
      const result = await getIntegrationConfig('linear');
      expect(result.configured).toBe(true);
      expect(result.teamId).toBe('team-123');
      expect(result.teamName).toBe('Engineering');
    });
  });

  // ── Jira ───────────────────────────────────────────────────────────────────
  describe('jira', () => {
    it('delegates to getJiraConfig', async () => {
      getJiraConfig.mockResolvedValueOnce({ configured: true, domain: 'test.atlassian.net' });
      const result = await getIntegrationConfig('jira');
      expect(result.configured).toBe(true);
      expect(result.domain).toBe('test.atlassian.net');
    });
  });

  // ── Notion ─────────────────────────────────────────────────────────────────
  describe('notion', () => {
    it('delegates to getNotionConfig', async () => {
      getNotionConfig.mockResolvedValueOnce({ configured: true, apiKey: 'ntn_key' });
      const result = await getIntegrationConfig('notion');
      expect(result.configured).toBe(true);
    });
  });

  // ── Unknown + Error Handling ───────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns configured=false for unknown integration name', async () => {
      const result = await getIntegrationConfig('unknown_service');
      expect(result.configured).toBe(false);
    });

    it('returns configured=false on credential load error', async () => {
      loadCredential.mockRejectedValueOnce(new Error('Vault locked'));
      const result = await getIntegrationConfig('slack');
      expect(result.configured).toBe(false);
    });
  });
});
