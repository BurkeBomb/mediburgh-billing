"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // registration successful
          console.log("Service worker registered:", reg);
        })
        .catch((err) => console.error("Service worker registration failed:", err));
    }
  }, []);

  return null;
}
