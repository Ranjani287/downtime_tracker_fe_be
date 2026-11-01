import { useCallback, useEffect, useRef, useState } from 'react';

// Runs an async function on mount and whenever `deps` change; exposes loading / error / data and a reload().
// Keeps the previous data visible while reloading (no flicker when paginating or filtering) and ignores
// responses that arrive after a newer request was started.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then((data) => { if (!stale) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (!stale) setState((s) => ({ ...s, loading: false, error })); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
