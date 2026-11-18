import { useEffect, useRef } from 'react';
import {
  hasCompanionConversation,
  type CompanionSnapshot,
} from '@shared/companion';

export function ConversationBubble({
  snapshot,
}: {
  snapshot: CompanionSnapshot;
}) {
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [
    snapshot.assistantText,
    snapshot.transcript,
    snapshot.conversationVisible,
  ]);
  if (!hasCompanionConversation(snapshot)) return null;

  return (
    <section className="companion-conversation" aria-label="Live conversation">
      <div
        className="companion-conversation-output"
        ref={outputRef}
        role="log"
        aria-label="Conversation text"
        aria-live="polite"
        tabIndex={0}
      >
        {snapshot.transcript && (
          <div className="companion-utterance is-user" aria-label="You">
            <p>{snapshot.transcript}</p>
          </div>
        )}
        {snapshot.assistantText ? (
          <div className="companion-utterance is-assistant" aria-label="CYRVIS">
            <p>{snapshot.assistantText}</p>
          </div>
        ) : (
          <div
            className="companion-utterance is-assistant companion-typing"
            role="status"
            aria-label={
              snapshot.state === 'listening' ? 'Listening' : 'Thinking'
            }
          >
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </section>
  );
}
