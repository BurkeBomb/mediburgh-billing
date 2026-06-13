"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase";

export default function AuthenticationGatePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  
  // Registration Profile Metadata States
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [practiceNumber, setPracticeNumber] = useState("");
  const [specialty, setSpecialty] = useState("General Anesthesia");

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();

  // Route authenticated session configurations instantly on mount
  useEffect(() => {
    async function checkExistingSession() {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        handleRoleDirection(authData.user.id);
      }
    }
    checkExistingSession();
  }, []);

  const handleRoleDirection = async (userId: string) => {
    try {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profileErr || !profile) throw new Error("Practice configuration profile row missing.");

      if (profile.role === "practitioner") {
        window.location.href = "/dashboard";
      } else {
        window.location.href = "/office";
      }
    } catch (err: any) {
      setError("Authorization routing error. Profile row sync failure.");
      await supabase.auth.signOut();
    }
  };

  const handleAuthenticationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please input your authorization credentials completely.");
      return;
    }

    setProcessing(true);
    setError(null);
    setMessage(null);

    try {
      if (authMode === "login") {
        // ── EXECUTE SECURE PORTAL LOGIN ──
        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (loginErr) throw loginErr;
        if (loginData?.user) {
          handleRoleDirection(loginData.user.id);
        }
      } else {
        // ── EXECUTE SECURE REGISTRATION FLOW ──
        if (!firstName.trim() || !lastName.trim()) {
          throw new Error("First name and surname fields are required for profile generation.");
        }

        const { data: registerData, error: registerErr } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
        });

        if (registerErr) throw registerErr;

        if (registerData?.user) {
          // Write explicit structural data parameters to profiles relation table
          const { error: profileCreateErr } = await supabase
            .from("profiles")
            .insert([
              {
                id: registerData.user.id,
                name: firstName.trim(),
                surname: lastName.trim(),
                practice_number: practiceNumber.trim() || null,
                specialty: specialty,
                email: email.trim().toLowerCase(),
                role: "practitioner", // Default signups to clinical theater interface tracking
              },
            ]);

          if (profileCreateErr) throw profileCreateErr;
          
          setMessage("Secure practice registration complete. Accessing control panel...");
          handleRoleDirection(registerData.user.id);
        }
      }
    } catch (err: any) {
      console.error("Auth transaction anomaly logged:", err);
      setError(err.message || "Credential verification pipeline handshake failed.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center bg-[#0b0f14] px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      {/* Visual Aesthetic Layers */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(20,184,166,0.12),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0.1),transparent_40%,rgba(11,15,20,1))]" />

      <div className="relative w-full max-w-md space-y-6 z-10">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-teal-400">Mediburgh ClinTech</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
            {authMode === "login" ? "Access Secure Terminal" : "Register Practice Token"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Continuous real-time clinical submission infrastructure
          </p>
        </div>

        <div className="rounded-sm border border-slate-800/90 bg-slate-900/40 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-sm">
          {error && (
            <div className="mb-4 rounded-sm border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          {message && (
            <div className="mb-4 rounded-sm border border-teal-500/30 bg-teal-950/20 px-3 py-2 text-xs text-teal-200">
              {message}
            </div>
          )}

          <form onSubmit={handleAuthenticationSubmit} className="space-y-4">
            {authMode === "register" && (
              <div className="grid grid-cols-2 gap-3 animation-fadeIn">
                <div>
                  <label htmlFor="first-name-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">First Name</label>
                  <input id="first-name-input" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70" placeholder="Xander" required />
                </div>
                <div>
                  <label htmlFor="last-name-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Surname</label>
                  <input id="last-name-input" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70" placeholder="Burke" required />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Email Address</label>
              <input id="auth-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70" placeholder="xander@mediburgh.co.za" required />
            </div>

            <div>
              <label htmlFor="auth-password-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Password</label>
              <input id="auth-password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70" placeholder="••••••••••••" required />
            </div>

            {authMode === "register" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-800/60 pt-3">
                <div>
                  <label htmlFor="practice-num-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Practice Number</label>
                  <input id="practice-num-input" type="text" value={practiceNumber} onChange={(e) => setPracticeNumber(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70" placeholder="e.g. 0123456" />
                </div>
                <div>
                  <label htmlFor="specialty-select" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Clinical Field</label>
                  <select id="specialty-select" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500/70">
                    <option value="General Anesthesia">Anesthesiology</option>
                    <option value="Orthopedic Surgery">Orthopedic Surgery</option>
                    <option value="Clinical Technology">Clinical Technology</option>
                    <option value="General Practice">General Practice</option>
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={processing}
              className="w-full rounded-sm bg-teal-600 border border-teal-500/40 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-teal-500 disabled:opacity-40 mt-2"
            >
              {processing ? "Authorizing Trace Matrix..." : authMode === "login" ? "Verify Security Credentials" : "Initialize System Account"}
            </button>
          </form>

          <div className="mt-4 border-t border-slate-800/80 pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setAuthMode(prev => prev === "login" ? "register" : "login");
                setError(null);
                setMessage(null);
              }}
              className="text-xs text-slate-400 hover:text-teal-400 transition underline decoration-slate-700 underline-offset-4"
            >
              {authMode === "login" ? "Need portal credentials? Register practice here" : "Return to secure access connection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}