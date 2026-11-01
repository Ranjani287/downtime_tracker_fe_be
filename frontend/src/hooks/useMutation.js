import { useCallback, useState } from 'react';

// Wraps a write action (POST/PATCH/DELETE) with loading + error state.
// `run(...args)` never throws: it resolves to { ok: true, data } or { ok: false, error }.
export function useMutation(action) {
  const [state, setState] = useState({ loading: false, error: null });

  const run = useCallback(async (...args) => {
    setState({ loading: true, error: null });
    try {
      const data = await action(...args);
      setState({ loading: false, error: null });
      return { ok: true, data };
    } catch (error) {
      setState({ loading: false, error });
      return { ok: false, error };
    }
  }, [action]);

  const reset = useCallback(() => setState({ loading: false, error: null }), []);
  return { ...state, run, reset };
}
