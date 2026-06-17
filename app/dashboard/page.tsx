"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { createClient } from "@/utils/supabase";
import icd10Database from "@/data/ICD10.json";

type ClaimStatus = "captured" | "on_hold" | "billed";

export interface ModifierOption {
  code: string;
  label: string;
}

interface ClaimFormState {
  patientName: string;
  patientSurname: string;
  billingRate: string;
  procedureDescription: string;
  procedureCode: string;
  icd10Code: string;
  theatreDate: string;
  theatreStartTime: string;
  theatreEndTime: string;
  weight: string;
  height: string;
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
  medical_aid?: string;
  error_code?: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  message: string;
  sender_role: "billing_team" | "practitioner";
  created_at: string;
}

interface IcdCodeItem {
  ICD10CODE?: string;
  "DESCRIPTION\r"?: string;
}

const getTodayDateString = () => {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offset).toISOString().split("T")[0];
};

const emptyForm = (): ClaimFormState => ({
  patientName: "",
  patientSurname: "",
  billingRate: "Medical aid rates/No Copay, Private, Practice Profile",
  procedureDescription: "",
  procedureCode: "",
  icd10Code: "",
  theatreDate: getTodayDateString(),
  theatreStartTime: "",
  theatreEndTime: "",
  weight: "",
  height: "",
  bmiInfo: "",
  modifiers: "",
  extraNotes: "",
});

const calculateBMI = (weightKg: string, heightCm: string): string => {
  const w = parseFloat(weightKg);
  const h = parseFloat(heightCm) / 100;
  if (!w || !h || h === 0) return "";
  return (w / (h * h)).toFixed(1);
};

const ALL_ICD10_CODES = (icd10Database?.Employees?.Employee || []) as IcdCodeItem[];

const PRELOADED_MODIFIERS: ModifierOption[] = [
  { code: "0151", label: "Pre-anaesthetic assessment" },
  { code: "0147 + 0011", label: "Emergency, Possible PMB-Confirm if reports are available (radiology, xrays, labs) as this will greatly expidite PMB review" },
  { code: "0039", label: "Blood Pressure Control" },
  { code: "0026", label: "One Lung Ventilation" },
  { code: "0032", label: "Position other than supine or lithotomy" },
  { code: "0034", label: "Head, Neck and Shoulder" },
  { code: "0038", label: "Blood salvage/Cell saver" },
  { code: "0042", label: "Extra Corporeal Circulation" },
  { code: "0043", label: "Patients younger than 1 year or older than 70 years" },
  { code: "0044", label: "Neonates up to and including 28 days after birth" },
  { code: "0019", label: "Neonates with a low birthweight less than 2.5kg" },
  { code: "0018", label: "BMI higher than 35 (Indicate Height & Weight in notes below)" },
  { code: "5441", label: "Orthopedic Modifier (Carpal, Tarsal, Wrist, Ankle, All bones and muscles not mentioned below)" },
  { code: "5442", label: "Orthopedic Modifier (Shoulder, Scapula, Knee, Humerus, Clavicla, Upper 1/3 Tib/fib, Elbow, Mandible)" },
  { code: "5443", label: "Orthopedic Modifier (Orbital)" },
  { code: "5444", label: "Orthopedic Modifier (Shaft of Femur)" },
  { code: "5445", label: "Orthopedic Modifier (Spine,(exc.cocyx), Hip, Pelvis, Ribs, Skull)" },
  { code: "5448", label: "Orthopedic Modifier (Sternum)" },
  { code: "0109", label: "Hospital Follow up" },
  { code: "1204", label: "ICU care" },
  { code: "0007", label: "TCI" },
  { code: "1215", label: "A-line" },
  { code: "1218", label: "CVP" },
  { code: "1220", label: "Hire fee PCA" },
  { code: "1221", label: "PCA pump" },
  { code: "1780", label: "NG tube" },
  { code: "IV-UNDER-3", label: "Insertion IV line under 3 years. No Fee" },
  { code: "IV-ABOVE-3", label: "Insertion IV line above 3 years, No Fee" },
  { code: "EYE-BLOCK", label: "Eye Block+15min theatre time" },
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

export default function DashboardPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);
  const icdSearchRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<ClaimFormState>(emptyForm());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [extraImageFile, setExtraImageFile] = useState<File | null>(null);
  const [extraImagePreviewUrl, setExtraImagePreviewUrl] = useState<string | null>(null);

  const [icdSearch, setIcdSearch] = useState("");
  const [icdDropdownOpen, setIcdDropdownOpen] = useState(false);

  const [submittedCount, setSubmittedCount] = useState(0);
  const [holdCount, setHoldCount] = useState(0);

  const [totalClaimsCount, setTotalClaimsCount] = useState<number | null>(null);
  const [valueBilledTotal, setValueBilledTotal] = useState<number | null>(null);
  const [practiceSuccessRate, setPracticeSuccessRate] = useState<number | null>(null);

  const [liveTickets, setLiveTickets] = useState<TicketThread[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [chatReplyInput, setChatReplyInput] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);

  const supabase = createClient();

  // Auto-calculate BMI on form metric changes
  useEffect(() => {
    const bmi = calculateBMI(form.weight, form.height);
    setForm(p => ({ ...p, bmiInfo: bmi }));
  }, [form.weight, form.height]);

  const filteredIcdCodes = useMemo(() => {
    if (!icdSearch.trim()) return ALL_ICD10_CODES.slice(0, 10);
    const query = icdSearch.toLowerCase();
    return ALL_ICD10_CODES.filter(
      item =>
        item?.ICD10CODE?.toLowerCase().includes(query) ||
        item?.["DESCRIPTION\r"]?.toLowerCase().includes(query)
    ).slice(0, 10);
  }, [icdSearch]);

  const medicalAidWarnings = useMemo(() => {
    const warnings: string[] = [];
    const mods = form.modifiers.split(",").map(m => m.trim());
    const procedureCodes = form.procedureCode.split(",").map(c => c.trim());

    if (mods.includes("0147 + 0011") && !form.extraNotes.toLowerCase().includes("emergency")) {
      warnings.push("Emergency modifiers require motivation and supporting reports to apply for PMB.");
    }
    if (parseFloat(form.bmiInfo) > 35 && !mods.includes("0018")) {
      warnings.push("A registered BMI > 35 requires the selection of Modifier 0018.");
    }
    
    const diagnosticCodes = ["1587", "1653", "1493", "2207", "3047", "3058", "2137"];
    const hasDiagnostic = procedureCodes.some(code => diagnosticCodes.includes(code));
    if (mods.includes("0018") && hasDiagnostic) {
      warnings.push("Diagnostic and non-surgical procedures may not be billed with 0018.");
    }

    if (mods.includes("0043") && form.extraNotes.toLowerCase().indexOf("age") === -1) {
      warnings.push("Rule 0043 Warning: Patient age validation parameters must be clearly specified within your note layout.");
    }
    return warnings;
  }, [form.modifiers, form.bmiInfo, form.extraNotes, form.procedureCode]);

  useEffect(() => {
    function handleOutsideDropdownClicks(event: MouseEvent) {
      if (icdSearchRef.current && !icdSearchRef.current.contains(event.target as Node)) setIcdDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideDropdownClicks);
    return () => document.removeEventListener("mousedown", handleOutsideDropdownClicks);
  }, []);

  useEffect(() => {
    let claimsChannel: any;
    let ticketsChannel: any;

    async function initializeSync() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      claimsChannel = supabase
        .channel(`cl-sync-${authData.user.id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "claims", filter: `practitioner_id=eq.${authData.user.id}` }, () => setRealtimeTrigger(p => p + 1))
        .subscribe();

      ticketsChannel = supabase
        .channel(`tk-sync-${authData.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `practitioner_id=eq.${authData.user.id}` }, () => setRealtimeTrigger(p => p + 1))
        .subscribe();
    }
    initializeSync();
    return () => {
      if (claimsChannel) supabase.removeChannel(claimsChannel);
      if (ticketsChannel) supabase.removeChannel(ticketsChannel);
    };
  }, [supabase]);

  useEffect(() => {
    async function fetchLiveMetrics() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        const currentUserId = authData.user.id;

        const { data: monthClaims } = await supabase
          .from("claims")
          .select("status")
          .eq("practitioner_id", currentUserId);

        if (monthClaims) {
          setTotalClaimsCount(monthClaims.length);
          const successful = monthClaims.filter((c: any) => c.status === "captured" || c.status === "billed").length;
          setPracticeSuccessRate(monthClaims.length > 0 ? Math.round((successful / monthClaims.length) * 100) : 100);
        }

        const { data: manualReport } = await supabase
          .from("billing_reports")
          .select("total_billed_revenue")
          .eq("practitioner_id", currentUserId)
          .maybeSingle();

        if (manualReport) {
          setValueBilledTotal(Number(manualReport.total_billed_revenue) || 0);
        } else {
          setValueBilledTotal(0);
        }

        const { data: tk } = await supabase.from("tickets").select("*").eq("practitioner_id", currentUserId).order("updated_at", { ascending: false });
        if (tk) setLiveTickets(tk as TicketThread[]);
      } catch (err) {
        console.error(err);
      }
    }
    fetchLiveMetrics();
  }, [submittedCount, holdCount, realtimeTrigger, supabase]);

  useEffect(() => {
    if (!selectedTicketId) return;
    let msgChannel: any;

    async function fetchMessages() {
      const { data } = await supabase.from("ticket_messages").select("*").eq("ticket_id", selectedTicketId).order("created_at", { ascending: true });
      if (data) setTicketMessages(data as any[]);

      msgChannel = supabase
        .channel(`msg-sync-${selectedTicketId}`)
        .on("postgres_changes", { 
          event: "INSERT", 
          schema: "public", 
          table: "ticket_messages", 
          filter: `ticket_id=eq.${selectedTicketId}` 
        }, (payload: { new: TicketMessage }) => {
          setTicketMessages(prev => [...prev, payload.new]);
        })
        .subscribe();
    }
    fetchMessages();

    return () => { 
      if (msgChannel) supabase.removeChannel(msgChannel); 
    };
  }, [selectedTicketId, supabase]);

  const handleSendChatReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatReplyInput.trim() || !selectedTicketId) return;

    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      await supabase.from("ticket_messages").insert([
        { ticket_id: selectedTicketId, sender_id: authData.user.id, sender_role: "practitioner", message: chatReplyInput.trim() }
      ]);
      setChatReplyInput("");
    } catch (err) {
      console.error(err);
    }
  };

  const handlePingOffice = async () => {
    if (!selectedTicketId) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      await supabase.from("ticket_messages").insert([
        { 
          ticket_id: selectedTicketId, 
          sender_id: authData.user.id, 
          sender_role: "practitioner", 
          message: "⚠️ Practitioner requested an immediate case update status ping." 
        }
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkTicketComplete = async () => {
    if (!selectedTicketId) return;
    try {
      await supabase.from("tickets").update({ status: "closed" }).eq("id", selectedTicketId);
      setSelectedTicketId(null);
      setRealtimeTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
    }
  };

  const validateForm = (): string | null => {
    if (!form.icd10Code.trim()) return "ICD-10 Diagnostic Code choice is strictly required.";
    if (!form.theatreStartTime.trim()) return "Theatre Operations Start Clock parameter is required.";
    if (!form.theatreEndTime.trim()) return "Theatre Operations End Clock parameter is required.";
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleExtraFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (extraImagePreviewUrl) URL.revokeObjectURL(extraImagePreviewUrl);
    setExtraImageFile(file);
    setExtraImagePreviewUrl(URL.createObjectURL(file));
  };

  const clearImage = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    setImageFile(null);
  };

  const clearExtraImage = () => {
    if (extraImagePreviewUrl) URL.revokeObjectURL(extraImagePreviewUrl);
    setExtraImagePreviewUrl(null);
    setExtraImageFile(null);
  };

  const resetForm = () => {
    setForm(emptyForm());
    clearImage();
    clearExtraImage();
    setIcdSearch("");
    setError(null);
  };

  const handlePersistClaim = async (targetStatus: ClaimStatus) => {
    if (isSaving) return;
    if (targetStatus === "captured") {
      const errCheck = validateForm();
      if (errCheck) { setError(errCheck); return; }
    }

    setIsSaving(true);
    setError(null);

    try {
      let uploadedImageUrl = null;
      if (imageFile) {
        const path = `${crypto.randomUUID()}.${imageFile.name.split(".").pop()}`;
        const { error: upErr } = await supabase.storage.from("claim-attachments").upload(path, imageFile);
        if (upErr) throw upErr;
        uploadedImageUrl = supabase.storage.from("claim-attachments").getPublicUrl(path).data.publicUrl;
      }

      let uploadedExtraImageUrl = null;
      if (extraImageFile) {
        const path = `extra-${crypto.randomUUID()}.${extraImageFile.name.split(".").pop()}`;
        const { error: upErr } = await supabase.storage.from("claim-attachments").upload(path, extraImageFile);
        if (upErr) throw upErr;
        uploadedExtraImageUrl = supabase.storage.from("claim-attachments").getPublicUrl(path).data.publicUrl;
      }

      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) throw new Error("Authentication state lost.");
      const currentUserId = authData.user.id;

      const compositeNotes = `[Patient: ${form.patientName.trim() || "N/A"} ${form.patientSurname.trim() || "N/A"}] [Procedure Code: ${form.procedureCode.trim() || "None assigned"}] [Billing Rate: ${form.billingRate}] [Weight: ${form.weight || "N/A"}kg] [Height: ${form.height || "N/A"}cm] [BMI: ${form.bmiInfo || "N/A"}] ${form.extraNotes.trim()}`.trim();

      const { data: record, error: claimErr } = await supabase.from("claims").insert([
        {
          practitioner_id: currentUserId,
          procedure_description: form.procedureDescription || "Incomplete Case Record",
          icd10_code: form.icd10Code || null,
          theatre_start_time: form.theatreStartTime ? new Date(`${form.theatreDate}T${form.theatreStartTime}`).toISOString() : null,
          theatre_end_time: form.theatreEndTime ? new Date(`${form.theatreDate}T${form.theatreEndTime}`).toISOString() : null,
          bmi_info: form.bmiInfo ? parseFloat(form.bmiInfo) : null,
          modifiers: form.modifiers ? form.modifiers.split(",").map(m => m.trim()).filter(Boolean) : [],
          extra_notes: compositeNotes,
          image_url: uploadedImageUrl,
          extra_image_url: uploadedExtraImageUrl,
          status: targetStatus
        }
      ]).select().single();

      if (claimErr) throw claimErr;

      await supabase.from("audit_logs").insert([{ claim_id: record.id, user_id: currentUserId, action: "Claim authorized via desktop terminal input grid layer." }]);

      if (targetStatus === "captured") setSubmittedCount(c => c + 1);
      else setHoldCount(c => c + 1);
      resetForm();
    } catch (err: any) {
      setError(err.message || "Pipeline transfer error.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = useCallback((field: keyof ClaimFormState, value: string) => setForm(p => ({ ...p, [field]: value })), []);
  
  const selectIcdCode = (opt: { code: string; description: string }) => {
    updateField("icd10Code", opt.code);
    setIcdSearch(`${opt.code} — ${opt.description}`);
    setIcdDropdownOpen(false);
  };

  const toggleModifierCode = (c: string) => {
    const cur = form.modifiers ? form.modifiers.split(",").map(m => m.trim()).filter(Boolean) : [];
    const upd = cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
    updateField("modifiers", upd.join(", "));
  };

  const bmiMeta = useMemo(() => {
    const val = parseFloat(form.bmiInfo);
    if (!val) return { label: "", color: "text-slate-500" };
    if (val < 18.5) return { label: "Underweight", color: "text-blue-400" };
    if (val < 25) return { label: "Normal", color: "text-teal-400" };
    if (val < 30) return { label: "Overweight", color: "text-amber-400" };
    return { label: "Obese", color: "text-red-400" };
  }, [form.bmiInfo]);

  return (
    <div className="relative min-h-screen bg-[#0b0f14] text-slate-100 flex flex-col">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-15%,rgba(20,184,166,0.12),transparent)]" />

      <div className="relative mx-auto w-full max-w-[1680px] px-4 py-6 flex-1 flex flex-col gap-6">
        <header className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-teal-400">Mediburgh ClinTech v2</p>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">Practitioner Workspace</h1>
          </div>
          <div className="flex gap-2 font-mono text-xs">
            <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 text-teal-400">SUBMITTED: {submittedCount}</div>
            <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 text-amber-400">HELD: {holdCount}</div>
            <button onClick={() => window.location.href = "/"} className="bg-red-950/40 border border-red-500/30 px-3 text-red-400 font-sans uppercase tracking-wider font-semibold hover:bg-red-900/20 rounded-sm">Exit</button>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 flex-1">
          <section className={`xl:col-span-3 p-5 space-y-4 ${cardClassName}`}>
            {medicalAidWarnings.length > 0 && (
              <div className="rounded-sm border border-amber-500/30 bg-amber-950/20 p-3 space-y-1">
                {medicalAidWarnings.map((w, idx) => (
                  <p key={idx} className="text-xs font-medium text-amber-300/90 flex gap-2">⚠️ <span>{w}</span></p>
                ))}
              </div>
            )}

            {error && <div className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                {!imagePreviewUrl ? (
                  <div onClick={() => fileInputRef.current?.click()} className="flex min-h-[224px] cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed border-slate-700 bg-slate-950/40 hover:border-teal-500/40 transition p-4 text-center">
                    <p className="text-sm text-slate-400 font-medium">Capture Primary Hospital Billing Sheet</p>
                    <p className="text-xs text-slate-600 mt-1">PNG, JPEG, or camera integration</p>
                  </div>
                ) : (
                  <div className="relative border border-slate-800 rounded-sm bg-slate-950 p-2">
                    <img src={imagePreviewUrl} className="max-h-[224px] w-full object-contain mx-auto" alt="Primary Billing Sheet" />
                    <button onClick={clearImage} className="absolute top-4 right-4 bg-red-600 px-2 py-1 text-[10px] font-bold uppercase rounded-sm">Remove</button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

                {!extraImagePreviewUrl ? (
                  <div onClick={() => extraFileInputRef.current?.click()} className="flex min-h-[224px] cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed border-slate-800 bg-slate-950/20 hover:border-teal-500/30 transition p-4 text-center">
                    <p className="text-sm text-slate-500 font-medium">+ Add Supporting Document / Image</p>
                    <p className="text-xs text-slate-600 mt-1">Optional allocation sheet or secondary attachment</p>
                  </div>
                ) : (
                  <div className="relative border border-slate-800 rounded-sm bg-slate-950 p-2">
                    <img src={extraImagePreviewUrl} className="max-h-[224px] w-full object-contain mx-auto" alt="Extra Billing Sheet" />
                    <button onClick={clearExtraImage} className="absolute top-4 right-4 bg-red-600 px-2 py-1 text-[10px] font-bold uppercase rounded-sm">Remove</button>
                  </div>
                )}
                <input ref={extraFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleExtraFileChange} />
              </div>

              <form onSubmit={e => e.preventDefault()} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClassName}>Patient Name</label>
                    <input type="text" value={form.patientName} onChange={e => updateField("patientName", e.target.value)} className={inputClassName} placeholder="First name" />
                  </div>
                  <div>
                    <label className={labelClassName}>Surname</label>
                    <input type="text" value={form.patientSurname} onChange={e => updateField("patientSurname", e.target.value)} className={inputClassName} placeholder="Surname" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClassName}>Billing Rate Plan Strategy</label>
                    <select value={form.billingRate} onChange={e => updateField("billingRate", e.target.value)} className={`${inputClassName} bg-slate-950`}>
                      <option value="Medical aid rates, No Copay">Medical aid rates, No Copay</option>
                      <option value="Practice Profile">Practice Profile</option>
                      <option value="International/Private">International/Private</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClassName}>Procedure Code / Tariffs</label>
                    <input type="text" value={form.procedureCode} onChange={e => updateField("procedureCode", e.target.value)} className={inputClassName} placeholder="e.g. 0012, 5432" />
                  </div>
                </div>

                <div>
                  <label className={labelClassName}>Procedure Description</label>
                  <input type="text" value={form.procedureDescription} onChange={e => updateField("procedureDescription", e.target.value)} className={inputClassName} placeholder="Surgical description..." />
                </div>

                <div ref={icdSearchRef} className="relative">
                  <label className={`${labelClassName} text-teal-400 font-semibold`}>ICD-10 Diagnostic Search *</label>
                  <input type="text" value={icdSearch} onFocus={() => setIcdDropdownOpen(true)} onChange={e => setIcdSearch(e.target.value)} className={`${inputClassName} border-teal-900/50`} placeholder="Search diagnostic classifications..." />
                  {icdDropdownOpen && filteredIcdCodes.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-36 w-full overflow-y-auto bg-slate-950 border border-slate-800 rounded-sm divide-y divide-slate-900 shadow-2xl">
                      {filteredIcdCodes.map((i, idx) => {
                        const code = i?.ICD10CODE || "";
                        const desc = i?.["DESCRIPTION\r"] || "";
                        return (
                          <li key={code || idx} onClick={() => selectIcdCode({ code, description: desc })} className="px-3 py-2 text-xs hover:bg-slate-900 cursor-pointer flex justify-between gap-2">
                            <span className="text-teal-400 font-mono font-bold whitespace-nowrap">{code || "N/A"}</span>
                            <span className="text-slate-400 truncate max-w-xs">{desc}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2">
                  <div className="col-span-3">
                    <label className={labelClassName}>Theatre Operations Date</label>
                    <input type="date" value={form.theatreDate} onChange={e => updateField("theatreDate", e.target.value)} className={inputClassName} />
                  </div>
                  <div className="col-span-1">
                    <label className={`${labelClassName} text-teal-400 font-semibold`}>Start Clock *</label>
                    <input type="time" value={form.theatreStartTime} onChange={e => updateField("theatreStartTime", e.target.value)} className={`${inputClassName} border-teal-900/50`} />
                  </div>
                  <div className="col-span-1">
                    <label className={`${labelClassName} text-teal-400 font-semibold`}>End Clock *</label>
                    <input type="time" value={form.theatreEndTime} onChange={e => updateField("theatreEndTime", e.target.value)} className={`${inputClassName} border-teal-900/50`} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2">
                  <div>
                    <label className={labelClassName}>Weight (kg)</label>
                    <input type="number" min="0" step="0.1" value={form.weight} onChange={e => updateField("weight", e.target.value)} className={inputClassName} placeholder="75" />
                  </div>
                  <div>
                    <label className={labelClassName}>Height (cm)</label>
                    <input type="number" min="0" step="0.1" value={form.height} onChange={e => updateField("height", e.target.value)} className={inputClassName} placeholder="175" />
                  </div>
                  <div>
                    <label className={labelClassName}>BMI</label>
                    <div className={`${inputClassName} flex flex-col justify-center min-h-[38px]`}>
                      {form.bmiInfo ? (
                        <>
                          <span className={`font-mono font-bold text-sm ${bmiMeta.color}`}>{form.bmiInfo}</span>
                          <span className={`text-[9px] uppercase tracking-wider ${bmiMeta.color}`}>{bmiMeta.label}</span>
                        </>
                      ) : (
                        <span className="text-slate-600 text-xs">Auto</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelClassName}>Modifiers Selector Block</label>
                  <div className="flex flex-wrap gap-1 bg-slate-950 p-2 rounded-sm border border-slate-800 max-h-32 overflow-y-auto">
                    {PRELOADED_MODIFIERS.map(m => {
                      const isSel = form.modifiers.includes(m.code);
                      return (
                        <button 
                          key={m.code} 
                          type="button" 
                          onClick={() => toggleModifierCode(m.code)} 
                          title={m.label}
                          className={`px-2 py-0.5 rounded-sm font-mono text-[11px] transition text-left truncate max-w-full block w-full ${isSel ? "bg-teal-600 text-white border border-teal-400" : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"}`}
                        >
                          [{m.code}] <span className="opacity-70 font-sans text-[10px] ml-1">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={labelClassName}>Extra Diagnostic Notes</label>
                  <textarea rows={2} value={form.extraNotes} onChange={e => updateField("extraNotes", e.target.value)} className={`${inputClassName} resize-none`} placeholder="Anesthesia notes or system audit details..." />
                </div>
              </form>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
              <button onClick={() => handlePersistClaim("captured")} disabled={isSaving} className="bg-teal-600 font-semibold py-2.5 text-xs font-sans uppercase tracking-wider rounded-sm hover:bg-teal-500 disabled:opacity-40">
                {isSaving ? "Transmitting..." : "Transmit Claim Matrix"}
              </button>
              <button onClick={() => handlePersistClaim("on_hold")} disabled={isSaving} className="bg-amber-600 font-semibold py-2.5 text-xs font-sans uppercase tracking-wider text-amber-950 rounded-sm hover:bg-amber-500 disabled:opacity-40">
                Hold Case Token
              </button>
            </div>
          </section>

          <aside className="xl:col-span-2 flex flex-col gap-4">
            <div className={`p-4 ${cardClassName}`}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Live Practice Financial Pack</h3>
              <div className="grid grid-cols-3 text-center gap-2 mt-3 font-mono text-xs">
                <div className="bg-slate-950/60 p-2 border border-slate-900">
                  <span className="text-slate-500 block text-[9px] uppercase">MTD Volume</span>
                  <span className="text-lg font-bold text-white block mt-1">{totalClaimsCount ?? "0"}</span>
                </div>
                <div className="bg-slate-950/60 p-2 border border-slate-900">
                  <span className="text-slate-500 block text-[9px] uppercase">ZAR Revenue</span>
                  <span className="text-lg font-bold text-teal-400 block mt-1">R {valueBilledTotal?.toLocaleString() ?? "0"}</span>
                </div>
                <div className="bg-slate-950/60 p-2 border border-slate-900">
                  <span className="text-slate-500 block text-[9px] uppercase">Bureau Rate</span>
                  <span className="text-lg font-bold text-white block mt-1">{practiceSuccessRate ?? "100"}%</span>
                </div>
              </div>
            </div>

            <div className={`flex-1 flex flex-col overflow-hidden max-h-[460px] ${cardClassName}`}>
              <div className="border-b border-slate-800 px-4 py-3 bg-slate-950/40 flex justify-between items-center">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Interactive Adjudication Tickets</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Real-time chat resolution with your billing consultants</p>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-3 overflow-hidden">
                <ul className="col-span-1 border-r border-slate-800 divide-y divide-slate-900 overflow-y-auto bg-slate-950/20">
                  {liveTickets.map(t => (
                    <li key={t.id} onClick={() => setSelectedTicketId(t.id)} className={`p-2.5 cursor-pointer text-[11px] flex flex-col gap-1 hover:bg-slate-900/40 ${selectedTicketId === t.id ? "bg-slate-950 border-l-2 border-teal-500" : ""}`}>
                      <span className={`font-semibold truncate ${t.status === "urgent" ? "text-red-400" : "text-slate-200"}`}>{t.subject}</span>
                      <span className="text-slate-500 font-mono text-[9px] uppercase tracking-wide truncate">{t.medical_aid || "General Case"}</span>
                    </li>
                  ))}
                </ul>

                <div className="col-span-2 flex flex-col overflow-hidden bg-slate-950/40">
                  {selectedTicketId ? (
                    <>
                      <div className="flex gap-2 p-2 bg-slate-950/80 border-b border-slate-800/60">
                        <button 
                          onClick={handlePingOffice}
                          className="flex-1 rounded-sm bg-slate-900 border border-slate-700 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:bg-slate-800 transition"
                        >
                          ⚡ Ping Office
                        </button>
                        <button 
                          onClick={handleMarkTicketComplete}
                          className="flex-1 rounded-sm bg-teal-950/60 border border-teal-500/40 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-400 hover:bg-teal-900/40 transition"
                        >
                          ✓ Mark Resolved
                        </button>
                      </div>

                      <div className="flex-1 p-3 overflow-y-auto space-y-2 text-xs flex flex-col">
                        {ticketMessages.map(m => {
                          const isMe = m.sender_role === "practitioner";
                          return (
                            <div key={m.id} className={`max-w-[85%] rounded-sm p-2 flex flex-col ${isMe ? "bg-teal-950/40 border border-teal-500/20 text-teal-200 self-end" : "bg-slate-900 border border-slate-800 text-slate-300 self-start"}`}>
                              <span className="font-sans leading-relaxed">{m.message}</span>
                              <span className="text-[8px] font-mono text-slate-500 mt-1 self-end">{new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          );
                        })}
                      </div>
                      <form onSubmit={handleSendChatReply} className="border-t border-slate-800 p-2 flex bg-slate-950/80">
                        <input type="text" value={chatReplyInput} onChange={e => setChatReplyInput(e.target.value)} placeholder="Type chat update..." className="flex-1 bg-transparent px-2 text-xs text-slate-100 outline-none" />
                        <button type="submit" className="bg-teal-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm">Send</button>
                      </form>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-600 italic p-4 text-center">Select an open billing alert to join the interactive audit thread.</div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
