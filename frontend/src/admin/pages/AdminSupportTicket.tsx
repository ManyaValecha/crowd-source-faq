// Admin single-ticket view. Status changes, internal notes, replies,
// recording-link attachment, proof requests — all in one place.
// Admin/moderator only.

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  getSupportRequest,
  updateSupportStatus,
  replyToSupportRequest,
  SUPPORT_ISSUE_OPTIONS,
} from '../../components/support/api';
import { getIssueIcon } from '../../components/support/icons';
import { ContextFieldsDisplay } from '../../components/support/ContextFieldsDisplay';
import type { SupportRequest, SupportStatus, SupportCategory } from '../../components/support/types';
import Spinner from '../../components/ui/Spinner';
import { friendlyError } from '../../utils/api';

const STATUS_OPTIONS: SupportStatus[] = ['Pending', 'In Review', 'Resolved', 'Rejected'];

function AdminTicketInner(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [request, setRequest] = useState<SupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Status form state
  const [nextStatus, setNextStatus] = useState<SupportStatus | ''>('');
  const [adminNote, setAdminNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [sessionAccessUrl, setSessionAccessUrl] = useState('');
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [requestProof, setRequestProof] = useState(false);
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success'): void => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = React.useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getSupportRequest(id);
      setRequest(r);
      setAdminNote(r.adminNote);
      setResolutionSummary(r.resolutionSummary);
      setSessionAccessUrl(r.sessionAccessUrl);
    } catch (err) {
      setError(friendlyError(err, 'Could not load this ticket.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleSaveStatus(): Promise<void> {
    if (!request || !nextStatus) return;
    setSaving(true);
    try {
      const updated = await updateSupportStatus(request._id, {
        status: nextStatus,
        adminNote: adminNote.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
        resolutionSummary: resolutionSummary.trim() || undefined,
        sessionAccessUrl: sessionAccessUrl.trim() || undefined,
        followUpMessage: followUpMessage.trim() || undefined,
        requestProof: followUpMessage.trim() ? requestProof : undefined,
      });
      setRequest(updated);
      setNextStatus('');
      setInternalNote('');
      setFollowUpMessage('');
      setRequestProof(false);
      showToast(`Status updated to ${updated.status}.`);
    } catch (err) {
      showToast(friendlyError(err, 'Failed to update status.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickReply(): Promise<void> {
    if (!request) return;
    const message = prompt('Reply message:');
    if (!message || !message.trim()) return;
    try {
      const updated = await replyToSupportRequest(request._id, message.trim());
      setRequest(updated);
      showToast('Reply sent.');
    } catch (err) {
      showToast(friendlyError(err, 'Failed to send reply.'), 'error');
    }
  }

  if (loading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Spinner size="lg" /></div>;
  }
  if (error || !request) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-danger">{error ?? 'Ticket not found.'}</p>
        <button onClick={() => navigate('/admin/support')} className="text-xs text-accent hover:underline">← Back to inbox</button>
      </div>
    );
  }

  const issueByKey = SUPPORT_ISSUE_OPTIONS.find((o) => o.key === request.issueType);

  return (
    <div className="space-y-4">
      <AnimatePresence>{toast && <Toast toast={toast} />}</AnimatePresence>

      <button onClick={() => navigate('/admin/support')} className="text-xs text-ink-soft hover:text-ink">
        ← Back to inbox
      </button>

      {/* Header card */}
      <div className="admin-card-surface p-5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-10 h-10 rounded-xl bg-cream text-accent flex items-center justify-center">
            {getIssueIcon(request.issueType)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider ${statusStyle(request.status)}`}>
                {request.status}
              </span>
              <span className="text-[10px] text-ink-faint uppercase tracking-wider font-semibold">
                {issueByKey?.label ?? request.issueLabel}
              </span>
            </div>
            <h1 className="font-serif text-lg text-ink leading-snug">{request.title}</h1>
            <p className="text-[11px] text-ink-faint mt-1">
              {request.userName} · {request.userEmail} · Submitted {new Date(request.createdAt).toLocaleString()}
            </p>
          </div>
          <button onClick={handleQuickReply} className="admin-btn-secondary">Quick reply</button>
        </div>
      </div>

      {/* Status update form */}
      <div className="admin-card-surface">
        <div className="admin-card-header">
          <p className="text-sm font-semibold text-ink">Update status</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="admin-label">New status</label>
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as SupportStatus | '')}
                className="admin-select w-full"
              >
                <option value="">— select —</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="admin-label">Session recording URL (resolved only)</label>
              <input
                value={sessionAccessUrl}
                onChange={(e) => setSessionAccessUrl(e.target.value)}
                placeholder="https://… (optional)"
                className="admin-input"
              />
            </div>
          </div>

          <div>
            <label className="admin-label">Public admin note (visible to student)</label>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={2}
              placeholder="Required when rejecting. Optional otherwise."
              className="admin-textarea"
            />
          </div>
          <div>
            <label className="admin-label">Internal note (admin-only)</label>
            <textarea
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={2}
              placeholder="Not sent to the student."
              className="admin-textarea"
            />
          </div>
          <div>
            <label className="admin-label">Resolution summary</label>
            <textarea
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              rows={2}
              placeholder="How was this resolved? (one-line summary)"
              className="admin-textarea"
            />
          </div>
          <div>
            <label className="admin-label">Send a reply with this update (optional)</label>
            <textarea
              value={followUpMessage}
              onChange={(e) => setFollowUpMessage(e.target.value)}
              rows={2}
              placeholder="Shown to the student in the follow-up thread."
              className="admin-textarea"
            />
            {followUpMessage.trim() && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={requestProof}
                  onChange={(e) => setRequestProof(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border text-accent focus:ring-accent"
                />
                Mark this reply as "Proof requested"
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <button
              type="button"
              onClick={handleSaveStatus}
              disabled={saving || !nextStatus}
              className="admin-btn-primary"
            >
              {saving ? 'Saving…' : 'Update status'}
            </button>
          </div>
        </div>
      </div>

      {/* Original message + student message */}
      <div className="admin-card-surface p-5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mb-2">Student's original message</p>
        <p className="text-sm text-ink whitespace-pre-line">{request.details}</p>
        {request.attemptedSteps.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/60">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mb-1.5">Steps they tried</p>
            <ul className="space-y-1">
              {request.attemptedSteps.map((s, i) => (
                <li key={i} className="text-xs text-ink-soft flex items-start gap-1.5">
                  <span className="text-ink-faint">✓</span><span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Internal notes (admin only) */}
      {request.internalNotes && request.internalNotes.length > 0 && (
        <div className="admin-card-surface p-5">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mb-2">
            Internal notes ({request.internalNotes.length}) — admin only
          </p>
          <ul className="space-y-2">
            {request.internalNotes.map((n) => (
              <li key={n._id} className="p-3 rounded-xl bg-cream/40 border border-border">
                <p className="text-xs text-ink-soft mb-1">
                  {n.addedByName} · {new Date(n.createdAt).toLocaleString()}
                </p>
                <p className="text-sm text-ink whitespace-pre-line">{n.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Provided context — the schema-driven fields the student filled in */}
      <ContextFieldsDisplay values={request.contextFields ?? []} />

      {/* Thread */}
      <div className="admin-card-surface p-5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mb-3">
          Conversation ({request.followUps.length})
        </p>
        {request.followUps.length === 0 ? (
          <p className="text-sm text-ink-faint italic">No follow-ups yet.</p>
        ) : (
          <ul className="space-y-2">
            {request.followUps.map((f) => (
              <li
                key={f._id}
                className={`p-3 rounded-xl border ${
                  f.senderRole === 'admin'
                    ? 'bg-admin-blue/5 border-admin-blue/20'
                    : 'bg-cream/40 border-border'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-ink">{f.senderName}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                    f.senderRole === 'admin' ? 'bg-admin-blue/15 text-admin-blue' : 'bg-mist text-ink-soft'
                  }`}>{f.senderRole}</span>
                  {f.requestProof && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider bg-warning/15 text-warning border border-warning/30">
                      Proof requested
                    </span>
                  )}
                  <span className="text-[10px] text-ink-faint ml-auto">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-ink whitespace-pre-line">{f.message}</p>
                {f.documents.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {f.documents.map((d, i) => (
                      <li key={i}>
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                          📎 {d.name || 'Attachment'}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Status history */}
      {request.statusHistory.length > 0 && (
        <div className="admin-card-surface p-5">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mb-3">Status history</p>
          <ol className="space-y-2 text-xs">
            {request.statusHistory.map((h) => (
              <li key={h._id} className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider ${statusStyle(h.status)}`}>
                  {h.status}
                </span>
                <div>
                  <p className="text-ink-soft">{h.note || <em className="text-ink-faint">no note</em>}</p>
                  <p className="text-[10px] text-ink-faint">{h.updatedByName} · {new Date(h.timestamp).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Toast({ toast }: { toast: { msg: string; type: 'success' | 'error' } }): React.ReactElement {
  const colour = toast.type === 'error' ? 'admin-toast-error' : 'admin-toast-success';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-xs font-medium border ${colour}`}
    >{toast.msg}</motion.div>
  );
}

function statusStyle(s: SupportStatus): string {
  switch (s) {
    case 'Pending':   return 'bg-warning/15 text-warning border-warning/30';
    case 'In Review': return 'bg-admin-blue/15 text-admin-blue border-admin-blue/30';
    case 'Resolved':  return 'bg-success/15 text-success border-success/30';
    case 'Rejected':  return 'bg-danger/15 text-danger border-danger/30';
  }
}

export default function AdminSupportTicket(): React.ReactElement {
  return <AdminTicketInner />;
}
