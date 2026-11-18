/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Activity,
  AlertCircle,
  AudioLines,
  Bot,
  CheckCircle2,
  Ear,
  Eraser,
  Headphones,
  House,
  Globe,
  Loader,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  Power,
  Square,
  UserRound,
  Volume2,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  useFloatingVoice,
  type FloatingEntry,
} from '@renderer/components/CyrvisVoice/useFloatingVoice';
import { useSetting } from '@renderer/hooks/useSetting';
import { Operator } from '@main/store/types';
import type { TaskStatus } from '@shared/cyrvis';
import logo from '@resources/logo-full.svg?url';
import logoDark from '@resources/logo-full-dark.svg?url';

import './widget.css';

const isWin = navigator.userAgent.includes('Windows');

const TASK_LABELS: Record<TaskStatus, string> = {
  idle: 'Idle',
  starting: 'Starting',
  executing: 'Executing',
  paused: 'Paused',
  cancelling: 'Stopping',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const formatEntryTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);

const getOperatorIcon = (operator: Operator) =>
  operator === Operator.LocalBrowser ? (
    <Globe className="h-3 w-3" />
  ) : (
    <Monitor className="h-3 w-3" />
  );

const getOperatorLabel = (operator: Operator) =>
  operator === Operator.LocalBrowser ? 'Browser' : 'Computer';

function ToolButton({
  label,
  disabled = false,
  active = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`no-drag h-8 w-8 border-gray-300 bg-white/70 hover:border-gray-500 hover:bg-white ${
        active
          ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
          : danger
            ? 'border-red-300 text-red-600 hover:border-red-500 hover:bg-red-50'
            : 'text-slate-600'
      }`}
    >
      {children}
    </Button>
  );
}

function ChatEntry({
  entry,
  streaming = false,
}: {
  entry: FloatingEntry;
  streaming?: boolean;
}) {
  const fromUser = entry.kind === 'user';
  return (
    <div className={`flex gap-2 ${fromUser ? 'justify-end' : 'justify-start'}`}>
      {!fromUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
          <Bot className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={`max-w-[82%] rounded-xl px-3 py-2 text-sm leading-5 ${
          fromUser
            ? 'bg-slate-900 text-white'
            : 'border border-slate-200 bg-white text-slate-800'
        }`}
      >
        <span className="whitespace-pre-wrap break-words">{entry.text}</span>
        {streaming && (
          <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded-sm bg-current align-middle" />
        )}
        <div
          className={`mt-1 text-[10px] ${
            fromUser ? 'text-slate-300' : 'text-slate-400'
          }`}
        >
          {formatEntryTime(entry.timestamp)}
        </div>
      </div>
      {fromUser && (
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
          <UserRound className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

function LiveMessage({
  role,
  text,
  streaming,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming: boolean;
}) {
  return (
    <ChatEntry
      entry={{
        id: `live-${role}`,
        kind: role,
        text,
        timestamp: Date.now(),
      }}
      streaming={streaming}
    />
  );
}

function ActivityEntry({ entry }: { entry: FloatingEntry }) {
  const failed = entry.kind === 'error';
  const done = /完成|done|finished/i.test(entry.text);
  const Icon = failed ? AlertCircle : done ? CheckCircle2 : Activity;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${
        failed ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'
      }`}
    >
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
          failed ? 'text-red-500' : 'text-cyan-600'
        }`}
      />
      <p className="min-w-0 flex-1 break-words">{entry.text}</p>
      <span className="shrink-0 text-[10px] text-slate-400">
        {formatEntryTime(entry.timestamp)}
      </span>
    </div>
  );
}

const Widget = () => {
  const { settings } = useSetting();
  const {
    state,
    entries,
    transcript,
    transcriptFinal,
    assistantText,
    assistantFinal,
    thinking,
    playbackActive,
    micReady,
    audioMode,
    ptt,
    error,
    taskActive,
    clearEntries,
    start,
    sleep,
    wake,
    interrupt,
    togglePtt,
    toggleAudioMode,
    cancelTask,
    pauseTask,
    resumeTask,
  } = useFloatingVoice();
  const currentOperator = settings.operator || Operator.LocalComputer;

  const [activeView, setActiveView] = useState<'chat' | 'activity'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const assistantSpeaking = state?.ttsSpeaking || playbackActive;
  const voiceStatus = !state
    ? 'Voice off'
    : !micReady
      ? 'Voice off'
      : ptt.mode && !ptt.active
        ? 'Push to talk'
        : assistantSpeaking
          ? 'Speaking'
          : state.userSpeaking
            ? 'Listening'
            : thinking
              ? 'Thinking'
              : state.awake
                ? 'Ready'
                : 'Sleeping';

  const currentActivity = [...entries]
    .reverse()
    .find((entry) => entry.kind === 'activity' || entry.kind === 'error');
  const visibleEntries = entries.filter((entry) =>
    activeView === 'chat'
      ? entry.kind === 'user' || entry.kind === 'assistant'
      : entry.kind === 'activity' || entry.kind === 'error',
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottomRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [assistantText, entries.length, transcript, activeView]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceToBottom <= 32;
  }, []);

  const handleOpenMainWindow = useCallback(() => {
    void api.showMainWindow();
  }, []);

  const handleVoiceToggle = useCallback(() => {
    if (micReady) {
      wake();
      return;
    }
    void start();
  }, [micReady, start, wake]);

  const handleTaskPauseResume = useCallback(() => {
    if (state?.task.status === 'paused') {
      void resumeTask();
    } else {
      void pauseTask();
    }
  }, [pauseTask, resumeTask, state?.task.status]);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[10px] border-gray-300 bg-white/95 p-4 dark:bg-gray-800/95"
      style={{ borderWidth: isWin ? '1px' : '0' }}
    >
      <div className="draggable-area flex shrink-0 items-center gap-2">
        <img
          src={logo}
          alt="Cyrvis"
          className="-ml-2 h-6 dark:hidden"
          draggable={false}
        />
        <img
          src={logoDark}
          alt="Cyrvis"
          className="-ml-2 h-6 hidden dark:block"
          draggable={false}
        />
        <div className="ml-1 flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              state?.awake ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            CYRVIS
          </span>
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[10px] text-slate-500">
          {getOperatorIcon(currentOperator)}
          {getOperatorLabel(currentOperator)}
        </div>

        <div className="ml-auto flex items-center rounded-lg border border-slate-200 bg-white/80 p-0.5">
          <Button
            variant={activeView === 'chat' ? 'secondary' : 'ghost'}
            size="sm"
            aria-label="Show conversation"
            title="Conversation"
            onClick={() => setActiveView('chat')}
            className="no-drag h-7 gap-1 px-2 text-[11px]"
          >
            <Bot className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button
            variant={activeView === 'activity' ? 'secondary' : 'ghost'}
            size="sm"
            aria-label="Show activity"
            title="Activity"
            onClick={() => setActiveView('activity')}
            className="no-drag h-7 gap-1 px-2 text-[11px]"
          >
            <Activity className="h-3.5 w-3.5" />
            Activity
          </Button>
        </div>

        <ToolButton label="Clear view" onClick={clearEntries}>
          <Eraser className="h-3.5 w-3.5" />
        </ToolButton>
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-cyan-100 bg-cyan-50/80 px-3 py-2 text-xs text-cyan-900">
        <AudioLines
          className={`h-3.5 w-3.5 shrink-0 ${
            assistantSpeaking || thinking ? 'animate-pulse' : ''
          }`}
        />
        <span className="min-w-0 flex-1 truncate">
          {currentActivity?.text ||
            (taskActive
              ? `任务步骤 ${state?.task.step || 0}`
              : `Qwen Realtime · ${voiceStatus}`)}
        </span>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
          {state ? TASK_LABELS[state.task.status] : 'Offline'}
        </span>
      </div>

      <div
        ref={scrollRef}
        data-testid="cyrvis-widget-scroll"
        onScroll={handleScroll}
        className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-thin"
      >
        {visibleEntries.map((entry) =>
          activeView === 'chat' ? (
            <ChatEntry key={entry.id} entry={entry} />
          ) : (
            <ActivityEntry key={entry.id} entry={entry} />
          ),
        )}

        {activeView === 'chat' && transcript && !transcriptFinal && (
          <LiveMessage
            role="user"
            text={transcript}
            streaming={state?.userSpeaking || false}
          />
        )}

        {activeView === 'chat' && assistantText && !assistantFinal && (
          <LiveMessage
            role="assistant"
            text={assistantText}
            streaming={thinking || assistantSpeaking}
          />
        )}

        {thinking && activeView === 'chat' && !assistantText && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-500">
            <Loader className="h-3.5 w-3.5 animate-spin" />
            Thinking
          </div>
        )}

        {!visibleEntries.length &&
          !transcript &&
          !assistantText &&
          !thinking && (
            <div className="flex min-h-32 items-center justify-center text-xs text-slate-400">
              {activeView === 'chat'
                ? 'No voice activity yet'
                : 'Task activity will appear here'}
            </div>
          )}
      </div>

      {(error || state?.task.error) && (
        <div className="mt-2 flex shrink-0 items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            {error || state?.task.error}
          </span>
        </div>
      )}

      <div className="mt-3 flex shrink-0 items-center justify-between border-t border-slate-200 pt-3">
        <div className="flex items-center gap-1.5">
          <ToolButton label="Open main window" onClick={handleOpenMainWindow}>
            <House className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label={
              audioMode === 'speaker'
                ? 'Switch to headset mode'
                : 'Switch to speaker mode'
            }
            active={audioMode === 'speaker'}
            onClick={() => void toggleAudioMode()}
          >
            {audioMode === 'speaker' ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <Headphones className="h-4 w-4" />
            )}
          </ToolButton>
          {ptt.mode && (
            <ToolButton
              label="Push to talk"
              active={ptt.active}
              onClick={() => void togglePtt()}
            >
              <Mic className="h-4 w-4" />
            </ToolButton>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <ToolButton
            label={micReady ? 'Wake voice' : 'Start voice'}
            active={micReady && state?.awake}
            onClick={handleVoiceToggle}
          >
            {micReady ? (
              <Ear className="h-4 w-4" />
            ) : (
              <MicOff className="h-4 w-4" />
            )}
          </ToolButton>
          <ToolButton label="Sleep voice" onClick={sleep}>
            <Power className="h-4 w-4" />
          </ToolButton>
          {assistantSpeaking && (
            <ToolButton label="Interrupt speech" danger onClick={interrupt}>
              <Square className="h-4 w-4" />
            </ToolButton>
          )}
          {taskActive && (
            <>
              <ToolButton
                label={
                  state?.task.status === 'paused' ? 'Resume task' : 'Pause task'
                }
                disabled={
                  state?.task.status !== 'executing' &&
                  state?.task.status !== 'paused'
                }
                onClick={handleTaskPauseResume}
              >
                {state?.task.status === 'paused' ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </ToolButton>
              <ToolButton
                label="Stop task"
                danger
                onClick={() => void cancelTask()}
              >
                <Square className="h-4 w-4" />
              </ToolButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Widget;
