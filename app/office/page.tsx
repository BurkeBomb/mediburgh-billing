"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/utils/supabase";

type OfficeRole = "worker" | "admin";
type ClaimStatus = "captured" | "billed" | "incomplete" | "on_hold";

interface ClientProfile { id: string; name: string; surname: string; practice_number: string; specialty: string; email: string; }
interface ClaimRecord { id: string; practitioner_id: string; account_number: string | null; status: ClaimStatus; image_url: string | null; procedure_description: string; icd10_code: string | null; theatre_start_time: string | null; theatre_end_time: string | null; bmi_info: number | null; modifiers: string[]; extra_notes: string | null; created_at: string; }
interface TicketThread { id: string; subject: string; preview: string; status: "open" | "closed" | "urgent"; updated_at: string; medical_aid?: string; error_code?: string; }
interface TicketMessage { id: string; message: string; sender_role: string; created_at: string; }

const cardClassName = "rounded-sm border border-slate-800/90 bg-slate-900/40 shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm";
const inputClassName = "w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-500/70";

function formatTimestampContext(isoString: string | null) {
  if (!isoString) return { date: "—", time: "—" };
  try {
    const d = new Date(isoString);
    return {
      date: d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }),
      time: d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })
    };
  } catch { return { date: "Invalid", time: "Invalid" }; }
}

export default function OfficePortalPage() {
  const [currentRole, setCurrentRole] = useState<OfficeRole>("admin");
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);

  // Live Bureau conversational ticket system states
  const [activeTickets, setActiveTickets] = useState<TicketThread[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [chatReplyInput, setChatReplyInput] = useState("");

  const [statusFilter, setStatusFilter] = useState<ClaimStatus | "all">("all");
  const [accountNumberInput, setAccountNumberInput] = useState("");
  const [targetStatus, setTargetStatus] = useState<ClaimStatus>("billed");

  // New ticket creation metrics fields
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketPreview, setTicketPreview] = useState("");
  const [ticketMedicalAid, setTicketMedicalAid] = useState("Discovery Health");
  const [ticketPriority, setTicketPriority] = useState<"open" | "urgent">("open");

  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [queueUpdateTrigger, setQueueUpdateTrigger] = useState(0);

  const supabase = createClient();

  useEffect(() => {
    async function fetchPractitioners() {
      setLoading(true);
      try {
        const { data } = await supabase.from("profiles").select("*").eq("role", "practitioner");
        if (data) { setClients(data); if (data.length > 0 && !selectedClientId) setSelectedClientId(data[0].id); }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    fetchPractitioners();
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    async function fetchClientClaimsAndTickets() {
      const { data: cl } = await supabase.from("claims").select("*").eq("practitioner_id", selectedClientId).order("created_at", { ascending: false });
      if (cl) setClaims(cl);

      const { data: tk } = await supabase.from("tickets").select("*").eq("practitioner_id", selectedClientId).order("updated_at", { ascending: false });
      if (tk) setActiveTickets(tk);
    }
    fetchClientClaimsAndTickets();
  }, [selectedClientId, queueUpdateTrigger]);

  // Realtime active claim updates listener hook
  useEffect(() => {
    if (!selectedClientId) return;
    const channel = supabase.channel(`of-claims-${selectedClientId}`).on("postgres_changes", { event: "*", schema: "public", table: "claims", filter: `practitioner_id=eq.${selectedClientId}` }, () => setQueueUpdateTrigger(p => p + 1)).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedClientId]);

  // Stream text logs for the conversational messaging frames
  useEffect(() => {
    if (!selectedTicketId) return;
    async function fetchMessages() {
      const { data } = await supabase.from("ticket_messages").select("*").eq("ticket_id", selectedTicketId).order("created_at", { ascending: true });
      if (data) setTicketMessages(data as any[]);
    }
    fetchMessages();

    const channel = supabase
      .channel(`of-msg-${selectedTicketId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ticket_messages", filter: `ticket_id=eq.${selectedTicketId}` }, (p) => {
        setTicketMessages(prev => [...prev, p.new as TicketMessage]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedTicketId]);

  const handleSendChatReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatReplyInput.trim() || !selectedTicketId) return;

    try {
      const { data: authData } = await supabase.auth.getUser();
      await supabase.from("ticket_messages").insert([
        { ticket_id: selectedTicketId, sender_id: authData!.user.id, sender_role: "billing_team", message: chatReplyInput.trim() }
      ]);
      setChatReplyInput("");
    } catch (err) { console.error(err); }
  };

  const handleUpdateClaimState = async () => {
    if (!selectedClaim || updating || currentRole !== "admin") return;
    setUpdating(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("claims").update({ account_number: accountNumberInput.trim() || null, status: targetStatus }).eq("id", selectedClaim.id);
      await supabase.from("audit_logs").insert([{ claim_id: selectedClaim.id, user_id: auth!.user.id, action: `Billed state mutation sync: [${targetStatus}]` }]);
      setSuccessMessage("Database parameter adjustments synchronized.");
      setQueueUpdateTrigger(p => p + 1);
    } catch (err) { console.error(err); }
    finally { setUpdating(false); }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !ticketSubject.trim()) return;

    try {
      const { data: tkRecord } = await supabase.from("tickets").insert([
        { practitioner_id: selectedClientId, subject: ticketSubject.trim(), preview: ticketPreview.trim(), status: ticketPriority, sender: "billing_team", medical_aid: ticketMedicalAid }
      ]).select().single();

      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("ticket_messages").insert([
        { ticket_id: tkRecord.id, sender_id: auth!.user.id, sender_role: "billing_team", message: ticketPreview.trim() }
      ]);

      setTicketSubject("");
      setTicketPreview("");
      setQueueUpdateTrigger(p => p + 1);
    } catch (err) { console.error(err); }
  };

  const filteredClaims = useMemo(() => statusFilter === "all" ? claims : claims.filter(c => c.status === statusFilter), [claims, statusFilter]);
  const selectedClientDetails = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);

  return (
    <div className="relative min-h-screen bg-[#0b0f14] text-slate-100 flex flex-col">
      <div className="mx-auto w-full max-w-[1680px] px-4 py-6 flex-1 flex flex-col gap-6">
        <header className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-teal-400">Mediburgh Bureau Operations</p>
            <h1 className="text-2xl font-bold text-white mt-0.5">Office Administration Console</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentRole("admin")} className={`px-3 py-1 text-xs uppercase font-mono font-bold ${currentRole === "admin" ? "bg-teal-600 text-white" : "bg-slate-900 text-slate-500"}`}>Admin Mode</button>
            <button onClick={() => window.location.href = "/"} className="bg-slate-800 border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide font-medium">Exit</button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
          {/* Left Panel Registry & Ticket Chat Interface */}
          <section className="lg:col-span-1 flex flex-col gap-4">
            <div className={cardClassName}>
              <div className="border-b border-slate-800 px-4 py-2.5 bg-slate-950/40 font-semibold text-xs uppercase tracking-wider text-slate-300">Active Medical Practices</div>
              <ul className="divide-y divide-slate-900 max-h-[160px] overflow-y-auto">
                {clients.map(c => (
                  <li key={c.id} onClick={() => setSelectedClientId(c.id)} className={`px-4 py-2.5 text-xs cursor-pointer hover:bg-slate-950/30 transition flex flex-col ${selectedClientId === c.id ? "bg-slate-950 border-l-2 border-teal-500" : ""}`}>
                    <span className="font-medium text-slate-200">Dr {c.name} {c.surname}</span>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5">PR: {c.practice_number}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Live Interactive Tickets Chat console inside Office View */}
            <div className="rounded-sm border border-slate-800 bg-slate-900/40 flex flex-col h-[340px] overflow-hidden">
              <div className="border-b border-slate-800 px-4 py-2.5 bg-slate-950/40 font-semibold text-xs uppercase tracking-wider text-slate-300">Live Adjudication Chats</div>
              <div className="flex-1 flex overflow-hidden">
                <ul className="w-1/3 border-r border-slate-900 overflow-y-auto divide-y divide-slate-950 text-[10px]">
                  {activeTickets.map(t => (
                    <li key={t.id} onClick={() => setSelectedTicketId(t.id)} className={`p-2 cursor-pointer truncate hover:bg-slate-950/40 ${selectedTicketId === t.id ? "bg-slate-950 font-bold text-teal-400" : "text-slate-400"}`}>{t.subject}</li>
                  ))}
                </ul>
                <div className="w-2/3 flex flex-col bg-slate-950/20 overflow-hidden">
                  {selectedTicketId ? (
                    <>
                      <div className="flex-1 p-2 overflow-y-auto space-y-1.5 text-[11px] flex flex-col">
                        {ticketMessages.map((m, idx) => {
                          const isMe = m.sender_role === "billing_team";
                          return (
                            <div key={idx} className={`max-w-[90%] p-1.5 rounded-sm border ${isMe ? "bg-slate-900 border-slate-800 text-slate-200 self-end" : "bg-teal-950/30 border-teal-900/40 text-teal-300 self-start"}`}>{m.message}</div>
                          );
                        })}
                      </div>
                      <form onSubmit={handleSendChatReply} className="border-t border-slate-900 p-1 flex bg-slate-950">
                        <input type="text" value={chatReplyInput} onChange={e => setChatReplyInput(e.target.value)} placeholder="Type chat reply..." className="flex-1 bg-transparent text-[11px] text-slate-200 px-1 outline-none" />
                        <button type="submit" className="bg-teal-600 text-[9px] uppercase font-bold px-2 rounded-sm">Send</button>
                      </form>
                    </>
                  ) : (
                    <p className="text-[10px] text-slate-600 italic p-3 text-center my-auto">Select a chat line.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Broadcast Ticket Generation Interface */}
            <div className={cardClassName}>
              <form onSubmit={handleCreateTicket} className="p-4 space-y-2.5">
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Raise Audited Rulebook Ticket</p>
                <input type="text" value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} placeholder="Subject (e.g. Rule 0018 Discrepancy)" className={`${inputClassName} text-xs`} />
                <textarea rows={2} value={ticketPreview} onChange={e => setTicketPreview(e.target.value)} placeholder="Chat message context for practitioner..." className={`${inputClassName} text-xs resize-none`} />
                <div className="grid grid-cols-2 gap-2">
                  <select value={ticketMedicalAid} onChange={e => setTicketMedicalAid(e.target.value)} className={`${inputClassName} bg-slate-950 text-[10px]`}>
                    <option value="Discovery Health">Discovery Health</option>
                    <option value="GEMS">GEMS</option>
                  </select>
                  <select value={ticketPriority} onChange={e => setTicketPriority(e.target.value as any)} className={`${inputClassName} bg-slate-950 text-[10px]`}>
                    <option value="open">Standard</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <button type="submit" className="w-full bg-slate-800 text-[10px] uppercase font-bold py-1.5 border border-slate-700 hover:bg-slate-750">Open Chat Thread</button>
              </form>
            </div>
          </section>

          {/* Right Panel Main Verification Grid Pipeline */}
          <section className="lg:col-span-3 flex flex-col gap-4">
            <div className={cardClassName}>
              <div className="border-b border-slate-800 px-4 py-3 flex justify-between items-center bg-slate-950/20">
                <h2 className="text-sm font-semibold tracking-wide text-slate-200">Adjudication Incoming Stream Queue</h2>
                <div className="flex gap-1 text-[10px] font-mono bg-slate-950 p-0.5 border border-slate-800">
                  {["all", "captured", "billed", "on_hold"].map(f => (
                    <button key={f} onClick={() => setStatusFilter(f as any)} className={`px-2 py-0.5 font-bold uppercase ${statusFilter === f ? "text-teal-400 bg-slate-900" : "text-slate-500"}`}>{f}</button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/60 font-mono text-[10px] text-slate-500 uppercase border-b border-slate-800">
                      <th className="p-3">Patient / Case Parameters</th>
                      <th className="p-3">Medical Aid</th>
                      <th className="p-3">Theatre Timeline</th>
                      <th className="p-3 font-mono">ICD-10</th>
                      <th className="p-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60">
                    {filteredClaims.map(c => {
                      const patientStr = c.extra_notes?.match(/\[Patient:\s*([^\]]+)\]/)?.[1] || "Unassigned Patient";
                      const tCode = c.extra_notes?.match(/\[Procedure Code:\s*([^\]]+)\]/)?.[1] || "—";
                      const mAid = c.extra_notes?.match(/\[Medical Aid:\s*([^\]]+)\]/)?.[1] || "Discovery Health";
                      const start = formatTimestampContext(c.theatre_start_time);
                      const end = formatTimestampContext(c.theatre_end_time);

                      return (
                        <tr key={c.id} onClick={() => handleSelectClaim(c)} className={`cursor-pointer hover:bg-slate-950/30 transition ${selectedClaim?.id === c.id ? "bg-slate-950/40" : ""}`}>
                          <td className="p-3">
                            <p className="font-semibold text-slate-200">{patientStr}</p>
                            <p className="text-slate-500 text-[11px] mt-0.5 truncate max-w-xs">{c.procedure_description} <span className="text-teal-400 font-mono font-bold text-[10px] ml-1">[{tCode}]</span></p>
                          </td>
                          <td className="p-3 font-medium text-slate-300">{mAid}</td>
                          <td className="p-3 font-mono text-slate-400 text-[11px]">{start.date !== "—" ? `${start.date} @ ${start.time}-${end.time}` : "—"}</td>
                          <td className="p-3 font-mono text-teal-400 font-bold">{c.icd10_code || "—"}</td>
                          <td className="p-3 text-right">
                            <span className={`px-1.5 py-0.5 rounded-sm uppercase tracking-wider text-[9px] border font-medium ${c.status === "captured" ? "bg-teal-950/40 text-teal-400 border-teal-900" : c.status === "billed" ? "bg-blue-950/40 text-blue-400 border-blue-900" : "bg-amber-950/40 text-amber-400 border-amber-900"}`}>{c.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedClaim && (
              <div className={`grid grid-cols-1 lg:grid-cols-5 gap-4 p-5 ${cardClassName}`}>
                <div className="lg:col-span-2 flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sheet Verification</p>
                  <div className="flex-1 bg-slate-950 border border-slate-800 rounded-sm overflow-hidden min-h-[260px] p-2 flex">
                    {selectedClaim.image_url ? <img src={selectedClaim.image_url} className="max-h-[300px] w-full object-contain m-auto" /> : <p className="text-xs text-slate-600 italic m-auto">No sheet image uploaded.</p>}
                  </div>
                </div>
                <div className="lg:col-span-3 flex flex-col justify-between space-y-3">
                  <div className="space-y-3 text-xs">
                    <h4 className="font-bold text-slate-200 uppercase tracking-wide">Adjudication Console</h4>
                    <div className="p-3 bg-slate-950/80 border border-slate-900 space-y-2 rounded-sm text-[11px]">
                      <p><span className="text-slate-500">Case Description:</span> <span className="text-slate-300">{selectedClaim.procedure_description}</span></p>
                      <p><span className="text-slate-500">Extra Parameters Matrix:</span> <span className="text-teal-400 font-mono text-[10px] block mt-1 bg-slate-950 p-1.5 border border-slate-900">{selectedClaim.extra_notes}</span></p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] uppercase text-slate-400 font-medium block mb-1">Assign Account Reference</label>
                        <input type="text" value={accountNumberInput} onChange={e => setAccountNumberInput(e.target.value)} className={inputClassName} placeholder="ACC-8849" />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase text-slate-400 font-medium block mb-1">Set Processing State</label>
                        <select value={targetStatus} onChange={e => setTargetStatus(e.target.value as any)} className={`${inputClassName} bg-slate-950`}>
                          <option value="captured">Captured</option>
                          <option value="billed">Billed</option>
                          <option value="on_hold">On Hold</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="text-right border-t border-slate-900 pt-3">
                    <button onClick={handleUpdateClaimState} className="bg-teal-600 px-5 py-2 text-xs uppercase font-sans tracking-wider font-bold text-white rounded-sm hover:bg-teal-500">Commit Changes & Broadcast Sync</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}