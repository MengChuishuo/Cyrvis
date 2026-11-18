export type CompanionState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'working'
  | 'sleeping';
export interface CompanionSnapshot {
  skinId?: string;
  state: CompanionState;
  micReady: boolean;
  error: string | null;
  transcript?: string;
  assistantText?: string;
  connecting?: boolean;
  conversationVisible?: boolean;
  audioMode?: 'headset' | 'speaker';
}

export const CONVERSATION_LINGER_MS = 5000;
export const hasCompanionConversation = (snapshot: CompanionSnapshot) =>
  snapshot.conversationVisible === true;

export function voiceErrorMessage(error: string): string {
  if (/401|InvalidApiKey/i.test(error))
    return 'Voice could not connect. Update your Qwen API key (QWEN_API_KEY), restart Cyrvis, then try again.';
  if (/not configured/i.test(error))
    return 'Set QWEN_API_KEY in your voice configuration and restart Cyrvis to start a conversation.';
  return error;
}

type Bounds = { x: number; y: number; width: number; height: number };
/** Keep the robot at the bottom right as its conversation opens/closes. */
export function companionBounds(
  current: Bounds,
  expanded: boolean,
  area: Bounds,
): Bounds {
  const width = Math.min(expanded ? 360 : 220, area.width);
  const height = Math.min(expanded ? 520 : 280, area.height);
  return {
    x: Math.round(
      Math.max(
        area.x,
        Math.min(
          current.x + current.width - width,
          area.x + area.width - width,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(
          current.y + current.height - height,
          area.y + area.height - height,
        ),
      ),
    ),
    width,
    height,
  };
}
export function resolveCompanionState(input: {
  awake: boolean;
  userSpeaking: boolean;
  speaking: boolean;
  thinking: boolean;
  taskStatus: string;
  micReady: boolean;
}): CompanionState {
  if (input.userSpeaking && input.micReady) return 'listening';
  if (input.speaking) return 'speaking';
  if (
    ['starting', 'executing', 'paused', 'cancelling'].includes(input.taskStatus)
  )
    return 'working';
  if (input.thinking && input.micReady) return 'thinking';
  if (!input.micReady || !input.awake) return 'sleeping';
  return 'idle';
}
