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

interface ProviderProfile {
  title_name_surname: string;
  pr_number: string;
  specialty: string;
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
  billingRate: "Practice Profile",
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
  { code: "IV-UNDER-3", label: "Insertion IV line under 3 years" },
  { code: "IV-ABOVE-3", label: "Insertion IV line above 3 years" },
  { code: "EYE-BLOCK", label: "Eye Block+15min theatre time" },
  { code: "2800", label: "Plexus Nerve Block" },
  { code: "2801", label: "Epidural Injection" },
  { code: "2802", label: "Peripheral Nerve Block" },
  { code: "2804", label: "Dwelling Nerve Catheter" },
  { code: "5103 + 0083", label: "Ultrasound" },
];

// ─── Design tokens ────────────────────────────────────────────────────────────
// Base: near-black #080c10 with a cool steel-blue undertone
// Accent: electric teal #00d4c8 (active/highlight)
// Signal amber: #f59e0b (hold/warn)
// Signal red: #ef4444 (errors/exit)
// Card surface: slate-900/60 with hairline border slate-800
// Header brand line: hot magenta #e91e8c  ←  the single bold risk
// ─────────────────────────────────────────────────────────────────────────────

const cardClassName =
  "rounded-md border border-slate-800/80 bg-slate-900/50 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-sm";

const inputClassName =
  "w-full rounded-md border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-400/80 focus:ring-1 focus:ring-teal-400/30";

const labelClassName =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400";

// ─── Stat card subcomponent ───────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-slate-800 bg-slate-950/60 p-3 text-center">
      {/* subtle left accent bar */}
      <div className={`absolute left-0 top-0 h-full w-0.5 ${accent ?? "bg-teal-500"}`} />
      <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">{label}</span>
      <span className={`mt-1 block font-mono text-xl font-extrabold ${accent ? "" : "text-white"}`}
        style={accent ? { color: accent === "bg-teal-500" ? "#2dd4bf" : accent === "bg-amber-500" ? "#f59e0b" : "#e2e8f0" } : {}}
      >{value}</span>
    </div>
  );
}

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

  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);

  const supabase = createClient();

  // Auto-calculate BMI
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
      warnings.push("GEMS Rulebook Alert: Emergency modifiers require motivation and supporting reports to apply for PMB.");
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

        const { data: profile } = await supabase
          .from("profiles")
          .select("title_name_surname, pr_number, specialty")
          .eq("id", currentUserId)
          .maybeSingle();

        if (profile) {
          setProviderProfile(profile as ProviderProfile);
        } else {
          setProviderProfile({
            title_name_surname: "Dr X Burke",
            pr_number: "PR0232610",
            specialty: "Anaesthesiologist"
          });
        }

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
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "ticket_messages", filter: `ticket_id=eq.${selectedTicketId}` }, (payload: { new: TicketMessage }) => {
          setTicketMessages(prev => [...prev, payload.new]);
        })
        .subscribe();
    }
    fetchMessages();
    return () => { if (msgChannel) supabase.removeChannel(msgChannel); };
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
    } catch (err) { console.error(err); }
  };

  const handlePingOffice = async () => {
    if (!selectedTicketId) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;
      await supabase.from("ticket_messages").insert([
        { ticket_id: selectedTicketId, sender_id: authData.user.id, sender_role: "practitioner", message: "⚠️ Practitioner requested an immediate case update status ping." }
      ]);
    } catch (err) { console.error(err); }
  };

  const handleMarkTicketComplete = async () => {
    if (!selectedTicketId) return;
    try {
      await supabase.from("tickets").update({ status: "closed" }).eq("id", selectedTicketId);
      setSelectedTicketId(null);
      setRealtimeTrigger(p => p + 1);
    } catch (err) { console.error(err); }
  };

  const validateForm = (): string | null => {
    if (!form.icd10Code.trim()) return "ICD-10 Diagnostic Code is required before submission.";
    if (!form.theatreStartTime.trim()) return "Theatre start time is required.";
    if (!form.theatreEndTime.trim()) return "Theatre end time is required.";
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

      const { data: record, error: claimErr } = await supabase.from("claims").insert([{
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
      }]).select().single();

      if (claimErr) throw claimErr;
      await supabase.from("audit_logs").insert([{ claim_id: record.id, user_id: currentUserId, action: "Claim submitted via Practitioner Workspace." }]);

      if (targetStatus === "captured") setSubmittedCount(c => c + 1);
      else setHoldCount(c => c + 1);
      resetForm();
    } catch (err: any) {
      setError(err.message || "Submission failed. Please try again.");
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

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-[#080c10] text-slate-100 flex flex-col font-sans">

      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(0,212,200,0.09) 0%, transparent 70%), radial-gradient(ellipse 40% 30% at 90% 10%, rgba(233,30,140,0.05) 0%, transparent 60%)"
        }}
      />

      <div className="relative mx-auto w-full max-w-[1720px] px-5 py-5 flex-1 flex flex-col gap-5">

        {/* ── HEADER ────────────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-0 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">

          {/* Left: Brand + practitioner identity */}
          <div className="flex flex-col gap-1">

            {/* App name — the bold brand moment */}
            <div className="flex items-baseline gap-2.5">
              {/* Magenta accent dot */}
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: "#e91e8c", boxShadow: "0 0 8px 2px rgba(233,30,140,0.55)" }}
              />
              <span
                className="text-[10px] font-bold tracking-[0.35em] uppercase"
                style={{ color: "#e91e8c" }}
              >
                by MediBurgh
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-none uppercase">
              The Doc Log
            </h1>

            {/* Practitioner identity strip */}
            {providerProfile ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Avatar initial badge */}
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-black text-white flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #00d4c8 0%, #007a74 100%)" }}
                >
                  {providerProfile.title_name_surname.replace(/^Dr\s+/i, "").charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
                  <span className="font-bold text-teal-300">{providerProfile.title_name_surname}</span>
                  <span className="text-slate-700">|</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: "rgba(0,212,200,0.1)", color: "#00d4c8", border: "1px solid rgba(0,212,200,0.25)" }}
                  >
                    {providerProfile.pr_number}
                  </span>
                  <span className="text-slate-700">|</span>
                  <span className="text-slate-400">{providerProfile.specialty}</span>
                </div>
              </div>
            ) : (
              <div className="mt-2 h-5 w-48 animate-pulse rounded bg-slate-800" />
            )}
          </div>

          {/* Right: Session counters + exit */}
          <div className="flex items-center gap-2 mt-3 sm:mt-0 font-mono text-xs flex-shrink-0">
            <div className="flex items-center gap-1.5 rounded-md border border-teal-500/25 bg-teal-950/30 px-3 py-2 text-teal-400">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
              SUBMITTED: <span className="font-black">{submittedCount}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-950/30 px-3 py-2 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              HELD: <span className="font-black">{holdCount}</span>
            </div>
            <button
              onClick={() => window.location.href = "/"}
              className="rounded-md border border-red-500/30 bg-red-950/40 px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-widest text-red-400 transition hover:bg-red-900/40 hover:border-red-400/50"
            >
              Exit
            </button>
          </div>
        </header>

        {/* ── MAIN GRID ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 flex-1">

          {/* ── LEFT: Claim capture form ──────────────────────────────────── */}
          <section className={`xl:col-span-3 p-5 space-y-4 ${cardClassName}`}>

            {/* Warnings */}
            {medicalAidWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 space-y-1.5">
                {medicalAidWarnings.map((w, idx) => (
                  <p key={idx} className="flex gap-2 text-[11px] font-medium text-amber-300/90">
                    <span>⚠️</span><span>{w}</span>
                  </p>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-950/30 px-4 py-2.5 text-[11px] text-red-300">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Image uploads */}
              <div className="space-y-3">
                {!imagePreviewUrl ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-[210px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-700/60 bg-slate-950/40 p-4 text-center transition hover:border-teal-500/50 hover:bg-slate-950/60"
                  >
                    {/* Upload icon */}
                    <svg className="mb-2 h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-sm font-semibold text-slate-400">Capture Primary Billing Sheet</p>
                    <p className="mt-1 text-xs text-slate-600">PNG, JPEG, or camera</p>
                  </div>
                ) : (
                  <div className="relative rounded-md border border-slate-800 bg-slate-950 p-2">
                    <img src={imagePreviewUrl} className="max-h-[210px] w-full rounded object-contain mx-auto" alt="Primary Billing Sheet" />
                    <button onClick={clearImage} className="absolute top-3 right-3 rounded bg-red-600 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-red-500">Remove</button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

                {!extraImagePreviewUrl ? (
                  <div
                    onClick={() => extraFileInputRef.current?.click()}
                    className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-800 bg-slate-950/20 p-3 text-center transition hover:border-teal-500/30"
                  >
                    <p className="text-sm font-medium text-slate-500">+ Add Supporting Document</p>
                    <p className="mt-0.5 text-xs text-slate-700">Allocation sheet or secondary attachment</p>
                  </div>
                ) : (
                  <div className="relative rounded-md border border-slate-800 bg-slate-950 p-2">
                    <img src={extraImagePreviewUrl} className="max-h-[130px] w-full rounded object-contain mx-auto" alt="Supporting Document" />
                    <button onClick={clearExtraImage} className="absolute top-3 right-3 rounded bg-red-600 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-red-500">Remove</button>
                  </div>
                )}
                <input ref={extraFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleExtraFileChange} />
              </div>

              {/* Form fields */}
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
                    <label className={labelClassName}>Billing Rate</label>
                    <select value={form.billingRate} onChange={e => updateField("billingRate", e.target.value)} className={`${inputClassName} bg-slate-950`}>
                      <option value="Practice Profile">Practice Profile</option>
                      <option value="Medical aid rates, No Copay">Medical aid rates, No Copay</option>
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

                {/* ICD-10 search */}
                <div ref={icdSearchRef} className="relative">
                  <label className={`${labelClassName} text-teal-400`}>
                    ICD-10 Diagnostic Search <span className="text-teal-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={icdSearch}
                    onFocus={() => setIcdDropdownOpen(true)}
                    onChange={e => setIcdSearch(e.target.value)}
                    className={`${inputClassName} border-teal-900/60 focus:border-teal-400/80`}
                    placeholder="Search diagnostic classifications..."
                  />
                  {icdDropdownOpen && filteredIcdCodes.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-slate-800 bg-slate-950 divide-y divide-slate-900/80 shadow-2xl">
                      {filteredIcdCodes.map((i, idx) => {
                        const code = i?.ICD10CODE || "";
                        const desc = i?.["DESCRIPTION\r"] || "";
                        return (
                          <li key={code || idx} onClick={() => selectIcdCode({ code, description: desc })} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs transition hover:bg-slate-900">
                            <span className="font-mono font-bold text-teal-400 whitespace-nowrap">{code || "N/A"}</span>
                            <span className="truncate text-slate-400">{desc}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Date & time row */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-3">
                  <div className="col-span-3 sm:col-span-1">
                    <label className={labelClassName}>Theatre Date</label>
                    <input type="date" value={form.theatreDate} onChange={e => updateField("theatreDate", e.target.value)} className={inputClassName} />
                  </div>
                  <div>
                    <label className={`${labelClassName} text-teal-400`}>Start Clock <span className="text-teal-500">*</span></label>
                    <input type="time" value={form.theatreStartTime} onChange={e => updateField("theatreStartTime", e.target.value)} className={`${inputClassName} border-teal-900/50`} />
                  </div>
                  <div>
                    <label className={`${labelClassName} text-teal-400`}>End Clock <span className="text-teal-500">*</span></label>
                    <input type="time" value={form.theatreEndTime} onChange={e => updateField("theatreEndTime", e.target.value)} className={`${inputClassName} border-teal-900/50`} />
                  </div>
                </div>

                {/* BMI row */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-3">
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

                {/* Modifiers */}
                <div>
                  <label className={labelClassName}>Modifiers Selector Block</label>
                  <div className="max-h-36 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-2 space-y-1 scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-slate-800">
                    {PRELOADED_MODIFIERS.map(m => {
                      const isSel = form.modifiers.includes(m.code);
                      return (
                        <button
                          key={m.code}
                          type="button"
                          onClick={() => toggleModifierCode(m.code)}
                          title={m.label}
                          className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[11px] transition ${isSel
                            ? "border border-teal-400/40 bg-teal-950/60 text-teal-300"
                            : "border border-transparent bg-slate-900/50 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                            }`}
                        >
                          <span className="font-mono font-bold whitespace-nowrap">[{m.code}]</span>
                          <span className="opacity-80 font-sans text-[10px] leading-tight">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={labelClassName}>Extra Diagnostic Notes</label>
                  <textarea rows={2} value={form.extraNotes} onChange={e => updateField("extraNotes", e.target.value)} className={`${inputClassName} resize-none`} placeholder="Anaesthesia notes or system audit details..." />
                </div>
              </form>
            </div>

            {/* CTA buttons */}
            <div className="grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-4">
              <button
                onClick={() => handlePersistClaim("captured")}
                disabled={isSaving}
                className="relative overflow-hidden rounded-md py-3 text-xs font-bold uppercase tracking-widest text-white transition disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #00a89e 0%, #006b68 100%)" }}
              >
                {isSaving ? "Submitting…" : "Submit Claim"}
              </button>
              <button
                onClick={() => handlePersistClaim("on_hold")}
                disabled={isSaving}
                className="rounded-md border border-amber-500/40 bg-amber-950/40 py-3 text-xs font-bold uppercase tracking-widest text-amber-300 transition hover:bg-amber-950/60 disabled:opacity-50"
              >
                Hold Case
              </button>
            </div>
          </section>

          {/* ── RIGHT: Financial pack + tickets ───────────────────────────── */}
          <aside className="xl:col-span-2 flex flex-col gap-4">

            {/* Financial pack */}
            <div className={`p-4 ${cardClassName}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">Live Financial Pack</h3>
                <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wider">MTD</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="relative overflow-hidden rounded-md border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <div className="absolute left-0 top-0 h-full w-0.5 bg-slate-500" />
                  <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Volume</span>
                  <span className="mt-1 block font-mono text-xl font-extrabold text-white">{totalClaimsCount ?? "0"}</span>
                </div>
                <div className="relative overflow-hidden rounded-md border border-teal-900/50 bg-slate-950/60 p-3 text-center">
                  <div className="absolute left-0 top-0 h-full w-0.5 bg-teal-500" />
                  <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">ZAR Revenue</span>
                  <span className="mt-1 block font-mono text-xl font-extrabold text-teal-400">R {valueBilledTotal?.toLocaleString() ?? "0"}</span>
                </div>
                <div className="relative overflow-hidden rounded-md border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <div className="absolute left-0 top-0 h-full w-0.5 bg-slate-400" />
                  <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Bureau Rate</span>
                  <span className="mt-1 block font-mono text-xl font-extrabold text-white">{practiceSuccessRate ?? "100"}%</span>
                </div>
              </div>
            </div>

            {/* Interactive Adjudication Tickets */}
            <div className={`flex-1 flex flex-col overflow-hidden max-h-[500px] ${cardClassName}`}>
              <div className="border-b border-slate-800/80 px-4 py-3 bg-slate-950/40">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-200">Adjudication Tickets</h3>
                <p className="mt-0.5 text-[10px] text-slate-500">Real-time chat with your billing consultants</p>
              </div>

              <div className="flex-1 grid grid-cols-3 overflow-hidden min-h-0">
                {/* Ticket list */}
                <ul className="col-span-1 border-r border-slate-800 divide-y divide-slate-900/60 overflow-y-auto bg-slate-950/20">
                  {liveTickets.length === 0 && (
                    <li className="p-3 text-[10px] text-slate-600 italic">No open tickets</li>
                  )}
                  {liveTickets.map(t => (
                    <li
                      key={t.id}
                      onClick={() => setSelectedTicketId(t.id)}
                      className={`cursor-pointer p-2.5 text-[11px] flex flex-col gap-0.5 transition hover:bg-slate-900/40 ${selectedTicketId === t.id ? "border-l-2 border-teal-500 bg-slate-950" : "border-l-2 border-transparent"}`}
                    >
                      <span className={`font-semibold truncate ${t.status === "urgent" ? "text-red-400" : "text-slate-200"}`}>{t.subject}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wide text-slate-500 truncate">{t.medical_aid || "General Case"}</span>
                    </li>
                  ))}
                </ul>

                {/* Ticket thread */}
                <div className="col-span-2 flex flex-col overflow-hidden bg-slate-950/30">
                  {selectedTicketId ? (
                    <>
                      <div className="flex gap-2 border-b border-slate-800/60 bg-slate-950/80 p-2">
                        <button
                          onClick={handlePingOffice}
                          className="flex-1 rounded border border-amber-500/30 bg-slate-900 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 transition hover:bg-slate-800"
                        >
                          ⚡ Ping Office
                        </button>
                        <button
                          onClick={handleMarkTicketComplete}
                          className="flex-1 rounded border border-teal-500/30 bg-teal-950/50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-400 transition hover:bg-teal-900/40"
                        >
                          ✓ Resolved
                        </button>
                      </div>

                      <div className="flex-1 flex flex-col space-y-2 overflow-y-auto p-3 text-xs">
                        {ticketMessages.map(m => {
                          const isMe = m.sender_role === "practitioner";
                          return (
                            <div
                              key={m.id}
                              className={`max-w-[88%] rounded-md p-2.5 flex flex-col ${isMe
                                ? "self-end border border-teal-500/20 bg-teal-950/40 text-teal-100"
                                : "self-start border border-slate-800 bg-slate-900 text-slate-300"
                                }`}
                            >
                              <span className="leading-relaxed">{m.message}</span>
                              <span className="mt-1 self-end font-mono text-[8px] text-slate-500">
                                {new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <form onSubmit={handleSendChatReply} className="flex border-t border-slate-800/80 bg-slate-950/80 p-2">
                        <input
                          type="text"
                          value={chatReplyInput}
                          onChange={e => setChatReplyInput(e.target.value)}
                          placeholder="Type a message…"
                          className="flex-1 bg-transparent px-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none"
                        />
                        <button type="submit" className="rounded bg-teal-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-teal-500 transition">Send</button>
                      </form>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-6 text-center">
                      <p className="text-xs italic text-slate-600">Select an open billing alert to join the audit thread.</p>
                    </div>
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
