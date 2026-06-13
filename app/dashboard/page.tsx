"use client";

import { DragEvent, useCallback, useMemo, useRef, useState, useEffect } from "react";
import { createClient } from "@/utils/supabase";
import icd10Database from "@/data/ICD10.json";

type ClaimStatus = "captured" | "on_hold";

interface ClaimFormState {
  patientName: string;
  patientSurname: string;
  procedureDescription: string;
  icd10Code: string;
  theatreStartTime: string;
  theatreEndTime: string;
  bmiInfo: string;
  modifiers: string;
  extraNotes: string;
}

interface TicketThread {
  id: string;
  subject: string;
  preview: string;
  status: "open" | "closed" | "urgent";
  updated_at: string;
  sender: "billing_team" | "practitioner";
}

interface ModifierOption {
  code: string;
  label: string;
}

const emptyForm: ClaimFormState = {
  patientName: "",
  patientSurname: "",
  procedureDescription: "",
  icd10Code: "",
  theatreStartTime: "",
  theatreEndTime: "",
  bmiInfo: "",
  modifiers: "",
  extraNotes: "",
};

const ALL_ICD10_CODES = icd10Database.Employees.Employee;

const PRELOADED_MODIFIERS: ModifierOption[] = [
  { code: "0151", label: "Pre-anaesthetic assessment" },
  { code: "0147 + 0011", label: "Emergency" },
  { code: "0039", label: "Blood Pressure Control" },
  { code: "0026", label: "One Lung Ventilation" },
  { code: "0032", label: "Prone Position" },
  { code: "0034", label: "Head, Neck and Shoulder" },
  { code: "0038", label: "Blood salvage" },
  { code: "0042", label: "Extra Corporeal Circulation" },
  { code: "0043", label: "Patients younger than 1 year or older than 70 years" },
  { code: "0044", label: "Neonates up to and including 28 days after birth" },
  { code: "0019", label: "Neonates with a low birthweight less than 2.5kg" },
  { code: "0018", label: "BMI higher than 35 (Indicate Height & Weight in notes below)" },
  { code: "5441", label: "Orthopedic Modifier (Allocation 5441)" },
  { code: "5442", label: "Orthopedic Modifier (Allocation 5442)" },
  { code: "5443", label: "Orthopedic Modifier (Allocation 5443)" },
  { code: "5444", label: "Orthopedic Modifier (Allocation 5444)" },
  { code: "5445", label: "Orthopedic Modifier (Allocation 5445)" },
  { code: "5448", label: "Orthopedic Modifier (Allocation 5448)" },
  { code: "0109", label: "Hospital Follow up" },
  { code: "1204", label: "ICU care" },
  { code: "0007", label: "TCI" },
  { code: "1215", label: "A-line" },
  { code: "1218", label: "CVP" },
  { code: "1220", label: "Hire fee PCA" },
  { code: "1221", label: "PCA pump" },
  { code: "1780", label: "NG tube" },
  { code: "IV-UNDER-3", label: "Insertion IV line under 3 years" },
  { code: "IV-ABOVE-3", label: "Insertion IV line above 3 years" },
  { code: "EYE-BLOCK", label: "Eye Block" },
  { code: "2800", label: "Plexus Nerve Block" },
  { code: "2801", label: "Epidural Injection" },
  { code: "2802", label: "Peripheral Nerve Block" },
  { code: "2804", label: "Dwelling Nerve Catheter" },
  { code: "5103 + 0083", label: "Ultrasound" },
];

const cardClassName =
  "rounded-sm border border-slate-800/90 bg-slate-900/40 shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm";

const inputClassName =
  "w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-500/70 focus:ring-1 focus:ring-teal-500/40";

const labelClassName =
  "mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400";

function getMonthRangeLabel(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const fmt = new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const icdSearchRef = useRef<HTMLDivElement>(null);
  const modSearchRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<ClaimFormState>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [icdSearch, setIcdSearch] = useState("");
  const [icdDropdownOpen, setIcdDropdownOpen] = useState(false);
  const [modSearch, setModSearch] = useState("");
  const [modDropdownOpen, setModDropdownOpen] = useState(false);

  const [submittedCount, setSubmittedCount] = useState(0);
  const [holdCount, setHoldCount] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(false);

  const [totalClaimsCount, setTotalClaimsCount] = useState<number | null>(null);
  const [valueBilledTotal, setValueBilledTotal] = useState<number | null>(null);
  const [practiceSuccessRate, setPracticeSuccessRate] = useState<number | null>(null);
  const [liveTickets, setLiveTickets] = useState<TicketThread[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isPremiumUser = true;
  const monthRange = useMemo(() => getMonthRangeLabel(new Date()), []);

  const supabase = createClient();

  // ── LIVE METRICS AND DATA STREAMING PIPELINE ──
  useEffect(() => {
    async function fetchLiveMetrics() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        
        const currentUserId = authData.user.id;
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data: monthClaims } = await supabase
          .from("claims")
          .select("status")
          .eq("practitioner_id", currentUserId)
          .gte("created_at", firstDayOfMonth);

        if (monthClaims) {
          const total = monthClaims.length;
          setTotalClaimsCount(total);
          setValueBilledTotal(total * 1250);
          
          // CRITICAL FIXED LINE: Strict structural inline type cast assignment to clear Vercel build checks
          const successfulCases = monthClaims.filter((c: { status: string }) => c.status === "captured" || c.status === "billed").length;
          const rate = total > 0 ? Math.round((successfulCases / total) * 100) : 100;
          setPracticeSuccessRate(rate);
        }

        const { data: ticketData } = await supabase
          .from("tickets")
          .select("id, subject, preview, status, updated_at, sender")
          .eq("practitioner_id", currentUserId)
          .order("updated_at", { ascending: false });

        if (ticketData) {
          setLiveTickets(ticketData as TicketThread[]);
        }
      } catch (err) {
        console.error("Failed to stream live practice metrics layout:", err);
      }
    }
    fetchLiveMetrics();
  }, [submittedCount, holdCount]);

  const ticketCounts = useMemo(() => {
    return {
      open: liveTickets.filter((t) => t.status === "open").length,
      closed: liveTickets.filter((t) => t.status === "closed").length,
      urgent: liveTickets.filter((t) => t.status === "urgent").length,
    };
  }, [liveTickets]);

  const filteredIcdOptions = useMemo(() => {
    const q = icdSearch.trim().toLowerCase();
    const cleanDesc = (descStr: string) => {
      if (!descStr) return "";
      return descStr.replace(/\\"/g, "").replace(/\"/g, "").replace(/\r/g, "").replace(/\n/g, "").trim();
    };

    if (!q) {
      return ALL_ICD10_CODES.slice(0, 8).map((item) => ({
        code: item.ICD10CODE,
        description: cleanDesc(item["DESCRIPTION\r"]),
      }));
    }

    return ALL_ICD10_CODES
      .filter((item) => {
        const codeMatch = item.ICD10CODE?.toLowerCase().includes(q);
        const descMatch = item["DESCRIPTION\r"]?.toLowerCase().includes(q);
        return codeMatch || descMatch;
      })
      .slice(0, 15)
      .map((item) => ({
        code: item.ICD10CODE,
        description: cleanDesc(item["DESCRIPTION\r"]),
      }));
  }, [icdSearch]);

  const filteredModifierOptions = useMemo(() => {
    const q = modSearch.trim().toLowerCase();
    if (!q) return PRELOADED_MODIFIERS.slice(0, 8);

    return PRELOADED_MODIFIERS.filter(
      (opt) => opt.code.toLowerCase().includes(q) || opt.label.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [modSearch]);

  const activeModifiersList = useMemo(() => {
    return form.modifiers
      ? form.modifiers.split(",").map((m) => m.trim()).filter((m) => m.length > 0)
      : [];
  }, [form.modifiers]);

  const updateField = useCallback(
    (field: keyof ClaimFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const toggleModifierCode = (code: string) => {
    const current = form.modifiers
      ? form.modifiers.split(",").map((m) => m.trim()).filter((m) => m.length > 0)
      : [];
    
    let updated;
    if (current.includes(code)) {
      updated = current.filter((item) => item !== code);
    } else {
      updated = [...current, code];
    }
    updateField("modifiers", updated.join(", "));
  };

  const clearImage = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload a valid image file (PNG, JPG, WEBP, etc.).");
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadImage(file);
  };

  const resetForm = useCallback(() => {
    setForm(emptyForm);
    setIcdSearch("");
    setModSearch("");
    setIcdDropdownOpen(false);
    setModDropdownOpen(false);
    clearImage();
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }, [clearImage]);

  const selectIcdCode = (option: { code: string; description: string }) => {
    updateField("icd10Code", option.code);
    setIcdSearch(`${option.code} — ${option.description}`);
    setIcdDropdownOpen(false);
  };

  const validateForm = (): string | null => {
    if (!imageFile) return "Please upload a hospital sheet image before continuing.";
    if (!form.patientName.trim()) return "Patient Name is required.";
    if (!form.patientSurname.trim()) return "Patient Surname is required.";
    if (!form.procedureDescription.trim()) return "Procedure Description is required.";
    if (!form.icd10Code.trim()) return "ICD-10 Code is required.";
    if (!form.theatreStartTime) return "Theatre Start Time is required.";
    if (!form.theatreEndTime) return "Theatre End Time is required.";
    if (form.theatreEndTime <= form.theatreStartTime) {
      return "Theatre End Time must be after Theatre Start Time.";
    }
    return null;
  };

  const handlePersistClaim = async (targetStatus: ClaimStatus) => {
    if (batchCompleted || isSaving) return;

    if (targetStatus === "captured") {
      const validationError = validateForm();
      if (validationError) {
        setError(validationError);
        setStatusMessage(null);
        return;
      }
    } else if (targetStatus === "on_hold") {
      if (!form.patientName.trim() && !form.patientSurname.trim() && !imageFile) {
        setError("Add at least a patient name, surname or document before placing a claim on hold.");
        setStatusMessage(null);
        return;
      }
    }

    setIsSaving(true);
    setError(null);
    setStatusMessage("Processing submission and securely transferring logs...");

    try {
      let uploadedImageUrl = null;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop();
        const secureFileName = `${crypto.randomUUID()}.${fileExt}`;
        const targetPath = `${secureFileName}`;

        const { error: uploadError } = await supabase.storage
          .from("claim-attachments")
          .upload(targetPath, imageFile, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("claim-attachments")
          .getPublicUrl(targetPath);

        uploadedImageUrl = publicUrlData.publicUrl;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw new Error("Session verification failed. Please re-authenticate via the portal gateway.");
      }
      const currentUserId = authData.user.id;

      const cleanedModifiers = form.modifiers
        ? form.modifiers.split(",").map((m) => m.trim()).filter((m) => m.length > 0)
        : [];

      const compoundNotes = `[Patient: ${form.patientName} ${form.patientSurname}] ${form.extraNotes}`.trim();

      const { data: newClaimRecord, error: claimError } = await supabase
        .from("claims")
        .insert([
          {
            practitioner_id: currentUserId,
            procedure_description: form.procedureDescription || "Incomplete — Positioned on Hold",
            icd10_code: form.icd10Code || null,
            theatre_start_time: form.theatreStartTime ? new Date(form.theatreStartTime).toISOString() : null,
            theatre_end_time: form.theatreEndTime ? new Date(form.theatreEndTime).toISOString() : null,
            bmi_info: form.bmiInfo ? parseFloat(form.bmiInfo) || null : null,
            modifiers: cleanedModifiers,
            extra_notes: compoundNotes,
            image_url: uploadedImageUrl,
            status: targetStatus,
          },
        ])
        .select()
        .single();

      if (claimError) throw claimError;

      const logActionString = targetStatus === "captured"
        ? `Claim record generated with initial standard submission capture.`
        : `Claim pushed to database and flagged with active 'on_hold' trace state.`;

      await supabase
        .from("audit_logs")
        .insert([
          {
            claim_id: newClaimRecord.id,
            user_id: currentUserId,
            action: logActionString,
          },
        ]);

      if (targetStatus === "captured") {
        setSubmittedCount((c) => c + 1);
        setStatusMessage("Claim successfully pushed to backend. Next form initialized.");
      } else {
        setHoldCount((c) => c + 1);
        setStatusMessage("Claim record flagged and securely held inside data tracking view.");
      }

      resetForm();
    } catch (err: any) {
      console.error("Critical submission break logged:", err);
      setError(err.message || "An issue disrupted the server communication lane. Data preserved locally.");
      setStatusMessage(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompleted = () => {
    setBatchCompleted(true);
    setStatusMessage(
      `Batch processing marked complete. ${submittedCount} claims secured, ${holdCount} trace queues flagged.`,
    );
    setError(null);
  };

  const handleStartNewBatch = () => {
    setBatchCompleted(false);
    setSubmittedCount(0);
    setHoldCount(0);
    setStatusMessage("New batch interface session opened.");
    resetForm();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const formDisabled = batchCompleted || isSaving;

  return (
    <div className="relative min-h-full flex-1 bg-[#0b0f14] text-slate-100">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-15%,rgba(20,184,166,0.14),transparent)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0.25),transparent_30%,rgba(11,15,20,1))]" />

      <div className="relative mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-teal-400/90">Mediburgh Billing</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Practitioner Dashboard</h1>
            <p className="mt-1 text-sm text-slate-400">Continuous claims · Practice insights · Billing support</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-sm border border-teal-500/30 bg-slate-900/60 px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-teal-400/80">Submitted</span>
              <span className="font-mono text-xl font-semibold tabular-nums text-teal-300">{submittedCount}</span>
            </div>
            <div className="flex items-center gap-2 rounded-sm border border-amber-500/30 bg-slate-900/60 px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-amber-400/80">On Hold</span>
              <span className="font-mono text-xl font-semibold tabular-nums text-amber-300">{holdCount}</span>
            </div>
            
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-sm border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-300 transition hover:bg-slate-800"
            >
              Sign Out
            </button>

            {batchCompleted && (
              <button
                type="button"
                onClick={handleStartNewBatch}
                className="rounded-sm border border-slate-600 bg-slate-800/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Start new batch
              </button>
            )}
          </div>
        </header>

        {error && <div className="mb-4 rounded-sm border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}
        {statusMessage && <div className="mb-4 rounded-sm border border-teal-500/30 bg-teal-950/20 px-4 py-3 text-sm text-teal-100">{statusMessage}</div>}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5 xl:gap-6">
          <section className={`xl:col-span-3 ${cardClassName}`}>
            <div className="border-b border-slate-800/90 px-5 py-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Continuous Claim Submission</h2>
              <p className="mt-0.5 text-xs text-slate-500">Load hospital sheet · Complete details · Accept or hold</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="border-b border-slate-800/90 p-4 lg:border-b-0 lg:border-r lg:border-slate-800/90">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-slate-500">Hospital Sheet</p>

                {!imagePreviewUrl ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !formDisabled && fileInputRef.current?.click()}
                    className={`flex min-h-[480px] cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed px-4 py-10 transition ${
                      isDragging ? "border-teal-400 bg-teal-950/20" : "border-slate-700/80 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-950/70"
                    } ${formDisabled ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm border border-slate-700 bg-slate-900">
                      <svg className="h-6 w-6 text-teal-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a41.763 41.763 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                    </div>
                    <p className="text-center text-sm font-medium text-slate-300">Drop photo or click to capture</p>
                    <p className="mt-1 text-center text-xs text-slate-500">Refer to sheet while entering claim data</p>
                  </div>
                ) : (
                  <div className="flex min-h-[480px] flex-col">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-slate-400">{imageFile?.name}</p>
                      {!formDisabled && (
                        <button type="button" onClick={clearImage} className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500 transition hover:text-red-400">
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden rounded-sm border border-slate-800 bg-slate-950/70">
                      <img src={imagePreviewUrl} alt="Hospital sheet preview" className="h-full max-h-[520px] w-full object-contain" />
                    </div>
                  </div>
                )}

                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" disabled={formDisabled} />
              </div>

              <div className="flex flex-col">
                <form ref={formRef} onSubmit={(e) => e.preventDefault()} className={`flex-1 space-y-3 p-4 ${formDisabled ? "pointer-events-none opacity-50" : ""}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="patient-name" className={labelClassName}>Patient Name</label>
                      <input id="patient-name" type="text" value={form.patientName} onChange={(e) => updateField("patientName", e.target.value)} className={inputClassName} placeholder="John" disabled={formDisabled} />
                    </div>
                    <div>
                      <label htmlFor="patient-surname" className={labelClassName}>Surname</label>
                      <input id="patient-surname" type="text" value={form.patientSurname} onChange={(e) => updateField("patientSurname", e.target.value)} className={inputClassName} placeholder="Doe" disabled={formDisabled} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="procedure-description" className={labelClassName}>Procedure Description</label>
                    <input id="procedure-description" type="text" value={form.procedureDescription} onChange={(e) => updateField("procedureDescription", e.target.value)} className={inputClassName} placeholder="Laparoscopic cholecystectomy" disabled={formDisabled} />
                  </div>

                  <div ref={icdSearchRef} className="relative">
                    <label htmlFor="icd10-search" className={labelClassName}>ICD-10 Code Search</label>
                    <input id="icd10-search" type="text" value={icdSearch} onChange={(e) => { setIcdSearch(e.target.value); setIcdDropdownOpen(true); if (!e.target.value.trim()) updateField("icd10Code", ""); }} onFocus={() => setIcdDropdownOpen(true)} onBlur={() => setTimeout(() => setIcdDropdownOpen(false), 150)} className={inputClassName} placeholder="Search code or condition…" disabled={formDisabled} autoComplete="off" />
                    {form.icd10Code && <p className="mt-1 font-mono text-[11px] text-teal-400/90">Selected: {form.icd10Code}</p>}
                    {icdDropdownOpen && filteredIcdOptions.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-sm border border-slate-700 bg-slate-950 shadow-xl">
                        {filteredIcdOptions.map((option) => (
                          <li key={option.code}>
                            <button type="button" onMouseDown={() => selectIcdCode(option)} className="w-full px-3 py-2 text-left text-xs transition hover:bg-slate-800">
                              <span className="font-mono font-medium text-teal-400">{option.code}</span>
                              <span className="ml-2 text-slate-400">{option.description}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="theatre-start" className={labelClassName}>Theatre Start</label>
                      <input id="theatre-start" type="datetime-local" value={form.theatreStartTime} onChange={(e) => updateField("theatreStartTime", e.target.value)} className={inputClassName} disabled={formDisabled} />
                    </div>
                    <div>
                      <label htmlFor="theatre-end" className={labelClassName}>Theatre End</label>
                      <input id="theatre-end" type="datetime-local" value={form.theatreEndTime} onChange={(e) => updateField("theatreEndTime", e.target.value)} className={inputClassName} disabled={formDisabled} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="bmi-info" className={labelClassName}>BMI Info</label>
                    <input id="bmi-info" type="text" value={form.bmiInfo} onChange={(e) => updateField("bmiInfo", e.target.value)} className={inputClassName} placeholder="28.4 — Obesity Class I" disabled={formDisabled} />
                  </div>

                  <div ref={modSearchRef} className="relative">
                    <label htmlFor="modifiers-search" className={labelClassName}>Modifiers Lookup</label>
                    <input id="modifiers-search" type="text" value={modSearch} onChange={(e) => { setModSearch(e.target.value); setModDropdownOpen(true); }} onFocus={() => setModDropdownOpen(true)} onBlur={() => setTimeout(() => setModDropdownOpen(false), 180)} className={inputClassName} placeholder="Type keyword or code..." disabled={formDisabled} autoComplete="off" />

                    {activeModifiersList.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {activeModifiersList.map((mCode) => (
                          <span key={mCode} className="inline-flex items-center gap-1 rounded-sm border border-teal-500/30 bg-teal-950/40 px-2 py-0.5 text-[11px] font-mono font-medium text-teal-300">
                            {mCode}
                            <button type="button" onClick={() => toggleModifierCode(mCode)} className="text-teal-500 hover:text-red-400 font-bold ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {modDropdownOpen && filteredModifierOptions.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-sm border border-slate-700 bg-slate-950 shadow-xl">
                        {filteredModifierOptions.map((option) => {
                          const isSelected = activeModifiersList.includes(option.code);
                          return (
                            <li key={option.code}>
                              <button type="button" onMouseDown={() => toggleModifierCode(option.code)} className={`w-full px-3 py-2 text-left text-xs transition flex items-center justify-between hover:bg-slate-800 ${isSelected ? "bg-slate-900" : ""}`}>
                                <span className="min-w-0 flex-1 pr-2">
                                  <span className="font-mono font-medium text-teal-400 mr-2">[{option.code}]</span>
                                  <span className="text-slate-300">{option.label}</span>
                                </span>
                                {isSelected && <span className="text-[10px] uppercase font-semibold tracking-wide text-teal-400 shrink-0">Selected</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div>
                    <label htmlFor="extra-notes" className={labelClassName}>Extra Notes</label>
                    <textarea id="extra-notes" rows={2} value={form.extraNotes} onChange={(e) => updateField("extraNotes", e.target.value)} className={`${inputClassName} resize-none`} placeholder="Additional details..." disabled={formDisabled} />
                  </div>
                </form>

                <div className="border-t border-slate-800/90 p-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button type="button" onClick={() => handlePersistClaim("captured")} disabled={formDisabled} className="rounded-sm border border-teal-500/50 bg-teal-600 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:bg-teal-500 disabled:opacity-40">
                      {isSaving ? "Uploading..." : "Accept & Load Next"}
                    </button>
                    <button type="button" onClick={() => handlePersistClaim("on_hold")} disabled={formDisabled} className="rounded-sm border border-amber-500/50 bg-amber-600/90 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 transition hover:bg-amber-500 disabled:opacity-40">
                      Hold for Info
                    </button>
                    <button type="button" onClick={handleCompleted} disabled={formDisabled} className="rounded-sm border border-slate-500/60 bg-slate-200 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900 transition hover:bg-white disabled:opacity-40">
                      Completed
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-6 xl:col-span-2">
            <div className={cardClassName}>
              <div className="border-b border-slate-800/90 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Monthly Practice Metrics</h2>
                <p className="mt-0.5 text-xs text-slate-500">{monthRange}</p>
              </div>
              <div className="grid grid-cols-1 gap-px bg-slate-800/50 sm:grid-cols-3">
                <div className="bg-slate-900/40 px-4 py-5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Total Claims</p>
                  <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">{totalClaimsCount !== null ? totalClaimsCount : "—"}</p>
                  <p className="mt-1 text-[10px] text-teal-500/80">Live MTD count</p>
                </div>
                <div className="bg-slate-900/40 px-4 py-5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Value Billed</p>
                  <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-teal-300">{valueBilledTotal !== null ? `R ${valueBilledTotal.toLocaleString("en-ZA")}` : "—"}</p>
                  <p className="mt-1 text-[10px] text-slate-600">Est. ZAR Gross</p>
                </div>
                <div className="bg-slate-900/40 px-4 py-5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Success Rate</p>
                  <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">{practiceSuccessRate !== null ? `${practiceSuccessRate}%` : "—"}</p>
                  <p className="mt-1 text-[10px] text-slate-600">Processed vs Hold</p>
                </div>
              </div>
            </div>

            <div className={`flex flex-1 flex-col ${cardClassName}`}>
              <div className="border-b border-slate-800/90 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Billing Team Communications</h2>
                <p className="mt-0.5 text-xs text-slate-500">Tactical ticket lines with your billing team</p>
              </div>

              <div className="grid grid-cols-3 gap-px border-b border-slate-800/90 bg-slate-800/50">
                <div className="bg-slate-900/40 px-3 py-3 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Open</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-200">{ticketCounts.open}</p>
                </div>
                <div className="bg-slate-900/40 px-3 py-3 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Closed</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-400">{ticketCounts.closed}</p>
                </div>
                <div className="bg-slate-900/40 px-3 py-3 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-red-400/80">Urgent</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-400">{ticketCounts.urgent}</p>
                </div>
              </div>

              <ul className="flex-1 divide-y divide-slate-800/60 max-h-[320px] overflow-y-auto">
                {liveTickets.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 italic text-center">No current alerts or tickets from the bureau.</p>
                ) : (
                  liveTickets.map((ticket) => (
                    <li key={ticket.id} className="px-5 py-4 transition hover:bg-slate-950/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ticket.status === "urgent" ? "bg-red-500" : ticket.status === "open" ? "bg-teal-500" : "bg-slate-600"}`} />
                            <p className="truncate text-sm font-medium text-slate-200">{ticket.subject}</p>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{ticket.preview}</p>
                          <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">
                            {ticket.sender === "billing_team" ? "Billing Team" : "You"} · {formatRelativeTime(ticket.updated_at)}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                          ticket.status === "urgent" ? "border-red-500/40 bg-red-950/30 text-red-300" : ticket.status === "open" ? "border-teal-500/30 bg-teal-950/20 text-teal-300" : "border-slate-700 bg-slate-900 text-slate-500"
                        }`}>{ticket.status}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </aside>
        </div>

        {isPremiumUser && (
          <section className="mt-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-teal-500/30 to-transparent" />
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-teal-400/70">Premium Suite</p>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-teal-500/30 to-transparent" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={`group relative overflow-hidden ${cardClassName} p-6 transition hover:border-teal-500/30`}>
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(20,184,166,0.08),transparent_60%)]" />
                <div className="relative">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Quotes Setup Tool</h3>
                    <span className="rounded-sm border border-teal-500/30 bg-teal-950/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-teal-400">Premium</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-400">Configure procedure quote templates, fee schedules, and modifier rules for your practice. Coming soon.</p>
                  <button type="button" disabled className="mt-5 rounded-sm border border-slate-700 bg-slate-900/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">Launch tool</button>
                </div>
              </div>

              <div className={`group relative overflow-hidden ${cardClassName} p-6 transition hover:border-teal-500/30`}>
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(20,184,166,0.08),transparent_60%)]" />
                <div className="relative">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Monthly Practice Analysis Pack</h3>
                    <span className="rounded-sm border border-teal-500/30 bg-teal-950/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-teal-400">Premium</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-400">Detailed revenue breakdown, rejection analysis, and benchmarking report for {monthRange.split(" – ")[1] ?? "this month"}. Coming soon.</p>
                  <button type="button" disabled className="mt-5 rounded-sm border border-slate-700 bg-slate-900/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">View analysis</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {batchCompleted && (
          <div className="mt-6 rounded-sm border border-slate-700/80 bg-slate-900/60 px-5 py-4 text-center">
            <p className="text-sm font-medium text-slate-200">Batch session closed</p>
            <p className="mt-1 text-xs text-slate-500">Batch finalized with all entries securely written to the audit log. Start a new batch from the header when ready.</p>
          </div>
        )}
      </div>
    </div>
  );
}