"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/utils/supabase";

interface ClaimRecord {
  id: string;
  created_at: string;
  procedure_description: string;
  icd10_code: string | null;
  theatre_start_time: string | null;
  theatre_end_time: string | null;
  bmi_info: number | null;
  modifiers: string[];
  extra_notes: string;
  image_url: string | null;
  extra_image_url: string | null;
  status: "captured" | "on_hold" | "billed";
  practitioner_id: string;
  profiles?: {
    title_name_surname: string;
    pr_number: string;
    specialty: string;
  };
}

interface TicketThread {
  id: string;
  subject: string;
  status: "open" | "closed" | "urgent";
  updated_at: string;
  practitioner_id: string;
  medical_aid?: string;
  profiles?: {
    title_name_surname: string;
  };
}

interface TicketMessage {
  id: string;
  message: string;
  sender_role: "billing_team" | "practitioner";
  created_at: string;
}

// ─── Surgical Clean Styling Tokens ───────────────────────────────────────────
const cardClassName =
  "rounded border border-cyan-500/40 bg-black p-5 shadow-[0_10px_40px_rgba(0,0,0,0.9)]";

const inputClassName =
  "w-full rounded border border-cyan-400 bg-black px-3 py-1.5 text-sm font-bold text-cyan-400 placeholder:text-cyan-900 outline-none transition focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300/20 min-h-[36px] [color-scheme:dark]";

const labelClassName =
  "mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-200";

export default function OfficeDashboard() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [tickets, setTickets] = useState<TicketThread[]>([]);
  
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  
  const [chatInput, setChatInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "captured" | "on_hold" | "billed">("all");
  
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const supabase = createClient();

  // Fetch Claims and Tickets
  useEffect(() => {
    async function fetchOfficeData() {
      const { data: claimsData } = await supabase
        .from("claims")
        .select("*, profiles(title_name_surname, pr_number, specialty)")
        .order("created_at", { ascending: false });
        
      if (claimsData) setClaims(claimsData as ClaimRecord[]);

      const { data: ticketsData } = await supabase
        .from("tickets")
        .select("*, profiles(title_name_surname)")
        .order("updated_at", { ascending: false });
        
      if (ticketsData) setTickets(ticketsData as TicketThread[]);
    }
    fetchOfficeData();
  }, [realtimeTrigger, supabase]);

  // Fetch Messages for Active Thread
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
        .channel(`office-msg-${selectedTicketId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "ticket_messages", filter: `ticket_id=eq.${selectedTicketId}` }, (payload) => {
          setTicketMessages(prev => [...prev, payload.new as TicketMessage]);
        })
        .subscribe();
    }
    fetchMessages();
    return () => { if (msgChannel) supabase.removeChannel(msgChannel); };
  }, [selectedTicketId, supabase]);

  // Realtime Subscriptions for global dashboard metrics
  useEffect(() => {
    const claimsChan = supabase
      .channel("office-claims-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, () => setRealtimeTrigger(p => p + 1))
      .subscribe();

    const ticketsChan = supabase
      .channel("office-tickets-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => setRealtimeTrigger(p => p + 1))
      .subscribe();

    return () => {
      supabase.removeChannel(claimsChan);
      supabase.removeChannel(ticketsChan);
    };
  }, [supabase]);

  // Filtered Claims pipeline
  const filteredClaims = useMemo(() => {
    return claims.filter(c => {
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const providerName = c.profiles?.title_name_surname?.toLowerCase() || "";
      const desc = c.procedure_description?.toLowerCase() || "";
      const query = searchFilter.toLowerCase();
      const matchesSearch = providerName.includes(query) || desc.includes(query) || c.icd10_code?.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [claims, statusFilter, searchFilter]);

  // Financial calculations
  const metrics = useMemo(() => {
    const captured = claims.filter(c => c.status === "captured").length;
    const hold = claims.filter(c => c.status === "on_hold").length;
    const billed = claims.filter(c => c.status === "billed").length;
    return { captured, hold, billed };
  }, [claims]);

  const handleUpdateStatus = async (claimId: string, nextStatus: ClaimStatus) => {
    setIsProcessing(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      await supabase.from("claims").update({ status: nextStatus }).eq("id", claimId);
      await supabase.from("audit_logs").insert([{ claim_id: claimId, user_id: authData.user?.id, action: `Claim status changed to ${nextStatus} via Office Audit Panel.` }]);
      setSelectedClaim(prev => prev?.id === claimId ? { ...prev, status: nextStatus } : prev);
      setRealtimeTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedTicketId) return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      await supabase.from("ticket_messages").insert([
        { ticket_id: selectedTicketId, sender_id: authData.user?.id, sender_role: "billing_team", message: chatInput.trim() }
      ]);
      setChatInput("");
    } catch (err) { console.error(err); }
  };

  const handleCreateTicket = async (claim: ClaimRecord) => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const { data: nextTicket } = await supabase.from("tickets").insert([{
        practitioner_id: claim.practitioner_id,
        subject: `Audit Query: ${claim.icd10_code || "No ICD10"}`,
        medical_aid: claim.extra_notes.match(/\[Billing Rate:\s*([^\]]+)\]/)?.[1] || "Review Required",
        status: "open"
      }]).select().single();

      if (nextTicket) {
        await supabase.from("ticket_messages").insert([
          { ticket_id: nextTicket.id, sender_id: authData.user?.id, sender_role: "billing_team", message: `System initiated audit trail for case details: ${claim.procedure_description}. Please review and update parameters.` }
        ]);
        setSelectedTicketId(nextTicket.id);
      }
    } catch (err) { console.error(err); }
  };

  return (
    <div className="relative min-h-screen bg-black text-slate-100 flex flex-col font-sans antialiased selection:bg-cyan-500/30">
      <div className="relative mx-auto w-full max-w-[1720px] px-4 py-4 flex-1 flex flex-col gap-4">

        {/* ── HEADER ────────────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-cyan-500/20 pb-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-cyan-400">by MediBurgh</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white uppercase">ClinTech Audit Control</h1>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-slate-400">
              <span className="font-bold text-cyan-400">Central Back-Office Engine</span>
              <span>•</span>
              <span>System-wide Bureau Auditing Grid</span>
            </div>
          </div>

          {/* Session Counters */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <div className="rounded border border-cyan-500/30 bg-black px-3 py-1.5 text-cyan-400 font-bold">
              UNRESOLVED: <span>{metrics.captured}</span>
            </div>
            <div className="rounded border border-amber-500/30 bg-black px-3 py-1.5 text-amber-400 font-bold">
              HELD CASES: <span>{metrics.hold}</span>
            </div>
            <div className="rounded border border-emerald-500/30 bg-black px-3 py-1.5 text-emerald-400 font-bold">
              BILLED MTD: <span>{metrics.billed}</span>
            </div>
          </div>
        </header>

        {/* ── CONTROLS STRIP ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Filter by practitioner, code, or description..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className={inputClassName}
          />
          <div className="flex gap-2">
            {(["all", "captured", "on_hold", "billed"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`flex-1 rounded border text-xs font-bold uppercase tracking-wider py-1.5 transition ${statusFilter === st
                  ? "border-cyan-400 bg-cyan-950/40 text-cyan-300"
                  : "border-cyan-500/20 bg-black text-slate-400 hover:text-cyan-400"
                }`}
              >
                {st.replace("_", " ")}
              </button>
            ))}
          </div>
          <div className="text-right flex items-center justify-end font-mono text-[11px] text-cyan-600">
            TOTAL ENGINES COMPLIANT • REALTIME LIVE SYNC
          </div>
        </div>

        {/* ── MAIN AUDIT CONTROL GRID ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 flex-1">

          {/* ── LEFT TABLE: Claims queue listing ───────────────────────────── */}
          <section className={`xl:col-span-3 overflow-hidden flex flex-col ${cardClassName}`}>
            <div className="border-b border-cyan-500/20 pb-2 mb-2 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-white">Inbound Billing Pipeline</h2>
              <span className="text-[10px] font-mono text-cyan-400/70">QUEUE COUNT: {filteredClaims.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-cyan-950/60 max-h-[680px] pr-1 scrollbar-thin scrollbar-thumb-cyan-950">
              {filteredClaims.length === 0 ? (
                <div className="p-8 text-center text-xs italic text-cyan-900 font-mono">NO VERIFIED ATTACHMENTS MATCHING SEARCH PARAMETERS</div>
              ) : (
                filteredClaims.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedClaim(c)}
                    className={`p-3 transition cursor-pointer flex flex-col gap-1 rounded ${selectedClaim?.id === c.id ? "bg-cyan-950/20 border border-cyan-500/40" : "hover:bg-cyan-950/10 border border-transparent"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-black uppercase tracking-wide text-white">{c.profiles?.title_name_surname || "Unknown Doctor"}</span>
                        <span className="block text-[10px] font-mono text-cyan-500/80">{c.profiles?.specialty} • PR: {c.profiles?.pr_number}</span>
                      </div>
                      <span className={`text-[9px] font-mono font-black border rounded px-1.5 py-0.5 uppercase ${c.status === "captured" ? "border-cyan-400 text-cyan-400" : c.status === "on_hold" ? "border-amber-400 text-amber-400" : "border-emerald-400 text-emerald-400"}`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 font-semibold truncate mt-1">{c.procedure_description}</p>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-0.5">
                      <span>ICD10: <span className="text-cyan-400 font-bold">{c.icd10_code || "NONE"}</span></span>
                      <span>{new Date(c.created_at).toLocaleDateString("en-ZA")} {new Date(c.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── RIGHT PANELS: Detailed view & Messaging ─────────────────────── */}
          <aside className="xl:col-span-2 flex flex-col gap-4">

            {/* Audit Detail Inspector panel */}
            <div className={`flex flex-col ${cardClassName} ${selectedClaim ? "" : "justify-center items-center text-center p-8 min-h-[220px]"}`}>
              {selectedClaim ? (
                <div className="space-y-3 w-full">
                  <div className="border-b border-cyan-500/20 pb-2 flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">Case Audit File</h3>
                    <button
                      onClick={() => handleCreateTicket(selectedClaim)}
                      className="rounded border border-cyan-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-400 bg-black hover:bg-cyan-950/30"
                    >
                      🗣️ Open Query
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-medium border-b border-cyan-500/10 pb-2.5">
                    <div>
                      <span className="block text-[9px] text-slate-500 font-bold uppercase">Classification Target</span>
                      <span className="font-mono text-cyan-400 font-bold">{selectedClaim.icd10_code || "Not Stated"}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-500 font-bold uppercase">Tariff Codes</span>
                      <span className="font-mono text-white font-bold">
                        {selectedClaim.extra_notes.match(/\[Procedure Code:\s*([^\]]+)\]/)?.[1] || "None Specified"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-500 font-bold uppercase">Calculated Body Mass Index</span>
                      <span className="font-mono text-slate-300">{selectedClaim.bmi_info ? `${selectedClaim.bmi_info} kg/m²` : "N/A"}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] text-slate-500 font-bold uppercase">Modifications Stack</span>
                      <span className="font-mono text-cyan-300 text-[11px] truncate block">{selectedClaim.modifiers?.join(", ") || "None"}</span>
                    </div>
                  </div>

                  {/* Attachment Previews */}
                  <div className="flex gap-2">
                    {selectedClaim.image_url && (
                      <a href={selectedClaim.image_url} target="_blank" rel="noreferrer" className="flex-1 block rounded border border-cyan-500/20 bg-cyan-950/10 p-1.5 text-center text-[10px] font-bold text-cyan-400 uppercase tracking-wider hover:border-cyan-400">
                        View Primary Sheet
                      </a>
                    )}
                    {selectedClaim.extra_image_url && (
                      <a href={selectedClaim.extra_image_url} target="_blank" rel="noreferrer" className="flex-1 block rounded border border-cyan-500/20 bg-cyan-950/10 p-1.5 text-center text-[10px] font-bold text-cyan-400 uppercase tracking-wider hover:border-cyan-400">
                        View Support Doc
                      </a>
                    )}
                  </div>

                  {/* Workflow routing layout CTA */}
                  <div className="grid grid-cols-2 gap-2 border-t border-cyan-500/20 pt-2.5">
                    <button
                      onClick={() => handleUpdateStatus(selectedClaim.id, "billed")}
                      disabled={isProcessing || selectedClaim.status === "billed"}
                      className="rounded border border-emerald-400 bg-black py-1.5 text-xs font-black uppercase tracking-wider text-emerald-400 hover:bg-emerald-950/20 disabled:opacity-30"
                    >
                      ✓ Post to Medical Aid
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedClaim.id, "on_hold")}
                      disabled={isProcessing || selectedClaim.status === "on_hold"}
                      className="rounded border border-amber-400 bg-black py-1.5 text-xs font-black uppercase tracking-wider text-amber-400 hover:bg-amber-950/20 disabled:opacity-30"
                    >
                      ⚠️ flag on hold
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] font-mono text-cyan-900 uppercase">Select a medical case record from the billing pipeline grid to initiate back-office validation.</p>
              )}
            </div>

            {/* Adjudication Workspace Chat Module */}
            <div className={`flex-1 flex flex-col overflow-hidden max-h-[400px] ${cardClassName}`}>
              <div className="border-b border-cyan-500/20 pb-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Active Adjudication Streams</h3>
                <p className="text-[9px] font-mono text-cyan-600/80 uppercase">Direct validation loop with providers</p>
              </div>

              <div className="flex-1 grid grid-cols-3 overflow-hidden min-h-0 pt-2">
                {/* Tickets side menu */}
                <ul className="col-span-1 border-r border-cyan-500/20 divide-y divide-cyan-950 overflow-y-auto bg-black pr-1">
                  {tickets.length === 0 && (
                    <li className="p-2 text-[10px] text-cyan-900 font-mono italic">NO CHAT ALERTS ACTIVE</li>
                  )}
                  {tickets.map(t => (
                    <li
                      key={t.id}
                      onClick={() => setSelectedTicketId(t.id)}
                      className={`cursor-pointer p-2 text-[11px] flex flex-col gap-0.5 rounded transition ${selectedTicketId === t.id ? "bg-cyan-950/40 border border-cyan-400 text-cyan-300" : "border border-transparent text-slate-400 hover:text-slate-200"}`}
                    >
                      <span className="font-bold truncate text-slate-200">{t.profiles?.title_name_surname || "Doctor"}</span>
                      <span className="font-mono text-[9px] text-cyan-600 uppercase tracking-tight truncate">{t.subject}</span>
                    </li>
                  ))}
                </ul>

                {/* Messages stream pane */}
                <div className="col-span-2 flex flex-col overflow-hidden bg-black pl-2">
                  {selectedTicketId ? (
                    <>
                      <div className="flex-1 flex flex-col space-y-2 overflow-y-auto py-2 pr-1 text-xs">
                        {ticketMessages.map(m => {
                          const isOffice = m.sender_role === "billing_team";
                          return (
                            <div
                              key={m.id}
                              className={`max-w-[90%] rounded p-2 flex flex-col border ${isOffice
                                ? "self-end border-cyan-400/40 bg-cyan-950/20 text-cyan-300"
                                : "self-start border-cyan-900 bg-black text-slate-300"
                              }`}
                            >
                              <span className="leading-normal font-medium">{m.message}</span>
                              <span className="mt-0.5 self-end font-mono text-[8px] opacity-60">
                                {new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <form onSubmit={handleSendChat} className="flex border-t border-cyan-500/20 pt-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          placeholder="Transmit advisory note to practitioner..."
                          className="flex-1 bg-black text-xs text-cyan-400 placeholder:text-cyan-900 outline-none pr-2 font-semibold"
                        />
                        <button type="submit" className="rounded border border-cyan-400 bg-black px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 hover:bg-cyan-950/30">Send</button>
                      </form>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-center p-4">
                      <p className="text-[10px] font-mono text-cyan-900 uppercase">Select an active query session to interface with practitioner dashboard files.</p>
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
