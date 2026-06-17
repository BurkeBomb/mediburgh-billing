"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/utils/supabase";

export default function AuthenticationGatePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [practiceNumber, setPracticeNumber] = useState("");
  const [specialty, setSpecialty] = useState("General Anesthesia");

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();
  const hasCheckedSession = useRef(false);

  useEffect(() => {
    if (hasCheckedSession.current) return;
    hasCheckedSession.current = true;

    async function checkExistingSession() {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();

        if (authErr || !authData?.user) {
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single();

        if (!profile) return;

        if (profile.role === "practitioner") {
          window.location.replace("/dashboard");
        } else {
          window.location.replace("/office");
        }
      } catch (err) {
        console.error("Session check error:", err);
      }
    }

    checkExistingSession();
  }, []);

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
        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (loginErr) throw loginErr;
        if (!loginData?.user) throw new Error("Invalid credential payload.");

        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", loginData.user.id)
          .single();

        if (profileErr || !profile) {
          setError("Your authorization is valid, but no matching practice profile rows were discovered.");
          return;
        }

        if (profile.role === "practitioner") {
          window.location.replace("/dashboard");
        } else {
          window.location.replace("/office");
        }
      } else {
        if (!firstName.trim() || !lastName.trim()) {
          throw new Error("First name and surname fields are required.");
        }

        const { data: registerData, error: registerErr } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
          options: {
            data: {
              name: firstName.trim(),
              surname: lastName.trim(),
              practice_number: practiceNumber.trim() || null,
              specialty: specialty
            }
          }
        });

        if (registerErr) throw registerErr;
        if (!registerData?.user) throw new Error("Could not initialize your user tracking security account.");

        if (registerData.session === null) {
          setMessage("Practice profile token initialized! Please check your email inbox to verify your connection and access the portal.");
          setFormClear();
          return;
        }

        setMessage("Account created and verified. Synchronizing control portal environment...");
        window.location.replace("/dashboard");
      }
    } catch (err: any) {
      console.error("Authentication Gate Exception:", err);
      setError(err.message || "Credential pipeline handshake error.");
    } finally {
      setProcessing(false);
    }
  };

  const setFormClear = () => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setPracticeNumber("");
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center bg-[#0b0f14] px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(20,184,166,0.12),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0.1),transparent_40%,rgba(11,15,20,1))]" />

      <div className="relative w-full max-w-md space-y-6 z-10">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-teal-400">Mediburgh ClinTech</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
            {authMode === "login" ? "Access Secure Terminal" : "Register Practice Token"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">Continuous real-time clinical submission infrastructure</p>
        </div>

        <div className="rounded-sm border border-slate-800/90 bg-slate-900/40 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-sm">
          {error && <div className="mb-4 rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}
          {message && <div className="mb-4 rounded-sm border border-teal-500/30 bg-teal-950/20 px-3 py-2 text-xs text-teal-200">{message}</div>}

          <form onSubmit={handleAuthenticationSubmit} className="space-y-4">
            {authMode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="first-name-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">First Name</label>
                  <input id="first-name-input" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70" placeholder="Xander" required />
                </div>
                <div>
                  <label htmlFor="last-name-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Surname</label>
                  <input id="last-name-input" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70" placeholder="Burke" required />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Email Address</label>
              <input id="auth-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70" placeholder="xander@mediburgh.co.za" required />
            </div>

            <div>
              <label htmlFor="auth-password-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Password</label>
              <input id="auth-password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70" placeholder="••••••••••••" required />
            </div>

            {authMode === "register" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-800/60 pt-3">
                <div>
                  <label htmlFor="practice-num-input" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Practice Number</label>
                  <input id="practice-num-input" type="text" value={practiceNumber} onChange={(e) => setPracticeNumber(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70" placeholder="888888" />
                </div>
                <div>
                  <label htmlFor="specialty-select" className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">Clinical Field</label>
                  <select id="specialty-select" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="w-full rounded-sm border border-slate-700/80 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70">
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
