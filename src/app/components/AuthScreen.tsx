import { useState } from 'react';
import { Send } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import nudgeLogo from '../../imports/image-3.png';
import { supabase } from '../utils/supabase/client';

interface AuthScreenProps {
  onSignedIn: (displayName: string) => void;
}

type Mode = 'signup' | 'login' | 'forgot' | 'reset';

export function AuthScreen({ onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('signup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
    setCode('');
  };

  // Shared rule for anywhere a new password is chosen
  const passwordProblem = () =>
    password.length < 6 ? 'Use at least 6 characters for your password.'
      : password !== confirmPassword ? "Those passwords don't match — retype them."
      : null;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = displayName.trim();
    if (!name) {
      setError('Pick a display name');
      return;
    }
    const problem = passwordProblem();
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);

    // Check the name isn't already taken before creating the account,
    // so we can give a clear error instead of a raw database one.
    const { data: existing } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('display_name', name)
      .maybeSingle();

    if (existing) {
      setError('That name is already taken — try another.');
      setLoading(false);
      return;
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Stored with the login so the password-reset email can remind them of their name
      options: { data: { display_name: name } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    const userId = signUpData.user?.id;
    if (!userId) {
      // No session yet — email confirmation is required before we can write
      // the profile row (RLS needs an authenticated session).
      setCheckEmail(true);
      setLoading(false);
      return;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: userId, display_name: name });

    if (profileError) {
      setError(
        profileError.message.includes('duplicate')
          ? 'That name is already taken — try another.'
          : profileError.message
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    onSignedIn(name);
  };

  const finishLogin = async (userId: string | undefined) => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      setError("Couldn't find your profile. Try signing up instead.");
      setLoading(false);
      return;
    }

    setLoading(false);
    onSignedIn(profile.display_name);
  };

  const handleLogIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }
    await finishLogin(data.user?.id);
  };

  // Forgot password, step 1: email them a 6-digit code (the email also reminds them of their display name)
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Enter the email you signed up with.');
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    switchMode('reset');
    setNotice(`If ${email.trim()} has a Nudge account, we just emailed it a 6-digit code.`);
  };

  // Forgot password, step 2: the code proves it's them, then save the new password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    });
    if (verifyError) {
      setError("That code didn't work — check it, or send a new one.");
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    await finishLogin(data.user?.id);
  };

  const inputClass = 'w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300';
  const labelClass = 'block text-xs text-stone-500 mb-1';

  // The logo image has a lot of empty space built in; the negative margins trim it
  const logo = <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-[230px] w-auto object-contain mx-auto -my-[72px]" />;

  // Fits one iPhone screen: starts near the top (below the notch) instead of floating in the middle
  const shell = (children: React.ReactNode) => (
    <div
      className="h-full overflow-y-auto bg-white px-5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
    >
      <div className="w-full max-w-sm mx-auto text-center">{children}</div>
    </div>
  );

  if (checkEmail) {
    return shell(
      <>
        {logo}
        <p className="text-stone-700 mt-2">
          Check your email for a confirmation link, then come back here and log in.
        </p>
        <button
          onClick={() => { setCheckEmail(false); switchMode('login'); }}
          className="mt-6 text-orange-600 underline text-sm"
        >
          Back to log in
        </button>
      </>
    );
  }

  const isRecovery = mode === 'forgot' || mode === 'reset';
  const onSubmit = mode === 'signup' ? handleSignUp : mode === 'login' ? handleLogIn : mode === 'forgot' ? handleSendCode : handleResetPassword;
  const submitLabel = mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : mode === 'forgot' ? 'Email me a code' : 'Save new password';

  return shell(
    <>
      {logo}
      <p className="text-stone-600 italic text-sm mb-4">
        Because "I'll check it out later" is a lie.
      </p>

      {isRecovery ? (
        <p className="mb-3 text-sm text-stone-700 text-left">
          {mode === 'forgot'
            ? "Forgot your password or your Nudge name? Enter your email and we'll send a code to set a new password. The email also tells you your name."
            : 'Enter the code from the email, then choose a new password.'}
        </p>
      ) : (
        <div className="flex mb-4 rounded-lg border border-stone-200 overflow-hidden">
          <button
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2 text-sm transition-colors ${mode === 'signup' ? 'bg-orange-600 text-white' : 'bg-white text-stone-600'}`}
          >
            Sign up
          </button>
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 text-sm transition-colors ${mode === 'login' ? 'bg-orange-600 text-white' : 'bg-white text-stone-600'}`}
          >
            Log in
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-2.5 text-left">
        {mode === 'signup' && (
          <div>
            <label htmlFor="auth-name" className={labelClass}>Display name</label>
            <input
              id="auth-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What friends will see"
              autoCapitalize="words"
              autoCorrect="off"
              className={inputClass}
            />
          </div>
        )}

        {mode !== 'reset' && (
          <div>
            <label htmlFor="auth-email" className={labelClass}>Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              className={inputClass}
            />
          </div>
        )}

        {mode === 'reset' && (
          <div>
            <label htmlFor="auth-code" className={labelClass}>6-digit code from the email</label>
            <input
              id="auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className={`${inputClass} tracking-widest`}
            />
          </div>
        )}

        {mode !== 'forgot' && (
          <div>
            <label htmlFor="auth-password" className={labelClass}>{mode === 'reset' ? 'New password' : 'Password'}</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? 'Your password' : 'At least 6 characters'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={inputClass}
            />
          </div>
        )}

        {(mode === 'signup' || mode === 'reset') && (
          <div>
            <label htmlFor="auth-confirm" className={labelClass}>Retype password</label>
            <input
              id="auth-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Same password again"
              autoComplete="new-password"
              className={`${inputClass} ${confirmPassword && confirmPassword !== password ? 'border-red-400 focus:ring-red-200' : ''}`}
            />
          </div>
        )}

        {notice && <p className="text-sm text-stone-600">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          {loading ? 'Please wait…' : submitLabel}
        </button>
      </form>

      <div className="mt-3 flex flex-col items-center gap-2 text-sm">
        {mode === 'login' && (
          <button onClick={() => switchMode('forgot')} className="text-orange-600">
            Forgot your password or name?
          </button>
        )}
        {mode === 'reset' && (
          <button onClick={() => switchMode('forgot')} className="text-orange-600">
            Send a new code
          </button>
        )}
        {isRecovery && (
          <button onClick={() => switchMode('login')} className="text-stone-500">
            Back to log in
          </button>
        )}
      </div>
    </>
  );
}
