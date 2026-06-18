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
}

const emptyForm = (): ClaimFormState => ({
  procedure_description: "",
  icd10_code: null,
  modifiers: [],
  extra_notes: "",
  weight_kg: "",
  height_cm: "",
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

  const handlePersistClaim = async (targetStatus: ClaimStatus) => {
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

      const { data: inserted, error } = await supabase
        .from("claims")
        .insert([
          {
            procedure_description: form.procedure_description,
            icd10_code: form.icd10_code,
            modifiers: form.modifiers,
            extra_notes: form.extra_notes,
            bmi_info: calculateBMI(form.weight_kg, form.height_cm) || null,
            image_url: imageUrl,
            status: targetStatus,
            practitioner_id: authData.user?.id || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Insert error:", error);
        alert("Failed to save claim. Check console for details.");
      } else {
        alert("Claim saved.");
        setForm(emptyForm());
        setFile(null);
        setSelectedIcd(null);
      }
    } catch (err) {
      console.error(err);
      alert("Unexpected error. See console.");
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
        <label className="block mb-2 text-sm font-semibold">Attach image (optional)</label>
        <input type="file" onChange={handleFileChange} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handlePersistClaim("captured")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-teal-500 text-black rounded font-semibold"
        >
          Save & Capture
        </button>

        <button
          onClick={() => handlePersistClaim("on_hold")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-yellow-500 text-black rounded font-semibold"
        >
          Save & Flag Hold
        </button>

        <button
          onClick={() => handlePersistClaim("billed")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-green-600 text-white rounded font-semibold"
        >
          Save & Bill
        </button>
      </div>
    </div>
  );
}
