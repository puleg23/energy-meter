import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { Btn, Card, Field, inputCls } from './ui';
import { LogoMark } from './Logo';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (creating) await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(
        code === 'auth/email-already-in-use' ? 'That email already has an account. Sign in instead.'
        : code === 'auth/weak-password' ? 'Choose a password with at least 6 characters.'
        : code === 'auth/too-many-requests' || code === 'auth/network-request-failed' ? 'Too many attempts or no connection. Wait a bit and try again.'
        : code === 'auth/operation-not-allowed' ? 'Email/Password sign-in is not turned on in Firebase yet.'
        : creating ? 'Could not create the account. Check the email and password.'
        : 'Sign-in failed. Check the email and password.');
    }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm lg:max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <LogoMark size={84} className="shadow-sm rounded-[20px]" />
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">EHC <span className="text-[#1a5fb4]">Meter</span></h1>
          <p className="text-sm text-[#555555] mt-1">Live energy, cost and protection</p>
        </div>
        <Card title={creating ? 'Create account' : 'Sign in'} className="lg:shadow-sm">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Email"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password"><input className={inputCls} type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {err && <p className="text-sm text-[#b3261e]" role="alert">{err}</p>}
            <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Please wait...' : creating ? 'Create account' : 'Sign in'}</Btn>
            <button type="button" className="text-sm underline min-h-11" onClick={() => { setCreating(!creating); setErr(''); }}>{creating ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
          </form>
        </Card>
      </div>
    </div>
  );
};
