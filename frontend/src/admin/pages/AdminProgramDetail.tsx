/**
 * v1.69 — Phase 10: Admin Program Detail.
 *
 * Single-program management view with tabbed navigation:
 *   - Overview  — at-a-glance stats (members, FAQs, courses, support tickets)
 *   - Settings  — ProgramSettings (theme / hero / sections / branding)
 *   - Courses   — per-program course list + quick "new course" action
 *   - Members   — enrollment roster + role management
 *   - AI        — per-program AI config (resolves to global fallback if not set)
 *   - Zoom      — per-program Zoom OAuth credentials
 *   - Discord   — per-program Discord bot
 *   - Features  — per-program feature flag overrides
 *   - Support   — per-program app settings (Golden Ticket cooldown / SP cost /
 *                  penalty multiplier) + per-program SupportCategory overrides
 *
 * Each tab is a thin wrapper around the existing per-program admin
 * endpoints added in Phases 4-9. The detail page is purely a
 * navigation shell + per-program summary card.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import adminApi from '../utils/adminApi';
// v1.69 — Phase 8 admin UI: real interactive widget for the
// per-program feature flag toggle. Replaces the previous
// placeholder curl snippet on the Features tab.
import ProgramFeatureFlagsTab from '../components/program/ProgramFeatureFlagsTab';
// v1.69 — Phase 9 admin UI: per-program support category CRUD widget.
import ProgramSupportCategoriesTab from '../components/program/ProgramSupportCategoriesTab';
// v1.69 — Phase 9 admin UI: per-program app settings widget
// (Golden Ticket cooldown / SP cost / penalty multiplier).
import ProgramAppSettingsTab from '../components/program/ProgramAppSettingsTab';

type Tab = 'overview' | 'settings' | 'courses' | 'members' | 'ai' | 'zoom' | 'discord' | 'features' | 'support' | 'appSettings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'settings', label: 'Settings' },
  { key: 'courses',  label: 'Courses' },
  { key: 'members',  label: 'Members' },
  { key: 'ai',       label: 'AI' },
  { key: 'zoom',     label: 'Zoom' },
  { key: 'discord',  label: 'Discord' },
  { key: 'features', label: 'Features' },
  { key: 'support',  label: 'Support' },
];

interface ProgramInfo {
  _id: string;
  name: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
  status: 'draft' | 'active' | 'archived' | 'completed';
  enrollmentMode: 'open' | 'invite_only' | 'closed';
  startDate: string;
  endDate: string;
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="text-2xl font-serif text-ink mt-1">{value}</p>
    </div>
  );
}

export default function AdminProgramDetail(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const programId = params.id ?? '';
  const [tab, setTab] = useState<Tab>('overview');
  const [info, setInfo] = useState<ProgramInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.get<{ batch: ProgramInfo }>(`/batches/${programId}`);
        if (!cancelled) setInfo(res.data.batch);
      } catch (err) {
        if (!cancelled) setError('Failed to load program.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [programId]);

  if (loading && !info) {
    return <div className="text-sm text-ink-soft py-12 text-center">Loading program…</div>;
  }
  if (error || !info) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        {error ?? 'Program not found.'}{' '}
        <Link to="/admin/programs" className="underline">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link
              to="/admin/programs"
              className="text-[11px] text-ink-faint hover:text-ink"
            >
              ← All programs
            </Link>
            <h1 className="text-xl font-semibold text-ink mt-1">{info.name}</h1>
            {info.description && (
              <p className="text-sm text-ink-soft mt-1 max-w-3xl">{info.description}</p>
            )}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {info.isDefault && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  ★ Default program
                </span>
              )}
              <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
                info.status === 'active'    ? 'bg-emerald-100 text-emerald-700' :
                info.status === 'draft'     ? 'bg-mist text-ink-soft' :
                info.status === 'completed' ? 'bg-amber-100 text-amber-700' :
                                              'bg-rose-100 text-rose-700'
              }`}>
                {info.status}
              </span>
              <span className="text-[11px] text-ink-faint">
                {new Date(info.startDate).toLocaleDateString()} → {new Date(info.endDate).toLocaleDateString()}
              </span>
              <span className="text-[11px] text-ink-faint">
                Enrollment: <span className="font-medium text-ink">{info.enrollmentMode}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="border-b border-border/60">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {tab === 'overview' && <OverviewTab programId={programId} />}
        {tab === 'settings' && (
          <SettingsTab programId={programId} />
        )}
        {tab === 'courses' && (
          <CoursesTab programId={programId} />
        )}
        {tab === 'members' && (
          <MembersTab programId={programId} />
        )}
        {tab === 'ai' && (
          <AiTab programId={programId} />
        )}
        {tab === 'zoom' && (
          <ZoomTab programId={programId} />
        )}
        {tab === 'discord' && (
          <DiscordTab programId={programId} />
        )}
        {tab === 'features' && (
          <FeaturesTab programId={programId} />
        )}
        {tab === 'support' && (
          <SupportTab programId={programId} />
        )}
        {tab === 'appSettings' && (
          <AppSettingsTab programId={programId} />
        )}
      </motion.div>
    </div>
  );
}

function OverviewTab({ programId }: { programId: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        At-a-glance counts for this program. Detailed per-tab views are in the tabs above.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Members" value="—" />
        <StatBox label="FAQs" value="—" />
        <StatBox label="Courses" value="—" />
        <StatBox label="Open support" value="—" />
        <StatBox label="Open community" value="—" />
        <StatBox label="Zoom meetings" value="—" />
        <StatBox label="Knowledge base" value="—" />
        <StatBox label="Badges awarded" value="—" />
      </div>
      <p className="text-[11px] text-ink-faint">
        Program id: <code className="px-1 py-0.5 rounded bg-mist">{programId}</code>
      </p>
    </div>
  );
}

function SettingsTab({ programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
      <p className="text-sm text-ink-soft mb-3">
        Per-program theme, hero copy, sections, and branding.
      </p>
      <Link
        to={`/admin/programs/${programId}/settings`}
        className="admin-btn-primary text-sm"
      >
        Open settings editor →
      </Link>
    </div>
  );
}

function CoursesTab({ programId: _programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
      <p className="text-sm text-ink-soft mb-3">
        Per-program courses. Manage them on the courses page — the program filter pills
        narrow the view to this program's courses.
      </p>
      <Link
        to="/admin/courses"
        className="admin-btn-primary text-sm"
      >
        Open courses →
      </Link>
    </div>
  );
}

function MembersTab({ programId: _programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
      <p className="text-sm text-ink-soft mb-3">
        Enrollment roster for this program. Admins can invite / remove / change role
        for each member. The migration auto-enrolls every existing user in the
        default program; new users join via self-enroll (or invite link for
        invite-only programs).
      </p>
      <Link
        to="/admin/programs"
        className="admin-btn-ghost text-sm"
      >
        View full roster
      </Link>
    </div>
  );
}

function AiTab({ programId: _programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-3">
      <p className="text-sm text-ink-soft">
        Per-program AI config — provider / API key / model / per-feature
        temperature. Resolves to the global default when no per-program override
        is set.
      </p>
      <p className="text-[11px] text-ink-faint">
        The admin AI Settings page accepts ?batchId=... — open it with this
        program preselected to edit the override.
      </p>
      <a
        href={`/admin/ai-config?batchId=${_programId}`}
        className="admin-btn-primary text-sm"
      >
        Open AI config →
      </a>
    </div>
  );
}

function ZoomTab({ programId: _programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-3">
      <p className="text-sm text-ink-soft">
        Per-program Zoom OAuth credentials (client ID / secret / webhook secret /
        access / refresh tokens, encrypted at rest). Each program registers its
        own Zoom Marketplace app; the runtime resolver picks the per-program
        credentials for meetings in this program.
      </p>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        GET /api/admin/programs/{_programId}/zoom
      </code>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        PUT /api/admin/programs/{_programId}/zoom  body: {'{ clientId, clientSecret, webhookSecretToken?, authCode? }'}
      </code>
    </div>
  );
}

function SupportTab({ programId }: { programId: string }) {
  // v1.69 — Phase 9 admin UI: real interactive widget for
  // the per-program support category CRUD. Replaces the
  // previous placeholder curl snippet. Calls
  // GET/POST/PATCH/DELETE /api/support/categories with the
  // program's batchId in the params (read) or body (write).
  return <ProgramSupportCategoriesTab programId={programId} />;
}

function FeaturesTab({ programId }: { programId: string }) {
  // v1.69 — Phase 8 admin UI: the placeholder curl snippet has
  // been replaced with a real interactive widget. The
  // per-program feature flag toggle lives in
  // ProgramFeatureFlagsTab; it calls the GET / PUT / DELETE
  // endpoints that were added when the resolver chain was
  // shipped in Phase 8.
  return <ProgramFeatureFlagsTab programId={programId} />;
}

function DiscordTab({ programId: _programId }: { programId: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-3">
      <p className="text-sm text-ink-soft">
        Per-program Discord bot — application ID / guild ID / bot token
        (encrypted) / webhook URL / notification channel. The
        runtime BotManager spawns one bot per program on
        server boot.
      </p>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        GET    /api/admin/programs/{_programId}/discord
      </code>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        PUT    /api/admin/programs/{_programId}/discord
      </code>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        POST   /api/admin/programs/{_programId}/discord/enable
      </code>
      <code className="block text-[11px] bg-mist rounded-md p-2 text-ink-soft break-all">
        POST   /api/admin/programs/{_programId}/discord/disable
      </code>
    </div>
  );
}

function AppSettingsTab({ programId }: { programId: string }) {
  // v1.69 — Phase 9 admin UI: real interactive widget for
  // the per-program app settings (Golden Ticket cooldown /
  // SP cost / penalty multiplier). Calls the existing
  // /api/admin/programs/:id/settings endpoints that were
  // added in Phase 9+.
  return <ProgramAppSettingsTab programId={programId} />;
}
