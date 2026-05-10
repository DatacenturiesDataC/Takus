import React, { Suspense, lazy } from 'react';
import { useUi } from '@store/index.js';

const AskPillar    = lazy(() => import('@components/pillars/AskPillar.jsx'));
const RecordPillar = lazy(() => import('@components/pillars/RecordPillar.jsx'));
const TasksPillar  = lazy(() => import('@components/pillars/TasksPillar.jsx'));
const ConnectPillar = lazy(() => import('@components/pillars/ConnectPillar.jsx'));

const PILLAR_MAP = {
  ask:     AskPillar,
  record:  RecordPillar,
  tasks:   TasksPillar,
  connect: ConnectPillar,
};

export function WorkspacePane() {
  const { activePillar } = useUi();
  const ActivePillar = PILLAR_MAP[activePillar] ?? RecordPillar;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Suspense fallback={<PillarSkeleton />}>
        <ActivePillar />
      </Suspense>
    </div>
  );
}

function PillarSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-white/[0.04] rounded-xl w-48" />
      <div className="h-32 bg-white/[0.04] rounded-2xl" />
      <div className="h-24 bg-white/[0.04] rounded-2xl" />
    </div>
  );
}
