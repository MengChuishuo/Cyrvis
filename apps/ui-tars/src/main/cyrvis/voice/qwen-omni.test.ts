/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { QwenOmniProvider } from './qwen-omni';

const sockets = vi.hoisted(() => [] as FakeWebSocket[]);

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });

  constructor() {
    super();
    sockets.push(this);
  }

  ready(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'session.updated' })),
    );
  }
}

vi.mock('ws', () => ({
  default: Object.assign(
    function () {
      return new FakeWebSocket();
    },
    { OPEN: 1 },
  ),
}));

const providers: QwenOmniProvider[] = [];
const setup = (model?: string) => {
  vi.useFakeTimers();
  const callbacks = {
    onError: vi.fn(),
    onClose: vi.fn(),
    onReady: vi.fn(),
    onAudio: vi.fn(),
  };
  const provider = new QwenOmniProvider({
    apiKey: 'test-key',
    model,
    callbacks,
    connectTimeoutMs: 100,
  });
  providers.push(provider);
  return { provider, callbacks };
};

afterEach(() => {
  providers.splice(0).forEach((provider) => provider.close());
  sockets.length = 0;
  vi.useRealTimers();
});

const receive = (socket: FakeWebSocket, event: object) =>
  socket.emit('message', Buffer.from(JSON.stringify(event)));
const sent = (socket: FakeWebSocket) =>
  socket.send.mock.calls.map(([data]) => JSON.parse(data));

describe('Qwen companion voices', () => {
  it('uses the compatible voice field for the configured Qwen3.5 model', async () => {
    const { provider } = setup('qwen3.5-omni-plus-realtime');
    provider.setVoice('Evan');
    const connected = provider.connect();
    sockets[0].readyState = 1;
    receive(sockets[0], { type: 'session.created' });
    expect(sent(sockets[0])[0].session.voice).toBe('Evan');
    expect(sent(sockets[0])[0].session.audio.output.voice).toBeUndefined();
    sockets[0].ready();
    await connected;
    provider.setVoice('Raymond');
    expect(sent(sockets[0]).at(-1).session).toEqual({ voice: 'Raymond' });
  });
  it('uses a selected voice on first connection and after reconnecting', async () => {
    const { provider } = setup();
    provider.setVoice('Evan');
    const connected = provider.connect();
    sockets[0].readyState = 1;
    receive(sockets[0], { type: 'session.created' });
    expect(sent(sockets[0])[0].session.audio.output.voice).toBe('Evan');
    sockets[0].ready();
    await connected;
    provider.close();
    const reconnected = provider.connect();
    sockets[1].readyState = 1;
    receive(sockets[1], { type: 'session.created' });
    expect(sent(sockets[1])[0].session.audio.output.voice).toBe('Evan');
    sockets[1].ready();
    await reconnected;
  });

  it('switches on the same session, drops old audio and plays the next response', async () => {
    const { provider, callbacks } = setup();
    const connected = provider.connect();
    sockets[0].ready();
    await connected;
    receive(sockets[0], { type: 'response.created', response_id: 'old' });
    const audio = { type: 'response.audio.delta', delta: 'AQACAA==' };
    receive(sockets[0], audio);
    expect(callbacks.onAudio).toHaveBeenCalledTimes(1);
    expect(provider.setVoice('Raymond')).toBe(true);
    sockets[0].ready();
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    const events = sent(sockets[0]);
    expect(events.map((event) => event.type)).toContain('response.cancel');
    expect(events.at(-1).session).toEqual({
      audio: { output: { voice: 'Raymond' } },
    });
    receive(sockets[0], audio);
    expect(callbacks.onAudio).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(401);
    receive(sockets[0], { type: 'response.created', response_id: 'new' });
    receive(sockets[0], audio);
    expect(callbacks.onAudio).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).not.toHaveBeenCalled();
    const count = sockets[0].send.mock.calls.length;
    expect(provider.setVoice('Raymond')).toBe(false);
    expect(sockets[0].send).toHaveBeenCalledTimes(count);
  });

  it('keeps the last selection when skins change during the connection handshake', async () => {
    const { provider } = setup();
    const connected = provider.connect();
    sockets[0].readyState = 1;
    receive(sockets[0], { type: 'session.created' });
    provider.setVoice('Evan');
    provider.setVoice('Raymond');
    sockets[0].ready();
    await connected;
    expect(sent(sockets[0]).at(-1).session.audio.output.voice).toBe('Raymond');
    expect(sockets).toHaveLength(1);
  });

  it('reports a rejected voice update even while the old response is being canceled', async () => {
    const { provider, callbacks } = setup();
    const connected = provider.connect();
    sockets[0].ready();
    await connected;
    provider.setVoice('Raymond');
    const update = sent(sockets[0]).at(-1);
    receive(sockets[0], {
      type: 'error',
      error: { event_id: update.event_id, message: 'Unsupported voice' },
    });
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Unsupported voice'),
      }),
    );
  });
});
