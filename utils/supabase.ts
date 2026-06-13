import { createBrowserClient } from "@supabase/ssr";

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (clientInstance) return clientInstance;

  // Paste your literal database strings from your Supabase dashboard inside these quotes:
  const url = "https://sibqhgpmuazshlexzspa.supabase.co";
  const anonKey = "sb_publishable_tXCkAi6O3Rmy3qpwrcXUdg_KlU8Hrrq";

  clientInstance = createBrowserClient(url, anonKey);
  return clientInstance;
}