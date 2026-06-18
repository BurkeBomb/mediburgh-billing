"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase";
import {
  AppShell,
  ContentShell,
  AppHeader,
  AppCard,
  SectionTitle,
  StatPill,
  MessageBubble,
  TicketListItem,
} from "@/components/doclog-ui";

type ClaimStatus = "captured" | "on_hold" | "billed";

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

export default function OfficeDashboard() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [tickets, setTickets] = useState<TicketThread[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "captured" | "on_hold" | "billed"
  >("all");
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const supabase = createClient();

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
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ticket_messages",
            filter: `ticket_id=eq.${selectedTicketId}`,
          },
          (payload) => {
            setTicketMessages((prev) => [...prev, payload.new as TicketMessage]);
          }
        )
        .subscribe();
    }

    fetchMessages();

    return () => {
      if (msgChannel) supabase.removeChannel(msgChannel);
    };
  }, [selectedTicketId, supabase]);

  useEffect(() => {
    const claimsChan = supabase
      .channel("office-claims-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "claims" },
        () => setRealtimeTrigger((p) => p + 1)
      )
      .subscribe();

    const ticketsChan = supabase
      .channel("office-tickets-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => setRealtimeTrigger((p) => p + 1)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(claimsChan);
      supabase.removeChannel(ticketsChan);
    };
  }, [supabase]);

  const filteredClaims = useMemo(() => {
    return claims.filter((claim) => {
      const matchesStatus =
        statusFilter === "all" || claim.status === statusFilter;

      const providerName =
        claim.profiles?.title_name_surname?.toLowerCase() || "";
      const desc = claim.procedure_description?.toLowerCase() || "";
      const query = searchFilter.toLowerCase();

      const matchesSearch =
        providerName.includes(query) ||
        desc.includes(query) ||
        claim.icd10_code?.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [claims, statusFilter, searchFilter]);

  const metrics = useMemo(() => {
    const captured = claims.filter((c) => c.status === "captured").length;
    const hold = claims.filter((c) => c.status === "on_hold").length;
    const billed = claims.filter((c) => c.status === "billed").length;

    return { captured, hold, billed };
  }, [claims]);

  const handleUpdateStatus = async (
    claimId: string,
    nextStatus: ClaimStatus
  ) => {
    setIsProcessing(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      await supabase
        .from("claims")
        .update({ status: nextStatus })
        .eq("id", claimId);

      await supabase.from("audit_logs").insert([
        {
          claim_id: claimId,
          user_id: authData.user?.id,
          action: `Claim status changed to ${nextStatus} via Office Audit Panel.`,
        },
      ]);

      setSelectedClaim((prev) =>
        prev?.id === claimId ? { ...prev, status: nextStatus } : prev
      );

      setRealtimeTrigger((p) => p + 1);
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
        {
          ticket_id: selectedTicketId,
          sender_id: authData.user?.id,
          sender_role: "billing_team",
          message: chatInput.trim(),
        },
      ]);

      setChatInput("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateTicket = async (claim: ClaimRecord) => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      const { data: nextTicket } = await supabase
        .from("tickets")
        .insert([
          {
            practitioner_id: claim.practitioner_id,
            subject: `Audit Query: ${claim.icd10_code || "No ICD10"}`,
            medical_aid:
              claim.extra_notes.match(/\[Billing Rate:\s*([^\]]+)\]/)?.[1] ||
              "Review Required",
            status: "open",
          },
        ])
        .select()
        .single();

      if (nextTicket) {
        await supabase.from("ticket_messages").insert([
          {
            ticket_id: nextTicket.id,
            sender_id: authData.user?.id,
            sender_role: "billing_team",
            message: `System initiated audit trail for case details: ${claim.procedure_description}. Please review and update parameters.`,
          },
        ]);

        setSelectedTicketId(nextTicket.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AppShell>
      <AppHeader
        title="CLINTECH AUDIT CONTROL"
        byline="BY MEDIBURGH"
        tagline="Central Back-Office Engine"
        subline="System-wide Bureau Auditing Grid"
        right={
          <>
            <StatPill label="UNRESOLVED" value={metrics.captured} />
            <StatPill label="HELD CASES" value={metrics.hold} />
            <StatPill label="BILLED MTD" value={metrics.billed} className="text-[#A8FFEA]" />
          </>
        }
      />

      <ContentShell>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Filter by practitioner, code, or description..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full h-[42px] rounded-[10px] bg-[#14181F] border border-[#1F242C] px-3 text-[13px] font-medium text-[#E8F1FF] placeholder:text-[#6C7A89] outline-none transition focus:border-[#00C2D1] focus:shadow-[0_0_0_3px_rgba(0,194,209,0.15)]"
          />

          <div className="flex gap-2">
            {(["all", "captured", "on_hold", "billed"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`flex-1 rounded-[10px] border py-1.5 text-xs font-semibold uppercase tracking-[0.8px] transition ${
                  statusFilter === status
                    ? "border-[#00C2D1] bg-[#16232A] text-[#DDE7F5]"
                    : "border-[#1F242C] bg-[#14181F] text-[#7F8FA3] hover:text-[#DDE7F5]"
                }`}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end text-right text-[11px] font-medium text-[#6C7A89]">
            TOTAL ENGINES COMPLIANT • REALTIME LIVE SYNC
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 flex-1">
          <section className="xl:col-span-3 overflow-hidden flex flex-col">
            <AppCard className="overflow-hidden flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-[#232A33] pb-2 mb-2">
                <SectionTitle className="mb-0">
                  Inbound Billing Pipeline
                </SectionTitle>
                <span className="text-[10px] text-[#6C7A89] uppercase tracking-[0.8px]">
                  Queue Count: {filteredClaims.length}
                </span>
              </div>

              <div className="flex-1 max-h-[680px] overflow-y-auto divide-y divide-[#232A33] pr-1">
                {filteredClaims.length === 0 ? (
                  <div className="p-8 text-center text-xs italic text-[#6C7A89]">
                    NO VERIFIED ATTACHMENTS MATCHING SEARCH PARAMETERS
                  </div>
                ) : (
                  filteredClaims.map((claim) => (
                    <div
                      key={claim.id}
                      onClick={() => setSelectedClaim(claim)}
                      className={`rounded-[12px] border p-3 transition cursor-pointer flex flex-col gap-1 ${
                        selectedClaim?.id === claim.id
                          ? "border-[#00C2D1] bg-[#16232A]"
                          : "border-transparent hover:bg-[#111820]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-[0.6px] text-[#E8F1FF]">
                            {claim.profiles?.title_name_surname || "Unknown Doctor"}
                          </span>
                          <span className="block text-[10px] text-[#6C7A89]">
                            {claim.profiles?.specialty} • PR: {claim.profiles?.pr_number}
                          </span>
                        </div>

                        <span
                          className={`rounded-[10px] border px-2 py-0.5 text-[9px] font-semibold uppercase ${
                            claim.status === "captured"
                              ? "border-[#00C2D1] text-[#00C2D1]"
                              : claim.status === "on_hold"
                              ? "border-[#E7B75B] text-[#E7B75B]"
                              : "border-[#A8FFEA] text-[#A8FFEA]"
                          }`}
                        >
                          {claim.status.replace("_", " ")}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-xs font-medium text-[#DDE7F5]">
                        {claim.procedure_description}
                      </p>

                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-[#7F8FA3]">
                        <span>
                          ICD10:{" "}
                          <span className="font-semibold text-[#00C2D1]">
                            {claim.icd10_code || "NONE"}
                          </span>
                        </span>
                        <span>
                          {new Date(claim.created_at).toLocaleDateString("en-ZA")}{" "}
                          {new Date(claim.created_at).toLocaleTimeString("en-ZA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </AppCard>
          </section>

          <aside className="xl:col-span-2 flex flex-col gap-4">
            <AppCard
              className={`flex flex-col ${
                selectedClaim
                  ? ""
                  : "min-h-[220px] items-center justify-center p-8 text-center"
              }`}
            >
              {selectedClaim ? (
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between border-b border-[#232A33] pb-2">
                    <SectionTitle className="mb-0">
                      Case Audit File
                    </SectionTitle>

                    <button
                      onClick={() => handleCreateTicket(selectedClaim)}
                      className="rounded-[10px] border border-[#00C2D1] bg-[#14181F] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.8px] text-[#00C2D1] hover:bg-[#16232A]"
                    >
                      🗣️ Open Query
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-[#232A33] pb-2.5 text-xs">
                    <div>
                      <span className="block text-[9px] font-semibold uppercase text-[#6C7A89]">
                        Classification Target
                      </span>
                      <span className="font-mono font-semibold text-[#00C2D1]">
                        {selectedClaim.icd10_code || "Not Stated"}
                      </span>
                    </div>

                    <div>
                      <span className="block text-[9px] font-semibold uppercase text-[#6C7A89]">
                        Tariff Codes
                      </span>
                      <span className="font-mono font-semibold text-[#E8F1FF]">
                        {selectedClaim.extra_notes.match(/\[Procedure Code:\s*([^\]]+)\]/)?.[1] ||
                          "None Specified"}
                      </span>
                    </div>

                    <div>
                      <span className="block text-[9px] font-semibold uppercase text-[#6C7A89]">
                        Calculated Body Mass Index
                      </span>
                      <span className="font-mono text-[#DDE7F5]">
                        {selectedClaim.bmi_info
                          ? `${selectedClaim.bmi_info} kg/m²`
                          : "N/A"}
                      </span>
                    </div>

                    <div>
                      <span className="block text-[9px] font-semibold uppercase text-[#6C7A89]">
                        Modifications Stack
                      </span>
                      <span className="block truncate font-mono text-[11px] text-[#DDE7F5]">
                        {selectedClaim.modifiers?.join(", ") || "None"}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {selectedClaim.image_url && (
                      <a
                        href={selectedClaim.image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-[10px] border border-[#1F242C] bg-[#14181F] p-2 text-center text-[10px] font-semibold uppercase tracking-[0.8px] text-[#00C2D1] transition hover:border-[#00C2D1]"
                      >
                        View Primary Sheet
                      </a>
                    )}

                    {selectedClaim.extra_image_url && (
                      <a
                        href={selectedClaim.extra_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-[10px] border border-[#1F242C] bg-[#14181F] p-2 text-center text-[10px] font-semibold uppercase tracking-[0.8px] text-[#00C2D1] transition hover:border-[#00C2D1]"
                      >
                        View Support Doc
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-[#232A33] pt-2.5">
                    <button
                      onClick={() => handleUpdateStatus(selectedClaim.id, "billed")}
                      disabled={isProcessing || selectedClaim.status === "billed"}
                      className="rounded-[10px] border border-[#2C6F5E] bg-[#14181F] py-1.5 text-xs font-semibold uppercase tracking-[0.8px] text-[#A8FFEA] hover:bg-[#1A2A25] disabled:opacity-30"
                    >
                      ✓ Post to Medical Aid
                    </button>

                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedClaim.id, "on_hold")
                      }
                      disabled={
                        isProcessing || selectedClaim.status === "on_hold"
                      }
                      className="rounded-[10px] border border-[#735A22] bg-[#14181F] py-1.5 text-xs font-semibold uppercase tracking-[0.8px] text-[#E7B75B] hover:bg-[#2A2315] disabled:opacity-30"
                    >
                      ⚠️ Flag on Hold
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] uppercase tracking-[0.8px] text-[#6C7A89]">
                  Select a medical case record from the billing pipeline grid to
                  initiate back-office validation.
                </p>
              )}
            </AppCard>

            <AppCard className="flex-1 flex flex-col overflow-hidden max-h-[400px]">
              <div className="border-b border-[#232A33] pb-2">
                <SectionTitle className="mb-0">
                  Active Adjudication Streams
                </SectionTitle>
                <p className="text-[9px] uppercase tracking-[0.6px] text-[#6C7A89]">
                  Direct validation loop with providers
                </p>
              </div>

              <div className="min-h-0 flex-1 grid grid-cols-3 overflow-hidden pt-2">
                <ul className="col-span-1 overflow-y-auto border-r border-[#232A33] pr-1 space-y-1">
                  {tickets.length === 0 && (
                    <li className="p-2 text-[10px] italic text-[#6C7A89]">
                      NO CHAT ALERTS ACTIVE
                    </li>
                  )}

                  {tickets.map((ticket) => (
                    <TicketListItem
                      key={ticket.id}
                      active={selectedTicketId === ticket.id}
                      title={ticket.profiles?.title_name_surname || "Doctor"}
                      subtitle={ticket.subject}
                      onClick={() => setSelectedTicketId(ticket.id)}
                    />
                  ))}
                </ul>

                <div className="col-span-2 flex flex-col overflow-hidden pl-2">
                  {selectedTicketId ? (
                    <>
                      <div className="flex-1 space-y-2 overflow-y-auto py-2 pr-1 text-xs">
                        {ticketMessages.map((message) => (
                          <MessageBubble
                            key={message.id}
                            isMine={message.sender_role === "billing_team"}
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
                        onSubmit={handleSendChat}
                        className="flex border-t border-[#232A33] pt-2"
                      >
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Transmit advisory note to practitioner..."
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
                        Select an active query session to interface with practitioner dashboard files.
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
``
