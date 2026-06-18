"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase";
import { loadIcdList, searchIcd, IcdCodeItem } from "@/utils/icd";

type ClaimStatus = "captured" | "on_hold" | "billed";

interface ClaimFormState {
  procedure_description: string;
  icd10_code: string | null;
  modifiers: string[];
  extra_notes: string;
  weight_kg: string;
  height_cm: string;
  account_number: string;
  theatre_start_time: string; // ISO datetime string
  theatre_end_time: string; // ISO datetime string
  medical_aid: string;
  error_code: string;
}

const emptyForm = (): ClaimFormState => ({
  procedure_description: "",
  icd10_code: null,
  modifiers: [],
  extra_notes: "",
  weight_kg: "",
  height_cm: "",
  account_number: "",
  theatre_start_time: "",
  theatre_end_time: "",
  medical_aid: "",
  error_code: "",
});

const calculateBMI = (weightKg: string, heightCm: string): string => {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!w || !h) return "";
  const bmi = w / (h * h);
  return bmi ? bmi.toFixed(1) : "";
};

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<ClaimFormState>(emptyForm());
  const [icdQuery, setIcdQuery] = useState("");
  const [icdResults, setIcdResults] = useState<IcdCodeItem[]>([]);
  const [selectedIcd, setSelectedIcd] = useState<IcdCodeItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [lastSavedClaimId, setLastSavedClaimId] = useState<string | null>(null);

  const icdListRef = useRef<IcdCodeItem[]>([]);

  useEffect(() => {
    // preload ICD list index (lazy)
    try {
      icdListRef.current = loadIcdList();
    } catch (err) {
      console.error("Failed to load ICD list:", err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!icdQuery) return setIcdResults([]);
      const res = searchIcd(icdQuery, 30);
      setIcdResults(res);
    }, 250);

    return () => clearTimeout(t);
  }, [icdQuery]);

  const handleSelectIcd = (item: IcdCodeItem) => {
    setSelectedIcd(item);
    setForm((f) => ({ ...f, icd10_code: item.code }));
    setIcdQuery("");
    setIcdResults([]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  // Persist claim and return inserted id (or null)
  const handlePersistClaim = async (targetStatus: ClaimStatus): Promise<string | null> => {
    setIsSubmitting(true);

    try {
      // upload file if present
      let imageUrl: string | null = null;

      if (file) {
        const filePath = `claims/${Date.now()}_${file.name}`;
        const { data, error: uploadErr } = await supabase.storage
          .from("claims")
          .upload(filePath, file, { upsert: true });

        if (uploadErr) {
          console.error("Upload error:", uploadErr);
        } else {
          const { data: urlData } = supabase.storage
            .from("claims")
            .getPublicUrl(filePath);

          imageUrl = urlData.publicUrl;
        }
      }

      const { data: authData } = await supabase.auth.getUser();

      const insertPayload: any = {
        procedure_description: form.procedure_description,
        icd10_code: form.icd10_code,
        modifiers: form.modifiers,
        extra_notes: form.extra_notes,
        bmi_info: calculateBMI(form.weight_kg, form.height_cm) || null,
        image_url: imageUrl,
        status: targetStatus,
        practitioner_id: authData.user?.id || null,
        account_number: form.account_number || null,
        theatre_start_time: form.theatre_start_time || null,
        theatre_end_time: form.theatre_end_time || null,
        medical_aid: form.medical_aid || null,
        error_code: form.error_code || null,
      };

      const { data: inserted, error } = await supabase
        .from("claims")
        .insert([insertPayload])
        .select()
        .single();

      if (error) {
        console.error("Insert error:", error);
        alert("Failed to save claim. Check console for details.");
        return null;
      } else {
        const claimId = (inserted as any).id as string;
        setLastSavedClaimId(claimId);

        // insert audit log
        try {
          await supabase.from("audit_logs").insert([
            {
              claim_id: claimId,
              user_id: authData.user?.id || null,
              action: "create_claim",
            },
          ]);
        } catch (alogErr) {
          console.error("Failed to insert audit log:", alogErr);
        }

        alert("Claim saved.");
        return claimId;
      }
    } catch (err) {
      console.error(err);
      alert("Unexpected error. See console.");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTicket = async () => {
    // Ticket creation is an explicit separate action. Do not auto-save.
    if (!lastSavedClaimId) {
      alert("Please save the claim first before creating a ticket.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const practitionerId = authData.user?.id || null;

      // build ticket payload
      const subject = (form.procedure_description || "Untitled").slice(0, 80);
      const preview = (form.extra_notes && form.extra_notes.length > 0)
        ? form.extra_notes.slice(0, 120)
        : form.procedure_description.slice(0, 120);

      const { data: ticketInserted, error: ticketErr } = await supabase
        .from("tickets")
        .insert([
          {
            practitioner_id: practitionerId,
            subject: subject,
            preview: preview,
            status: "open",
            sender: practitionerId,
            medical_aid: form.medical_aid || null,
            error_code: form.error_code || null,
            claim_id: lastSavedClaimId,
          },
        ])
        .select()
        .single();

      if (ticketErr) {
        console.error("Ticket create error:", ticketErr);
        alert("Failed to create ticket. See console.");
        return;
      }

      const ticketId = (ticketInserted as any).id as string;

      // optional: insert initial ticket message
      try {
        await supabase.from("ticket_messages").insert([
          {
            ticket_id: ticketId,
            sender_id: practitionerId,
            sender_role: "practitioner",
            message: form.procedure_description,
          },
        ]);
      } catch (tmErr) {
        console.error("Failed to insert ticket message:", tmErr);
      }

      // audit log for ticket
      try {
        await supabase.from("audit_logs").insert([
          {
            claim_id: lastSavedClaimId,
            user_id: practitionerId,
            action: "create_ticket",
          },
        ]);
      } catch (alogErr) {
        console.error("Failed to insert audit log for ticket:", alogErr);
      }

      alert("Ticket created.");
    } catch (err) {
      console.error(err);
      alert("Unexpected error creating ticket. See console.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Theatre Capture</h1>

      <label className="block mb-2 text-sm font-semibold">Procedure description</label>
      <textarea
        value={form.procedure_description}
        onChange={(e) => setForm((f) => ({ ...f, procedure_description: e.target.value }))}
        className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded mb-3"
      />

      <label className="block mb-2 text-sm font-semibold">ICD10 Code</label>
      <input
        type="text"
        value={icdQuery}
        onChange={(e) => setIcdQuery(e.target.value)}
        placeholder="Search ICD10 by code or description..."
        className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded mb-1"
      />

      {icdResults.length > 0 && (
        <ul className="max-h-64 overflow-auto bg-[#071018] border border-[#1b2430] rounded mb-3">
          {icdResults.map((it) => (
            <li
              key={it.code}
              onClick={() => handleSelectIcd(it)}
              className="p-2 hover:bg-[#0b2a2f] cursor-pointer text-sm"
            >
              <span className="font-mono text-teal-300 mr-2">{it.code}</span>
              <span>{it.description}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block mb-2 text-sm font-semibold">Weight (kg)</label>
          <input
            type="number"
            value={form.weight_kg}
            onChange={(e) => setForm((f) => ({ ...f, weight_kg: e.target.value }))}
            className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
          />
        </div>

        <div>
          <label className="block mb-2 text-sm font-semibold">Height (cm)</label>
          <input
            type="number"
            value={form.height_cm}
            onChange={(e) => setForm((f) => ({ ...f, height_cm: e.target.value }))}
            className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
          />
        </div>
      </div>

      <div className="mb-3 text-sm">
        <strong>BMI:</strong> {calculateBMI(form.weight_kg, form.height_cm) || "N/A"}
      </div>

      <div className="mb-3">
        <label className="block mb-2 text-sm font-semibold">Account number (optional)</label>
        <input
          type="text"
          value={form.account_number}
          onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
          className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block mb-2 text-sm font-semibold">Theatre start</label>
          <input
            type="datetime-local"
            value={form.theatre_start_time}
            onChange={(e) => setForm((f) => ({ ...f, theatre_start_time: e.target.value }))}
            className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
          />
        </div>
        <div>
          <label className="block mb-2 text-sm font-semibold">Theatre end</label>
          <input
            type="datetime-local"
            value={form.theatre_end_time}
            onChange={(e) => setForm((f) => ({ ...f, theatre_end_time: e.target.value }))}
            className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block mb-2 text-sm font-semibold">Medical Aid (optional)</label>
        <input
          type="text"
          value={form.medical_aid}
          onChange={(e) => setForm((f) => ({ ...f, medical_aid: e.target.value }))}
          className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
        />
      </div>

      <div className="mb-3">
        <label className="block mb-2 text-sm font-semibold">Error code (optional)</label>
        <input
          type="text"
          value={form.error_code}
          onChange={(e) => setForm((f) => ({ ...f, error_code: e.target.value }))}
          className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded"
        />
      </div>

      <div className="mb-3">
        <label className="block mb-2 text-sm font-semibold">Extra notes</label>
        <textarea
          value={form.extra_notes}
          onChange={(e) => setForm((f) => ({ ...f, extra_notes: e.target.value }))}
          className="w-full p-2 bg-[#0f1720] border border-[#22282e] text-sm rounded mb-3"
        />
      </div>

      <div className="mb-3">
        <label className="block mb-2 text-sm font-semibold">Attach image (optional)</label>
        <input type="file" onChange={handleFileChange} />
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={async () => {
            await handlePersistClaim("captured");
          }}
          disabled={isSubmitting}
          className="px-3 py-2 bg-teal-500 text-black rounded font-semibold"
        >
          Save & Capture
        </button>

        <button
          onClick={async () => {
            await handlePersistClaim("on_hold");
          }}
          disabled={isSubmitting}
          className="px-3 py-2 bg-yellow-500 text-black rounded font-semibold"
        >
          Save & Flag Hold
        </button>

        <button
          onClick={async () => {
            await handlePersistClaim("billed");
          }}
          disabled={isSubmitting}
          className="px-3 py-2 bg-green-600 text-white rounded font-semibold"
        >
          Save & Bill
        </button>

        <button
          onClick={handleCreateTicket}
          disabled={isSubmitting}
          className="px-3 py-2 bg-indigo-600 text-white rounded font-semibold ml-auto"
          title="Create a ticket for this claim (explicit action)."
        >
          Create Ticket
        </button>
      </div>

      <div className="text-xs text-slate-400">
        {lastSavedClaimId ? (
          <div>Last saved claim id: <span className="font-mono">{lastSavedClaimId}</span></div>
        ) : (
          <div>No saved claim yet.</div>
        )}
      </div>
    </div>
  );
}
