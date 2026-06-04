import { useState, useCallback, useRef } from 'react';
import { submitProject, subscribeToLogs } from '../lib/api.js';

/**
 * @typedef {'idle'|'queued'|'building'|'success'|'failed'} Phase
 * @typedef {{ phase: Phase, projectId: string|null, logs: string[], url: string|null, error: string|null }} BuildState
 */

const INITIAL = { phase: 'idle', projectId: null, logs: [], url: null, error: null };

export function useBuild() {
  const [state, setState] = useState(INITIAL);
  const unsubRef = useRef(null);

  const deploy = useCallback(async (gitUrl) => {
    // Reset
    unsubRef.current?.();
    setState({ ...INITIAL, phase: 'queued', logs: ['Submitting build job…'] });

    try {
      const { projectId, url } = await submitProject(gitUrl);

      setState((s) => ({
        ...s,
        projectId,
        url,
        logs: [...s.logs, `Project ID: ${projectId}`, 'Waiting for build worker…'],
      }));

      const unsub = subscribeToLogs(projectId, {
        onLog: (line) =>
          setState((s) => ({ ...s, phase: 'building', logs: [...s.logs, line] })),

        onStatus: (status) =>
          setState((s) => ({ ...s, phase: status })),

        onError: () =>
          setState((s) =>
            s.phase !== 'success' && s.phase !== 'failed'
              ? { ...s, phase: 'failed', error: 'Lost connection to build server.' }
              : s,
          ),
      });

      unsubRef.current = unsub;
    } catch (err) {
      setState((s) => ({ ...s, phase: 'failed', error: err.message }));
    }
  }, []);

  const reset = useCallback(() => {
    unsubRef.current?.();
    setState(INITIAL);
  }, []);

  return { ...state, deploy, reset };
}
