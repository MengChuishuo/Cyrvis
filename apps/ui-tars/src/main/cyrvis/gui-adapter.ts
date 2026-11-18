import { showCompanion } from '@main/window';
/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StatusEnum } from '@ui-tars/shared/types';
import type { PredictionParsed } from '@ui-tars/shared/types';

import { GUIAgentManager } from '@main/ipcRoutes/agent';
import { runAgent } from '@main/services/runAgent';
import { store } from '@main/store/create';
import type { AppState } from '@main/store/types';
import {
  closeScreenMarker,
  hideScreenWaterFlow,
} from '@main/window/ScreenMarker';

import type { GUIAdapter, GUIAdapterCallbacks } from './types';

const truncate = (text: string, max = 100): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

const cleanError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (parsed?.message) {
      return truncate(parsed.message);
    }
  } catch {
    // Not JSON, use the raw text.
  }
  return truncate(raw);
};

const DIRECTION_LABEL: Record<string, string> = {
  up: '上',
  down: '下',
  left: '左',
  right: '右',
};

export const summarizeAction = (parsed: PredictionParsed): string => {
  const inputs = parsed.action_inputs ?? {};
  switch (parsed.action_type) {
    case 'click':
      return '点击目标';
    case 'left_double':
      return '双击目标';
    case 'right_single':
      return '右键点击目标';
    case 'drag':
      return '拖拽目标';
    case 'hotkey': {
      const key = inputs.hotkey || inputs.key;
      return key ? `按下快捷键 ${key}` : '执行快捷键';
    }
    case 'type':
      return '输入文本';
    case 'scroll': {
      const direction = inputs.direction
        ? DIRECTION_LABEL[inputs.direction] || inputs.direction
        : '';
      return direction ? `向${direction}滚动` : '滚动页面';
    }
    case 'wait':
      return '等待界面变化';
    case 'finished':
      return '任务完成';
    case 'call_user':
      return '需要用户帮助';
    default:
      return parsed.thought?.trim()
        ? truncate(parsed.thought.trim(), 60)
        : parsed.action_type || '执行下一步';
  }
};

/**
 * Real GUIAdapter backed by the existing UI-TARS `runAgent` and Zustand store.
 *
 * It intentionally does not change the GUI agent loop: it only starts a task,
 * translates store updates into Controller inputs, and aborts the same
 * AbortController/GUIAgent that the desktop UI uses.
 */
export class ElectronGUIAdapter implements GUIAdapter {
  private callbacks: GUIAdapterCallbacks | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastProcessed = 0;
  private stepIndex = 0;
  private lastSummary = '任务完成';
  private cancelRequested = false;
  private terminalEmitted = false;
  private startedEmitted = false;

  async start(
    instruction: string,
    callbacks: GUIAdapterCallbacks,
  ): Promise<void> {
    if (store.getState().thinking) {
      throw new Error('GUI agent is already running');
    }

    this.callbacks = callbacks;
    this.lastProcessed = 0;
    this.stepIndex = 0;
    this.lastSummary = '任务完成';
    this.cancelRequested = false;
    this.terminalEmitted = false;
    this.startedEmitted = false;

    const state = store.getState();
    store.setState({
      ...state,
      instructions: instruction,
      abortController: new AbortController(),
      thinking: true,
      errorMsg: null,
      messages: [],
      restUserData: null,
      status: StatusEnum.INIT,
    });

    this.unsubscribe = store.subscribe((next, prev) =>
      this.handleState(next, prev),
    );

    try {
      await runAgent(store.setState, store.getState);
    } catch (error) {
      this.emitFailed(error);
    } finally {
      this.unsubscribe?.();
      this.unsubscribe = null;

      if (!this.terminalEmitted) {
        this.emitFromFinalStatus(store.getState());
      }

      store.setState({ ...store.getState(), thinking: false });
      this.restoreUI();
    }
  }

  async cancel(): Promise<void> {
    this.cancelRequested = true;

    const state = store.getState();
    state.abortController?.abort();

    const agent = GUIAgentManager.getInstance().getAgent();
    if (agent) {
      agent.resume();
      agent.stop();
    }

    const previousStatus = state.status;
    store.setState({
      ...state,
      status: StatusEnum.END,
      thinking: false,
    });

    // Zustand does not notify when the value is unchanged. If the task was
    // already END, emit cancellation explicitly instead of getting stuck.
    if (previousStatus === StatusEnum.END) {
      this.emitCancelled();
    }
  }

  async pause(): Promise<void> {
    const agent = GUIAgentManager.getInstance().getAgent();
    if (!agent) {
      throw new Error('No active GUI agent to pause');
    }

    agent.pause();
    store.setState({ ...store.getState(), thinking: false });
    this.callbacks?.onPaused();
  }

  async resume(): Promise<void> {
    const agent = GUIAgentManager.getInstance().getAgent();
    if (!agent) {
      throw new Error('No active GUI agent to resume');
    }

    agent.resume();
    this.callbacks?.onResumed();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.callbacks = null;
  }

  private handleState(state: AppState, prev: AppState): void {
    if (state.messages !== prev.messages) {
      this.processMessages(state);
    }

    if (state.status === prev.status) {
      return;
    }

    switch (state.status) {
      case StatusEnum.RUNNING:
        if (prev.status === StatusEnum.PAUSE) {
          this.callbacks?.onResumed();
        } else if (!this.startedEmitted) {
          this.startedEmitted = true;
          this.callbacks?.onStarted();
        }
        break;
      case StatusEnum.PAUSE:
        this.callbacks?.onPaused();
        break;
      case StatusEnum.CALL_USER:
        this.callbacks?.onNeedsUser(this.lastThought(state));
        break;
      case StatusEnum.END:
        this.cancelRequested ? this.emitCancelled() : this.emitDone();
        break;
      case StatusEnum.USER_STOPPED:
        this.emitCancelled();
        break;
      case StatusEnum.ERROR:
        this.emitFailed(state.errorMsg || 'GUI agent error');
        break;
      default:
        break;
    }
  }

  private processMessages(state: AppState): void {
    const messages = state.messages || [];
    if (messages.length < this.lastProcessed) {
      this.lastProcessed = 0;
      this.stepIndex = 0;
    }

    for (let i = this.lastProcessed; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.from !== 'gpt' || !message.predictionParsed?.length) {
        continue;
      }

      for (const parsed of message.predictionParsed) {
        if (!parsed.action_type) {
          continue;
        }
        this.stepIndex += 1;
        this.lastSummary = summarizeAction(parsed);
        this.callbacks?.onStep({
          index: this.stepIndex,
          summary: this.lastSummary,
          actionType: parsed.action_type,
        });
      }
    }

    this.lastProcessed = messages.length;
  }

  private lastThought(state: AppState): string {
    const messages = state.messages || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.from !== 'gpt' || !message.predictionParsed?.length) {
        continue;
      }
      const parsed =
        message.predictionParsed[message.predictionParsed.length - 1];
      const thought = parsed.thought?.trim() || parsed.reflection?.trim();
      if (thought) {
        return truncate(thought, 120);
      }
    }
    return '需要你的帮助。';
  }

  private emitDone(summary?: string): void {
    if (this.terminalEmitted) {
      return;
    }
    this.terminalEmitted = true;
    this.callbacks?.onDone(summary || this.lastSummary || '任务完成');
  }

  private emitFailed(error: unknown): void {
    if (this.terminalEmitted) {
      return;
    }
    this.terminalEmitted = true;
    this.callbacks?.onFailed(cleanError(error));
  }

  private emitCancelled(): void {
    if (this.terminalEmitted) {
      return;
    }
    this.terminalEmitted = true;
    this.callbacks?.onCancelled();
  }

  private emitFromFinalStatus(state: AppState): void {
    switch (state.status) {
      case StatusEnum.END:
        this.cancelRequested ? this.emitCancelled() : this.emitDone();
        break;
      case StatusEnum.USER_STOPPED:
        this.emitCancelled();
        break;
      case StatusEnum.ERROR:
        this.emitFailed(state.errorMsg || 'GUI agent error');
        break;
      default:
        this.emitFailed(
          `GUI agent ended with unexpected status: ${state.status}`,
        );
    }
  }

  private restoreUI(): void {
    closeScreenMarker();
    hideScreenWaterFlow();
    showCompanion();
  }
}
