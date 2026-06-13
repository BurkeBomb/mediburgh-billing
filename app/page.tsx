"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/utils/supabase";

type AuthMode = "login" | "register";

const inputClassName =
  "w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-500/70 focus:ring-1 focus:ring-teal-500/40";

export default function Home() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null,
  );

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [practiceNumber, setPracticeNumber] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [password, setPassword] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    setLoading(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setMessage({ type: "success", text: "Signed in successfully." });
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (!privacyAccepted) {
      setLoading(false);
      setMessage({ type: "error", text: "Please accept the Privacy Policy to continue." });
      return;
    }

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          surname,
          practice_number: practiceNumber,
          specialty,
          contact_number: contactNumber,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setMessage({ type: "error", text: signUpError.message });
      return;
    }

    const userId = data.user?.id;
    if (!userId) {
      setLoading(false);
      setMessage({
        type: "error",
        text: "Account created, but no user ID was returned. Check your email to confirm signup.",
      });
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      name: firstName,
      surname,
      practice_number: practiceNumber,
      specialty,
      email,
      contact_number: contactNumber,
      role: "practitioner",
    });

    setLoading(false);

    if (profileError) {
      setMessage({
        type: "error",
        text: `Account created, but profile setup failed: ${profileError.message}`,
      });
      return;
    }

    setMessage({
      type: "success",
      text: "Registration complete. Check your email if confirmation is required.",
    });
  }

  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-[#0b0f14] px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(20,184,166,0.18),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0.4),transparent_40%,rgba(11,15,20,0.9))]"
      />

      <div className="relative w-full max-w-md">
        <header className="mb-10 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.35em] text-teal-400/90">
            Mediburgh
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Billing Portal
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Secure access for healthcare practitioners
          </p>
        </header>

        <div className="overflow-hidden rounded-sm border border-slate-800/90 bg-slate-900/40 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm">
          <div className="grid grid-cols-2 border-b border-slate-800/90">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setMessage(null);
              }}
              className={`px-4 py-4 text-sm font-medium transition ${
                mode === "login"
                  ? "border-b-2 border-teal-400 bg-slate-950/50 text-teal-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setMessage(null);
              }}
              className={`px-4 py-4 text-sm font-medium transition ${
                mode === "register"
                  ? "border-b-2 border-teal-400 bg-slate-950/50 text-teal-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Register
            </button>
          </div>

          <div className="p-8">
            {message && (
              <div
                className={`mb-6 rounded-sm border px-4 py-3 text-sm ${
                  message.type === "error"
                    ? "border-red-500/40 bg-red-950/30 text-red-200"
                    : "border-teal-500/40 bg-teal-950/20 text-teal-100"
                }`}
              >
                {message.text}
              </div>
            )}

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label htmlFor="login-email" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className={inputClassName}
                    placeholder="you@practice.co.za"
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Password
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className={inputClassName}
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-sm border border-teal-500/50 bg-teal-600 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="first-name" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                      Name
                    </label>
                    <input
                      id="first-name"
                      type="text"
                      required
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={inputClassName}
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label htmlFor="surname" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                      Surname
                    </label>
                    <input
                      id="surname"
                      type="text"
                      required
                      autoComplete="family-name"
                      value={surname}
                      onChange={(e) => setSurname(e.target.value)}
                      className={inputClassName}
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="practice-number" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Practice Number
                  </label>
                  <input
                    id="practice-number"
                    type="text"
                    required
                    value={practiceNumber}
                    onChange={(e) => setPracticeNumber(e.target.value)}
                    className={inputClassName}
                    placeholder="MP1234567"
                  />
                </div>

                <div>
                  <label htmlFor="specialty" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Specialty
                  </label>
                  <input
                    id="specialty"
                    type="text"
                    required
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className={inputClassName}
                    placeholder="General Practice"
                  />
                </div>

                <div>
                  <label htmlFor="register-email" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Email
                  </label>
                  <input
                    id="register-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClassName}
                    placeholder="you@practice.co.za"
                  />
                </div>

                <div>
                  <label htmlFor="contact-number" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Contact Number
                  </label>
                  <input
                    id="contact-number"
                    type="tel"
                    required
                    autoComplete="tel"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className={inputClassName}
                    placeholder="+27 82 000 0000"
                  />
                </div>

                <div>
                  <label htmlFor="register-password" className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Password
                  </label>
                  <input
                    id="register-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClassName}
                    placeholder="Minimum 8 characters"
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-slate-800/80 bg-slate-950/40 p-4">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-slate-600 bg-slate-950 text-teal-500 focus:ring-teal-500/40"
                  />
                  <span className="text-sm leading-relaxed text-slate-400">
                    I agree to the{" "}
                    <a href="/privacy" className="text-teal-400 underline-offset-2 hover:underline">
                      Privacy Policy
                    </a>{" "}
                    and consent to the processing of my personal information.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-sm border border-teal-500/50 bg-teal-600 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Creating account…" : "Create account"}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-600">
          Protected by Supabase Auth · POPIA compliant
        </p>
      </div>
    </div>
  );
}
