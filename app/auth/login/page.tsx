"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
          // User is already authenticated, redirect to dashboard
          router.push("/dashboard");
        }
      } catch (err) {
        console.error("Auth check error:", err);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [supabase, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!email.trim() || !password.trim()) {
        setError("Email and password are required.");
        setLoading(false);
        return;
      }

      if (isSignUp) {
        // Sign up new user
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
        });

        if (signUpError) {
          setError(signUpError.message || "Sign up failed. Please try again.");
          setLoading(false);
          return;
        }

        if (data?.user) {
          // Check if email confirmation is required
          if (data.user.email_confirmed_at) {
            // Automatically signed in
            router.push("/dashboard");
          } else {
            setError(
              "Account created! Please check your email to confirm your registration."
            );
            setEmail("");
            setPassword("");
          }
        }
      } else {
        // Sign in existing user
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (signInError) {
          setError(signInError.message || "Login failed. Please try again.");
          setLoading(false);
          return;
        }

        if (data?.user) {
          router.push("/dashboard");
        }
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0d1b2e] text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-2xl">⏳</div>
          <p className="text-sm text-slate-400">Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1b2e] via-[#12253f] to-[#0d1b2e] text-slate-100 flex items-center justify-center p-4">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
      </div>

      {/* Login Card */}
      <div className="relative w-full max-w-md">
        <div className="rounded-lg border border-slate-700/40 bg-[#12253f] p-8 shadow-2xl backdrop-blur-sm">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center">
              <div className="flex items-center justify-center w-10 h-10 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30 font-bold shadow-sm">
                🛡️
              </div>
            </div>
            <h1 className="text-2xl font-black tracking-wider text-white uppercase">
              THE DOC LOG
            </h1>
            <p className="text-xs font-semibold tracking-widest text-teal-400/80 mt-1">
              BY MEDIBURGH
            </p>
            <p className="text-xs text-slate-400 mt-3">
              Clinical claim capture & administration engine
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div
              className={`mb-4 rounded-sm border p-3 text-xs font-medium ${
                error.includes("created") || error.includes("check your email")
                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300/90"
                  : "border-red-500/40 bg-red-950/30 text-red-200"
              }`}
            >
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Input */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="practitioner@mediburgh.com"
                className="w-full rounded-sm border border-slate-600/50 bg-[#0d1b2e]/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-400/80 focus:bg-[#0d1b2e]"
                disabled={loading}
              />
            </div>

            {/* Password Input */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-sm border border-slate-600/50 bg-[#0d1b2e]/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-400/80 focus:bg-[#0d1b2e]"
                disabled={loading}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-teal-600 font-bold py-2.5 text-xs font-sans uppercase tracking-wider text-white rounded-sm hover:bg-teal-500 transition disabled:bg-teal-600/60 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  {isSignUp ? "Creating Account..." : "Signing In..."}
                </span>
              ) : isSignUp ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Toggle Sign Up / Sign In */}
          <div className="mt-6 border-t border-slate-700/40 pt-4">
            <p className="text-center text-xs text-slate-400">
              {isSignUp ? "Already have an account?" : "New practitioner?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setEmail("");
                  setPassword("");
                }}
                className="font-semibold text-teal-400 hover:text-teal-300 transition"
              >
                {isSignUp ? "Sign In" : "Create Account"}
              </button>
            </p>
          </div>

          {/* Footer Info */}
          <div className="mt-6 rounded-sm bg-[#0d1b2e]/60 border border-slate-700/30 p-3">
            <p className="text-[10px] text-slate-500 text-center leading-relaxed">
              Secure practitioner portal. Your credentials are encrypted and stored securely
              with Supabase authentication.
            </p>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-4 text-center text-xs text-slate-500">
          <a href="#" className="hover:text-teal-400 transition">
            Forgot password?
          </a>
          <span className="mx-2">•</span>
          <a href="#" className="hover:text-teal-400 transition">
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
