// Takus — Slack Inbound Adapter
//
// Pulls messages from Slack channels into the Takus knowledge graph.
// Uses the Slack Web API (conversations.history) with a user-provided Bot Token.
//
// Required Slack Bot Token scopes:
//   - channels:history (public channels)
//   - groups:history (private channels, optional)
//   - channels:read (channel info)
//   - users:read (user names)
//
// Phase C: Bidirectional Integration Framework

import { InboundAdapter } from '../inbound-adapter.js';

const SLACK_API = 'https://slack.com/api';

export class SlackInboundAdapter extends InboundAdapter {
  constructor() {
    super({
      id: 'slack',
      name: 'Slack',
      icon: '💬',
      description: 'Import bookmarked and starred Slack messages as knowledge items.',
    });
    this._lastTs = null;     // Timestamp of last fetched message (for pagination)
    this._channelCache = {}; // channelId → name
    this._userCache = {};    // userId → displayName
  }

  /**
   * Connect with a Slack Bot Token and channel IDs.
   * @param {{ token: string, channelIds: string[] }} config
   */
  async connect(config) {
    if (!config?.token) throw new Error('Slack Bot Token is required');
    if (!config?.channelIds?.length) throw new Error('At least one Slack channel ID is required');

    // Validate token with auth.test
    const res = await fetch(`${SLACK_API}/auth.test`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack auth failed: ${data.error}`);

    this._config = {
      token: config.token,
      channelIds: config.channelIds,
      onlyStarred: config.onlyStarred ?? true,
      maxMessages: config.maxMessages ?? 50,
      teamName: data.team || '',
      userId: data.user_id || '',
    };
    this._connected = true;
  }

  /**
   * Poll configured channels for new messages.
   * @returns {Promise<object[]>} Raw Slack messages
   */
  async poll() {
    if (!this._connected) return [];

    const { token, channelIds, onlyStarred, maxMessages } = this._config;
    const allMessages = [];

    for (const channelId of channelIds) {
      try {
        const params = new URLSearchParams({
          channel: channelId,
          limit: String(Math.min(maxMessages, 100)),
        });
        if (this._lastTs) params.set('oldest', this._lastTs);

        const res = await fetch(`${SLACK_API}/conversations.history?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!data.ok) {
          console.warn(`[Slack] Channel ${channelId} failed: ${data.error}`);
          continue;
        }

        let messages = data.messages || [];

        // Filter to starred messages only if configured
        if (onlyStarred) {
          messages = messages.filter(m =>
            m.is_starred || (m.reactions || []).some(r => r.name === 'bookmark' || r.name === 'pushpin')
          );
        }

        // Annotate with channel ID for normalization
        for (const msg of messages) {
          msg._channelId = channelId;
          allMessages.push(msg);
        }

        // Track latest timestamp for next poll
        if (data.messages?.length) {
          const latest = data.messages[0].ts; // messages are newest-first
          if (!this._lastTs || latest > this._lastTs) {
            this._lastTs = latest;
          }
        }
      } catch (e) {
        console.warn(`[Slack] Failed to poll channel ${channelId}:`, e.message);
      }
    }

    // Pre-resolve channel and user names for normalization
    const uniqueChannels = [...new Set(allMessages.map(m => m._channelId))];
    const uniqueUsers = [...new Set(allMessages.map(m => m.user).filter(Boolean))];
    await Promise.all([
      ...uniqueChannels.map(id => this._resolveChannelName(id)),
      ...uniqueUsers.map(id => this._resolveUserName(id)),
    ]);

    return allMessages;
  }

  /**
   * Normalize a Slack message into a NormalizedContent object.
   * @param {object} msg — Raw Slack message
   * @returns {import('../inbound-adapter.js').NormalizedContent}
   */
  normalize(msg) {
    const channelName = this._channelCache[msg._channelId] || msg._channelId;
    const userName = this._userCache[msg.user] || msg.user || 'Unknown';
    const text = msg.text || '';
    const ts = parseFloat(msg.ts) * 1000; // Slack ts is Unix seconds with microseconds

    // Build title from first line or channel name
    const firstLine = text.split('\n')[0].slice(0, 100);
    const title = firstLine || `Slack message in #${channelName}`;

    // Build full content with thread context
    const contentParts = [text];
    if (msg.thread_ts && msg.replies?.length) {
      contentParts.push('\n--- Thread ---');
      for (const reply of msg.replies) {
        contentParts.push(`${reply.user || 'User'}: ${reply.text || ''}`);
      }
    }

    return {
      title,
      content: contentParts.join('\n'),
      type: 'chat',
      source: 'slack',
      sourceKey: `slack:${msg._channelId}:${msg.ts}`,
      metadata: {
        channelId: msg._channelId,
        channelName,
        userId: msg.user,
        userName,
        threadTs: msg.thread_ts || null,
        permalink: msg.permalink || null,
        reactions: (msg.reactions || []).map(r => r.name),
      },
      tags: ['slack', `#${channelName}`],
      timestamp: isFinite(ts) ? ts : Date.now(),
    };
  }

  /**
   * Resolve a channel ID to its name.
   * @param {string} channelId
   * @returns {Promise<string>}
   */
  async _resolveChannelName(channelId) {
    if (this._channelCache[channelId]) return this._channelCache[channelId];
    try {
      const res = await fetch(`${SLACK_API}/conversations.info?channel=${channelId}`, {
        headers: { Authorization: `Bearer ${this._config.token}` },
      });
      const data = await res.json();
      if (data.ok) {
        this._channelCache[channelId] = data.channel.name;
        return data.channel.name;
      }
    } catch { /* fallback to ID */ }
    return channelId;
  }

  /**
   * Resolve a user ID to their display name.
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async _resolveUserName(userId) {
    if (this._userCache[userId]) return this._userCache[userId];
    try {
      const res = await fetch(`${SLACK_API}/users.info?user=${userId}`, {
        headers: { Authorization: `Bearer ${this._config.token}` },
      });
      const data = await res.json();
      if (data.ok) {
        const name = data.user.profile?.display_name || data.user.real_name || data.user.name || userId;
        this._userCache[userId] = name;
        return name;
      }
    } catch { /* fallback to ID */ }
    return userId;
  }
}
