import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorMessage } from '../components/DataState.jsx';
import { Field } from '../components/Field.jsx';
import { useMutation } from '../hooks/useMutation.js';

const DEMO_PASSWORD = 'Password123!';
const DEMO = [
  ['superadmin@platform.com', 'Super admin'],
  ['admin@acme.com', 'Acme admin'],
  ['operator@acme.com', 'Acme operator'],
  ['admin@globex.com', 'Globex admin'],
  ['operator@globex.com', 'Globex operator'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useMutation(() => login(email, password));

  const submit = (e) => { e.preventDefault(); signIn.run(); };

  return (
    <div className="login-wrap">
      <form className="card login stack" onSubmit={submit}>
        <h1>Downtime Tracker</h1>
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <ErrorMessage error={signIn.error} />
        <button className="btn" disabled={signIn.loading}>{signIn.loading ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Demo accounts (password <code>{DEMO_PASSWORD}</code>):</p>
        <div className="chips">
          {DEMO.map(([demoEmail, label]) => (
            <button type="button" key={demoEmail} className="chip" title={demoEmail}
              onClick={() => { setEmail(demoEmail); setPassword(DEMO_PASSWORD); }}>{label}</button>
          ))}
        </div>
      </form>
    </div>
  );
}
