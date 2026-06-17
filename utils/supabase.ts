import { createBrowserClient } from "@supabase/ssr";

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (clientInstance) return clientInstance;

  const url = "https://sibqhgpmuazshlexzspa.supabase.co";
  
  // CRITICAL: Replace the placeholder string below with your literal 'eyJ...' public anon token 
  // found in your Supabase Dashboard under Project Settings -> API -> anon public key.
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYnFoZ3BtdWF6c2hsZXh6c3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTAyNzgsImV4cCI6MjA5NjkyNjI3OH0.uvE-_tFxOhetpqPdf7If2UJI5fwJp5ykpG3uFYaqFpc";

  clientInstance = createBrowserClient(url, anonKey);
  return clientInstance;
}