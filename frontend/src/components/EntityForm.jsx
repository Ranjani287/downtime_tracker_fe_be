import { useState } from 'react';
import { Field, Select } from './Field.jsx';
import { ErrorMessage } from './DataState.jsx';

/**
 * Generic form driven by a field list:
 *   { name, label, type?: 'text'|'email'|'password'|'select', options?, required?, minLength?, hint? }
 * onSubmit(values) must resolve to { ok } (e.g. the result of useMutation().run).
 */
export default function EntityForm({ fields, initial = {}, submitLabel, onSubmit, loading, error, resetOnSuccess = false }) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, initial[f.name] != null ? String(initial[f.name]) : '']));
  const [values, setValues] = useState(blank);
  const set = (name) => (e) => setValues({ ...values, [name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const result = await onSubmit(values);
    if (result?.ok && resetOnSuccess) setValues(blank());
  };

  return (
    <form className="form-row" onSubmit={submit}>
      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint}>
          {f.type === 'select' ? (
            <Select required={f.required} value={values[f.name]} options={f.options} placeholder="Select…" onChange={set(f.name)} />
          ) : (
            <input
              type={f.type || 'text'} required={f.required} minLength={f.minLength} maxLength={f.maxLength ?? 100}
              value={values[f.name]} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={set(f.name)}
            />
          )}
        </Field>
      ))}
      <button className="btn" disabled={loading}>{loading ? 'Saving…' : submitLabel}</button>
      <ErrorMessage error={error} />
    </form>
  );
}
