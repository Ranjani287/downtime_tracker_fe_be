const pad = (n) => String(n).padStart(2, '0');

export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export function fmtMinutes(minutes) {
  if (minutes == null) return '—';
  const m = Math.round(Number(minutes));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// Date -> value for <input type="datetime-local"> (local time, minute precision)
export const toLocalInput = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// <input type="datetime-local"> value -> ISO string (undefined when empty)
export const localInputToIso = (value) => (value ? new Date(value).toISOString() : undefined);

// Date -> "YYYY-MM-DD" in local time (value for <input type="date">)
export const toDateInput = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const daysAgo = (n) => toDateInput(new Date(Date.now() - n * 864e5));

// A picked calendar day covers 00:00:00.000 to 23:59:59.999 local time.
export const dayStartIso = (day) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
export const dayEndIso = (day) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);
