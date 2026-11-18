import { getState } from '@renderer/hooks/useStore';
import { useEffect, useState } from 'react';
import { sessionManager } from '@renderer/db/session';
import { chatManager } from '@renderer/db/chat';
import { Operator } from '@main/store/types';
import type { ControllerEvent } from '@main/cyrvis/types';
import type { ConversationWithSoM } from '@main/shared/types';

/** Only mounted by the audio owner, so each finalized event is saved once. */
export function useVoiceHistory() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const channel = new BroadcastChannel('cyrvis-history');
    let sessionId: string | null = null;
    let queue = Promise.resolve();
    const append = (message: ConversationWithSoM, title?: string) => {
      queue = queue
        .then(async () => {
          if (!sessionId || !(await sessionManager.getSession(sessionId))) {
            const session = await sessionManager.createSession(
              (title || message.value).slice(0, 60),
              {
                operator: Operator.LocalComputer,
                source: 'companion',
              },
            );
            sessionId = session.id;
          }
          const messages =
            (await chatManager.getSessionMessages(sessionId)) ?? [];
          await chatManager.updateSessionMessages(sessionId, [
            ...messages,
            message,
          ]);
          await sessionManager.updateSession(sessionId, {});
          channel.postMessage({ sessionId });
          setError(null);
        })
        .catch(() =>
          setError('Could not save history. Check your local storage space.'),
        );
    };
    const reset = () => {
      queue = queue.then(() => {
        sessionId = null;
      });
    };
    const cleanups = [
      window.electron.voice.onTranscript(({ text, final }) => {
        if (final && text.trim()) append({ from: 'human', value: text });
      }),
      window.electron.voice.onAssistantText(({ text, final }) => {
        if (final && text.trim()) append({ from: 'gpt', value: text });
      }),
      window.electron.voice.onSleep(reset),
      window.electron.voice.onTaskEvent((raw) => {
        const event = raw as ControllerEvent;
        if (event.type === 'task_started')
          append(
            { from: 'gpt', value: `Starting task: ${event.instruction}` },
            event.instruction,
          );
        if (event.type === 'step_update')
          append({
            ...[...(getState().messages || [])]
              .reverse()
              .find(
                (message) =>
                  message.screenshotBase64 ||
                  message.screenshotBase64WithElementMarker,
              ),
            from: 'gpt',
            value: `Step ${event.step} · ${event.actionType}\n\n${event.summary}`,
          });
        if (event.type === 'task_done')
          append({ from: 'gpt', value: `Task completed\n\n${event.summary}` });
        if (event.type === 'task_failed')
          append({ from: 'gpt', value: `Task failed\n\n${event.error}` });
        if (event.type === 'task_cancelled')
          append({ from: 'gpt', value: 'Task cancelled' });
        if (event.type === 'task_needs_user')
          append({ from: 'gpt', value: event.question });
      }),
    ];
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      void queue.finally(() => channel.close());
    };
  }, []);
  return error;
}
