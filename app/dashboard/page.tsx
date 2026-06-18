"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase";
import icd10Database from "@/data/ICD10.json";
import {
  AppShell,
  ContentShell,
  AppHeader,
  AppCard,
  SectionTitle,
  FieldLabel,
  TextInput,
  SelectInput,
  TextArea,
  StatPill,
  ExitButton,
  MetricTile,
  MessageBubble,
  TicketListItem,
  inputClassName,
} from "@/components/doclog-ui";

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
  {
    code: "0147 + 0011",
    label:
      "Emergency, Possible PMB-Confirm if reports are available (radiology, xrays, labs) as this will greatly expidite PMB review",
  },
  { code: "0039", label: "Blood Pressure Control" },
  { code: "0026", label: "One Lung Ventilation" },
  { code: "0032", label: "Position other than supine or lithotomy" },
  { code: "0034", label: "Head, Neck and Shoulder" },
  { code: "0038", label: "Blood salvage/Cell saver" },
  { code: "0042", label: "Extra Corporeal Circulation" },
  {
    code: "0043",
    label: "Patients younger than 1 year or older than 70 years",
  },
  {
    code: "0044",
    label: "Neonates up to and including 28 days after birth",
  },
  {
    code: "0019",
    label: "Neonates with a low birthweight less than 2.5kg",
  },
  {
    code: "0018",
    label: "BMI higher than 35 (Indicate Height & Weight in notes below)",
  },
  {
    code: "5441",
    label:
      "Orthopedic Modifier (Carpal, Tarsal, Wrist, Ankle, All bones and muscles not mentioned below)",
  },
  {
    code: "5442",
    label:
      "Orthopedic Modifier (Shoulder, Scapula, Knee, Humerus, Clavicla, Upper 1/3 Tib/fib, Elbow, Mandible)",
  },
  { code: "5443", label: "Orthopedic Modifier (Orbital)" },
  { code: "5444", label: "Orthopedic Modifier (Shaft of Femur)" },
  {
    code: "5445",
    label:
      "Orthopedic Modifier (Spine,(exc.cocyx), Hip, Pelvis, Ribs, Skull)",
  },
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

  useEffect(() => {
    const bmi = calculateBMI(form.weight, form.height);
    setForm((p) => ({ ...p, bmiInfo: bmi }));
  }, [form.weight, form.height]);

  const filteredIcdCodes = useMemo(() => {
    if (!icdSearch.trim()) return ALL_ICD10_CODES.slice(0, 10);
    const query = icdSearch.toLowerCase();

    return ALL_ICD10_CODES.filter(
      (item) =>
        item?.ICD10CODE?.toLowerCase().includes(query) ||
        item?.["DESCRIPTION\r"]?.toLowerCase().includes(query)
    ).slice(0, 10);
  }, [icdSearch]);

  const medicalAidWarnings = useMemo(() => {
    const warnings: string[] = [];
    const mods = form.modifiers.split(",").map((m) => m.trim());
    const procedureCodes = form.procedureCode.split(",").map((c) => c.trim());

    if (
      mods.includes("0147 + 0011") &&
      !form.extraNotes.toLowerCase().includes("emergency")
    ) {
      warnings.push(
        "GEMS Rulebook Alert: Emergency modifiers require motivation and supporting reports to apply for PMB."
      );
    }

    if (parseFloat(form.bmiInfo) > 35 && !mods.includes("0018")) {
      warnings.push(
        "A registered BMI > 35 requires the selection of Modifier 0018."
      );
    }

    const diagnosticCodes = ["1587", "1653", "1493", "2207", "3047", "3058", "2137"];
    const hasDiagnostic = procedureCodes.some((code) =>
      diagnosticCodes.includes(code)
    );

    if (mods.includes("0018") && hasDiagnostic) {
      warnings.push(
        "Diagnostic and non-surgical procedures may not be billed with 0018."
      );
    }

    if (
      mods.includes("0043") &&
      form.extraNotes.toLowerCase().indexOf("age") === -1
    ) {
      warnings.push(
        "Rule 0043 Warning: Patient age validation parameters must be clearly specified within your note layout."
      );
    }

    return warnings;
  }, [form.modifiers, form.bmiInfo, form.extraNotes, form.procedureCode]);

  useEffect(() => {
    function handleOutsideDropdownClicks(event: MouseEvent) {
      if (
        icdSearchRef.current &&
        !icdSearchRef.current.contains(event.target as Node)
      ) {
        setIcdDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideDropdownClicks);
    return () =>
      document.removeEventListener("mousedown", handleOutsideDropdownClicks);
  }, []);

  useEffect(() => {
    let claimsChannel: any;
    let ticketsChannel: any;

    async function initializeSync() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      claimsChannel = supabase
        .channel(`cl-sync-${authData.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "claims",
            filter: `practitioner_id=eq.${authData.user.id}`,
          },
          () => setRealtimeTrigger((p) => p + 1)
        )
        .subscribe();

      ticketsChannel = supabase
        .channel(`tk-sync-${authData.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tickets",
            filter: `practitioner_id=eq.${authData.user.id}`,
          },
          () => setRealtimeTrigger((p) => p + 1)
        )
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
            specialty: "Anaesthesiologist",
          });
        }

        const { data: monthClaims } = await supabase
          .from("claims")
          .select("status")
          .eq("practitioner_id", currentUserId);

        if (monthClaims) {
          setTotalClaimsCount(monthClaims.length);
          const successful = monthClaims.filter(
            (c: any) => c.status === "captured" || c.status === "billed"
          ).length;

          setPracticeSuccessRate(
            monthClaims.length > 0
              ? Math.round((successful / monthClaims.length) * 100)
              : 100
          );
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

        const { data: tk } = await supabase
          .from("tickets")
          .select("*")
          .eq("practitioner_id", currentUserId)
          .order("updated_at", { ascending: false });

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
      const { data } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", selectedTicketId)
        .order("created_at", { ascending: true });

      if (data) setTicketMessages(data as TicketMessage[]);

      msgChannel = supabase
        .channel(`msg-sync-${selectedTicketId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ticket_messages",
            filter: `ticket_id=eq.${selectedTicketId}`,
          },
          (payload: { new: TicketMessage }) => {
            setTicketMessages((prev) => [...prev, payload.new]);
          }
        )
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
        {
          ticket_id: selectedTicketId,
          sender_id: authData.user.id,
          sender_role: "practitioner",
          message: chatReplyInput.trim(),
        },
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
          message: "⚠️ Practitioner requested an immediate case update status ping.",
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkTicketComplete = async () => {
    if (!selectedTicketId) return;

    try {
      await supabase
        .from("tickets")
        .update({ status: "closed" })
        .eq("id", selectedTicketId);

      setSelectedTicketId(null);
      setRealtimeTrigger((p) => p + 1);
    } catch (err) {
      console.error(err);
    }
  };

  const validateForm = (): string | null => {
    if (!form.icd10Code.trim()) {
      return "ICD-10 Diagnostic Code is required before submission.";
    }
    if (!form.theatreStartTime.trim()) {
      return "Theatre start time is required.";
    }
    if (!form.theatreEndTime.trim()) {
      return "Theatre end time is required.";
    }
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
      if (errCheck) {
        setError(errCheck);
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      let uploadedImageUrl = null;

      if (imageFile) {
        const path = `${crypto.randomUUID()}.${imageFile.name.split(".").pop()}`;
        const { error: upErr } = await supabase
          .storage
          .from("claim-attachments")
          .upload(path, imageFile);

        if (upErr) throw upErr;

        uploadedImageUrl = supabase
          .storage
          .from("claim-attachments")
          .getPublicUrl(path).data.publicUrl;
      }

      let uploadedExtraImageUrl = null;

      if (extraImageFile) {
        const path = `extra-${crypto.randomUUID()}.${extraImageFile.name
          .split(".")
          .pop()}`;

        const { error: upErr } = await supabase
          .storage
          .from("claim-attachments")
          .upload(path, extraImageFile);

        if (upErr) throw upErr;

        uploadedExtraImageUrl = supabase
          .storage
          .from("claim-attachments")
          .getPublicUrl(path).data.publicUrl;
      }

      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) throw new Error("Authentication state lost.");

      const currentUserId = authData.user.id;

      const compositeNotes = `[Patient: ${form.patientName.trim() || "N/A"} ${
        form.patientSurname.trim() || "N/A"
      }] [Procedure Code: ${form.procedureCode.trim() || "None assigned"}] [Billing Rate: ${
        form.billingRate
      }] [Weight: ${form.weight || "N/A"}kg] [Height: ${form.height || "N/A"}cm] [BMI: ${
        form.bmiInfo || "N/A"
      }] ${form.extraNotes.trim()}`.trim();

      const { data: record, error: claimErr } = await supabase
        .from("claims")
        .insert([
          {
            practitioner_id: currentUserId,
            procedure_description: form.procedureDescription || "Incomplete Case Record",
            icd10_code: form.icd10Code || null,
            theatre_start_time: form.theatreStartTime
              ? new Date(`${form.theatreDate}T${form.theatreStartTime}`).toISOString()
              : null,
            theatre_end_time: form.theatreEndTime
              ? new Date(`${form.theatreDate}T${form.theatreEndTime}`).toISOString()
              : null,
            bmi_info: form.bmiInfo ? parseFloat(form.bmiInfo) : null,
            modifiers: form.modifiers
              ? form.modifiers.split(",").map((m) => m.trim()).filter(Boolean)
              : [],
            extra_notes: compositeNotes,
            image_url: uploadedImageUrl,
            extra_image_url: uploadedExtraImageUrl,
            status: targetStatus,
          },
        ])
        .select()
        .single();

      if (claimErr) throw claimErr;

      await supabase.from("audit_logs").insert([
        {
          claim_id: record.id,
          user_id: currentUserId,
          action: "Claim submitted via Practitioner Workspace.",
        },
      ]);

      if (targetStatus === "captured") {
        setSubmittedCount((c) => c + 1);
      } else {
        setHoldCount((c) => c + 1);
      }

      resetForm();
    } catch (err: any) {
      setError(err.message || "Submission failed. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = useCallback(
    (field: keyof ClaimFormState, value: string) =>
      setForm((p) => ({ ...p, [field]: value })),
    []
  );

  const selectIcdCode = (opt: { code: string; description: string }) => {
    updateField("icd10Code", opt.code);
    setIcdSearch(`${opt.code} — ${opt.description}`);
    setIcdDropdownOpen(false);
  };

  const toggleModifierCode = (code: string) => {
    const current = form.modifiers
      ? form.modifiers.split(",").map((m) => m.trim()).filter(Boolean)
      : [];

    const updated = current.includes(code)
      ? current.filter((x) => x !== code)
      : [...current, code];

    updateField("modifiers", updated.join(", "));
  };

  const bmiMeta = useMemo(() => {
    const val = parseFloat(form.bmiInfo);

    if (!val) return { label: "", color: "text-[#7F8FA3]" };
    if (val < 18.5) return { label: "Underweight", color: "text-[#00C2D1]" };
    if (val < 25) return { label: "Normal", color: "text-[#00C2D1]" };
    if (val < 30) return { label: "Overweight", color: "text-[#E7B75B]" };

    return { label: "Obese", color: "text-red-400" };
  }, [form.bmiInfo]);

  return (
    <AppShell>
      <AppHeader
        title="THE DOC LOG"
        byline="BY MEDIBURGH"
        tagline="Clinical Speed. Restless Automation."
        subline="Real-Time Case Capture & Billing Matrix"
        right={
          <>
            <StatPill label="SUBMITTED" value={submittedCount} />
            <StatPill label="HELD" value={holdCount} />
            <ExitButton onClick={() => (window.location.href = "/")}>
              EXIT
            </ExitButton>
          </>
        }
      />

      <ContentShell>
        {providerProfile && (
          <div className="rounded-[14px] border border-[#1F242C] bg-[#10141A] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#7F8FA3]">
              <span className="font-semibold text-[#E8F1FF]">
                {providerProfile.title_name_surname}
              </span>
              <span>•</span>
              <span className="rounded border border-[#1F242C] bg-[#14181F] px-2 py-0.5 text-[#00C2D1]">
                {providerProfile.pr_number}
              </span>
              <span>•</span>
              <span>{providerProfile.specialty}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 flex-1">
          <section className="xl:col-span-3">
            <AppCard className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#232A33] pb-2">
                <SectionTitle className="mb-0">
                  Primary Billing Sheet
                </SectionTitle>
                <span className="text-[10px] font-medium uppercase tracking-[0.8px] text-[#6C7A89]">
                  Case Capture Panel
                </span>
              </div>

              {medicalAidWarnings.length > 0 && (
                <div className="rounded-[14px] border border-[#3B3120] bg-[#14181F] p-3 space-y-1">
                  {medicalAidWarnings.map((warning, idx) => (
                    <p
                      key={idx}
                      className="flex gap-2 text-[11px] text-[#E7B75B]"
                    >
                      <span>⚠️</span>
                      <span>{warning}</span>
                    </p>
                  ))}
                </div>
              )}

              {error && (
                <div className="rounded-[14px] border border-[#5A2323] bg-[#14181F] px-3 py-2 text-[11px] font-semibold text-red-400">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  {!imagePreviewUrl ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-[14px] border border-[#1F242C] bg-[#14181F] p-4 text-center transition hover:border-[#00C2D1]"
                    >
                      <svg
                        className="mb-2 h-6 w-6 text-[#00C2D1]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                        />
                      </svg>

                      <p className="text-xs font-semibold uppercase tracking-[0.8px] text-[#DDE7F5]">
                        Capture Primary Billing Sheet
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#6C7A89]">
                        PNG, JPEG, OR CAMERA
                      </p>
                    </div>
                  ) : (
                    <div className="relative rounded-[14px] border border-[#1F242C] bg-[#14181F] p-2">
                      <img
                        src={imagePreviewUrl}
                        className="mx-auto max-h-[180px] w-full rounded object-contain"
                        alt="Primary Billing Sheet"
                      />
                      <button
                        onClick={clearImage}
                        className="absolute right-2 top-2 rounded-[10px] border border-[#5A2323] bg-[#2A1313] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.6px] text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {!extraImagePreviewUrl ? (
                    <div
                      onClick={() => extraFileInputRef.current?.click()}
                      className="flex min-h-[100px] cursor-pointer flex-col items-center justify-center rounded-[14px] border border-[#1F242C] bg-[#14181F] p-3 text-center transition hover:border-[#00C2D1]"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.8px] text-[#A9B7CA]">
                        + Add Supporting Document
                      </p>
                      <p className="mt-0.5 text-[9px] text-[#6C7A89]">
                        Allocation Sheet / Report Attachment
                      </p>
                    </div>
                  ) : (
                    <div className="relative rounded-[14px] border border-[#1F242C] bg-[#14181F] p-2">
                      <img
                        src={extraImagePreviewUrl}
                        className="mx-auto max-h-[100px] w-full rounded object-contain"
                        alt="Supporting Document"
                      />
                      <button
                        onClick={clearExtraImage}
                        className="absolute right-2 top-2 rounded-[10px] border border-[#5A2323] bg-[#2A1313] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.6px] text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <input
                    ref={extraFileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleExtraFileChange}
                  />
                </div>

                <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Patient Name</FieldLabel>
                      <TextInput
                        type="text"
                        value={form.patientName}
                        onChange={(e) => updateField("patientName", e.target.value)}
                        placeholder="First name"
                      />
                    </div>

                    <div>
                      <FieldLabel>Surname</FieldLabel>
                      <TextInput
                        type="text"
                        value={form.patientSurname}
                        onChange={(e) =>
                          updateField("patientSurname", e.target.value)
                        }
                        placeholder="Surname"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Billing Rate</FieldLabel>
                      <SelectInput
                        value={form.billingRate}
                        onChange={(e) => updateField("billingRate", e.target.value)}
                      >
                        <option value="Practice Profile">Practice Profile</option>
                        <option value="Medical aid rates, No Copay">
                          Medical aid rates, No Copay
                        </option>
                        <option value="International/Private">
                          International/Private
                        </option>
                      </SelectInput>
                    </div>

                    <div>
                      <FieldLabel>Procedure Code / Tariffs</FieldLabel>
                      <TextInput
                        type="text"
                        value={form.procedureCode}
                        onChange={(e) =>
                          updateField("procedureCode", e.target.value)
                        }
                        placeholder="e.g. 0012, 5432"
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Procedure Description</FieldLabel>
                    <TextInput
                      type="text"
                      value={form.procedureDescription}
                      onChange={(e) =>
                        updateField("procedureDescription", e.target.value)
                      }
                      placeholder="Surgical description..."
                    />
                  </div>

                  <div ref={icdSearchRef} className="relative">
                    <FieldLabel className="text-[#00C2D1]">
                      ICD-10 Diagnostic Search *
                    </FieldLabel>

                    <TextInput
                      type="text"
                      value={icdSearch}
                      onFocus={() => setIcdDropdownOpen(true)}
                      onChange={(e) => setIcdSearch(e.target.value)}
                      placeholder="Search diagnostic classifications..."
                    />

                    {icdDropdownOpen && filteredIcdCodes.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-[14px] border border-[#1F242C] bg-[#10141A] divide-y divide-[#232A33] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                        {filteredIcdCodes.map((item, idx) => {
                          const code = item?.ICD10CODE || "";
                          const desc = item?.["DESCRIPTION\r"] || "";

                          return (
                            <li
                              key={code || idx}
                              onClick={() =>
                                selectIcdCode({ code, description: desc })
                              }
                              className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs transition hover:bg-[#16232A]"
                            >
                              <span className="whitespace-nowrap font-mono font-semibold text-[#00C2D1]">
                                {code || "N/A"}
                              </span>
                              <span className="truncate text-[#DDE7F5]">
                                {desc}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-[#232A33] pt-2.5">
                    <div className="col-span-3 sm:col-span-1">
                      <FieldLabel>Theatre Date</FieldLabel>
                      <TextInput
                        type="date"
                        value={form.theatreDate}
                        onChange={(e) => updateField("theatreDate", e.target.value)}
                      />
                    </div>

                    <div>
                      <FieldLabel className="text-[#00C2D1]">
                        Start Clock *
                      </FieldLabel>
                      <TextInput
                        type="time"
                        value={form.theatreStartTime}
                        onChange={(e) =>
                          updateField("theatreStartTime", e.target.value)
                        }
                      />
                    </div>

                    <div>
                      <FieldLabel className="text-[#00C2D1]">
                        End Clock *
                      </FieldLabel>
                      <TextInput
                        type="time"
                        value={form.theatreEndTime}
                        onChange={(e) =>
                          updateField("theatreEndTime", e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-[#232A33] pt-2.5">
                    <div>
                      <FieldLabel>Weight (kg)</FieldLabel>
                      <TextInput
                        type="number"
                        min="0"
                        step="0.1"
                        value={form.weight}
                        onChange={(e) => updateField("weight", e.target.value)}
                        placeholder="75"
                      />
                    </div>

                    <div>
                      <FieldLabel>Height (cm)</FieldLabel>
                      <TextInput
                        type="number"
                        min="0"
                        step="0.1"
                        value={form.height}
                        onChange={(e) => updateField("height", e.target.value)}
                        placeholder="175"
                      />
                    </div>

                    <div>
                      <FieldLabel>BMI</FieldLabel>
                      <div className={`${inputClassName} flex items-center`}>
                        {form.bmiInfo ? (
                          <div className="flex w-full items-baseline justify-between">
                            <span className={`font-mono text-sm font-semibold ${bmiMeta.color}`}>
                              {form.bmiInfo}
                            </span>
                            <span className={`text-[8px] font-semibold uppercase tracking-[0.6px] ${bmiMeta.color}`}>
                              {bmiMeta.label}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-[#6C7A89]">
                            AUTO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Modifiers Selector Block</FieldLabel>
                    <div className="max-h-28 overflow-y-auto rounded-[14px] border border-[#1F242C] bg-[#14181F] p-1 space-y-0.5">
                      {PRELOADED_MODIFIERS.map((modifier) => {
                        const isSelected =
                          form.modifiers
                            .split(",")
                            .map((m) => m.trim())
                            .filter(Boolean)
                            .includes(modifier.code);

                        return (
                          <button
                            key={modifier.code}
                            type="button"
                            onClick={() => toggleModifierCode(modifier.code)}
                            title={modifier.label}
                            className={`flex w-full items-start gap-2 rounded-[10px] px-2 py-1 text-left text-[11px] transition ${
                              isSelected
                                ? "border border-[#00C2D1] bg-[#16232A] text-[#DDE7F5] font-semibold"
                                : "border border-transparent text-[#9AA4B2] hover:bg-[#111820] hover:text-[#DDE7F5]"
                            }`}
                          >
                            <span className="font-mono whitespace-nowrap">
                              [{modifier.code}]
                            </span>
                            <span className="truncate text-[10px]">
                              {modifier.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Extra Diagnostic Notes</FieldLabel>
                    <TextArea
                      rows={1}
                      value={form.extraNotes}
                      onChange={(e) => updateField("extraNotes", e.target.value)}
                      placeholder="Anaesthesia notes or system audit details..."
                    />
                  </div>
                </form>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-[#232A33] pt-3">
                <button
                  onClick={() => handlePersistClaim("captured")}
                  disabled={isSaving}
                  className="rounded-[10px] border border-[#00C2D1] bg-[#14181F] py-2.5 text-xs font-semibold uppercase tracking-[0.8px] text-[#00C2D1] transition hover:bg-[#16232A] disabled:opacity-50"
                >
                  {isSaving ? "Submitting…" : "Submit Claim"}
                </button>

                <button
                  onClick={() => handlePersistClaim("on_hold")}
                  disabled={isSaving}
                  className="rounded-[10px] border border-[#735A22] bg-[#14181F] py-2.5 text-xs font-semibold uppercase tracking-[0.8px] text-[#E7B75B] transition hover:bg-[#2A2315] disabled:opacity-50"
                >
                  Hold Case
                </button>
              </div>
            </AppCard>
          </section>

          <aside className="xl:col-span-2 flex flex-col gap-4">
            <AppCard>
              <div className="mb-2.5 flex items-center justify-between border-b border-[#232A33] pb-1">
                <SectionTitle className="mb-0">
                  Live Financial Pack
                </SectionTitle>
                <span className="text-[10px] font-medium uppercase tracking-[0.8px] text-[#6C7A89]">
                  MTD Metrics
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <MetricTile
                  label="Volume"
                  value={totalClaimsCount ?? 0}
                  emphasis="accent"
                />
                <MetricTile
                  label="Revenue"
                  value={`R ${valueBilledTotal?.toLocaleString() ?? 0}`}
                  emphasis="primary"
                />
                <MetricTile
                  label="Bureau Rate"
                  value={`${practiceSuccessRate ?? 100}%`}
                  emphasis="success"
                />
              </div>
            </AppCard>

            <AppCard className="flex-1 flex flex-col overflow-hidden max-h-[440px]">
              <div className="border-b border-[#232A33] pb-2">
                <SectionTitle className="mb-0">
                  Adjudication Tickets
                </SectionTitle>
                <p className="text-[9px] uppercase tracking-[0.6px] text-[#6C7A89]">
                  Real-time chat with billing consultants
                </p>
              </div>

              <div className="min-h-0 flex-1 grid grid-cols-3 overflow-hidden pt-2">
                <ul className="col-span-1 overflow-y-auto border-r border-[#232A33] pr-1 space-y-1">
                  {liveTickets.length === 0 && (
                    <li className="p-2 text-[10px] italic text-[#6C7A89]">
                      NO OPEN TICKETS
                    </li>
                  )}

                  {liveTickets.map((ticket) => (
                    <TicketListItem
                      key={ticket.id}
                      active={selectedTicketId === ticket.id}
                      title={
                        <span
                          className={
                            ticket.status === "urgent" ? "text-red-400" : ""
                          }
                        >
                          {ticket.subject}
                        </span>
                      }
                      subtitle={ticket.medical_aid || "General Case"}
                      onClick={() => setSelectedTicketId(ticket.id)}
                    />
                  ))}
                </ul>

                <div className="col-span-2 flex flex-col overflow-hidden pl-2">
                  {selectedTicketId ? (
                    <>
                      <div className="flex gap-2 border-b border-[#232A33] pb-2">
                        <button
                          onClick={handlePingOffice}
                          className="flex-1 rounded-[10px] border border-[#735A22] bg-[#14181F] py-1 text-[10px] font-semibold uppercase tracking-[0.8px] text-[#E7B75B] transition hover:bg-[#2A2315]"
                        >
                          ⚡ Ping Office
                        </button>

                        <button
                          onClick={handleMarkTicketComplete}
                          className="flex-1 rounded-[10px] border border-[#00C2D1] bg-[#14181F] py-1 text-[10px] font-semibold uppercase tracking-[0.8px] text-[#00C2D1] transition hover:bg-[#16232A]"
                        >
                          ✓ Resolved
                        </button>
                      </div>

                      <div className="flex-1 space-y-2 overflow-y-auto py-2 pr-1 text-xs">
                        {ticketMessages.map((message) => (
                          <MessageBubble
                            key={message.id}
                            isMine={message.sender_role === "practitioner"}
                            timestamp={new Date(message.created_at).toLocaleTimeString(
                              "en-ZA",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          >
                            {message.message}
                          </MessageBubble>
                        ))}
                      </div>

                      <form
                        onSubmit={handleSendChatReply}
                        className="flex border-t border-[#232A33] pt-2"
                      >
                        <input
                          type="text"
                          value={chatReplyInput}
                          onChange={(e) => setChatReplyInput(e.target.value)}
                          placeholder="Type a message…"
                          className="flex-1 bg-transparent pr-2 text-xs font-medium text-[#E8F1FF] outline-none placeholder:text-[#6C7A89]"
                        />
                        <button
                          type="submit"
                          className="rounded-[10px] border border-[#00C2D1] bg-[#14181F] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.8px] text-[#00C2D1] hover:bg-[#16232A]"
                        >
                          Send
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-4 text-center">
                      <p className="text-[10px] uppercase tracking-[0.8px] text-[#6C7A89]">
                        Select an active adjudication thread to view details.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </AppCard>
          </aside>
        </div>
      </ContentShell>
    </AppShell>
  );
}
