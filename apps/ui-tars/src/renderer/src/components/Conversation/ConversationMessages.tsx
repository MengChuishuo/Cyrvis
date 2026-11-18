import type { ConversationWithSoM } from '@main/shared/types';
import { IMAGE_PLACEHOLDER } from '@ui-tars/shared/constants';
import ThoughtChain from '../ThoughtChain';
import {
  AssistantTextMessage,
  HumanTextMessage,
  ScreenshotMessage,
} from '../RunMessages/Messages';

/** Shared by live chats and history so both retain the original message format. */
export function ConversationMessages({
  messages,
  onSelectImage,
}: {
  messages: ConversationWithSoM[];
  onSelectImage: (index: number) => void;
}) {
  return (
    <>
      {messages.map((message, index) => {
        const hasImage = Boolean(
          message.screenshotBase64 || message.screenshotBase64WithElementMarker,
        );
        if (message.from === 'human')
          return (
            <div key={index}>
              {message.value && message.value !== IMAGE_PLACEHOLDER && (
                <HumanTextMessage text={message.value} />
              )}
              {hasImage && (
                <ScreenshotMessage onClick={() => onSelectImage(index)} />
              )}
            </div>
          );
        const finished = message.predictionParsed?.find(
          (step) => step.action_type === 'finished',
        )?.action_inputs?.content;
        return (
          <div key={index}>
            {!!message.predictionParsed?.length && (
              <ThoughtChain
                steps={message.predictionParsed}
                hasSomImage={hasImage}
                onClick={() => onSelectImage(index)}
              />
            )}
            {typeof finished === 'string' && finished.trim() ? (
              <AssistantTextMessage text={finished} />
            ) : (
              !message.predictionParsed?.length &&
              message.value && <AssistantTextMessage text={message.value} />
            )}
            {hasImage && !message.predictionParsed?.length && (
              <ScreenshotMessage onClick={() => onSelectImage(index)} />
            )}
          </div>
        );
      })}
    </>
  );
}
