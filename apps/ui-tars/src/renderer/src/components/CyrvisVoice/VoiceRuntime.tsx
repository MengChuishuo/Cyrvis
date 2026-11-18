import { useEffect, useRef, useState } from 'react';

import {
  resolveCompanionState,
  CONVERSATION_LINGER_MS,
} from '@shared/companion';
import { useVoiceHistory } from './useVoiceHistory';
import { useGlobalSettings } from '../Settings/global';
import { useVoiceAudio } from './useVoiceAudio';

/** Owns the one voice pipeline while the history window may be hidden. */
export function VoiceRuntime() {
  const historyError = useVoiceHistory();
  const { openSettings } = useGlobalSettings();
  const {
    state,
    micReady,
    thinking,
    playbackActive,
    error,
    transcript,
    assistantText,
    connecting,
    audioMode,
    start,
    stop,
    forceAwake,
    interrupt,
    cancelTask,
    toggleAudioMode,
  } = useVoiceAudio();

  const [conversationVisible, setConversationVisible] = useState(false);
  const previousText = useRef({ transcript: '', assistantText: '' });
  const conversationActive =
    micReady &&
    (state.userSpeaking || state.ttsSpeaking || playbackActive || thinking);
  useEffect(() => {
    const textChanged =
      previousText.current.transcript !== transcript ||
      previousText.current.assistantText !== assistantText;
    previousText.current = { transcript, assistantText };
    if (!micReady || (!conversationActive && !transcript && !assistantText)) {
      setConversationVisible(false);
      return;
    }
    if (conversationActive || textChanged) setConversationVisible(true);
    if (conversationActive) return;
    const timer = setTimeout(
      () => setConversationVisible(false),
      CONVERSATION_LINGER_MS,
    );
    return () => clearTimeout(timer);
  }, [micReady, conversationActive, transcript, assistantText]);

  useEffect(() => {
    const stateName = resolveCompanionState({
      awake: state.awake,
      userSpeaking: state.userSpeaking,
      speaking: state.ttsSpeaking || playbackActive,
      thinking,
      taskStatus: state.task.status,
      micReady,
    });
    void window.electron.companion.publish({
      state: stateName,
      micReady,
      error: historyError || error,
      transcript,
      assistantText,
      connecting,
      audioMode,
      conversationVisible,
    });
  }, [
    error,
    historyError,
    micReady,
    playbackActive,
    state,
    thinking,
    transcript,
    assistantText,
    connecting,
    audioMode,
    conversationVisible,
  ]);

  useEffect(() => {
    return window.electron.companion.onCommand((command) => {
      if (command === 'settings') openSettings();
      else if (command === 'start') void start();
      else if (command === 'stop') void stop();
      else if (command === 'wake') forceAwake();
      else if (command === 'interrupt') interrupt();
      else if (command === 'cancel') void cancelTask();
      else if (command === 'audio-mode') void toggleAudioMode();
    });
  }, [
    cancelTask,
    forceAwake,
    interrupt,
    openSettings,
    start,
    stop,
    toggleAudioMode,
  ]);

  return null;
}
