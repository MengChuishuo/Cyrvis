import { ConversationMessages } from '@renderer/components/Conversation/ConversationMessages';
import { NewChatButton } from '@renderer/components/Conversation/NewChatButton';
import { useLocation, useNavigate } from 'react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Card } from '@renderer/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@renderer/components/ui/tabs';
import { NavHeader } from '@renderer/components/Detail/NavHeader';
import { ScrollArea } from '@renderer/components/ui/scroll-area';

import { useStore } from '@renderer/hooks/useStore';
import { useSession } from '@renderer/hooks/useSession';
import Prompts from '../../components/Prompts';
import {
  ErrorMessage,
  LoadingText,
} from '../../components/RunMessages/Messages';
import { api } from '../../api';
import ImageGallery from '../../components/ImageGallery';
import { StatusEnum } from '@ui-tars/shared/types';
import { RouterState } from '../../typings';
import { Operator } from '@main/store/types';
import ChatInput from '../../components/ChatInput';
import { NavDialog } from '../../components/AlertDialog/navDialog';
import {
  checkVLMSettings,
  LocalSettingsDialog,
} from '../../components/Settings/local';
import { sleep } from '@ui-tars/shared/utils';

const LocalOperator = () => {
  const location = useLocation();
  const state = (location.state as RouterState | null) ?? {
    operator: Operator.LocalComputer,
    sessionId: '',
    from: 'new' as const,
  };
  const navigate = useNavigate();

  const { status, messages = [], thinking, errorMsg } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestions: string[] = [];
  const [selectImg, setSelectImg] = useState<number | undefined>(undefined);
  const { setActiveSession, chatMessages } = useSession();
  const [pendingAction, setPendingAction] = useState<'back' | null>(null);
  const [isNavDialogOpen, setNavDialogOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [sessionId, setSessionId] = useState(state?.sessionId || '');

  useEffect(() => {
    setSessionId(state?.sessionId || '');
    setSelectImg(undefined);
    const update = async () => {
      if (state?.sessionId) {
        await setActiveSession(state.sessionId);
      }
    };
    update();
  }, [location.key]);

  useEffect(() => {
    setTimeout(() => {
      containerRef.current?.scrollIntoView(false);
    }, 100);
  }, [messages, thinking, errorMsg]);

  const handleSelect = async (suggestion: string) => {
    await api.setInstructions({ instructions: suggestion });
  };

  const handleImageSelect = async (index: number) => {
    setSelectImg(index);
  };

  // check status before nav
  const needsConfirm =
    status === StatusEnum.RUNNING ||
    status === StatusEnum.CALL_USER ||
    status === StatusEnum.PAUSE;

  const onBack = useCallback(async () => {
    navigate('/');
  }, []);

  const handleBack = useCallback(() => {
    if (needsConfirm) {
      setPendingAction('back');
      setNavDialogOpen(true);
    } else {
      onBack();
    }
  }, [needsConfirm]);

  const onConfirm = useCallback(async () => {
    await api.stopRun();
    await api.clearHistory();

    if (pendingAction === 'back') {
      await onBack();
    }
    setPendingAction(null);
    setNavDialogOpen(false);
  }, [pendingAction]);

  const onCancel = useCallback(() => {
    setPendingAction(null);
    setNavDialogOpen(false);
  }, []);

  const handleLocalSettingsSubmit = async () => {
    setLocalOpen(false);

    await sleep(200);
  };

  const handleLocalSettingsClose = () => {
    setLocalOpen(false);
  };

  const checkVLM = async () => {
    const hasVLM = await checkVLMSettings();

    if (hasVLM) {
      return true;
    } else {
      setLocalOpen(true);
      return false;
    }
  };

  const renderChatList = () => {
    return (
      <ScrollArea className="h-full px-4">
        <div ref={containerRef}>
          {!chatMessages?.length && suggestions?.length > 0 && (
            <Prompts suggestions={suggestions} onSelect={handleSelect} />
          )}

          <ConversationMessages
            messages={chatMessages}
            onSelectImage={handleImageSelect}
          />

          {thinking && <LoadingText text={'Thinking...'} />}
          {errorMsg && <ErrorMessage text={errorMsg} />}
        </div>
      </ScrollArea>
    );
  };

  return (
    <div className="flex flex-col w-full h-full">
      <NavHeader title="Chat" onBack={handleBack}></NavHeader>
      <div className="px-5 pb-5 flex flex-1 min-h-0 gap-5">
        <Card className="flex-1 basis-2/5 px-0 py-4 gap-4 h-full min-h-0 min-w-0">
          <div className="flex items-center justify-between w-full px-4">
            <span className="text-sm font-medium">Conversation</span>
            <NewChatButton />
          </div>
          {renderChatList()}
          <ChatInput
            key={location.key}
            disabled={false}
            operator={state.operator}
            sessionId={sessionId}
            onSessionCreated={setSessionId}
            checkBeforeRun={checkVLM}
          />
        </Card>
        <Card className="flex-1 basis-3/5 p-3 h-full min-h-0 min-w-0">
          <Tabs defaultValue="screenshot" className="flex-1">
            <TabsList>
              <TabsTrigger value="screenshot">Screenshots</TabsTrigger>
            </TabsList>
            <TabsContent value="screenshot">
              <ImageGallery
                messages={chatMessages}
                selectImgIndex={selectImg}
              />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
      <NavDialog
        open={isNavDialogOpen}
        onOpenChange={onCancel}
        onConfirm={onConfirm}
      />
      <LocalSettingsDialog
        isOpen={localOpen}
        onSubmit={handleLocalSettingsSubmit}
        onClose={handleLocalSettingsClose}
      />
    </div>
  );
};

export default LocalOperator;
