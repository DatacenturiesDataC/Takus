// Takus — Built-in App Registry
// Central registration point for all built-in apps.
// Called once during app startup to register all apps with the App Manager.

import { registerApps } from '../lib/app-manager.js';

// Built-in apps — imported statically so they're always available
import { PassportApp } from './passport/index.js';
import { RecorderApp } from './recorder/index.js';
import { TasksApp } from './tasks/index.js';
import { AskApp } from './ask/index.js';
import { InboxApp } from './inbox/index.js';
import { GoalApp } from './goals/index.js';
import { PeopleApp } from './people/index.js';
import { InsightsApp } from './insights/index.js';
import { CalendarApp } from './calendar/index.js';
import { DriveApp } from './drive/index.js';
import { IntegrationsApp } from './integrations/index.js';
import { ArchiveApp } from './archive/index.js';
import { DocumentsApp } from './documents/index.js';
import { FeedbackApp } from './feedback/index.js';
import { ChatApp } from './chat/index.js';

/**
 * All built-in apps in registration order.
 * Core apps first, then built-in apps ordered by importance.
 *
 * @type {import('../lib/app-interface.js').TakusApp[]}
 */
export const BUILT_IN_APPS = [
  // Core apps (cannot be deactivated)
  PassportApp,
  RecorderApp,
  TasksApp,
  AskApp,
  GoalApp,
  InboxApp,

  // Built-in apps (can be deactivated)
  PeopleApp,
  InsightsApp,
  CalendarApp,
  DriveApp,
  IntegrationsApp,
  ArchiveApp,
  DocumentsApp,
  FeedbackApp,
  ChatApp,
];

/**
 * Register all built-in apps with the App Manager.
 * Call this once during app initialization, before initAppManager().
 */
export function registerBuiltInApps() {
  registerApps(BUILT_IN_APPS);
}
