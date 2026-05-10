import React from 'react';
import { CheckSquare, Square, Trash2 } from 'lucide-react';
import { useTasks } from '@store/index.js';

export default function TasksPillar() {
  const { myTasks, agentTasks, toggleMyTask, removeMyTask, clearCompletedTasks } = useTasks();
  const pending = myTasks.filter((t) => !t.done);
  const done = myTasks.filter((t) => t.done);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Tasks</h1>
          <p className="text-sm text-white/40 mt-1">
            Commitments extracted from your recordings.
          </p>
        </div>
        {done.length > 0 && (
          <button
            onClick={clearCompletedTasks}
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            Clear {done.length} done
          </button>
        )}
      </div>

      {myTasks.length === 0 ? (
        <div className="glass-panel p-8 flex flex-col items-center gap-3 border-dashed">
          <CheckSquare size={32} className="text-white/10" />
          <p className="text-sm text-white/30">No tasks yet</p>
          <p className="text-xs text-white/20 text-center max-w-sm">
            Record a meeting — commitments like "I'll send the report by Friday" will be
            automatically extracted and appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {myTasks.map((task) => (
            <div
              key={task.id}
              className={[
                'flex items-start gap-3 p-3 rounded-xl border transition-colors',
                task.done
                  ? 'bg-white/[0.01] border-white/[0.04] opacity-50'
                  : 'bg-white/[0.03] border-white/[0.06]',
              ].join(' ')}
            >
              <button
                onClick={() => toggleMyTask(task.id)}
                className="mt-0.5 flex-shrink-0 text-white/40 hover:text-takus-success transition-colors"
              >
                {task.done ? <CheckSquare size={16} className="text-takus-success" /> : <Square size={16} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${task.done ? 'line-through text-white/30' : 'text-white/80'}`}>
                  {task.text}
                </p>
                {(task.assignee || task.dueDate) && (
                  <p className="text-xs text-white/30 mt-0.5">
                    {task.assignee && <span>{task.assignee}</span>}
                    {task.assignee && task.dueDate && <span> · </span>}
                    {task.dueDate && <span>Due {task.dueDate}</span>}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeMyTask(task.id)}
                className="flex-shrink-0 text-white/20 hover:text-white/50 transition-colors"
                aria-label="Remove task"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {agentTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Agent Actions</h2>
          {agentTasks.map((task) => (
            <div key={task.id} className="glass-panel p-3 flex items-center gap-3">
              <div className={[
                'w-2 h-2 rounded-full flex-shrink-0',
                task.status === 'done' ? 'bg-takus-success' :
                task.status === 'failed' ? 'bg-takus-danger' :
                'bg-takus-warning animate-pulse',
              ].join(' ')} />
              <p className="text-sm text-white/70 flex-1">{task.label}</p>
              <span className="text-xs text-white/30 capitalize">{task.status}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
