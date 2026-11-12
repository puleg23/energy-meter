import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { Btn, Card, Field, inputCls } from './ui';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch { setErr('Sign-in failed. Check the email and password.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="pt-16">
      <h1 className="text-xl font-bold mb-3">Smart Energy Meter</h1>
      <Card title="Sign in">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Email"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {err && <p className="text-sm text-[#b3261e]" role="alert">{err}</p>}
          <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Btn>
        </form>
      </Card>
    </div>
  );
};
