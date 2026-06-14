/**
 * ProgramContext — app-level provider for the currently selected
 * program (Batch under the hood — see the v1.69 multi-program
 * rename). Every page that shows FAQs, categories, or analytics
 * reads `currentProgram` from this context and passes `?batchId=X`
 * on its API calls. Switching is instant, persisted to
 * localStorage, and survives reloads.
 *
 * v1.69 — Phase 12: this file is the canonical ProgramContext
 * (the v1.69+ home). The legacy `BatchContext.tsx` file is a
 * re-export shim — new code should import from
 * `../context/ProgramContext`; old code that imports from
 * `../context/BatchContext` keeps working.
 *
 * Hierarchy of resolution when the provider first boots:
//   1. URL query param  ?batch=<id>      (highest priority — lets us deep-link)
//   2. localStorage     yaksha_active_program_id (falls back to old yaksha_active_batch_id)
//   3. First program returned by /api/batches
//   4. null             (ProgramPortalPage takes over)
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

export interface Program {
  _id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  /** True for the single program the ProgramContext should auto-pick on
   *  cold start. Enforced unique by a partial index on the model. */
  isDefault?: boolean;
  faqCount: number;
}

/** @deprecated Use `Program` instead. The type alias is preserved for
 *  the many call sites that haven't been renamed yet. */
export type Batch = Program;

interface ProgramContextValue {
  /** The currently selected program, or null if the user hasn't picked one yet. */
  currentProgram: Program | null;
  /** All active programs the user can switch to. Empty until first load. */
  availablePrograms: Program[];
  /** True while the initial /api/batches request is in flight. */
  loading: boolean;
  /** Network or validation error from the initial load (non-fatal). */
  error: string | null;
  /** Switch the active program. Persists to localStorage. */
  setCurrentProgram: (id: string) => boolean;
  /** Clear the active program — caller should redirect to the picker. */
  clearCurrentProgram: () => void;
  /** Re-fetch the list of available programs (e.g. after admin creates one). */
  refresh: () => Promise<void>;

  // ─── Legacy aliases (v1.69 — additive rename) ─────────────────────
  // These mirror the new names so existing callers don't break. New
  // code should use the `useProgram()` / `currentProgram` /
  // `availablePrograms` exports.
  currentBatch: Program | null;
  availableBatches: Program[];
  setCurrentBatch: (id: string) => boolean;
  clearCurrentBatch: () => void;
}

const ProgramContext = createContext<ProgramContextValue | null>(null);

const STORAGE_KEY_NEW = 'yaksha_active_program_id';
const STORAGE_KEY_OLD = 'yaksha_active_batch_id';

// Safety net: never let the initial load hang the UI indefinitely.
// If the API doesn't respond within this window, we treat it as an empty
// list and let the ProgramPortalPage take over.
const INITIAL_LOAD_TIMEOUT_MS = 5000;

export function useProgram(): ProgramContextValue {
  const ctx = useContext(ProgramContext);
  if (!ctx) {
    throw new Error('useProgram must be used inside a <ProgramProvider>');
  }
  return ctx;
}

/** @deprecated Use `useProgram()` instead. Kept for the many call
 *  sites that haven't been renamed yet. */
export function useBatch(): ProgramContextValue {
  return useProgram();
}

interface ProgramProviderProps {
  children: React.ReactNode;
}

export function ProgramProvider({ children }: ProgramProviderProps): React.ReactElement {
  const [availablePrograms, setAvailablePrograms] = useState<Program[]>([]);
  const [currentProgram, setCurrentProgramState] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load the list of active programs ─────────────────────────────────────
  const loadPrograms = useCallback(async (): Promise<Program[]> => {
    try {
      const res = await api.get<{ batches: Program[] }>('/batches');
      return res.data.batches ?? [];
    } catch {
      // Non-fatal: the public page can still render with an empty list
      // and a friendly "no programs" empty state.
      setError('Could not load programs. Please refresh.');
      return [];
    }
  }, []);

  // ── Pick the initial program per the resolution order in the file header ──
  //
  // Among the candidates returned by the API, prefer a program that already
  // has FAQs — otherwise the home page lands on an empty program (e.g. a
  // newly-created "test" program) and the public visitor sees three "no data"
  // cards with no obvious next step. We only do this auto-pick on the
  // initial resolution / refresh; explicit user choice via setCurrentProgram
  // is never overridden.
  const resolveInitial = useCallback((programs: Program[], fromUrl: string | null): Program | null => {
    if (programs.length === 0) return null;

    let picked: Program | undefined;

    if (fromUrl) {
      picked = programs.find((p) => p._id === fromUrl);
    }

    if (!picked) {
      let stored: string | null = null;
      try {
        // Read the new key first, fall back to the old key so
        // bookmarks / persistence from before the rename still
        // work.
        stored = window.localStorage.getItem(STORAGE_KEY_NEW)
          ?? window.localStorage.getItem(STORAGE_KEY_OLD);
      } catch { /* localStorage disabled */ }
      if (stored) {
        picked = programs.find((p) => p._id === stored);
      }
    }

    if (!picked) {
      // Cold-start default: prefer a program explicitly flagged
      // `isDefault: true` (admin can promote one from /admin/programs);
      // then a non-empty program so the home page actually has data;
      // then the first program as a last resort.
      picked =
        programs.find((p) => p.isDefault)
        ?? programs.find((p) => p.faqCount > 0)
        ?? programs[0];
    } else if (picked.faqCount === 0) {
      // The stored / deep-linked program is empty AND a non-empty alternative
      // exists — auto-promote to the non-empty one so the page isn't a
      // dead end. Persist the new pick so the user doesn't bounce back on
      // the next reload.
      const nonEmpty = programs.find((p) => p.faqCount > 0);
      if (nonEmpty) {
        picked = nonEmpty;
        try { window.localStorage.setItem(STORAGE_KEY_NEW, nonEmpty._id); } catch { /* ignore */ }
      }
    }

    return picked;
  }, []);

  // ── Initial mount: fetch + resolve ──────────────────────────────────────
  // Note: no useSearchParams and no useRef "run once" guard. Both caused
  // the loading state to get stuck in dev (StrictMode double-invokes
  // effects; the ref-based guard cancelled the only in-flight async).
  // The effect runs once, and the per-effect `cancelled` flag handles
  // StrictMode's cleanup properly.
  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      // Fetch is hung — treat as empty so the picker takes over.
      setError('Loading timed out. Please refresh.');
      setAvailablePrograms([]);
      setCurrentProgramState(null);
      setLoading(false);
    }, INITIAL_LOAD_TIMEOUT_MS);

    (async () => {
      setLoading(true);
      try {
        const programs = await loadPrograms();
        if (cancelled) return;
        // Read URL once at mount time, not via useSearchParams (which can
        // re-fire this effect and re-cancel an in-flight fetch).
        const fromUrl = new URLSearchParams(window.location.search).get('batch');
        const picked = resolveInitial(programs, fromUrl);
        if (cancelled) return;
        setAvailablePrograms(programs);
        setCurrentProgramState(picked);
        if (picked) {
          try { window.localStorage.setItem(STORAGE_KEY_NEW, picked._id); } catch { /* ignore */ }
          // Strip the query param so the URL is clean. Use history.replaceState
          // so we don't re-trigger this effect via the router.
          if (fromUrl) {
            const url = new URL(window.location.href);
            url.searchParams.delete('batch');
            window.history.replaceState({}, '', url.toString());
          }
        }
      } catch {
        if (cancelled) return;
        setError('Could not load programs. Please refresh.');
        setAvailablePrograms([]);
        setCurrentProgramState(null);
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [loadPrograms, resolveInitial]);

  // ── Public setters ──────────────────────────────────────────────────────
  const setCurrentProgram = useCallback((id: string): boolean => {
    const found = availablePrograms.find((p) => p._id === id);
    if (!found) return false;
    setCurrentProgramState(found);
    try { window.localStorage.setItem(STORAGE_KEY_NEW, id); } catch { /* ignore */ }
    return true;
  }, [availablePrograms]);

  const clearCurrentProgram = useCallback((): void => {
    setCurrentProgramState(null);
    try { window.localStorage.removeItem(STORAGE_KEY_NEW); } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const programs = await loadPrograms();
    setAvailablePrograms(programs);
    // If the current program disappeared, pick a non-empty alternative first,
    // then fall back to the first program (preserves the old behaviour when
    // no program has data).
    setCurrentProgramState((prev) => {
      if (prev && programs.some((p) => p._id === prev._id)) return prev;
      return programs.find((p) => p.faqCount > 0) ?? programs[0] ?? null;
    });
    setLoading(false);
  }, [loadPrograms]);

  // ── Legacy aliases for additive backwards compatibility ─────────────
  // These mirror the new names so every existing `useBatch()` /
  // `currentBatch` / `availableBatches` / `setCurrentBatch` /
  // `clearCurrentBatch` call site keeps working.
  const setCurrentBatch = setCurrentProgram;
  const clearCurrentBatch = clearCurrentProgram;
  const currentBatch = currentProgram;
  const availableBatches = availablePrograms;

  const value = useMemo<ProgramContextValue>(() => ({
    currentProgram,
    availablePrograms,
    loading,
    error,
    setCurrentProgram,
    clearCurrentProgram,
    refresh,
    // Legacy aliases
    currentBatch,
    availableBatches,
    setCurrentBatch,
    clearCurrentBatch,
  }), [
    currentProgram,
    availablePrograms,
    loading,
    error,
    setCurrentProgram,
    clearCurrentProgram,
    refresh,
    currentBatch,
    availableBatches,
    setCurrentBatch,
    clearCurrentBatch,
  ]);

  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
}

/** @deprecated Use `ProgramProvider` instead. The component name is
 *  preserved for the existing tree. */
export function BatchProvider(props: ProgramProviderProps): React.ReactElement {
  return <ProgramProvider {...props} />;
}

// Default export preserved for legacy imports.
export default ProgramProvider;
