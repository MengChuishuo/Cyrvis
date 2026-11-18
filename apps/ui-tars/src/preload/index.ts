import type { CompanionSnapshot } from '@shared/companion';
/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';
// import { preloadZustandBridge } from 'zutron/preload';

import type { UTIOPayload } from '@ui-tars/utio';

import type { AppState, LocalStore } from '@main/store/types';
import type {
  ControllerEvent,
  CyrvisActivityEvent,
  CyrvisMemorySnapshot,
  CyrvisVoiceState,
  TaskSnapshot,
  VoiceToolName,
} from '@shared/cyrvis';

export type Channels = '';

// Only one renderer callback may consume assistant audio. This prevents a
// stale HMR mount (or an accidental second hook) from playing every chunk
// twice, which sounds like two AIs talking at once.
let activeAudioCallback: ((pcm16: Int16Array) => void) | null = null;
let audioIpcAttached = false;
let audioSubscriberCount = 0;

const ensureAudioIpc = () => {
  if (audioIpcAttached) {
    return;
  }
  audioIpcAttached = true;
  ipcRenderer.on('cyrvis:voice:audio', (_event, buffer: ArrayBuffer) => {
    if (activeAudioCallback) {
      activeAudioCallback(new Int16Array(buffer));
    }
  });
};

const electronHandler = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(channel, ...args),
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  utio: {
    shareReport: (params: UTIOPayload<'shareReport'>) =>
      ipcRenderer.invoke('utio:shareReport', params),
  },
  setting: {
    getSetting: () => ipcRenderer.invoke('setting:get'),
    clearSetting: () => ipcRenderer.invoke('setting:clear'),
    updateSetting: (setting: Partial<LocalStore>) =>
      ipcRenderer.invoke('setting:update', setting),
    importPresetFromText: (yamlContent: string) =>
      ipcRenderer.invoke('setting:importPresetFromText', yamlContent),
    importPresetFromUrl: (url: string, autoUpdate: boolean) =>
      ipcRenderer.invoke('setting:importPresetFromUrl', url, autoUpdate),
    updatePresetFromRemote: () =>
      ipcRenderer.invoke('setting:updatePresetFromRemote'),
    resetPreset: () => ipcRenderer.invoke('setting:resetPreset'),
    onUpdate: (callback: (setting: LocalStore) => void) => {
      ipcRenderer.on('setting-updated', (_, state) => callback(state));
    },
  },
  companion: {
    command: (command: 'start' | 'stop' | 'interrupt' | 'audio-mode') =>
      ipcRenderer.invoke('companion:command', command),
    getState: (): Promise<CompanionSnapshot> =>
      ipcRenderer.invoke('companion:get-state'),
    publish: (state: CompanionSnapshot) =>
      ipcRenderer.invoke('companion:publish', state),
    onState: (callback: (state: CompanionSnapshot) => void) => {
      const listener = (_event: IpcRendererEvent, state: CompanionSnapshot) =>
        callback(state);
      ipcRenderer.on('companion:state', listener);
      return () => {
        ipcRenderer.removeListener('companion:state', listener);
      };
    },
    onCommand: (callback: (command: string) => void) => {
      const listener = (_event: IpcRendererEvent, command: string) =>
        callback(command);
      ipcRenderer.on('cyrvis:companion:command', listener);
      return () => {
        ipcRenderer.removeListener('cyrvis:companion:command', listener);
      };
    },
  },
  voice: {
    isTestMode: process.env.CYRVIS_VOICE_TEST === '1',
    // Capture runs in a hidden renderer that never plays audio; the main
    // renderer keeps playback only.
    externalCapture: true,
    onCaptureReady: (callback: (payload: { label: string }) => void) => {
      const listener = (_event: IpcRendererEvent, payload: { label: string }) =>
        callback(payload);
      ipcRenderer.on('cyrvis:voice:capture-ready', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:capture-ready', listener);
    },
    onCaptureError: (callback: (payload: { message: string }) => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { message: string },
      ) => callback(payload);
      ipcRenderer.on('cyrvis:voice:capture-error', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:capture-error', listener);
    },
    restartCapture: () => ipcRenderer.invoke('cyrvis:voice:restart-capture'),
    getCaptureReady: () =>
      ipcRenderer.invoke('cyrvis:voice:get-capture-ready') as Promise<{
        ready: boolean;
      }>,
    setOutput: (label: string) =>
      ipcRenderer.invoke('cyrvis:voice:set-output', label),
    onSetOutput: (callback: (label: string) => void) => {
      const listener = (_event: IpcRendererEvent, label: string) =>
        callback(label);
      ipcRenderer.on('cyrvis:voice:set-output', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:set-output', listener);
    },
    setAudioMode: (mode: 'headset' | 'speaker') =>
      ipcRenderer.invoke('cyrvis:voice:set-mode', mode),
    getAudioMode: () => ipcRenderer.invoke('cyrvis:voice:get-mode'),
    onAudioMode: (
      callback: (payload: { mode: 'headset' | 'speaker' }) => void,
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { mode: 'headset' | 'speaker' },
      ) => callback(payload);
      ipcRenderer.on('cyrvis:voice:audio-mode', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:audio-mode', listener);
    },
    start: () => ipcRenderer.invoke('cyrvis:voice:start'),
    stop: () => ipcRenderer.invoke('cyrvis:voice:stop'),
    testAudio: () => ipcRenderer.invoke('cyrvis:voice:test-audio'),
    togglePtt: () => ipcRenderer.invoke('cyrvis:voice:toggle-ptt'),
    getPtt: () => ipcRenderer.invoke('cyrvis:voice:get-ptt'),
    onPttState: (
      callback: (state: { active: boolean; mode: boolean }) => void,
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        state: { active: boolean; mode: boolean },
      ) => callback(state);
      ipcRenderer.on('cyrvis:voice:ptt', listener);
      return () => ipcRenderer.removeListener('cyrvis:voice:ptt', listener);
    },
    getState: () => ipcRenderer.invoke('cyrvis:voice:get-state'),
    getMemory: () =>
      ipcRenderer.invoke(
        'cyrvis:voice:get-memory',
      ) as Promise<CyrvisMemorySnapshot>,
    cancelTask: () => ipcRenderer.invoke('cyrvis:voice:cancel-task'),
    pauseTask: () =>
      ipcRenderer.invoke(
        'cyrvis:voice:pause-task',
      ) as Promise<TaskSnapshot | null>,
    resumeTask: () =>
      ipcRenderer.invoke(
        'cyrvis:voice:resume-task',
      ) as Promise<TaskSnapshot | null>,
    sendAudio: (buffer: ArrayBuffer) =>
      ipcRenderer.send('cyrvis:voice:audio', buffer),
    sendPlaybackReference: (buffer: ArrayBuffer, startedAt?: number) =>
      ipcRenderer.send('cyrvis:voice:playback-reference', buffer, startedAt),
    notifyPlaybackIdle: () => ipcRenderer.send('cyrvis:voice:playback-idle'),
    notifyPlaybackStopped: (info?: { queuedMs?: number }) =>
      ipcRenderer.send('cyrvis:voice:playback-stopped', info),
    bargeIn: () => ipcRenderer.send('cyrvis:voice:barge-in'),
    forceAwake: () => ipcRenderer.send('cyrvis:voice:force-awake'),
    sleep: () => ipcRenderer.send('cyrvis:voice:sleep'),
    onAudio: (callback: (pcm16: Int16Array) => void) => {
      activeAudioCallback = callback;
      audioSubscriberCount += 1;
      ensureAudioIpc();
      return () => {
        audioSubscriberCount = Math.max(0, audioSubscriberCount - 1);
        if (activeAudioCallback === callback) {
          activeAudioCallback = null;
        }
      };
    },
    debugAudioSubscribers: () => ({
      active: activeAudioCallback !== null,
      total: audioSubscriberCount,
    }),
    onSpeechStarted: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:speech-started', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:speech-started', listener);
    },
    onSpeechStopped: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:speech-stopped', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:speech-stopped', listener);
    },
    onTranscript: (
      callback: (payload: { text: string; final: boolean }) => void,
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { text: string; final: boolean },
      ) => callback(payload);
      ipcRenderer.on('cyrvis:voice:transcript', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:transcript', listener);
    },
    onAssistantText: (
      callback: (payload: { text: string; final: boolean }) => void,
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { text: string; final: boolean },
      ) => callback(payload);
      ipcRenderer.on('cyrvis:voice:assistant', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:assistant', listener);
    },
    onState: (callback: (state: CyrvisVoiceState) => void) => {
      const listener = (_event: IpcRendererEvent, state: CyrvisVoiceState) =>
        callback(state);
      ipcRenderer.on('cyrvis:voice:state', listener);
      return () => ipcRenderer.removeListener('cyrvis:voice:state', listener);
    },
    onTaskEvent: (callback: (event: ControllerEvent) => void) => {
      const listener = (_event: IpcRendererEvent, event: ControllerEvent) =>
        callback(event);
      ipcRenderer.on('cyrvis:voice:task-event', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:task-event', listener);
    },
    onToolCall: (
      callback: (call: { name: VoiceToolName; instruction?: string }) => void,
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        call: { name: VoiceToolName; instruction?: string },
      ) => callback(call);
      ipcRenderer.on('cyrvis:voice:tool-call', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:tool-call', listener);
    },
    onActivity: (callback: (event: CyrvisActivityEvent) => void) => {
      const listener = (_event: IpcRendererEvent, event: CyrvisActivityEvent) =>
        callback(event);
      ipcRenderer.on('cyrvis:voice:activity', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:activity', listener);
    },
    onResponseStarted: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:response-started', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:response-started', listener);
    },
    onResponseStopped: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:response-stopped', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:response-stopped', listener);
    },
    onPlaybackPause: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:playback-pause', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:playback-pause', listener);
    },
    onPlaybackResume: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:playback-resume', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:playback-resume', listener);
    },
    onThinking: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:thinking', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:thinking', listener);
    },
    onResponseDone: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:response-done', listener);
      return () =>
        ipcRenderer.removeListener('cyrvis:voice:response-done', listener);
    },
    onWake: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:wake', listener);
      return () => ipcRenderer.removeListener('cyrvis:voice:wake', listener);
    },
    onSleep: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('cyrvis:voice:sleep', listener);
      return () => ipcRenderer.removeListener('cyrvis:voice:sleep', listener);
    },
  },
};

// Initialize zustand bridge
const zustandBridge = {
  getState: () => ipcRenderer.invoke('getState'),
  subscribe: (callback) => {
    const subscription = (_: unknown, state: AppState) => callback(state);
    ipcRenderer.on('subscribe', subscription);

    return () => ipcRenderer.off('subscribe', subscription);
  },
};

// Expose both electron and zutron handlers
contextBridge.exposeInMainWorld('electron', electronHandler);
contextBridge.exposeInMainWorld('zustandBridge', zustandBridge);
contextBridge.exposeInMainWorld('platform', process.platform);

export type ElectronHandler = typeof electronHandler;
