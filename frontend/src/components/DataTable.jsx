/** columns: [{ key, header, render?: (row) => node, className? }] */
export default function DataTable({ columns, rows, rowKey = 'id', busy = false }) {
  return (
    <div className={`card table-wrap${busy ? ' busy' : ''}`}>
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
