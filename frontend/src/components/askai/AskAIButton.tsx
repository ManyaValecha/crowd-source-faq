import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { friendlyError } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';
import { useAuthModal } from '../../context/AuthModalContext';

const ANON_AI_LIMIT = 5;
const ANON_AI_COUNT_KEY = 'yaksha_anon_ai_count';
const ANON_AI_RESET_KEY = 'yaksha_anon_ai_reset';

function readAnonCount(): number {
  try {
    const resetAt = Number(localStorage.getItem(ANON_AI_RESET_KEY) || 0);
    if (!resetAt || Date.now() > resetAt) {
      localStorage.setItem(ANON_AI_COUNT_KEY, '0');
      localStorage.setItem(ANON_AI_RESET_KEY, String(Date.now() + 86400000));
      return 0;
    }
    return Number(localStorage.getItem(ANON_AI_COUNT_KEY) || 0);
  } catch { return 0; }
}
function bumpAnonCount(): number {
  const next = readAnonCount() + 1;
  try {
    localStorage.setItem(ANON_AI_COUNT_KEY, String(next));
    if (!localStorage.getItem(ANON_AI_RESET_KEY))
      localStorage.setItem(ANON_AI_RESET_KEY, String(Date.now() + 86400000));
  } catch {}
  return next;
}

interface Source { kind: 'knowledge'|'faq'|'community'; title: string; snippet: string; score: number; href: string; id: string; aboveThreshold?: boolean; }
interface AskResponse { question: string; answer: string; sources: Source[]; relevantCount: number; sourceCount: number; model: string; aiFailed: boolean; }
interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; sources?: Source[]; loading?: boolean; error?: string; }

type PanelState = 'collapsed' | 'minimized' | 'expanded';
const STATE_KEY = 'yaksha_chat_state';
function readPersistedState(): PanelState {
  try { const v = localStorage.getItem(STATE_KEY); if (v === 'minimized' || v === 'expanded') return v; } catch {} return 'collapsed';
}
function persistState(s: PanelState) { try { localStorage.setItem(STATE_KEY, s); } catch {} }

function SparkleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M12 2L13.5 7.5L19 9L13.5 10.5L12 16L10.5 10.5L5 9L10.5 7.5L12 2Z" />
      <path d="M19 14L19.8 16.4L22 17L19.8 17.6L19 20L18.2 17.6L16 17L18.2 16.4L19 14Z" opacity="0.7" />
    </svg>
  );
}

function SourceRow({ s, i, onNav }: { s: Source; i: number; onNav: (href: string) => void }) {
  const icon = s.kind === 'faq' ? '📋' : s.kind === 'community' ? '💬' : '🧠';
  const label = s.kind === 'faq' ? 'FAQ' : s.kind === 'community' ? 'Community' : 'Knowledge';
  return (
    <button
      onClick={() => onNav(s.href)}
      className="w-full text-left flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-card hover:bg-mist border border-border hover:border-accent/40 transition-all group"
    >
      <span className="text-sm shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
          <span className="text-[9px] text-ink-faint">{Math.round(s.score * 100)}%</span>
        </div>
        <p className="text-xs text-ink line-clamp-1">{s.title}</p>
      </div>
      <svg className="w-3 h-3 text-ink-faint group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0 mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  );
}

function MessageBubble({ m, onNav }: { m: ChatMessage; onNav: (href: string) => void }) {
  if (m.role === 'user') {
    return (<div className="flex justify-end"><div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-md bg-accent text-accent-text text-sm shadow-sm shadow-accent/20">{m.content}</div></div>);
  }
  if (m.loading) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-bl-md bg-card border border-border flex items-center gap-2 text-ink-soft text-sm">
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
          Searching knowledge base...
        </div>
      </div>
    );
  }
  if (m.error) {
    return (<div className="flex justify-start"><div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-danger-light border border-danger/30 text-danger text-sm">{m.error}</div></div>);
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-card border border-border text-ink text-sm leading-relaxed whitespace-pre-wrap">{m.content}</div>
        {m.sources && m.sources.length > 0 && (
          <div className="space-y-1 pl-1">
            <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold pl-1">Sources ({m.sources.length})</p>
            {m.sources.map((s, i) => <SourceRow key={`${s.id}-${i}`} s={s} i={i} onNav={onNav} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AskAIButton() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { openModal } = useAuthModal();

  const [panel, setPanel] = useState<PanelState>(readPersistedState);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [anonCount, setAnonCount] = useState(() => isAuthenticated ? 0 : readAnonCount());
  const [unreadCount, setUnreadCount] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { persistState(panel); }, [panel]);
  useEffect(() => { setAnonCount(isAuthenticated ? 0 : readAnonCount()); }, [isAuthenticated, panel]);
  useEffect(() => { if (panel !== 'collapsed') setTimeout(() => inputRef.current?.focus(), 200); }, [panel]);
  useEffect(() => { if (inputRef.current) { inputRef.current.style.height = '24px'; inputRef.current.style.height = Math.min(120, inputRef.current.scrollHeight) + 'px'; } }, [query]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, isLoading]);

  useEffect(() => {
    if (panel === 'collapsed') return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(panel === 'expanded' ? 'minimized' : 'collapsed'); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [panel]);

  useEffect(() => {
    if (panel !== 'expanded' || !panelRef.current) return;
    const el = panelRef.current;
    const focusable = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, [panel, messages]);

  useEffect(() => {
    if (panel === 'collapsed' && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === 'assistant' && !last.loading) setUnreadCount(c => c + 1);
    }
  }, [messages, panel]);
  useEffect(() => { if (panel !== 'collapsed') setUnreadCount(0); }, [panel]);

  const send = useCallback(async () => {
    const q = query.trim();
    if (q.length < 3 || isLoading) return;
    if (!isAuthenticated && readAnonCount() >= ANON_AI_LIMIT) { openModal('signin'); return; }
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: q };
    const aiMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', loading: true };
    setMessages(m => [...m, userMsg, aiMsg]);
    setQuery('');
    setIsLoading(true);
    try {
      const res = await api.post<AskResponse>('/ask-ai', { question: q });
      setMessages(m => m.map(msg => msg.id === aiMsg.id ? { ...msg, content: res.data.answer, sources: res.data.sources, loading: false } : msg));
      if (!isAuthenticated) { const next = bumpAnonCount(); setAnonCount(next); if (next === ANON_AI_LIMIT) setTimeout(() => openModal('signin'), 1500); }
    } catch (err: unknown) {
      setMessages(m => m.map(msg => msg.id === aiMsg.id ? { ...msg, content: '', loading: false, error: friendlyError(err, 'Search failed. Please try again.') } : msg));
    } finally { setIsLoading(false); }
  }, [query, isLoading, isAuthenticated, openModal]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const reset = () => { setMessages([]); setQuery(''); };
  const handleSourceNav = useCallback((href: string) => { setPanel('collapsed'); navigate(href); }, [navigate]);
  const isExpanded = panel === 'expanded';
  const quotaExhausted = !isAuthenticated && anonCount >= ANON_AI_LIMIT;

  if (panel === 'collapsed') {
    return (
      <button onClick={() => setPanel('minimized')} className="fixed z-50 right-6 bottom-6 group" aria-label="Open FAQ Assistant" title="Ask the FAQ Assistant">
        <div className="absolute inset-0 rounded-full bg-accent/20 animate-ping opacity-30 pointer-events-none" style={{ animationDuration: '3s' }} />
        <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent-dark shadow-lg shadow-accent/30 flex items-center justify-center transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
          <SparkleIcon size={24} />
        </div>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold px-1 shadow-md animate-bounce" style={{ animationDuration: '2s' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  const panelClasses = isExpanded
    ? 'fixed inset-4 sm:inset-6 md:inset-10 lg:inset-16'
    : 'fixed bottom-6 right-6 w-[380px] max-w-[calc(100vw-32px)]';

  return (
    <>
      {isExpanded && (<div className="search-overlay z-[59] transition-opacity duration-300" onClick={() => setPanel('minimized')} aria-hidden="true" />)}
      <div ref={panelRef} role="dialog" aria-label="FAQ Assistant" aria-modal={isExpanded} className={`z-[60] flex flex-col rounded-2xl overflow-hidden border border-border shadow-2xl shadow-ink/15 transition-all duration-300 ease-out bg-card ${panelClasses}`} style={{ maxHeight: isExpanded ? undefined : 'min(600px, calc(100vh - 100px))' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card select-none flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center shadow-md shadow-accent/25"><SparkleIcon size={14} /></div>
            <div>
              <h3 className="text-sm font-semibold text-ink leading-tight">FAQ Assistant</h3>
              <p className="text-[10px] text-ink-faint">Powered by RAG &#183; Search FAQ, Wiki, and Community knowledge</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {!isAuthenticated && (<span className={`mr-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${quotaExhausted ? 'bg-danger/10 text-danger border-danger/20' : 'bg-mist text-ink-soft border-border'}`}>{Math.max(0, ANON_AI_LIMIT - anonCount)}/{ANON_AI_LIMIT}</span>)}
            {messages.length > 0 && (<button onClick={reset} title="Clear chat" className="px-2 py-1 rounded-md text-[10px] font-medium text-ink-faint hover:text-ink hover:bg-mist transition-colors">Clear</button>)}
            <button onClick={() => setPanel(isExpanded ? 'minimized' : 'collapsed')} title={isExpanded ? 'Minimize' : 'Collapse'} className="w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-mist transition-colors flex items-center justify-center" aria-label="Minimize"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
            <button onClick={() => setPanel(isExpanded ? 'minimized' : 'expanded')} title={isExpanded ? 'Shrink' : 'Expand'} className="w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-mist transition-colors flex items-center justify-center" aria-label="Expand">
              {isExpanded
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              }
            </button>
            <button onClick={() => setPanel('collapsed')} title="Close (Esc)" className="w-7 h-7 rounded-md text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg/40 min-h-0">
          {messages.length === 0 && quotaExhausted && (
            <div className="text-center py-8 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
              <p className="text-sm font-semibold text-ink">Sign in to continue</p>
              <p className="text-[11px] text-ink-soft max-w-xs mx-auto">You have used your {ANON_AI_LIMIT} free AI searches. Sign in for unlimited access.</p>
              <button onClick={() => openModal('signin')} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent text-accent-text text-xs font-semibold hover:bg-accent-hover transition-colors">Sign in</button>
            </div>
          )}
          {messages.length === 0 && !quotaExhausted && (
            <div className="text-center py-6 space-y-2.5">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
              <p className="text-sm font-medium text-ink">How can I help?</p>
              <p className="text-[11px] text-ink-faint">I will search FAQs, Zoom transcripts, and community posts.</p>
              <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                {['How to get NOC?', 'When is the deadline?', 'Team formation rules'].map(ex => (<button key={ex} onClick={() => setQuery(ex)} className="text-[11px] text-ink-soft hover:text-ink px-2.5 py-1 rounded-full border border-border hover:border-accent/40 hover:bg-accent/5 transition-all">{ex}</button>))}
              </div>
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} m={m} onNav={handleSourceNav} />)}
        </div>
        <div className="flex-shrink-0 border-t border-border bg-card px-3 py-3">
          <div className="flex items-end gap-2">
            <div className="shrink-0 w-9 h-9 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
            <div className="flex-1">
              <textarea ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder={quotaExhausted ? 'Sign in to continue...' : 'Ask the FAQ Assistant...'} rows={1} disabled={quotaExhausted} className="w-full bg-bg rounded-2xl border border-border px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/15 resize-none leading-6 max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed transition-all" />
            </div>
            <button onClick={send} disabled={query.trim().length < 3 || isLoading || quotaExhausted} title="Send (Enter)" className="shrink-0 w-9 h-9 rounded-full bg-accent hover:bg-accent-hover active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-md shadow-accent/25 flex items-center justify-center" aria-label="Send message"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
          </div>
          <p className="text-[10px] text-ink-faint text-center mt-2">Powered by RAG &#183; Search FAQ, Wiki, and Community knowledge</p>
        </div>
      </div>
    </>
  );
}
