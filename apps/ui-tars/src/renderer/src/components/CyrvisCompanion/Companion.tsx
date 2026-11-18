import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { voiceErrorMessage, type CompanionSnapshot } from '@shared/companion';
import { ConversationBubble } from './ConversationBubble';
import { CompanionArtwork } from './CompanionArtwork';

const stateCopy: Record<CompanionSnapshot['state'], { label: string }> = {
  idle: { label: 'Idle' },
  listening: { label: 'Listening' },
  thinking: { label: 'Thinking' },
  speaking: { label: 'Speaking' },
  working: { label: 'Working' },
  sleeping: { label: 'Sleeping' },
};

export default function Companion() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>({
    state: 'idle',
    micReady: false,
    error: null,
  });
  const dragEndRef = useRef<Promise<boolean> | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void window.electron.companion.getState().then(setSnapshot);
    return window.electron.companion.onState(setSnapshot);
  }, []);

  const endDrag = () => {
    setDragging(false);
    dragEndRef.current ??= window.electron.ipcRenderer.invoke(
      'companion:drag-end',
    ) as Promise<boolean>;
    return dragEndRef.current;
  };
  const openMainWindow = async () => {
    if (!(await endDrag()))
      void window.electron.ipcRenderer.invoke('showMainWindow');
    dragEndRef.current = null;
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    setDragging(true);
    dragEndRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.electron.ipcRenderer.invoke('companion:drag-start');
  };

  const current = stateCopy[snapshot.state];
  return (
    <main
      className="companion-root"
      data-conversation={snapshot.conversationVisible || undefined}
      aria-label="CYRVIS desktop companion"
    >
      <ConversationBubble snapshot={snapshot} />
      <div className="companion-robot">
        <button
          type="button"
          className="companion-button"
          aria-label={`${current.label}. Click to open Cyrvis. Right-click for options.`}
          title={
            (snapshot.error && voiceErrorMessage(snapshot.error)) ||
            `${current.label} · ${snapshot.micReady ? 'Microphone on' : 'Microphone off'}`
          }
          onPointerDown={handlePointerDown}
          onPointerUp={() => void endDrag()}
          onPointerCancel={() => void endDrag()}
          onClick={openMainWindow}
          onContextMenu={(event) => {
            event.preventDefault();
            void window.electron.ipcRenderer.invoke('companion:menu');
          }}
        >
          <CompanionArtwork
            skinId={snapshot.skinId}
            state={snapshot.state}
            label={current.label}
            dragging={dragging}
          />
          <span className="companion-status" aria-hidden="true">
            <span
              className={`companion-dot ${snapshot.micReady ? 'is-ready' : ''}`}
            />
            {snapshot.error
              ? 'Voice or history unavailable · Right-click for settings'
              : `${current.label} · ${snapshot.micReady ? 'Mic on' : 'Mic off'}`}
          </span>
        </button>
        <div className="companion-controls" aria-label="Voice controls">
          <button
            type="button"
            disabled={snapshot.connecting}
            onClick={() =>
              void window.electron.companion.command(
                snapshot.micReady ? 'stop' : 'start',
              )
            }
          >
            {snapshot.connecting
              ? 'Connecting…'
              : snapshot.micReady
                ? 'Pause conversation'
                : 'Start conversation'}
          </button>
          {(snapshot.state === 'speaking' || snapshot.state === 'thinking') && (
            <button
              type="button"
              onClick={() =>
                void window.electron.companion.command('interrupt')
              }
            >
              Interrupt
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
