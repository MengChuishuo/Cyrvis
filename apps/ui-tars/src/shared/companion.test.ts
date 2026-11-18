import { describe, expect, it } from 'vitest';
import {
  resolveCompanionState,
  hasCompanionConversation,
  voiceErrorMessage,
  companionBounds,
} from './companion';

const ready = {
  awake: true,
  userSpeaking: false,
  speaking: false,
  thinking: false,
  taskStatus: 'idle',
  micReady: true,
};
describe('companion state precedence', () => {
  it('returns to rest when the microphone is paused, even after a thinking event', () => {
    expect(
      resolveCompanionState({ ...ready, micReady: false, thinking: true }),
    ).toBe('sleeping');
  });
  it('shows a user interruption while a GUI task and playback are active', () => {
    expect(
      resolveCompanionState({
        ...ready,
        userSpeaking: true,
        speaking: true,
        taskStatus: 'executing',
      }),
    ).toBe('listening');
  });
  it('shows actual playback over task status, including after generation finished', () => {
    expect(
      resolveCompanionState({
        ...ready,
        speaking: true,
        taskStatus: 'executing',
      }),
    ).toBe('speaking');
  });
  it('keeps working visible when voice is paused but the task is still running', () => {
    expect(
      resolveCompanionState({
        ...ready,
        micReady: false,
        taskStatus: 'executing',
      }),
    ).toBe('working');
  });
  it.each(['done', 'failed', 'cancelled'])(
    'clears the working pose on %s',
    (taskStatus) => {
      expect(resolveCompanionState({ ...ready, taskStatus })).toBe('idle');
    },
  );
  it('uses thinking only until playback starts', () => {
    expect(resolveCompanionState({ ...ready, thinking: true })).toBe(
      'thinking',
    );
    expect(
      resolveCompanionState({ ...ready, thinking: true, speaking: true }),
    ).toBe('speaking');
  });
});

describe('live conversation panel', () => {
  it('stays hidden for idle microphones, old text, connection and errors', () => {
    const idle = { state: 'idle', micReady: false, error: null } as const;
    expect(hasCompanionConversation(idle)).toBe(false);
    for (const change of [
      { connecting: true },
      { micReady: true },
      { assistantText: 'Hello' },
      { transcript: 'Hi' },
      { error: 'Offline' },
    ])
      expect(hasCompanionConversation({ ...idle, ...change })).toBe(false);
    expect(
      hasCompanionConversation({ ...idle, conversationVisible: true }),
    ).toBe(true);
  });
  it('explains invalid credentials instead of displaying an opaque handshake error', () => {
    expect(
      voiceErrorMessage('Error: Unexpected server response: 401'),
    ).toContain('API key');
    expect(voiceErrorMessage('voice service is not configured')).toContain(
      'QWEN_API_KEY',
    );
    expect(voiceErrorMessage('Microphone disconnected')).toBe(
      'Microphone disconnected',
    );
  });
  it('anchors resizing to the robot and clamps the panel inside the display', () => {
    expect(
      companionBounds({ x: 100, y: 400, width: 220, height: 280 }, true, {
        x: 0,
        y: 0,
        width: 1000,
        height: 800,
      }),
    ).toEqual({ x: 0, y: 160, width: 360, height: 520 });
    expect(
      companionBounds({ x: 600, y: 160, width: 360, height: 520 }, false, {
        x: 0,
        y: 0,
        width: 1000,
        height: 800,
      }),
    ).toEqual({ x: 740, y: 400, width: 220, height: 280 });
  });
});
