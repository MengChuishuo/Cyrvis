/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { toast } from 'sonner';

import { Conversation } from '@ui-tars/shared/types';
import { getState, useStore } from '@renderer/hooks/useStore';

import { usePermissions } from './usePermissions';
import { api } from '@renderer/api';
import { ConversationWithSoM } from '@/main/shared/types';
import { Message } from '@ui-tars/shared/types';
import { Operator } from '@/main/store/types';
import { chatManager } from '@renderer/db/chat';
import { sessionManager } from '@renderer/db/session';
import { useSessionStore } from '@renderer/store/session';

let sending = false;

const filterAndTransformWithMap = (
  history: ConversationWithSoM[],
): Message[] => {
  return history
    .map((conv) => {
      if (conv.from === 'human' && conv.value && conv.value !== '<image>') {
        return {
          from: conv.from,
          value: conv.value,
        };
      } else if (conv.from === 'gpt' && conv.predictionParsed?.length) {
        const finished = conv.predictionParsed.find(
          (p) => p.action_type === 'finished' && p.action_inputs?.content,
        );
        if (finished) {
          return {
            from: conv.from,
            value: finished.action_inputs!.content!,
          };
        }

        const callUser = conv.predictionParsed.find(
          (p) => p.action_type === 'call_user' && p.thought,
        );
        if (callUser) {
          return {
            from: conv.from,
            value: callUser.thought!,
          };
        }
        return undefined;
      } else if (conv.from === 'gpt' && conv.value) {
        return { from: conv.from, value: conv.value };
      } else {
        return undefined;
      }
    })
    .filter((msg): msg is Message => msg !== undefined);
};

export const useRunAgent = () => {
  // const dispatch = useDispatch();
  const { ensurePermissions } = usePermissions();

  const run = async (
    value: string,
    sessionId: string,
    operator: Operator,
    callback: () => void = () => {},
    onSessionCreated?: (sessionId: string) => void,
  ) => {
    const live = getState();
    if (
      !value.trim() ||
      sending ||
      live.thinking ||
      live.status === 'running' ||
      live.status === 'pause'
    )
      return;
    if (
      (operator === Operator.LocalBrowser ||
        operator === Operator.LocalComputer) &&
      !(ensurePermissions?.accessibility && ensurePermissions?.screenCapture)
    ) {
      const permissionsText = [
        !ensurePermissions?.screenCapture ? 'screenCapture' : '',
        !ensurePermissions?.accessibility ? 'Accessibility' : '',
      ]
        .filter(Boolean)
        .join(' and ');

      toast.warning(
        `Please grant the required permissions(${permissionsText})`,
      );
      return;
    }

    sending = true;
    let unsubscribe: (() => void) | undefined;
    let writes = Promise.resolve();
    let saveError: unknown;
    try {
      if (!sessionId) {
        const created = await useSessionStore
          .getState()
          .createSession(value, { operator });
        if (!created) throw new Error('Could not create chat');
        sessionId = created.id;
        onSessionCreated?.(sessionId);
      }
      const session = await sessionManager.getSession(sessionId);
      if (!session) throw new Error('This chat no longer exists.');
      const history = (await chatManager.getSessionMessages(sessionId)) ?? [];
      await window.electron.setting.updateSetting({ operator });
      await api.clearHistory();
      useSessionStore.getState().setCurrentSessionId(sessionId);
      useSessionStore.getState().setChatMessages(history);
      await sessionManager.updateSession(sessionId, {
        name: history.length ? session.name : value,
        meta: { ...session.meta, ...(getState().restUserData || {}) },
      });
      // Capture the session and its saved prefix for the entire run. This
      // subscription survives navigation and saves updates to existing steps too.
      const persist = (batch: ConversationWithSoM[]) => {
        if (!batch.length) return;
        const combined = [...history, ...batch];
        writes = writes
          .then(async () => {
            await chatManager.updateSessionMessages(sessionId, combined);
            const current = useSessionStore.getState();
            if (current.currentSessionId === sessionId)
              current.setChatMessages(combined);
          })
          .catch((error) => {
            saveError = error;
          });
      };
      unsubscribe = useStore.subscribe((next, previous) => {
        if (next.messages !== previous.messages) persist(next.messages || []);
      });
      const initialMessages: Conversation[] = [
        {
          from: 'human',
          value,
          timing: { start: Date.now(), end: Date.now(), cost: 0 },
        },
      ];
      await api.setInstructions({ instructions: value });
      await api.setSessionHistoryMessages({
        messages: filterAndTransformWithMap(history),
      });
      await api.setMessages({ messages: initialMessages });
      callback();
      await api.runAgent();
      // Read the final main-process state as IPC updates can arrive after the
      // run promise resolves; don't rely on the page still being mounted.
      persist((await window.zustandBridge.getState()).messages || []);
    } finally {
      unsubscribe?.();
      await writes;
      sending = false;
      if (saveError)
        toast.error(
          'Could not save this chat. Please check your local storage.',
        );
    }
  };

  const stopAgentRuning = async (callback: () => void = () => {}) => {
    await api.stopRun();
    callback();
  };

  return { run, stopAgentRuning };
};
