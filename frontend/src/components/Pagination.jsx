export default function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row pagination">
      <button type="button" className="btn secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="muted small">Page {page} of {pages} · {total} {total === 1 ? 'event' : 'events'}</span>
      <button type="button" className="btn secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
