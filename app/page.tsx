"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Mediburgh</h1>
      <p className="mb-4">Welcome to the Mediburgh billing system demo.</p>

      <div className="flex gap-3">
        <Link href="/dashboard">
          <a className="px-4 py-2 bg-[#0b2b2f] rounded">Practitioner Dashboard</a>
        </Link>
        <Link href="/office">
          <a className="px-4 py-2 bg-[#0b2b2f] rounded">Office Dashboard</a>
        </Link>
      </div>
    </div>
  );
}
