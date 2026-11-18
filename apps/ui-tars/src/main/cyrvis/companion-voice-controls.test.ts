import { beforeEach, afterEach, expect, it, vi } from 'vitest';

type CaptureCallbacks = Parameters<
  typeof import('./capture-service').startCaptureService
>[0];

const mock = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  captureCallbacks: null as CaptureCallbacks | null,
  startCapture: vi.fn(),
  closeCapture: vi.fn(),
  brainStart: vi.fn(),
  sleep: vi.fn(),
  bargeIn: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: { register: () => true },
  ipcMain: {
    handle: (name: string, fn: () => unknown) => mock.handlers.set(name, fn),
    on: vi.fn(),
  },
}));
vi.mock('@main/env', () => ({ isDev: false }));
vi.mock('@main/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('./capture-service', () => ({
  startCaptureService: (callbacks: CaptureCallbacks) =>
    mock.startCapture(callbacks),
}));
vi.mock('./controller', () => ({ CyrvisController: class {} }));
vi.mock('./gui-adapter', () => ({ ElectronGUIAdapter: class {} }));
vi.mock('./keyword-gate', () => ({
  KeywordGate: class {
    load = vi.fn();
  },
}));
vi.mock('./memory', () => ({
  voiceMemoryService: { appendActivity: async () => undefined },
}));
vi.mock('./voice/qwen-omni', () => ({
  QwenOmniProvider: class {
    bargeIn = mock.bargeIn;
  },
}));
vi.mock('./voice-brain', () => ({
  VoiceBrain: class {
    constructor(
      _controller: unknown,
      _callbacks: unknown,
      factory: (callbacks: object) => unknown,
    ) {
      factory({});
    }
    start = mock.brainStart;
    sleep = mock.sleep;
    getState() {
      return { awake: true };
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.handlers.clear();
  vi.useFakeTimers();
  vi.stubEnv('QWEN_API_KEY', 'test');
  mock.brainStart.mockResolvedValue(undefined);
  mock.startCapture.mockImplementation(async (callbacks: CaptureCallbacks) => {
    mock.captureCallbacks = callbacks;
    callbacks.onReady('Test microphone');
    return { close: mock.closeCapture };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const invoke = (channel: string) =>
  mock.handlers.get(`cyrvis:voice:${channel}`)!();

it('keeps controls available without a configured provider', async () => {
  vi.stubEnv('QWEN_API_KEY', '');
  const { startVoiceService } = await import('./voice-service');
  expect(startVoiceService()).toBeNull();
  expect(await invoke('start')).toMatchObject({ ok: false });
  expect(() => invoke('stop')).not.toThrow();
  expect(mock.startCapture).not.toHaveBeenCalled();
});
it('shares startup capture, cancels retries on pause, and resumes explicitly', async () => {
  const { startVoiceService } = await import('./voice-service');
  startVoiceService();
  expect(await invoke('start')).toMatchObject({ ok: true, captureReady: true });
  expect(mock.startCapture).toHaveBeenCalledTimes(1);
  mock.captureCallbacks!.onError('Microphone disconnected');
  invoke('stop');
  expect(mock.closeCapture).toHaveBeenCalledTimes(1);
  expect(mock.sleep).toHaveBeenCalledOnce();
  expect(mock.bargeIn).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(6000);
  expect(mock.startCapture).toHaveBeenCalledTimes(1);
  expect(invoke('get-capture-ready')).toEqual({ ready: false });
  expect(await invoke('start')).toMatchObject({ ok: true, captureReady: true });
  expect(mock.startCapture).toHaveBeenCalledTimes(2);
});
it('closes capture that finishes opening after pause and ignores its ready event', async () => {
  let finish!: (value: { close: typeof mock.closeCapture }) => void;
  mock.startCapture.mockImplementation((callbacks: CaptureCallbacks) => {
    mock.captureCallbacks = callbacks;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { startVoiceService } = await import('./voice-service');
  startVoiceService();
  await vi.advanceTimersByTimeAsync(0);
  invoke('stop');
  finish({ close: mock.closeCapture });
  await vi.advanceTimersByTimeAsync(0);
  mock.captureCallbacks!.onReady('Stale microphone');
  expect(mock.closeCapture).toHaveBeenCalledOnce();
  expect(invoke('get-capture-ready')).toEqual({ ready: false });
});
