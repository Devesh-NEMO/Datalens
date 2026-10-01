'use client';

import { useCallback, useRef, useState } from 'react';
import { DOWNLOAD_COPY } from '@/lib/constants';

export type DownloadStatus = 'idle' | 'preparing' | 'ready' | 'error';

export interface DownloadFailure {
  title: string;
  hint: string;
}

/**
 * Tracks one in-flight download: busy state, failure state, and the text that
 * should be announced to screen readers.
 *
 * `liveMessage` is cleared between runs on purpose. Screen readers ignore a live
 * region whose text does not change, so downloading twice in a row would
 * otherwise announce nothing the second time.
 */
export function useDownload() {
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [failure, setFailure] = useState<DownloadFailure | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  // Guards against a slow export landing after the user moved on or unmounted.
  const runIdRef = useRef(0);

  const run = useCallback(async (task: () => void | Promise<void>) => {
    const runId = ++runIdRef.current;
    setStatus('preparing');
    setFailure(null);
    setLiveMessage(DOWNLOAD_COPY.preparing);

    try {
      await task();
      if (runId !== runIdRef.current) return;
      setStatus('ready');
      setLiveMessage(DOWNLOAD_COPY.ready);
    } catch {
      // The user gets the friendly message and hint from DOWNLOAD_COPY. The raw
      // error is deliberately not surfaced: these pipelines touch canvas and
      // blob URLs, whose messages can leak paths and internal state.
      if (runId !== runIdRef.current) return;
      setStatus('error');
      setFailure({ title: DOWNLOAD_COPY.errorTitle, hint: DOWNLOAD_COPY.errorHint });
      setLiveMessage(DOWNLOAD_COPY.errorTitle);
    }
  }, []);

  const dismiss = useCallback(() => {
    runIdRef.current += 1;
    setStatus('idle');
    setFailure(null);
    setLiveMessage('');
  }, []);

  return {
    status,
    isPreparing: status === 'preparing',
    failure,
    liveMessage,
    run,
    dismiss,
  };
}