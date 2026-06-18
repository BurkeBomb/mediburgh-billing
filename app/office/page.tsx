"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/utils/supabase";

interface ClaimRecord {
  id: string;
  created_at: string;
  procedure_description: string;
  icd10_code: string | null;
  status: "captured" | "on_hold" | "billed";
  image_url: string | null;
  extra_image_url: string | null;
  extra_notes: string;
  billed_amount?: number;
  practitioner_profiles?: {
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
  medical_aid?: string;
  practitioner_id: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  message: string;
  sender_role: "billing_team" | "practitioner";
  created_at: string;
}

const cardClassName = "rounded-sm border border-slate-700/40 bg-[#12253f] p-5 shadow-2xl backdrop-blur-sm";
const inputClassName = "w-full rounded-sm border border-slate-600/50 bg-[#0d1b2e]/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-400/80 shadow-inner";
const labelClassName = "mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400";
const sectionHeaderClass = "text-xs font-bold uppercase tracking-wider text-teal-400 pb-1.5 mb-4 border-b border-teal-500/30";
const pillBtnClass = "flex items-center gap-1.5 rounded-full bg-[#12253f] border border-slate-600/50 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1a3254] hover:border-slate-500/50 transition shadow-sm";

export default function OfficeAdminPage() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [manualBilledAmount, setManualBilledAmount] = useState("");
  
  const [tickets, setTickets] = useState<TicketThread[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [chatReplyInput, setChatReplyInput] = useState("");
  const [newTicketSubject, setNewTicketSubject] = useState("");

  const [activeTab, setActiveTab] = useState<"claims" | "tickets">("claims");
  const [processing, setProcessing] = useState(false);
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);

  const supabase = createClient();

  useEffect(() => {
    async function fetchClaimsAndTickets() {
      try {
        const { data: claimsData } = await supabase
          .from("claims")
          .select("*, practitioner_profiles:profiles(title_name_surname, pr_number, specialty)")
          .order("created_at", { ascending: false });
        if (claimsData) setClaims(claimsData as unknown as ClaimRecord[]);

        const { data: ticketsData } = await supabase
          .from("tickets")
          .select("*")
          .order("updated_at", { ascending: false });
        if (ticketsData) {
          setTickets(ticketsData as TicketThread[]);
          if (ticketsData.length > 0 && !selectedTicketId) {
            setSelectedTicketId(ticketsData[0].id);
          }
        }
      } catch (err) {
        console.error("Data fetch error:", err);
      }
    }
    fetchClaimsAndTickets();
  }, [realtimeTrigger, supabase, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId) return;
    let msgChannel: any;

    async function fetchTicketMessages() {
      const { data } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", selectedTicketId)
        .order("created_at", { ascending: true });
      if (data) setTicketMessages(data as TicketMessage[]);

      msgChannel = supabase
        .channel(`office-msg-sync-${selectedTicketId}`)
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
    fetchTicketMessages();

    return () => {
      if (msgChannel) supabase.removeChannel(msgChannel);
    };
  }, [selectedTicketId, supabase]);

  const handleUpdateClaimBilledAmount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaimId || !manualBilledAmount.trim()) return;
    setProcessing(true);

    try {
      const amount = parseFloat(manualBilledAmount);
      const { error } = await supabase
        .from("claims")
        .update({ 
          billed_amount: amount,
          status: "billed"
        })
        .eq("id", selectedClaimId);

      if (error) throw error;

      // Update static tracking state across the matching profile reporting row context
      const selectedClaim = claims.find(c => c.id === selectedClaimId);
      if (selectedClaim) {
        const pId = selectedClaim.practitioner_id;
        const { data: existingReport } = await supabase
          .from("billing_reports")
          .select("total_billed_revenue")
          .eq("practitioner_id", pId)
          .maybeSingle();

        const currentRevenue = existingReport ? Number(existingReport.total_billed_revenue) : 0;
        await supabase
          .from("billing_reports")
          .upsert({ 
            practitioner_id: pId, 
            total_billed_revenue: currentRevenue + amount 
          }, { onConflict: "practitioner_id" });
      }

      setManualBilledAmount("");
      setSelectedClaimId(null);
      setRealtimeTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleSendOfficeReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatReplyInput.trim() || !selectedTicketId) return;

    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      await supabase.from("ticket_messages").insert([
        { 
          ticket_id: selectedTicketId, 
          sender_id: authData.user.id, 
          sender_role: "billing_team", 
          message: chatReplyInput.trim() 
        }
      ]);
      setChatReplyInput("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleInitializeTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeClaim = claims.find(c => c.id === selectedClaimId);
    if (!activeClaim || !newTicketSubject.trim()) return;

    try {
      const { data: newTicket, error } = await supabase
        .from("tickets")
        .insert([
          {
            practitioner_id: activeClaim.practitioner_id,
            subject: newTicketSubject.trim(),
            status: "open",
            medical_aid: activeClaim.extra_notes.match(/\[Medical Aid:\s*([^\]]+)\]/)?.[1] || "General Case"
          }
        ])
        .select()
        .single();

      if (error) throw error;

      await supabase.from("ticket_messages").insert([
        {
          ticket_id: newTicket.id,
          sender_role: "billing_team",
          message: `🚨 Case adjudication action opened regarding clinical capture description: "${activeClaim.procedure_description}"`
        }
      ]);

      setNewTicketSubject("");
      setSelectedTicketId(newTicket.id);
      setActiveTab("tickets");
      setRealtimeTrigger(p => p + 1);
    } catch (err) {
      console.error(err);
    }
  };

  const selectedClaimDetails = useMemo(() => {
    return claims.find(c => c.id === selectedClaimId) || null;
  }, [claims, selectedClaimId]);

  return (
    <div className="relative min-h-screen bg-[#0d1b2e] text-slate-100 flex flex-col font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <div className="relative mx-auto w-full max-w-[1680px] px-6 py-6 flex-1 flex flex-col gap-6">
        
        {/* Top Header Navigation Strip */}
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-slate-700/60 pb-5 gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30 font-bold shadow-sm">
              🛡️
            </div>
            <div>
              <h1 className="text-xl font-black tracking-wider text-white font-sans uppercase flex items-center gap-2">
                THE DOC LOG <span className="text-xs font-semibold tracking-widest text-teal-400/80">/ BY MEDIBURGH</span>
              </h1>
              <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mt-1">
                Central Bureau Adjudication Management Terminal Layer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end lg:self-center">
            <button onClick={() => setActiveTab("claims")} className={`${pillBtnClass} ${activeTab === "claims" ? "border-teal-400 text-teal-400 bg-[#1a3254]" : ""}`}>
              Claims Queue
            </button>
            <button onClick={() => setActiveTab("tickets")} className={`${pillBtnClass} ${activeTab === "tickets" ? "border-teal-400 text-teal-400 bg-[#1a3254]" : ""}`}>
              Adjudication Desk
            </button>
            <button onClick={() => window.location.href = "/"} className="flex items-center gap-1.5 rounded-full bg-red-950/30 border border-red-500/30 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-red-400 hover:bg-red-900/30 hover:border-red-400/40 transition shadow-sm">
              EXIT
            </button>
          </div>
        </header>

        {/* Workspace Operations Allocation Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 flex-1">
          
          {/* LEFT PANEL: Context Action Lists Queue */}
          <section className={`xl:col-span-3 space-y-5 ${cardClassName}`}>
            {activeTab === "claims" ? (
              <>
                <h2 className={sectionHeaderClass}>PRIMARY BILLING SHEET PIPELINE</h2>
                <div className="overflow-y-auto max-h-[680px] divide-y divide-slate-800/80 pr-2">
                  {claims.map(c => (
                    <div 
                      key={c.id} 
                      onClick={() => { setSelectedClaimId(c.id); setManualBilledAmount(c.billed_amount?.toString() || ""); }}
                      className={`p-4 cursor-pointer transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 ${selectedClaimId === c.id ? "bg-[#12253f]/90 border-l-2 border-teal-500" : "hover:bg-[#12253f]/40"}`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200">
                            {c.practitioner_profiles?.title_name_surname || "Dr X Burke"}
                          </span>
                          <span className="text-[10px] bg-[#0d1b2e] px-1.5 py-0.5 font-mono text-slate-400 border border-slate-700/60 rounded-sm">
                            {c.practitioner_profiles?.pr_number || "PR0232610"}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 mt-1 font-medium">{c.procedure_description}</p>
                        <p className="text-[11px] font-mono text-slate-500 mt-1 truncate max-w-md">{c.extra_notes}</p>
                      </div>
                      <div className="text-right flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider ${
                          c.status === "billed" ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/40" :
                          c.status === "on_hold" ? "bg-amber-950/80 text-amber-400 border border-amber-800/40" : "bg-teal-950/80 text-teal-400 border border-teal-800/40"
                        }`}>
                          {c.status}
                        </span>
                        {c.billed_amount ? (
                          <span className="text-xs font-mono font-bold text-teal-400">R {c.billed_amount.toLocaleString()}</span>
                        ) : (
                          <span className="text-xs font-mono text-slate-600">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className={sectionHeaderClass}>ACTIVE CASE DISPUTE STREAMS</h2>
                <div className="overflow-y-auto max-h-[680px] divide-y divide-slate-800/80 pr-2">
                  {tickets.map(t => (
                    <div 
                      key={t.id} 
                      onClick={() => setSelectedTicketId(t.id)}
                      className={`p-4 cursor-pointer transition-colors flex items-center justify-between gap-4 ${selectedTicketId === t.id ? "bg-[#12253f]/90 border-l-2 border-teal-500" : "hover:bg-[#12253f]/40"}`}
                    >
                      <div>
                        <h4 className={`text-sm font-bold ${t.status === "urgent" ? "text-red-400" : "text-slate-200"}`}>{t.subject}</h4>
                        <p className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">{t.medical_aid || "General Case"}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider ${
                        t.status === "closed" ? "bg-slate-950 text-slate-500 border border-slate-800" : "bg-red-950 text-red-400 border border-red-900/40 animate-pulse"
                      }`}>
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* RIGHT PANEL: Dynamic Audit Detail Handlers & Full Realtime Ticket Thread Chat View */}
          <aside className="xl:col-span-2 flex flex-col gap-4">
            
            {activeTab === "claims" ? (
              <div className={`flex-1 flex flex-col space-y-4 ${cardClassName}`}>
                <h2 className={sectionHeaderClass}>CLAIM RESOLUTION ENGINE</h2>
                {selectedClaimDetails ? (
                  <div className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-1">
                    <div className="bg-[#0d1b2e]/60 border border-slate-700/40 p-3 rounded-sm space-y-2 shadow-inner">
                      <p className="text-[10px] uppercase font-mono tracking-wider text-slate-500">System Extraction Metadata Notes</p>
                      <p className="text-xs text-slate-300 leading-relaxed font-mono">{selectedClaimDetails.extra_notes}</p>
                    </div>

                    {/* Manual Ledger Audit Processing Input Box */}
                    <form onSubmit={handleUpdateClaimBilledAmount} className="space-y-3 bg-[#0d1b2e]/30 p-3 border border-slate-700/30 rounded-sm shadow-inner">
                      <div>
                        <label className={labelClassName}>Manually Inserted Billed Value (ZAR)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={manualBilledAmount} 
                          onChange={e => setManualBilledAmount(e.target.value)} 
                          className={inputClassName} 
                          placeholder="Insert verified report total e.g. 2450.00" 
                          required 
                        />
                      </div>
                      <button 
                        type="submit" 
                        disabled={processing}
                        className="w-full bg-emerald-600 font-bold py-2 text-xs uppercase tracking-wider text-white rounded-sm hover:bg-emerald-500 transition-colors shadow-md"
                      >
                        {processing ? "Updating Ledger Entry..." : "Finalize Report Batch Entry"}
                      </button>
                    </form>

                    {/* Launch Subordinated Discrepancy Ticket Grid Form */}
                    <form onSubmit={handleInitializeTicket} className="space-y-3 bg-[#0d1b2e]/30 p-3 border border-slate-700/30 rounded-sm shadow-inner">
                      <div>
                        <label className={labelClassName}>Open Adjudication Discrepancy Ticket</label>
                        <input 
                          type="text" 
                          value={newTicketSubject} 
                          onChange={e => setNewTicketSubject(e.target.value)} 
                          className={inputClassName} 
                          placeholder="e.g. Need medical aid pre-auth validation token" 
                          required 
                        />
                      </div>
                      <button 
                        type="submit" 
                        className="w-full bg-teal-600 font-bold py-2 text-xs uppercase tracking-wider text-white rounded-sm hover:bg-teal-500 transition-colors shadow-md"
                      >
                        Launch Direct Live Chat Ticket
                      </button>
                    </form>

                    {/* Image Viewports Panel layout structure matching dashboard logic */}
                    <div className="space-y-3 pt-2">
                      {selectedClaimDetails.image_url && (
                        <div className="border border-slate-700/50 bg-[#0d1b2e] p-2 rounded-sm shadow-inner">
                          <p className="text-[9px] font-mono text-slate-500 uppercase mb-1">Primary Capture Asset File</p>
                          <img src={selectedClaimDetails.image_url} alt="Primary Billing sheet extraction view" className="w-full rounded-sm object-contain max-h-[220px]" />
                        </div>
                      )}
                      {selectedClaimDetails.extra_image_url && (
                        <div className="border border-slate-700/50 bg-[#0d1b2e] p-2 rounded-sm shadow-inner">
                          <p className="text-[9px] font-mono text-slate-500 uppercase mb-1">Secondary Allocation Attachment</p>
                          <img src={selectedClaimDetails.extra_image_url} alt="Secondary asset layout" className="w-full rounded-sm object-contain max-h-[220px]" />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-500 italic p-6 text-center">
                    Select an operations claim record tracking row to initialize report processing logic blocks.
                  </div>
                )}
              </div>
            ) : (
              /* ADJUDICATION TICKETS: Direct Unified Chat Window Engine Frame */
              <div className={`flex-1 flex flex-col overflow-hidden max-h-[560px] ${cardClassName}`}>
                <h2 className={sectionHeaderClass}>LIVE ADJUDICATION PACK VIEW</h2>

                <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1b2e]/40 border border-slate-700/30 rounded-sm shadow-inner">
                  {selectedTicketId ? (
                    <>
                      {/* Ticket contextual layout description banner ribbon */}
                      <div className="border-b border-slate-700/50 bg-[#12253f]/80 px-4 py-2.5 flex items-center justify-between shadow-sm">
                        <div className="truncate">
                          <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                            {tickets.find(t => t.id === selectedTicketId)?.subject || "Case Thread"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-[9px] font-mono text-slate-500 uppercase">Bureau Stream</span>
                        </div>
                      </div>

                      {/* Interactive scrolling thread area container viewport line mapping */}
                      <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs flex flex-col custom-scrollbar">
                        {ticketMessages.map(m => {
                          const isOffice = m.sender_role === "billing_team";
                          return (
                            <div 
                              key={m.id} 
                              className={`max-w-[85%] rounded-sm p-3 flex flex-col shadow-sm border ${
                                isOffice 
                                  ? "bg-teal-950/40 border-teal-500/20 text-teal-200 self-end" 
                                  : "bg-[#12253f]/90 border-slate-600/30 text-slate-200 self-start"
                              }`}
                            >
                              <span className="font-sans leading-relaxed break-words">{m.message}</span>
                              <span className="text-[8px] font-mono text-slate-500 mt-1.5 self-end tracking-wider">
                                {new Date(m.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Single text interaction post bar structure matching master workspace config layout */}
                      <div className="border-t border-slate-700/60 bg-[#12253f]/60 p-3">
                        <form onSubmit={handleSendOfficeReply} className="flex rounded-sm bg-[#0d1b2e] border border-slate-600/60 px-3 py-2 shadow-inner focus-within:border-teal-400 transition-colors">
                          <input 
                            type="text" 
                            value={chatReplyInput} 
                            onChange={e => setChatReplyInput(e.target.value)} 
                            placeholder="Type direct response response instructions onto clinical terminal..." 
                            className="flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-600 outline-none" 
                          />
                          <button type="submit" className="text-teal-400 hover:text-teal-300 font-bold text-xs font-mono uppercase tracking-wider ml-2 transition-colors">
                            Send
                          </button>
                        </form>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-500 italic p-6 text-center">
                      No active communications threads open on terminal desk selection state.
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
