"use client";

import { DragEvent, useCallback, useMemo, useRef, useState, useEffect } from "react";
import { createClient } from "@/utils/supabase";
import icd10Database from "@/data/ICD10.json";

type ClaimStatus = "captured" | "on_hold" | "billed";

interface ClaimFormState {
  patientName: string;
  patientSurname: string;
  medicalAid: string;
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

const getTodayDateString = () => {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offset).toISOString().split("T")[0];
};

const emptyForm = (): ClaimFormState => ({
  patientName: "",
  patientSurname: "",
  medicalAid: "Discovery Health",
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

const getMonthRangeLabel = (date: Date) => {
  return date.toLocaleString("en-ZA", { month: "long", year: "numeric" });
};

const ALL_ICD10_CODES = icd10Database.Employees.Employee;

const labelClassName = "block text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1";
const inputClassName = "w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/70";

export default function DashboardPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const icdSearchRef = useRef<HTMLDivElement>(null);
  const modSearchRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<ClaimFormState>(emptyForm());
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
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [chatReplyInput, setChatReplyInput] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);

  const supabase = createClient();
  const monthRange = useMemo(() => getMonthRangeLabel(new Date()), []);

  // Auto-calculate BMI when weight or height changes
  useEffect(() => {
    const bmi = calculateBMI(form.weight, form.height);
    setForm(p => ({ ...p, bmiInfo: bmi }));
  }, [form.weight, form.height]);

  const medicalAidWarnings = useMemo(() => {
    const warnings: string[] = [];
    const codes = form.procedureCode.split(",").map(c => c.trim());
    const mods = form.modifiers.split(",").map(m => m.trim());

    if (form.medicalAid === "GEMS" && mods.includes("0147 + 0011") && !form.extraNotes.toLowerCase().includes("emergency")) {
      warnings.push("GEMS Rulebook Alert: Emergency modifiers require explicit supporting context inside the Extra Notes field.");
    }
    if (form.medicalAid === "Discovery Health" && parseFloat(form.bmiInfo) > 35 && !mods.includes("0018")) {
      warnings.push("Discovery Rulebook Alert: A registered BMI > 35 requires the selection of Modifier 0018.");
    }
    if (mods.includes("0043") && form.extraNotes.toLowerCase().indexOf("age") === -1) {
      warnings.push("Rule 0043 Warning: Patient age validation parameters must be clearly specified within your note layout.");
    }
    return warnings;
  }, [form.medicalAid, form.procedureCode, form.modifiers, form.bmiInfo, form.extraNotes]);

  useEffect(() => {
    function handleOutsideDropdownClicks(event: MouseEvent) {
      if (icdSearchRef.current && !icdSearchRef.current.contains(event.target as Node)) setIcdDropdownOpen(false);
      if (modSearchRef.current && !modSearchRef.current.contains(event.target as Node)) setModDropdownOpen(false);
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
  }, []);

  useEffect(() => {
    async function fetchLiveMetrics() {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;
        const currentUserId = authData.user.id;

        const { data: monthClaims } = await supabase.from("claims").select("status").eq("practitioner_id", currentUserId);
        if (monthClaims) {
          setTotalClaimsCount(monthClaims.length);
          setValueBilledTotal(monthClaims.length * 1250);
          const successful = monthClaims.filter((c: any) => c.status === "captured" || c.status === "billed").length;
          setPracticeSuccessRate(monthClaims.length > 0 ? Math.round((successful / monthClaims.length) * 100) : 100);
        }

        const { data: tk } = await supabase.from("tickets").select("*").eq("practitioner_id", currentUserId).order("updated_at", { ascending: false });
        if (tk) setLiveTickets(tk as TicketThread[]);
      } catch (err) {
        console.error(err);
      }
    }
    fetchLiveMetrics();
  }, [submittedCount, holdCount, realtimeTrigger]);

  useEffect(() => {
    if (!selectedTicketId) return;
    async function fetchMessages() {
      const { data } = await supabase.from("ticket_messages").select("*").eq("ticket_id", selectedTicketId).order("created_at", { ascending: true });
      if (data) setTicketMessages(data as any[]);
    }
    fetchMessages();

    const msgChannel = supabase
      .channel(`msg-sync-${selectedTicketId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ticket_messages", filter: `ticket_id=eq.${selectedTicketId}` }, (payload: { new: TicketMessage }) => {
        setTicketMessages(prev => [...prev, payload.new as TicketMessage]);
      })
      .subscribe();

    return () => { supabase.removeChannel(msgChannel); };
  }, [selectedTicketId]);

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

  const validateForm = (): string | null => {
    if (!form.patientName.trim()) return "Patient name is required.";
    if (!form.patientSurname.trim()) return "Patient surname is required.";
    if (!form.procedureDescription.trim()) return "Procedure description is required.";
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handlePersistClaim = async (targetStatus: any) => {
    if (batchCompleted || isSaving) return;
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

      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData!.user.id;

      const compositeNotes = `[Patient: ${form.patientName.trim()} ${form.patientSurname.trim()}] [Procedure Code: ${form.procedureCode.trim() || "None assigned"}] [Medical Aid: ${form.medicalAid}] ${form.extraNotes.trim()}`.trim();

      const { data: record, error: claimErr } = await supabase.from("claims").insert([
        {
          practitioner_id: currentUserId,
          procedure_description: form.procedureDescription || "Incomplete Case Record",
          icd10_code: form.icd10Code || null,
          theatre_start_time: form.theatreStartTime ? new Date(`${form.theatreDate}T${form.theatreStartTime}`).toISOString() : null,
          theatre_end_time: form.theatreEndTime ? new Date(`${form.theatreDate}T${form.theatreEndTime}`).toISOString() : null,
          bmi_info: form.bmiInfo ? parseFloat(form.bmiInfo) : null,
          modifiers: form.modifiers ? form.modifiers.split(",").map(m => m.trim()) : [],
          extra_notes: compositeNotes,
          image_url: uploadedImageUrl,
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

  const resetForm = () => {
    setForm(emptyForm());
    setImageFile(null);
    setImagePreviewUrl(null);
    setIcdSearch("");
    setError(null);
    setStatusMessage(null);
  };

  const updateField = useCallback((field: keyof ClaimFormState, value: string) => setForm(p => ({ ...p, [field]: value })), []);
  const clearImage = () => { setImagePreviewUrl(null); setImageFile(null); };
  const selectIcdCode = (opt: any) => { updateField("icd10Code", opt.code); setIcdSearch(`${opt.code} — ${opt.description}`); setIcdDropdownOpen(false); };
  const toggleModifierCode = (c: string) => {
    const cur = form.modifiers ? form.modifiers.split(",").map(m => m.trim()).filter(Boolean) : [];
    const upd = cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
    updateField("modifiers", upd.join(", "));
  };

  const bmiCategory = (bmi: string): { label: string; color: string } => {
    const val = parseFloat(bmi);
    if (!val) return { label: "", color: "text-slate-500" };
    if (val < 18.5) return { label: "Underweight", color: "text-blue-400" };
    if (val < 25) return { label: "Normal", color: "text-teal-400" };
    if (val < 30) return { label: "Overweight", color: "text-amber-400" };
    return { label: "Obese", color: "text-red-400" };
  };

  const bmiMeta = bmiCategory(form.bmiInfo);

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
          {/* Main Form Entry */}
          <section className="xl:col-span-3 rounded-sm border border-slate-800 bg-slate-900/40 p-5 space-y-4">

            {medicalAidWarnings.length > 0 && (
              <div className="rounded-sm border border-amber-500/30 bg-amber-950/20 p-3 space-y-1">
                {medicalAidWarnings.map((w, idx) => (
                  <p key={idx} className="text-xs font-medium text-amber-300/90 flex gap-2">⚠️ <span>{w}</span></p>
                ))}
              </div>
            )}

            {error && <div className="rounded-sm border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Image Input Box */}
              <div>
                {!imagePreviewUrl ? (
                  <div onClick={() => fileInputRef.current?.click()} className="flex min-h-[460px] cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed border-slate-700 bg-slate-950/40 hover:border-teal-500/40 transition p-4">
                    <p className="text-sm text-slate-400 font-medium">Capture Hospital Billing Sheet</p>
                    <p className="text-xs text-slate-600 mt-1">PNG, JPEG, or device camera integration</p>
                  </div>
                ) : (
                  <div className="relative border border-slate-800 rounded-sm bg-slate-950 p-2">
                    <img src={imagePreviewUrl} className="max-h-[460px] w-full object-contain mx-auto" />
                    <button onClick={clearImage} className="absolute top-4 right-4 bg-red-600 px-2 py-1 text-[10px] font-bold uppercase rounded-sm">Remove</button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              </div>

              {/* Data Fields */}
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
                    <label className={labelClassName}>Medical Aid Fund</label>
                    <select value={form.medicalAid} onChange={e => updateField("medicalAid", e.target.value)} className={`${inputClassName} bg-slate-950`}>
                      <option value="Discovery Health">Discovery Health</option>
                      <option value="GEMS">GEMS</option>
                      <option value="Bonitas">Bonitas</option>
                      <option value="Medscheme Private">Medscheme Private</option>
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
                  <label className={labelClassName}>ICD-10 Diagnostic Search</label>
                  <input type="text" value={icdSearch} onFocus={() => setIcdDropdownOpen(true)} onChange={e => setIcdSearch(e.target.value)} className={inputClassName} placeholder="Search diagnostic classifications..." />
                  {icdDropdownOpen && (
                    <ul className="absolute z-20 mt-1 max-h-36 w-full overflow-y-auto bg-slate-950 border border-slate-800 rounded-sm divide-y divide-slate-900 shadow-2xl">
                      {ALL_ICD10_CODES.slice(0, 10).map((i: any) => (
                        <li key={i.ICD10CODE} onClick={() => selectIcdCode({ code: i.ICD10CODE, description: i["DESCRIPTION\r"] })} className="px-3 py-2 text-xs hover:bg-slate-900 cursor-pointer flex justify-between">
                          <span className="text-teal-400 font-mono font-bold">{i.ICD10CODE}</span>
                          <span className="text-slate-400 truncate max-w-xs">{i["DESCRIPTION\r"]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2">
                  <div className="col-span-3">
                    <label className={labelClassName}>Theatre Operations Date</label>
                    <input type="date" value={form.theatreDate} onChange={e => updateField("theatreDate", e.target.value)} className={inputClassName} />
                  </div>
                  <div className="col-span-1">
                    <label className={labelClassName}>Start Clock</label>
                    <input type="time" value={form.theatreStartTime} onChange={e => updateField("theatreStartTime", e.target.value)} className={inputClassName} />
                  </div>
                  <div className="col-span-1">
                    <label className={labelClassName}>End Clock</label>
                    <input type="time" value={form.theatreEndTime} onChange={e => updateField("theatreEndTime", e.target.value)} className={inputClassName} />
                  </div>
                </div>

                {/* Weight / Height / BMI Block */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2">
                  <div>
                    <label className={labelClassName}>Weight (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.weight}
                      onChange={e => updateField("weight", e.target.value)}
                      className={inputClassName}
                      placeholder="75"
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Height (cm)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.height}
                      onChange={e => updateField("height", e.target.value)}
                      className={inputClassName}
                      placeholder="175"
                    />
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
                  <div className="flex flex-wrap gap-1 bg-slate-950 p-2 rounded-sm border border-slate-800 max-h-24 overflow-y-auto">
                    {["0151", "0039", "0026", "0032", "5441", "1204"].map(m => {
                      const isSel = form.modifiers.includes(m);
                      return (
                        <button key={m} type="button" onClick={() => toggleModifierCode(m)} className={`px-2 py-0.5 rounded-sm font-mono text-xs transition ${isSel ? "bg-teal-600 text-white border border-teal-400" : "bg-slate-900 text-slate-500 border border-slate-800"}`}>[{m}]</button>
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

          {/* Analytics + Chat */}
          <aside className="xl:col-span-2 flex flex-col gap-4">
            <div className="rounded-sm border border-slate-800 bg-slate-900/40 p-4">
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

            <div className="rounded-sm border border-slate-800 bg-slate-900/40 flex-1 flex flex-col overflow-hidden max-h-[460px]">
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
