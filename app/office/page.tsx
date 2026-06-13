"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/utils/supabase";

type OfficeRole = "worker" | "admin";
type ClaimStatus = "captured" | "billed" | "incomplete" | "on_hold";

interface ClientProfile {
  id: string;
  name: string;
  surname: string;
  practice_number: string;
  specialty: string;
  email: string;
}

interface ClaimRecord {
  id: string;
  practitioner_id: string;
  account_number: string | null;
  status: ClaimStatus;
  image_url: string | null;
  procedure_description: string;
  icd10_code: string | null;
  theatre_start_time: string | null;
  theatre_end_time: string | null;
  bmi_info: number | null;
  modifiers: string[];
  extra_notes: string | null;
  created_at: string;
}

interface AuditLogRecord {
  id: string;
  claim_id: string;
  action: string;
  timestamp: string;
}

const cardClassName =
  "rounded-sm border border-slate-800/90 bg-slate-900/40 shadow-[0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm";

const inputClassName =
  "w-full rounded-sm border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-teal-500/70 focus:ring-1 focus:ring-teal-500/40";

export default function OfficePortalPage() {
  const [currentRole, setCurrentRole] = useState<OfficeRole>("admin");
  
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  const [statusFilter, setStatusFilter] = useState<ClaimStatus | "all">("all");
  const [accountNumberInput, setAccountNumberInput] = useState("");
  const [targetStatus, setTargetStatus] = useState<ClaimStatus>("billed");

  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketPreview, setTicketPreview] = useState("");
  const [ticketPriority, setTicketPriority] = useState<"open" | "urgent">("open");

  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabase = createClient();

  // 1. Fetch active practitioner profiles
  useEffect(() => {
    async function fetchPractitioners() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchErr } = await supabase
          .from("profiles")
          .select("id, name, surname, practice_number, specialty, email")
          .eq("role", "practitioner");

        if (fetchErr) throw fetchErr;
        
        setClients(data || []);
        if (data && data.length > 0) {
          setSelectedClientId(data[0].id);
        }
      } catch (err: any) {
        console.error("Failed to fetch clients list:", err);
        setError("Could not download practitioner registry.");
      } finally {
        setLoading(false);
      }
    }
    fetchPractitioners();
  }, []);

  // 2. Fetch claims associated with selected practitioner profile
  useEffect(() => {
    if (!selectedClientId) return;

    async function fetchClientClaims() {
      setError(null);
      setSelectedClaim(null);
      try {
        const { data, error: claimsErr } = await supabase
          .from("claims")
          .select("*")
          .eq("practitioner_id", selectedClientId)
          .order("created_at", { ascending: false });

        if (claimsErr) throw claimsErr;
        setClaims(data || []);
      } catch (err: any) {
        console.error("Failed to load claims queue:", err);
        setError("Error pulling claim queue for selected practice.");
      }
    }
    fetchClientClaims();
  }, [selectedClientId]);

  // 3. Populate audit trail ledger historical logs
  useEffect(() => {
    if (!selectedClaim) {
      setAuditLogs([]);
      return;
    }

    // STRICT TYPE-CHECKING SAFE-GUARD: Force snapshot binding to a guaranteed immutable identifier scope variable
    const targetClaimId = selectedClaim.id;

    async function fetchClaimHistory() {
      try {
        const { data, error: logErr } = await supabase
          .from("audit_logs")
          .select("id, claim_id, action, timestamp")
          .eq("claim_id", targetClaimId)
          .order("timestamp", { ascending: false });

        if (logErr) throw logErr;
        setAuditLogs(data || []);
      } catch (err) {
        console.error("Audit load block:", err);
      }
    }
    fetchClaimHistory();
  }, [selectedClaim]);

  const handleSelectClaim = (claim: ClaimRecord) => {
    setSelectedClaim(claim);
    setAccountNumberInput(claim.account_number || "");
    setTargetStatus(claim.status);
    setSuccessMessage(null);
  };

  // 4. Update claim properties (account generation and workflow state modification)
  const handleUpdateClaimState = async () => {
    if (!selectedClaim || updating) return;

    if (currentRole !== "admin") {
      setError("Operation Rejected: Current access level restricts write operations.");
      return;
    }

    setUpdating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error("Consultant authentication verification lost.");

      const { error: updateErr } = await supabase
        .from("claims")
        .update({
          account_number: accountNumberInput.trim() || null,
          status: targetStatus,
        })
        .eq("id", selectedClaim.id);

      if (updateErr) throw updateErr;

      const logString = `Office bureau updated claim parameters. Account: [${accountNumberInput.trim() || "Unassigned"}] · Status to [${targetStatus}].`;

      await supabase.from("audit_logs").insert([
        { claim_id: selectedClaim.id, user_id: authData.user.id, action: logString }
      ]);

      setSuccessMessage("Claim parameters successfully committed and logged.");
      setClaims(prev => prev.map(c => c.id === selectedClaim.id ? { ...c, account_number: accountNumberInput.trim() || null, status: targetStatus } : c));
      setSelectedClaim(prev => prev ? { ...prev, account_number: accountNumberInput.trim() || null, status: targetStatus } : null);
    } catch (err: any) {
      setError(err.message || "Could not push structural modifications back to the server.");
    } finally {
      setUpdating(false);
    }
  };

  // 5. Transmit dynamic clinical exception alert lines down to the doctor dashboard
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !ticketSubject.trim() || !ticketPreview.trim()) {
      setError("Please fill out both the ticket line subject and description.");
      return;
    }

    try {
      const { error: ticketErr } = await supabase
        .from("tickets")
        .insert([
          {
            practitioner_id: selectedClientId,
            subject: ticketSubject.trim(),
            preview: ticketPreview.trim(),
            status: ticketPriority,
            sender: "billing_team"
          }
        ]);

      if (ticketErr) throw ticketErr;

      setSuccessMessage("Operational alert ticket pushed cleanly down to practitioner layout.");
      setTicketSubject("");
      setTicketPreview("");
    } catch (err: any) {
      setError(err.message || "Failed to push message token.");
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const filteredClaims = useMemo(() => {
    if (statusFilter === "all") return claims;
    return claims.filter(c => c.status === statusFilter);
  }, [claims, statusFilter]);

  const selectedClientDetails = useMemo(() => {
    return clients.find(c => c.id === selectedClientId);
  }, [clients, selectedClientId]);

  return (
    <div className="relative min-h-full flex-1 bg-[#0b0f14] text-slate-100">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-15%,rgba(20,184,166,0.06),transparent)]" />
      
      <div className="relative mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/60 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-teal-400/90">Mediburgh Operations Bureau</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Office Administration Portal</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-sm border border-slate-800 bg-slate-900/40 p-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400 px-2">Access Profile:</span>
              <button type="button" onClick={() => { setCurrentRole("worker"); setError(null); }} className={`rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${currentRole === "worker" ? "bg-slate-700 text-white border border-slate-500" : "text-slate-500 hover:text-slate-300"}`}>Worker</button>
              <button type="button" onClick={() => { setCurrentRole("admin"); setError(null); }} className={`rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${currentRole === "admin" ? "bg-teal-600 text-white border border-teal-400" : "text-slate-500 hover:text-teal-400"}`}>Admin</button>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-sm border border-red-500/30 bg-red-950/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-400 transition hover:bg-red-900/30"
            >
              Sign Out
            </button>
          </div>
        </header>

        {error && <div className="mb-4 rounded-sm border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}
        {successMessage && <div className="mb-4 rounded-sm border border-teal-500/30 bg-teal-950/20 px-4 py-3 text-sm text-teal-100">{successMessage}</div>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <section className="lg:col-span-1 flex flex-col gap-4">
            <div className={cardClassName}>
              <div className="border-b border-slate-800/90 px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Linked Practices</h3>
              </div>
              
              {loading ? (
                <p className="p-4 text-xs text-slate-400">Querying registry...</p>
              ) : clients.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">No active practices registered.</p>
              ) : (
                <ul className="divide-y divide-slate-800/40 max-h-[320px] overflow-y-auto">
                  {clients.map(client => (
                    <li key={client.id}>
                      <button type="button" onClick={() => setSelectedClientId(client.id)} className={`w-full text-left px-4 py-3.5 transition flex flex-col gap-1 hover:bg-slate-950/30 ${selectedClientId === client.id ? "bg-slate-950/40 border-l-2 border-teal-500" : ""}`}>
                        <span className="text-sm font-medium text-slate-200">Dr {client.name} {client.surname}</span>
                        <span className="text-xs font-mono text-slate-500 flex justify-between">
                          <span>PR: {client.practice_number || "—"}</span>
                          <span className="text-teal-400/70 uppercase text-[10px]">{client.specialty || "General"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={cardClassName}>
              <div className="border-b border-slate-800/90 px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">Broadcast Practice Alert</h3>
                <p className="text-[10px] text-slate-500">Inject ticket thread to practitioner</p>
              </div>
              <form onSubmit={handleCreateTicket} className="p-4 space-y-3">
                <div>
                  <label htmlFor="bureau-ticket-subject" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1">Subject</label>
                  <input id="bureau-ticket-subject" type="text" value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} className={inputClassName} placeholder="e.g. Missing Theatre End Time" />
                </div>
                <div>
                  <label htmlFor="bureau-ticket-preview" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1">Message Preview</label>
                  <textarea id="bureau-ticket-preview" rows={2} value={ticketPreview} onChange={(e) => setTicketPreview(e.target.value)} className={`${inputClassName} resize-none`} placeholder="Details for practitioner notes..." />
                </div>
                <div>
                  <label htmlFor="bureau-ticket-priority" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1">Priority Layer</label>
                  <select id="bureau-ticket-priority" value={ticketPriority} onChange={(e) => setTicketPriority(e.target.value as any)} className={`${inputClassName} bg-slate-950`}>
                    <option value="open">Standard Open Alert</option>
                    <option value="urgent">Urgent Operational Check</option>
                  </select>
                </div>
                <button type="submit" className="w-full rounded-sm bg-slate-800 border border-slate-700 py-2 text-[10px] font-bold uppercase tracking-wide hover:bg-slate-750">Transmit Alert Line</button>
              </form>
            </div>
          </section>

          <section className="lg:col-span-3 flex flex-col gap-6">
            <div className={cardClassName}>
              <div className="border-b border-slate-800/90 px-5 py-3 flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                  Incoming Queue — {selectedClientDetails ? `Dr ${selectedClientDetails.name} ${selectedClientDetails.surname}` : "Selection Pending"}
                </h2>
                <div className="flex flex-wrap gap-1 bg-slate-950/50 p-1 rounded-sm border border-slate-800">
                  {["all", "captured", "billed", "on_hold", "incomplete"].map(st => (
                    <button key={st} type="button" onClick={() => setStatusFilter(st as any)} className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${statusFilter === st ? "bg-slate-800 text-teal-400" : "text-slate-500 hover:text-slate-300"}`}>{st}</button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-3">Patient / Procedure</th>
                      <th className="px-4 py-3 font-mono">ICD-10</th>
                      <th className="px-4 py-3">Modifiers</th>
                      <th className="px-4 py-3">Account Reference</th>
                      <th className="px-4 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {filteredClaims.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No matching records.</td></tr>
                    ) : (
                      filteredClaims.map(claim => (
                        <tr key={claim.id} onClick={() => handleSelectClaim(claim)} className={`cursor-pointer transition hover:bg-slate-950/20 ${selectedClaim?.id === claim.id ? "bg-slate-950/40" : ""}`}>
                          <td className="px-4 py-3.5">
                            <p className="font-medium text-slate-200">{claim.extra_notes?.match(/\[Patient:\s*([^\]]+)\]/)?.[1] || "Unspecified Patient"}</p>
                            <p className="text-slate-500 mt-0.5 max-w-xs truncate">{claim.procedure_description}</p>
                          </td>
                          <td className="px-4 py-3.5 font-mono font-medium text-teal-400">{claim.icd10_code || "—"}</td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {claim.modifiers && claim.modifiers.length > 0 ? claim.modifiers.map(m => <span key={m} className="px-1 bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-400 rounded-sm">{m}</span>) : <span className="text-slate-600">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-slate-300">
                            {claim.account_number ? <span className="text-white bg-slate-800 px-2 py-0.5 rounded-sm border border-slate-700/60">{claim.account_number}</span> : <span className="text-amber-500/80 italic text-[11px]">Unassigned</span>}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={`inline-block rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                              claim.status === "captured" ? "border-teal-500/30 bg-teal-950/20 text-teal-400" : 
                              claim.status === "billed" ? "border-blue-500/30 bg-blue-950/20 text-blue-400" : 
                              claim.status === "on_hold" ? "border-amber-500/40 bg-amber-950/20 text-amber-300" : 
                              "border-red-500/30 bg-red-950/20 text-red-400"
                            }`}>{claim.status}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedClaim && (
              <div className={`grid grid-cols-1 lg:grid-cols-5 gap-4 p-5 ${cardClassName}`}>
                <div className="lg:col-span-2 flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Document Image Verification</p>
                  <div className="flex-1 min-h-[340px] max-h-[460px] rounded-sm border border-slate-800 bg-slate-950 flex items-center justify-center overflow-hidden p-2">
                    {selectedClaim.image_url ? <img src={selectedClaim.image_url} alt="Verification frame" className="h-full w-full object-contain hover:scale-105 transition" /> : <p className="text-xs text-slate-600 italic">No image attached.</p>}
                  </div>
                </div>

                <div className="lg:col-span-3 flex flex-col justify-between gap-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start border-b border-slate-800 pb-2">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-200">Adjudication Engine</h4>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">ID: {selectedClaim.id}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] bg-slate-950/40 p-3 rounded-sm border border-slate-800/60">
                      <div>
                        <span className="text-slate-500 uppercase tracking-wide text-[9px] block">Procedure Description</span>
                        <span className="text-slate-200 text-xs font-medium">{selectedClaim.procedure_description}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase tracking-wide text-[9px] block">ICD-10 Code</span>
                        <span className="text-teal-400 font-mono font-semibold text-xs">{selectedClaim.icd10_code || "Not Specified"}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
                      <div>
                        <label htmlFor="bureau-account-input" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">Allocate Account Number</label>
                        <input id="bureau-account-input" type="text" value={accountNumberInput} onChange={(e) => setAccountNumberInput(e.target.value)} placeholder="e.g. ACC-20649" className={inputClassName} disabled={currentRole !== "admin" || updating} />
                      </div>
                      <div>
                        <label htmlFor="bureau-status-select" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">Operational Status</label>
                        <select id="bureau-status-select" value={targetStatus} onChange={(e) => setTargetStatus(e.target.value as ClaimStatus)} className={`${inputClassName} bg-slate-950`} disabled={currentRole !== "admin" || updating}>
                          <option value="captured">Captured (Awaiting bureau processing)</option>
                          <option value="billed">Billed (Pushed to medical aid)</option>
                          <option value="on_hold">On Hold (Flagged for review)</option>
                          <option value="incomplete">Incomplete (Data anomaly)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-800/60 pt-3 flex-1 flex flex-col gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Audit Trail Logs</p>
                    <div className="flex-1 max-h-24 overflow-y-auto bg-slate-950/50 rounded-sm border border-slate-800/60 p-2 space-y-1.5 font-mono text-[10px]">
                      {auditLogs.length === 0 ? <p className="text-slate-600 italic">No logs recorded.</p> : auditLogs.map(log => (
                        <div key={log.id} className="text-slate-400 border-b border-slate-900 pb-1 last:border-b-0">
                          <span className="text-slate-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span> <span className="text-slate-300 font-sans">{log.action}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end mt-2">
                      <button type="button" onClick={handleUpdateClaimState} disabled={currentRole !== "admin" || updating} className={`rounded-sm border px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition ${currentRole === "admin" ? "border-teal-500 bg-teal-600 text-white hover:bg-teal-500" : "border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed"}`}>
                        {updating ? "Processing Sync..." : "Commit Parameter Changes"}
                      </button>
                    </div>
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