"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: string; title: string; description?: string; variant?: "info" | "success" | "error" };

type ToastContextValue = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    const toast: Toast = { id, ...t };
    setToasts((s) => [...s, toast]);
    // auto dismiss
    setTimeout(() => {
      setToasts((s) => s.filter((x) => x.id !== id));
    }, 5000);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((s) => s.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={{ position: "fixed", right: 12, bottom: 12, zIndex: 9999 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.variant === "error" ? "#2b0202" : t.variant === "success" ? "#062e0f" : "#071422",
              color: "#fff",
              padding: "10px 14px",
              borderRadius: 8,
              boxShadow: "0 6px 18px rgba(2,8,23,0.6)",
              marginBottom: 8,
              minWidth: 220,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</div>
            {t.description && <div style={{ fontSize: 12, marginTop: 4 }}>{t.description}</div>}
            <div style={{ marginTop: 6, textAlign: "right" }}>
              <button onClick={() => dismiss(t.id)} style={{ color: "#9ca3af", fontSize: 12, background: "transparent", border: "none" }}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
