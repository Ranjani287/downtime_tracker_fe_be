// Label + control wrapper, and a <select> that accepts flat or grouped options.
export function Field({ label, hint, className = '', children }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** options: [{ value, label, group?, disabled? }] – options sharing a `group` are rendered inside an <optgroup>. */
export function Select({ options, placeholder, ...props }) {
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean))];
  const render = (o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>;
  return (
    <select {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.filter((o) => !o.group).map(render)}
      {groups.map((g) => (
        <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map(render)}</optgroup>
      ))}
    </select>
  );
}
