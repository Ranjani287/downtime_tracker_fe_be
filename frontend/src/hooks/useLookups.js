import { api } from '../api.js';
import { useAsync } from './useAsync.js';

// Lines, machines and reasons: the reference data every form and filter needs.
export function useLookups() {
  return useAsync(async () => {
    const [lines, machines, reasons] = await Promise.all([api('/lines'), api('/machines'), api('/reasons')]);
    return { lines: lines.data, machines: machines.data, reasons: reasons.data };
  }, []);
}
