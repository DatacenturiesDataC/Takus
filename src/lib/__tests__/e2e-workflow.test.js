// Takus — End-to-End Integration Workflow Test
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock External Modules to Avoid API Key and Network Requirements ───────

vi.mock('../ffmpeg-engine.js', () => ({
  extractAudio: vi.fn(async () => new Blob(['audio-data'], { type: 'audio/wav' })),
}));

vi.mock('../ai-engine.js', () => ({
  generateTranscriptionAndSummary: vi.fn(async () => ({
    transcript: 'We need to launch the project and improve the workflow. Improve the project timeline.',
    summary: '# Project Ingestion Summary\nThis session focused on workflows and project improvement.',
    vtt: 'WEBVTT\n00:01.000 --> 00:05.000\nIngestion test transcript',
  })),
  extractTasks: vi.fn(async () => ({
    takusTasks: [
      {
        id: 'tsk_e2e_101',
        title: 'Improve the project timeline',
        action: 'UPDATE_TIMELINE',
        status: 'pending',
        objective: 'Improve the project',
        steps: [],
      }
    ],
    meTasks: [],
  })),
  extractGoals: vi.fn(async () => ({
    goals: [
      {
        matchedGoalId: null,
        title: 'Improve the project',
        evidence: 'Improve the project timeline',
      }
    ],
  })),
  summarizeText: vi.fn(async () => ({
    summary: '# Import Document Summary\nSummarized successfully.',
  })),
}));

vi.mock('../embeddings.js', () => ({
  embedTranscript: vi.fn(async () => [
    { chunkIndex: 0, text: 'chunk1', embedding: new Array(1536).fill(0.1) }
  ]),
  cosineSimilarity: vi.fn(() => 0.95),
}));

const mockProvider = {
  id: 'google',
  storage: {
    ensureFolderPath: vi.fn(async () => 'folder-google-e2e'),
    listFolderContents: vi.fn(async () => [
      { id: 'file-vid', name: 'original.webm' },
      { id: 'file-meta', name: 'metadata.json' },
    ]),
    deleteFile: vi.fn(async () => {}),
    downloadFileBlob: vi.fn(async () => new Blob(['video-payload'])),
    downloadFileContent: vi.fn(async () => null),
    uploadSmallFile: vi.fn(async () => {}),
    upsertSmallFile: vi.fn(async () => {}),
    auth: {
      ensureValidToken: vi.fn(async () => 'google-token'),
    },
  },
};

vi.mock('../cloud-provider.js', () => ({
  CloudProviderManager: {
    getInstance: vi.fn(() => ({
      getProvider: vi.fn(() => mockProvider),
    })),
  },
}));

vi.mock('../settings-store.js', () => ({
  getSettings: vi.fn(() => ({
    aiProvider: 'openai',
    openaiKey: 'sk-mock-key-for-e2e',
    geminiKey: '',
    desktopNotifications: false,
    workspace: false,
  })),
  getEffectiveAIConfig: vi.fn(() => ({
    provider: 'openai',
    apiKey: 'sk-mock-key-for-e2e',
    useProxy: false,
    proxyUrl: null,
    workspaceId: null,
    memberToken: null,
  })),
  saveAndCache: vi.fn(),
  initSettings: vi.fn(),
  getShortcuts: vi.fn(),
  restoreSettingsFromCloud: vi.fn(),
}));

vi.mock('../closeness-worker.js', () => ({
  recomputeScores: vi.fn(async () => ({ updated: 0, crossed: [] })),
}));

// Import modules to test
import { saveSetting, getEntry, getEntries, clearAllEntries, getNodesByType, getAllEdges, getMediaBlob } from '../storage.js';
import { createEntry, processContent, processRawEntry, finalizeCapture } from '../content-pipeline.js';
import { ingestDocument } from '../document-adapter.js';
import { runWellbeingCheck } from '../wellbeing.js';
import { autoLinkTasks, computeGoalProgress } from '../goal-linker.js';
import { checkEligibility, transitionToColdStorage, isEligibleForColdStorage, restoreEntry } from '../archive-engine.js';
import { getAppSettings, setAppSetting } from '../app-manager.js';

describe('Takus End-to-End Workflow Integration', () => {
  beforeEach(async () => {
    await clearAllEntries();
    // Configure settings
    await saveSetting('aiProvider', 'openai');
    await saveSetting('openaiKey', 'sk-mock-key-for-e2e');
    // Mock global fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mock-file-id' }),
      text: async () => 'mock-response-text',
    });
  });

  it('executes document ingestion, task-goal auto-linking, well-being checks, and cold storage transitions', async () => {
    // ── STEP 1: Ingest Document (Non-Media Capture Ingestion) ────────────────
    const docInput = {
      title: 'Q3 Product Strategy notes',
      content: 'We need to launch the project and improve the workflow. Improve the project timeline.',
      tags: ['strategy', 'q3'],
    };

    const docIngestResult = await ingestDocument(docInput);
    expect(docIngestResult.success).toBe(true);
    expect(docIngestResult.entry).toBeDefined();

    // Verify raw entry was saved in IDB
    const entryId = docIngestResult.entry.id;
    let dbRawEntry = await getEntry(entryId);
    console.log("E2E Entry State:", dbRawEntry.state);
    console.log("E2E Pipeline Run:", JSON.stringify(dbRawEntry.pipelineRun, null, 2));
    if (dbRawEntry.pipelineRun?.error) {
      console.error("E2E Pipeline Error:", dbRawEntry.pipelineRun.error);
    }
    expect(dbRawEntry.state).toBe('active'); // processRawEntry ran auto-process successfully
    expect(dbRawEntry.title).toBe('Q3 Product Strategy notes');

    // Verify task extraction & node creation
    const taskNodes = await getNodesByType('task');
    expect(taskNodes.length).toBeGreaterThanOrEqual(1);
    const extractedTask = taskNodes.find(t => t.properties.title === 'Improve the project timeline');
    expect(extractedTask).toBeTruthy();
    expect(extractedTask.appId).toBe('tasks');

    // ── STEP 2: Goal Detection & Task-Goal Auto-Linking ─────────────────────
    // Mock-detected goals are saved as nodes
    const goalNodes = await getNodesByType('goal');
    expect(goalNodes.length).toBeGreaterThanOrEqual(1);
    const mainGoal = goalNodes[0];
    expect(mainGoal.properties.title).toBe('Improve the project');

    // Link tasks to goals
    await autoLinkTasks();

    // Verify MENTIONS / CONTRIBUTES_TO edge is established
    const edges = await getAllEdges();
    const linkEdge = edges.find(e => e.edgeType === 'CONTRIBUTES_TO' && e.sourceId === extractedTask.id && e.targetId === mainGoal.id);
    expect(linkEdge).toBeTruthy();

    // Calculate goal progress
    const progress = await computeGoalProgress(mainGoal.id);
    expect(progress).toBeDefined();
    expect(progress.total).toBeGreaterThanOrEqual(1);

    // Add App Settings for Goals
    await setAppSetting('goals', 'maxActiveGoals', 5);

    const goalsSettings = await getAppSettings('goals');
    expect(goalsSettings.maxActiveGoals).toBe(5);

    // Run Wellbeing check
    const wellbeingAssessment = await runWellbeingCheck({
      activeGoals: goalNodes,
      activeTasks: taskNodes,
      maxActiveGoals: goalsSettings.maxActiveGoals,
    });
    expect(wellbeingAssessment).toBeDefined();
    expect(wellbeingAssessment.focusLevel).toBeDefined();

    // ── STEP 4: Archive Eligibility & Cold Storage Transition ───────────────
    // Save vault sync info to mock successful upload
    const mockVaultSync = {
      id: entryId,
      drivePackageUploaded: true,
      archiveStatus: 'active',
    };
    const { saveVaultSync } = await import('../storage.js');
    await saveVaultSync(mockVaultSync);

    // Simulate entry age by changing date back by 95 days
    const ninetyFiveDaysAgo = Date.now() - 95 * 24 * 60 * 60 * 1000;
    dbRawEntry.date = ninetyFiveDaysAgo;
    const { saveEntry } = await import('../storage.js');
    await saveEntry(dbRawEntry);

    // Check archive eligibility
    const eligibility = checkEligibility(dbRawEntry, mockVaultSync);
    expect(eligibility.eligible).toBe(true);

    // Simulate archive transition
    dbRawEntry.archiveStatus = 'archived';
    mockVaultSync.archiveStatus = 'archived';
    await saveEntry(dbRawEntry);
    await saveVaultSync(mockVaultSync);

    // Check eligibility for cold storage
    const coldEligible = isEligibleForColdStorage(dbRawEntry, mockVaultSync);
    expect(coldEligible.eligible).toBe(true);

    // Transition to cold storage
    const transitionResult = await transitionToColdStorage(dbRawEntry, vi.fn());
    expect(transitionResult.success).toBe(true);

    // Verify status updated to COLD and original media deletion is scheduled/executed
    const updatedVaultSync = await getEntry(entryId);
    expect(updatedVaultSync.archiveStatus).toBe('cold');

    // ── STEP 5: Partial Restoration from Cold Storage ──────────────────────
    // Cold storage entries can now be partially restored (artefacts only, no video)
    const restoreResult = await restoreEntry(dbRawEntry);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.partial).toBe(true);
  });

  // ── WORKFLOW 2: Media Recording Lifecycle & State Machine Transitions ──
  it('verifies Media Recording state transitions and observer console/network sniffing', async () => {
    const { StateMachine, States } = await import('../state-machine.js');
    const { Observer } = await import('../observer.js');

    // 1. Verify State Machine Transitions
    const fsm = new StateMachine();
    expect(fsm.state).toBe(States.IDLE);
    expect(fsm.canTransition(States.REQUESTING_ACCESS)).toBe(true);
    
    expect(fsm.transition(States.REQUESTING_ACCESS)).toBe(true);
    expect(fsm.state).toBe(States.REQUESTING_ACCESS);
    
    expect(fsm.transition(States.PREVIEWING)).toBe(true);
    expect(fsm.state).toBe(States.PREVIEWING);
    
    expect(fsm.transition(States.RECORDING)).toBe(true);
    expect(fsm.state).toBe(States.RECORDING);

    expect(fsm.transition(States.PAUSED)).toBe(true);
    expect(fsm.state).toBe(States.PAUSED);

    expect(fsm.transition(States.REVIEWING)).toBe(true);
    expect(fsm.state).toBe(States.REVIEWING);

    // 2. Verify Observer console, click actions, and network error sniffing
    // Mock fetch to reject before starting observer
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const observer = new Observer();
    observer.start();

    // Trigger fake click and keydown events
    const fakeButton = document.createElement('button');
    fakeButton.id = 'submit-btn';
    document.body.appendChild(fakeButton);
    fakeButton.click();

    // Trigger console logs
    console.error('Test console error msg');
    console.warn('Test console warning msg');

    try {
      await fetch('https://invalid.url/endpoint');
    } catch {}

    // Stop observer and verify captured snapshot data
    const snapshot = observer.stop();
    document.body.removeChild(fakeButton);
    globalThis.fetch = origFetch;

    expect(snapshot.consoleErrors.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.consoleErrors.some(e => e.message.includes('Test console error msg'))).toBe(true);
    expect(snapshot.actions.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.actions.some(a => a.target.includes('#submit-btn'))).toBe(true);
    expect(snapshot.networkErrors.length).toBeGreaterThanOrEqual(1);
  });

  // ── WORKFLOW 3: Media Content Ingestion & FFmpeg Audio Extraction ──
  it('verifies Media Content Ingestion, FFmpeg audio extraction mock, and step execution', async () => {
    const { finalizeCapture, processContent } = await import('../content-pipeline.js');
    
    // 1. Create a dummy media entry
    const entryId = 'ent_media_e2e_new';
    const mediaEntry = {
      id: entryId,
      title: 'Monthly Sync Recording',
      type: 'meeting',
      date: Date.now(),
      archiveStatus: 'active',
      state: 'raw',
    };
    
    // 2. Process via finalizeCapture with a mock video blob
    const mockVideoBlob = new Blob(['dummy-video-bytes'], { type: 'video/webm' });
    const finalizeRes = await finalizeCapture(mockVideoBlob, mediaEntry);
    
    expect(finalizeRes.processedBlob).toBeDefined();
    
    // Process media content synchronously and await it
    await processContent(mediaEntry, { blob: mockVideoBlob });
    
    // Check local media blob storage
    const savedBlob = await getMediaBlob(entryId);
    expect(savedBlob).toBeDefined();
    
    // Fetch updated entry from IDB and verify state is 'active'
    let dbEntry = await getEntry(entryId);
    expect(dbEntry.state).toBe('active');
    expect(dbEntry.aiSummary).toBeDefined();
    expect(dbEntry.textContent).toBeDefined();
  });

  // ── WORKFLOW 4: Ask / Semantic Search & Cosine Similarity ──
  it('verifies Ask / Semantic Search, embeddings chunk retrieval, and actual cosine similarity', async () => {
    const { saveEntry, saveEmbeddings } = await import('../storage.js');
    const { searchContent } = await import('../search-engine.js');
    const { cosineSimilarity } = await vi.importActual('../embeddings.js');

    // 1. Save entry to search
    const searchId = 'ent_search_e2e';
    const searchEntry = {
      id: searchId,
      title: 'Knowledge Base Article',
      textContent: 'The system uses an index to search across transcripts. Performance is key.',
      aiSummary: 'System architecture search index overview.',
      type: 'document',
      date: Date.now(),
      state: 'active',
    };
    await saveEntry(searchEntry);

    // Save mock embeddings chunk for indexing
    await saveEmbeddings(searchId, [
      { chunkIndex: 0, text: 'index to search across transcripts', embedding: new Array(1536).fill(0.15) }
    ]);

    // 2. Query search Content
    const results = await searchContent('search transcripts');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(searchId);
    expect(results[0].snippet).toContain('search');

    // 3. Test Actual Cosine Similarity helper
    const similarity = cosineSimilarity([1, 1, 0], [1, 1, 0]);
    expect(similarity).toBeCloseTo(1.0);
    const orthogonal = cosineSimilarity([1, 0, 0], [0, 1, 0]);
    expect(orthogonal).toBeCloseTo(0.0);
  });

  // ── WORKFLOW 5: App Manager Activation, Node registration, and Settings ──
  it('verifies App Manager activation, node registration, namespaced settings, and deactivation', async () => {
    const { registerApp, activateApp, deactivateApp, isActive, setAppSetting, getAppSettings, _resetForTest } = await import('../app-manager.js');
    const { registerNodeType, hasNodeType } = await import('../graph/node-registry.js');

    // Reset app manager registry for clean testing state
    _resetForTest();

    // Register a mock custom app
    const mockApp = {
      id: 'custom_insights',
      name: 'Custom Insights App',
      version: '1.0.0',
      description: 'A mock custom app for testing',
      icon: '📊',
      category: 'built-in',
      requires: [],
      activate: vi.fn(async () => {
        // App-specific node registration
        registerNodeType({
          type: 'insight_report',
          label: 'Insight Report',
          icon: '📊',
          appId: 'custom_insights',
          requiredProps: ['score'],
        });
      }),
      deactivate: vi.fn(async () => {}),
      getSettingsSchema: () => [
        { key: 'syncInterval', label: 'Sync Interval', type: 'number', defaultValue: 300 }
      ],
      getDefaultSettings: () => ({ syncInterval: 300 }),
      getNavItem: () => null,
      renderPanel: () => {},
      getNodeTypes: () => ['insight_report'],
      getEdgeTypes: () => [],
      getStepTypes: () => [],
    };

    registerApp(mockApp);
    await activateApp('custom_insights');

    expect(isActive('custom_insights')).toBe(true);
    expect(mockApp.activate).toHaveBeenCalled();

    // Verify node types are registered
    expect(hasNodeType('insight_report')).toBe(true);

    // Save & Retrieve Namespaced Settings
    await setAppSetting('custom_insights', 'syncInterval', 600);
    const settings = await getAppSettings('custom_insights');
    expect(settings.syncInterval).toBe(600);

    // Deactivate app
    await deactivateApp('custom_insights');
    expect(isActive('custom_insights')).toBe(false);
  });

  // ── WORKFLOW 6: Inbound Polling & Inbox Deduplication ──
  it('verifies InboundAdapter connection, polling, ingestion, and deduplication', async () => {
    const { InboundAdapter, registerAdapter, unregisterAdapter, ingestFromAdapter, resetSeenKeys } = await import('../inbound-adapter.js');

    resetSeenKeys();

    class SlackAdapter extends InboundAdapter {
      constructor() {
        super({
          id: 'slack_conn',
          name: 'Slack Connector',
          icon: '💬',
          description: 'Polls slack messages',
        });
      }

      async poll() {
        return [
          { id: 'msg_999', text: 'Important alert: DB backup failed.', title: 'Alert Message' }
        ];
      }
    }

    const adapter = new SlackAdapter();
    registerAdapter(adapter);

    await adapter.connect({ apiKey: 'slack-test-key' });
    expect(adapter.connected).toBe(true);

    // First ingestion should succeed
    const stats1 = await ingestFromAdapter('slack_conn');
    expect(stats1.ingested).toBe(1);
    expect(stats1.skipped).toBe(0);

    // Verify entry got created in storage
    const entries = await getEntries();
    const alertEntry = entries.find(e => e.title === 'Alert Message');
    expect(alertEntry).toBeDefined();
    expect(alertEntry.textContent).toContain('Important alert');

    // Second ingestion should skip the item (deduplication check)
    const stats2 = await ingestFromAdapter('slack_conn');
    expect(stats2.ingested).toBe(0);
    expect(stats2.skipped).toBe(1);

    unregisterAdapter('slack_conn');
  });

  // ── WORKFLOW 7: Autonomy Loop Tick Execution ──
  it('verifies Autonomy Engine Tick loop execution, goal health, and auto-linking updates', async () => {
    const { testAutoGoalTaskLinking, testAutoGoalHealth } = await import('../autonomy-engine.js');
    const { saveNode, getNodesByType, getAllEdges } = await import('../storage.js');
    const { registerNodeType } = await import('../graph/node-registry.js');

    // 1. Create a stagnant goal to verify health transitions
    // Ensure 'goal' node type is registered
    try {
      registerNodeType({
        type: 'goal',
        label: 'Goal',
        icon: '🎯',
        appId: 'goals',
        requiredProps: [],
      });
    } catch {}

    const stagnantGoal = {
      id: 'goal_stagnant_e2e',
      type: 'goal',
      properties: {
        title: 'Learn Vitest',
        state: 'active',
        lastMentionedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago (stagnant)
      },
      createdAt: Date.now() - 35 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now(),
    };
    await saveNode(stagnantGoal);

    // 2. Create a task that is not linked to any goal to check auto-linking
    try {
      registerNodeType({
        type: 'task',
        label: 'Task',
        icon: '✅',
        appId: 'tasks',
        requiredProps: [],
      });
    } catch {}

    const standaloneTask = {
      id: 'task_standalone_e2e',
      type: 'task',
      appId: 'tasks',
      properties: {
        title: 'Write some tests',
        objective: 'Learn Vitest', // matches goal title for auto-linking
        state: 'pending',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveNode(standaloneTask);

    // 3. Execute Autonomy sub-steps to check them
    await testAutoGoalHealth();
    await testAutoGoalTaskLinking();

    // Verify goal marked as 'at-risk' due to stagnation
    const updatedGoals = await getNodesByType('goal');
    const targetGoal = updatedGoals.find(g => g.id === 'goal_stagnant_e2e');
    expect(targetGoal).toBeDefined();
    expect(targetGoal.properties.state).toBe('at-risk');

    // Verify standalone task is auto-linked to the goal
    const edges = await getAllEdges();
    const linkEdge = edges.find(e => e.edgeType === 'CONTRIBUTES_TO' && e.sourceId === 'task_standalone_e2e' && e.targetId === 'goal_stagnant_e2e');
    expect(linkEdge).toBeDefined();
  });

  // ── WORKFLOW 8: Integrations credentials lookup & Jira issue exporter ──
  it('verifies Integrations credential lookup, payload mapping, and issue creation fetch proxy', async () => {
    const { saveJiraConfig, getJiraConfig, buildJiraIssuePayload, createJiraIssue } = await import('../integrations/jira.js');

    // 1. Save and retrieve config
    const configData = {
      host: 'https://test-team.atlassian.net',
      email: 'user@example.com',
      token: 'jira-secret-token-123',
      project: 'TESTPROJ',
    };
    await saveJiraConfig(configData);

    const config = await getJiraConfig();
    expect(config.configured).toBe(true);
    expect(config.host).toBe(configData.host);
    expect(config.project).toBe(configData.project);

    // 2. Build task payload for Jira
    const mockTask = {
      id: 'task_j_1',
      title: 'Fix issue with login',
      action: 'BUG_FIX',
      objective: 'Smooth Auth flow',
      steps: [{ text: 'Locate button', status: 'completed' }, { text: 'Click button', status: 'pending' }],
    };
    const mockEntry = {
      id: 'entry_j_1',
      title: 'Review of Auth system',
      type: 'update',
      date: Date.now(),
    };

    const payload = buildJiraIssuePayload(mockTask, mockEntry);
    expect(payload.summary).toBe('Fix issue with login');
    expect(payload.description).toContain('Review of Auth system');
    expect(payload.description).toContain('✅ Locate button');
    expect(payload.description).toContain('❌ Click button');

    // 3. Mock and run createJiraIssue (calling fetch)
    const result = await createJiraIssue(config, payload);
    expect(result).toBeDefined();
  });
});

