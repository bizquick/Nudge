import { useState } from 'react';
import { Send } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import nudgeLogo from '../../imports/image-3.png';
import { supabase } from '../utils/supabase/client';

interface AuthScreenProps {
  onSignedIn: (displayName: string) => void;
}

export function AuthScreen({ onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = displayName.trim();
    if (!name) {
      setError('Pick a display name');
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

    const userId = data.user?.id;
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

  if (checkEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="w-full max-w-sm text-center">
          <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-20 w-auto object-contain mx-auto mb-6" />
          <p className="text-gray-700">
            Check your email for a confirmation link, then come back here and log in.
          </p>
          <button
            onClick={() => { setCheckEmail(false); setMode('login'); }}
            className="mt-6 text-indigo-600 underline text-sm"
          >
            Back to log in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm text-center">
        <ImageWithFallback src={nudgeLogo} alt="Nudge" className="h-20 w-auto object-contain mx-auto mb-2" />
        <p className="text-gray-600 italic mb-8">
          Because "I'll check it out later" is a lie.
        </p>

        <div className="flex mb-6 rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => { setMode('signup'); setError(null); }}
            className={`flex-1 py-2 text-sm transition-colors ${mode === 'signup' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}
          >
            Sign up
          </button>
          <button
            onClick={() => { setMode('login'); setError(null); }}
            className={`flex-1 py-2 text-sm transition-colors ${mode === 'login' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}
          >
            Log in
          </button>
        </div>

        <form onSubmit={mode === 'signup' ? handleSignUp : handleLogIn} className="space-y-3 text-left">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Display name</label>
              <input
                type="text"
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="What friends will see"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-6">
          Real accounts now — your display name is yours alone, no one else can send as you.
        </p>
      </div>
    </div>
  );
}
