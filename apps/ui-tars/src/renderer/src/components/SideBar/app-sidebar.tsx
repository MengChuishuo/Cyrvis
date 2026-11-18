import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { History, Settings, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from '@renderer/components/ui/sidebar';
import { GlobalSettings, useGlobalSettings } from '../Settings/global';
import { sessionManager, type SessionItem } from '@renderer/db/session';
import { chatManager } from '@renderer/db/chat';
import { NewChatButton } from '../Conversation/NewChatButton';
import { DeleteSessionDialog } from '../AlertDialog/delSessionDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useStore } from '@renderer/hooks/useStore';
import { StatusEnum } from '@ui-tars/shared/types';
import { useSessionStore } from '@renderer/store/session';
import { toast } from 'sonner';
import logo from '@resources/logo-vector.svg?url';

export function AppSidebar() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { thinking, status } = useStore();
  const busy =
    thinking ||
    [StatusEnum.RUNNING, StatusEnum.PAUSE, StatusEnum.CALL_USER].includes(
      status,
    );
  const deleteChat = async () => {
    if (!deleteTarget || deleting || busy) return;
    setDeleting(true);
    try {
      await chatManager.deleteSessionMessages(deleteTarget.id);
      await sessionManager.deleteSession(deleteTarget.id);
      setSessions((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      const active = useSessionStore.getState();
      const isOpenChat =
        pathname === '/local' && active.currentSessionId === deleteTarget.id;
      if (active.currentSessionId === deleteTarget.id) {
        active.setCurrentSessionId('');
        active.setChatMessages([]);
      }
      if (pathname === `/history/${deleteTarget.id}` || isOpenChat)
        navigate('/');
      setDeleteTarget(null);
    } catch {
      toast.error('Could not delete this chat. Please try again.');
    } finally {
      setDeleting(false);
    }
  };
  const { openSettings } = useGlobalSettings();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const records = await sessionManager.getAllSessions();
        if (active) {
          setSessions(records.sort((a, b) => b.updatedAt - a.updatedAt));
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const channel = new BroadcastChannel('cyrvis-history');
    channel.onmessage = () => void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      channel.close();
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = [
    { label: 'Today', items: sessions.filter((s) => s.updatedAt >= +today) },
    {
      label: 'Yesterday',
      items: sessions.filter(
        (s) => s.updatedAt >= +yesterday && s.updatedAt < +today,
      ),
    },
    {
      label: 'Earlier',
      items: sessions.filter((s) => s.updatedAt < +yesterday),
    },
  ];
  return (
    <>
      <Sidebar className="cyrvis-sidebar" collapsible="offcanvas">
        <SidebarHeader>
          <div className="h-9 draggable-area" />
          <div className="cyrvis-sidebar-brand">
            <Link to="/" aria-label="Cyrvis home">
              <img src={logo} alt="" />
              <span>Cyrvis</span>
            </Link>
            <button
              className="cyrvis-icon-button"
              onClick={openSettings}
              aria-label="Settings"
            >
              <Settings size={16} />
            </button>
          </div>
          <NewChatButton className="mx-3 mb-2" />
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="History" className="cyrvis-history-nav">
            <h2>
              <History size={15} />
              History
            </h2>
            {loading && <p role="status">Loading history…</p>}
            {error && (
              <p role="alert">
                Could not load history. Reopen the window to retry.
              </p>
            )}
            {!loading && !error && !sessions.length && (
              <p>
                No chats yet.
                <br />
                Your conversations will appear here.
              </p>
            )}
            {groups
              .filter((g) => g.items.length)
              .map((group) => (
                <section key={group.label}>
                  <h3>{group.label}</h3>
                  {group.items.map((item) => (
                    <div className="cyrvis-history-row" key={item.id}>
                      <Link
                        to={`/history/${item.id}`}
                        title={item.name}
                        aria-current={
                          pathname === `/history/${item.id}`
                            ? 'page'
                            : undefined
                        }
                      >
                        <span>{item.name}</span>
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="cyrvis-history-menu cyrvis-icon-button"
                            aria-label={`More options for ${item.name}`}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={busy}
                            onSelect={() => setDeleteTarget(item)}
                            className="text-red-600"
                          >
                            <Trash2 size={15} />
                            Delete
                          </DropdownMenuItem>
                          {busy && (
                            <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">
                              Finish or stop the current task before deleting
                              chats.
                            </p>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </section>
              ))}
          </nav>
        </SidebarContent>
      </Sidebar>
      <GlobalSettings />
      <DeleteSessionDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteChat()}
        name={deleteTarget?.name}
        deleting={deleting}
      />
    </>
  );
}
