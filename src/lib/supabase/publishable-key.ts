/** Öffentlicher Supabase-Client-Key: klassisch `anon` oder neuer Publishable-Key. */
export function getSupabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!key) {
    throw new Error(
      "Setze NEXT_PUBLIC_SUPABASE_ANON_KEY oder NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    );
  }
  return key;
}
