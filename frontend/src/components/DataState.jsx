// Shared loading / error / empty handling so every screen renders the three states the same way.
export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  const details = error.details?.length ? `: ${error.details.map((d) => `${d.path} ${d.message}`.trim()).join('; ')}` : '';
  return (
    <div className="error" role="alert">
      {error.message}{details}
      {onRetry && <button type="button" className="btn small secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function EmptyState({ children = 'Nothing to show yet.' }) {
  return <div className="state muted">{children}</div>;
}

/**
 * <DataState loading={..} error={..} isEmpty={..} emptyText=".." onRetry={..}>…content…</DataState>
 * Pass `loading` only for the first load (no data yet); background reloads keep showing the old content.
 */
export function DataState({ loading, error, isEmpty, emptyText, onRetry, children }) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={onRetry} />;
  if (isEmpty) return <EmptyState>{emptyText}</EmptyState>;
  return children;
}
