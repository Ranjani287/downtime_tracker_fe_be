export default function Badge({ tone, children }) {
  return <span className={`badge${tone ? ` ${tone}` : ''}`}>{children}</span>;
}
