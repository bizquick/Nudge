import { supabase } from './supabase/client';

// Find people on Addly by username (any part of it) or by their exact email address.
// The server only ever returns usernames — never anyone's email — and an email has to
// match exactly, so nobody can fish for addresses.
export async function searchPeople(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('search_people', { p_query: q });
  if (!error && Array.isArray(data)) {
    return data.map((row: { display_name?: string } | string) => (typeof row === 'string' ? row : row.display_name ?? '')).filter(Boolean);
  }
  // The search isn't set up in the database yet: fall back to an exact username
  if (q.includes('@')) return [];
  const exact = await supabase.rpc('find_profile', { p_name: q });
  return typeof exact.data === 'string' ? [exact.data] : [];
}
