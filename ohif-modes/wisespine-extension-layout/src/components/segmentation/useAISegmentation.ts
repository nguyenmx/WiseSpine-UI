import { useState, useRef, useCallback, useEffect } from 'react';

const SEG_SERVICE_BASE = '/segmentation';
const POLL_INTERVAL_MS = 5000;

export type SegStatus =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'loading'
  | 'done'
  | 'error';

export interface SegState {
  status: SegStatus;
  message: string;
  stage: string;          // fetch | segment | convert | upload | done
  elapsedSeconds: number; // seconds since job started (server-reported + client ticker)
  segments: string[];
  error: string | null;
}

export function useAISegmentation({ servicesManager, extensionManager }: any) {
  const [state, setState] = useState<SegState>({
    status: 'idle',
    message: '',
    stage: '',
    elapsedSeconds: 0,
    segments: [],
    error: null,
  });

  const pollTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobStartRef   = useRef<number>(0);   // client-side start timestamp (ms)

  const stopPolling = () => {
    if (pollTimerRef.current)  { clearInterval(pollTimerRef.current);  pollTimerRef.current  = null; }
    if (tickTimerRef.current)  { clearInterval(tickTimerRef.current);  tickTimerRef.current  = null; }
  };

  // Clean up timers on unmount
  useEffect(() => () => stopPolling(), []);

  const runSegmentation = useCallback(async () => {
    const {
      viewportGridService,
      displaySetService,
      uiNotificationService,
    } = servicesManager.services;

    // ── 1. Get active study/series UIDs ──────────────────────────────────────
    const { activeViewportId, viewports } = viewportGridService.getState();
    const activeViewport = viewports.get(activeViewportId);
    const displaySetUID = activeViewport?.displaySetInstanceUIDs?.[0];

    if (!displaySetUID) {
      setState(s => ({ ...s, status: 'error', error: 'No active viewport. Open a CT series first.' }));
      return;
    }

    const displaySet = displaySetService.getDisplaySetByUID(displaySetUID);
    if (!displaySet) {
      setState(s => ({ ...s, status: 'error', error: 'Could not find display set metadata.' }));
      return;
    }

    const { StudyInstanceUID, SeriesInstanceUID } = displaySet;
    if (!StudyInstanceUID || !SeriesInstanceUID) {
      setState(s => ({ ...s, status: 'error', error: 'Missing StudyInstanceUID or SeriesInstanceUID.' }));
      return;
    }

    // ── 2. Submit job ─────────────────────────────────────────────────────────
    setState({ status: 'submitting', message: 'Submitting segmentation job…', stage: 'queued', elapsedSeconds: 0, segments: [], error: null });

    let jobId: string;
    try {
      const res = await fetch(`${SEG_SERVICE_BASE}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyInstanceUID: StudyInstanceUID, seriesInstanceUID: SeriesInstanceUID }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      jobId = data.job_id;
    } catch (err: any) {
      setState({ status: 'error', message: '', stage: '', elapsedSeconds: 0, segments: [], error: `Failed to start job: ${err.message}` });
      return;
    }

    jobStartRef.current = Date.now();
    setState(s => ({ ...s, status: 'running', message: 'TotalSegmentator running on CPU…', stage: 'fetch' }));

    // ── 3a. Client-side elapsed-time ticker (updates every second) ────────────
    tickTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - jobStartRef.current) / 1000);
      setState(s => (s.status === 'running' ? { ...s, elapsedSeconds: elapsed } : s));
    }, 1000);

    // ── 3b. Poll server for status changes (every 5s) ─────────────────────────
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${SEG_SERVICE_BASE}/segment/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.status === 'running' || job.status === 'queued') {
          setState(s => ({
            ...s,
            message: job.message || s.message,
            stage: job.stage || s.stage,
            // Use server elapsed as floor so after a restart the number is still sensible
            elapsedSeconds: Math.max(job.elapsed_seconds ?? 0, Math.floor((Date.now() - jobStartRef.current) / 1000)),
          }));
          return;
        }

        stopPolling();

        if (job.status === 'error') {
          setState({ status: 'error', message: '', stage: '', elapsedSeconds: job.elapsed_seconds ?? 0, segments: [], error: job.message || 'Segmentation failed.' });
          return;
        }

        if (job.status === 'completed') {
          // ── 4. Reload study metadata so OHIF picks up the new DICOM SEG ──
          setState(s => ({ ...s, status: 'loading', message: 'Loading segmentation into viewer…', elapsedSeconds: job.elapsed_seconds ?? s.elapsedSeconds }));
          try {
            const [dataSource] = extensionManager.getActiveDataSource();
            await dataSource.retrieve.series.metadata({ StudyInstanceUID });
          } catch {
            // Non-fatal — user can manually refresh
          }

          setState({
            status: 'done',
            message: 'Segmentation complete! Check the Segmentation panel.',
            stage: 'done',
            elapsedSeconds: job.elapsed_seconds ?? 0,
            segments: job.segments ?? [],
            error: null,
          });

          uiNotificationService?.show?.({
            title: 'AI Segmentation',
            message: `Segmentation ready — ${(job.segments ?? []).length} structures found.`,
            type: 'success',
            duration: 5000,
          });
        }
      } catch {
        // Silently retry on network glitch
      }
    }, POLL_INTERVAL_MS);
  }, [servicesManager, extensionManager]);

  const reset = useCallback(() => {
    stopPolling();
    setState({ status: 'idle', message: '', stage: '', elapsedSeconds: 0, segments: [], error: null });
  }, []);

  return { state, runSegmentation, reset };
}
