"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase";

interface NavigationShellProps {
  children: React.ReactNode;
  currentPath: "dashboard" | "office";
}

export default function NavigationShell({ children, currentPath }: NavigationShellProps) {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function readActiveSession() {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        setUserEmail(authData.user.email ?? null);
        
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single();
          
        if (profile) {
          setUserRole(profile.role);
        }
      }
    }
    readActiveSession();
  }, [supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen bg-[#0b0f14]">
      {/* ── MASTER TACTICAL SIDEBAR NAVIGATION PANEL ── */}
      <aside className="fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-800/80 bg-slate-950/60 backdrop-blur-md hidden md:flex flex-col justify-between p-4">
        <div className="space-y-6">
          {/* Platform Identity */}
          <div className="px-2 py-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-teal-400">Mediburgh</p>
            <p className="text-xs text-slate-500 mt-0.5 font-medium uppercase tracking-wider">ClinTech Bureau v1.0</p>
          </div>

          {/* Navigation Route Matrices */}
          <nav className="space-y-1">
            <a
              href="/dashboard"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition ${
                currentPath === "dashboard"
                  ? "bg-slate-900 border border-slate-800 text-teal-400"
                  : "text-slate-400 hover:text-white hover:bg-slate-900/40"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${currentPath === "dashboard" ? "bg-teal-400" : "bg-slate-600"}`} />
              Theatre Capture
            </a>
            
            {(userRole === "admin" || userRole === "consultant" || userRole === "office_user" || userRole === "worker") && (
              <a
                href="/office"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition ${
                  currentPath === "office"
                    ? "bg-slate-900 border border-slate-800 text-teal-400"
                    : "text-slate-400 hover:text-white hover:bg-slate-900/40"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${currentPath === "office" ? "bg-teal-400" : "bg-slate-600"}`} />
                Bureau Workspace
              </a>
            )}
          </nav>
        </div>

        {/* Foot Profile Metadata & Secure Disconnect */}
        <div className="border-t border-slate-800/80 pt-4 space-y-3">
          <div className="px-2 truncate">
            <p className="text-[10px] uppercase font-medium tracking-wider text-slate-500">Active Profile</p>
            <p className="text-xs font-mono text-slate-300 truncate mt-0.5">{userEmail ?? "Loading..."}</p>
            <span className="inline-block px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-teal-400 border border-teal-500/20 bg-teal-950/20 rounded-sm mt-1">
              {userRole ?? "User"}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-red-400 rounded-sm hover:bg-red-950/20 transition border border-transparent hover:border-red-900/30"
          >
            Sign Out Session
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT LAYER CANVAS MOUNT ── */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
