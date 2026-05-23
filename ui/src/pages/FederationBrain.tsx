import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Database, FileJson, GitBranch, Lock, Radio, ReceiptText, ShieldCheck } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "@/lib/router";
import {
  federationBrainApi,
  type FederationBrainDashboardContent,
  type FederationBrainDerivedContent,
  type FederationBrainIdentityDisplay,
  type FederationBrainRead,
  type FederationBrainReceiptEvent,
  type FederationBrainReferralPacketContent,
  type FederationBrainReportContent,
  type FederationBrainTableContent,
  type FederationBrainVerificationReport,
} from "../api/federationBrain";
import { FederationHealthCard } from "../components/FederationHealthCard";
import { describeFederationCheck } from "../lib/federationCheckCopy";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function isDashboardContent(content: unknown): content is FederationBrainDashboardContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    Array.isArray((content as FederationBrainDashboardContent).widgets)
  );
}

function isReportContent(content: unknown): content is FederationBrainReportContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as FederationBrainReportContent).kind === "report"
  );
}

function isTableContent(content: unknown): content is FederationBrainTableContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as FederationBrainTableContent).kind === "table"
  );
}

function isReferralPacketContent(content: unknown): content is FederationBrainReferralPacketContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as FederationBrainReferralPacketContent).kind === "referral_packet"
  );
}

function isDerivedContent(content: unknown): content is FederationBrainDerivedContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as FederationBrainDerivedContent).kind === "derived_knowledge_object"
  );
}

function compactHash(value: string | undefined): string {
  if (!value) return "unknown";
  const [prefix, hash] = value.split(":");
  if (!hash || hash.length <= 18) return value;
  return `${prefix}:${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function compactInstallId(value: string | undefined): string {
  if (!value) return "unknown install";
  if (value.length <= 22) return value;
  return `${value.slice(0, 14)}...${value.slice(-6)}`;
}

function formatEventLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function statusTone(read: FederationBrainRead | undefined) {
  if (!read) return "border-border bg-card text-foreground";
  if (read.status === "denied") return "border-red-500/30 bg-red-950/15 text-red-100";
  return "border-emerald-500/25 bg-emerald-950/15 text-emerald-100";
}

type LiveStatus = "connecting" | "live" | "reconnecting" | "unavailable";

export function FederationBrain() {
  const params = useParams<{ koId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const koId = params.koId ?? "";
  const asConsumer = searchParams.get("asConsumer") ?? undefined;
  const queryClient = useQueryClient();
  const [draftKoId, setDraftKoId] = useState(koId);
  const [draftConsumer, setDraftConsumer] = useState(asConsumer ?? "");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [lastLiveEvent, setLastLiveEvent] = useState<FederationBrainReceiptEvent | null>(null);

  useEffect(() => {
    setDraftKoId(koId);
    setDraftConsumer(asConsumer ?? "");
  }, [asConsumer, koId]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.federationBrain.show(koId, asConsumer),
    queryFn: () => federationBrainApi.show(koId, asConsumer),
    enabled: koId.length > 0,
    retry: false,
  });
  useEffect(() => {
    if (!koId) return;
    if (typeof EventSource === "undefined") {
      setLiveStatus("unavailable");
      return;
    }

    setLiveStatus("connecting");
    setLastLiveEvent(null);
    const source = new EventSource(federationBrainApi.eventsUrl(koId));
    source.onopen = () => setLiveStatus("live");
    source.onerror = () => setLiveStatus("reconnecting");
    source.addEventListener("receipt", (event) => {
      const parsed = parseReceiptEvent(event);
      setLastLiveEvent(parsed);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.federationBrain.show(koId, asConsumer),
      });
    });

    return () => {
      source.close();
    };
  }, [asConsumer, koId, queryClient]);

  const dashboard = data?.status === "allowed" && isDashboardContent(data.content) ? data.content : null;
  const report = data?.status === "allowed" && isReportContent(data.content) ? data.content : null;
  const table = data?.status === "allowed" && isTableContent(data.content) ? data.content : null;
  const referralPacket = data?.status === "allowed" && isReferralPacketContent(data.content) ? data.content : null;
  const derived = data?.status === "allowed" && isDerivedContent(data.content) ? data.content : null;
  const receiptEvents = useMemo(() => Object.entries(data?.receipts.byEvent ?? {}), [data?.receipts.byEvent]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextKo = draftKoId.trim();
    if (!nextKo) return;
    const nextConsumer = draftConsumer.trim();
    navigate({
      pathname: `/federation/brain/${encodeURIComponent(nextKo)}`,
      search: nextConsumer ? `?asConsumer=${encodeURIComponent(nextConsumer)}` : "",
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className={cn("border p-5", statusTone(data))}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-current/25 text-current">
                  Stacy Brain
                </Badge>
                {data?.status === "allowed" ? (
                  <Badge className="bg-emerald-500 text-emerald-950">
                    <BadgeCheck className="h-3 w-3" />
                    Read allowed
                  </Badge>
                ) : data?.status === "denied" ? (
                  <Badge className="bg-red-500 text-red-950">
                    <Lock className="h-3 w-3" />
                    Read denied
                  </Badge>
                ) : null}
                <LiveStatusBadge status={liveStatus} lastEvent={lastLiveEvent} />
              </div>
              <h1 className="mt-3 break-words text-2xl font-semibold tracking-normal sm:text-3xl">
                {dashboard?.title ?? referralPacket?.title ?? report?.title ?? table?.title ?? (derived ? "Consumer counter-KO" : data?.id) ?? "Federation Knowledge Object"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-current/75">
                {data?.status === "denied"
                  ? data.reason
                  : dashboard?.summary ?? referralPacket?.summary ?? report?.summary ?? table?.summary ?? (derived ? "A consumer-signed derived Knowledge Object that references the producer-owned source KO without mutating it." : "Open a signed Knowledge Object to inspect provenance, consent, and receipts.")}
              </p>
            </div>
            <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] lg:w-[620px]">
              <Input
                value={draftKoId}
                onChange={(event) => setDraftKoId(event.target.value)}
                placeholder="ko_public_revenue_dashboard"
                aria-label="Knowledge Object ID"
              />
              <Input
                value={draftConsumer}
                onChange={(event) => setDraftConsumer(event.target.value)}
                placeholder="consumer install id"
                aria-label="Consumer install ID"
              />
              <Button type="submit">Open</Button>
            </form>
          </div>
        </section>

        {error ? (
          <Card className="rounded-md border-red-500/30 bg-red-950/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-red-100">
                <AlertTriangle className="h-4 w-4" />
                Unable to load KO
              </CardTitle>
              <CardDescription>{error instanceof Error ? error.message : "Unknown error"}</CardDescription>
            </CardHeader>
          </Card>
        ) : isLoading ? (
          <Card className="rounded-md">
            <CardContent className="py-8 text-sm text-muted-foreground">Loading federation proof...</CardContent>
          </Card>
        ) : data?.status === "denied" ? (
          <DeniedState read={data} />
        ) : data ? (
          <AllowedState read={data} dashboard={dashboard} referralPacket={referralPacket} report={report} table={table} derived={derived} receiptEvents={receiptEvents} />
        ) : (
          <Card className="rounded-md">
            <CardContent className="py-8 text-sm text-muted-foreground">Enter a KO id to open the public demo view.</CardContent>
          </Card>
        )}
        <FederationHealthCard />
      </div>
    </main>
  );
}

function parseReceiptEvent(event: MessageEvent): FederationBrainReceiptEvent | null {
  try {
    return JSON.parse(event.data) as FederationBrainReceiptEvent;
  } catch {
    return null;
  }
}

function LiveStatusBadge({
  status,
  lastEvent,
}: {
  status: LiveStatus;
  lastEvent: FederationBrainReceiptEvent | null;
}) {
  const label = status === "live"
    ? lastEvent
      ? `Live: ${formatEventLabel(lastEvent.eventType)}`
      : "Live updates"
    : status === "reconnecting"
      ? "Reconnecting"
      : status === "unavailable"
        ? "Live unavailable"
        : "Connecting";
  return (
    <Badge variant="outline" className="border-current/25 text-current">
      <Radio className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function AllowedState({
  read,
  dashboard,
  referralPacket,
  report,
  table,
  derived,
  receiptEvents,
}: {
  read: Extract<FederationBrainRead, { status: "allowed" }>;
  dashboard: FederationBrainDashboardContent | null;
  referralPacket: FederationBrainReferralPacketContent | null;
  report: FederationBrainReportContent | null;
  table: FederationBrainTableContent | null;
  derived: FederationBrainDerivedContent | null;
  receiptEvents: [string, number][];
}) {
  const verificationReports = read.verificationReports ?? [];
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ProofTile label="Content hash" value={compactHash(read.contentHash)} icon={FileJson} />
        <ProofTile label="Signature" value={read.verification.signature} icon={ShieldCheck} />
        <ProofTile label="Consent" value={read.consent.status === "enforced" ? "read-time enforced" : "local owner"} icon={Lock} />
        <ProofTile label="Receipts" value={`${read.receipts.total} persisted`} icon={ReceiptText} />
      </div>

      {dashboard ? (
        <DashboardCard dashboard={dashboard} />
      ) : referralPacket ? (
        <ReferralPacketCard referralPacket={referralPacket} />
      ) : report ? (
        <ReportCard report={report} />
      ) : table ? (
        <TableCard table={table} />
      ) : derived ? (
        <DerivedKoCard derived={derived} signer={read.identities?.signer} />
      ) : (
        <Card className="rounded-md">
          <CardContent className="py-5">
            <pre className="max-h-[420px] overflow-auto text-xs leading-5">{JSON.stringify(read.content, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {verificationReports.length > 0 ? (
        <VerificationReportsPanel reports={verificationReports} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <ProofPanel read={read} />
        <ReceiptPanel
          receiptEvents={receiptEvents}
          koChainValid={read.receiptVerification.koChainValid}
          globalAnchorValid={read.receiptVerification.globalAnchorValid}
        />
      </div>
    </>
  );
}

function ReferralPacketCard({ referralPacket }: { referralPacket: FederationBrainReferralPacketContent }) {
  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Referral packet</CardTitle>
        <CardDescription>
          {referralPacket.input?.fileName ? `${referralPacket.input.fileName} · ${referralPacket.input.rows ?? 0} rows` : "Signed referral packet content"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <KeyValue label="Patient" value={referralPacket.patientReference ?? "unknown"} />
          <KeyValue label="Reason" value={referralPacket.referralReason ?? "unknown"} />
          <KeyValue label="Labs" value={referralPacket.labSnapshot ?? "unknown"} />
          <KeyValue label="Imaging" value={referralPacket.imagingStatus ?? "unknown"} />
          <KeyValue label="Consent expires" value={referralPacket.consent?.expiresAt ?? "unknown"} />
          <KeyValue label="Revoke reason" value={referralPacket.consent?.revocationReason ?? "unknown"} />
        </div>
        <div className="border border-border p-4">
          <div className="text-sm font-semibold">Clinical summary</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{referralPacket.clinicalSummary ?? "No clinical summary provided."}</p>
        </div>
        <div className="border border-border p-4">
          <div className="text-sm font-semibold">Medication list</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {(referralPacket.medications ?? []).map((medication) => <li key={medication}>{medication}</li>)}
          </ul>
        </div>
        {referralPacket.attachments?.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {referralPacket.attachments.map((attachment) => (
              <div key={`${attachment.label}-${attachment.status}`} className="border border-border px-3 py-2">
                <span className="font-medium">{attachment.label ?? "Attachment"}</span>
                <span className="ml-2 text-muted-foreground">{attachment.status ?? "unknown"}</span>
              </div>
            ))}
          </div>
        ) : null}
        <AdapterNotes notes={referralPacket.adapterNotes} />
      </CardContent>
    </Card>
  );
}

function DerivedKoCard({
  derived,
  signer,
}: {
  derived: FederationBrainDerivedContent;
  signer?: FederationBrainIdentityDisplay;
}) {
  const source = derived.source ?? {};
  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4" />
          Consumer counter-KO
        </CardTitle>
        <CardDescription>
          Write scope creates a new consumer-signed artifact. It does not mutate the producer-owned source KO.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <KeyValue label="Source KO" value={source.koId ?? "unknown"} />
          <KeyValue label="Source hash" value={compactHash(source.koContentHash)} />
          <KeyValue label="Producer" value={compactInstallId(source.producerInstallId)} />
          <KeyValue label="Grant" value={`${source.grantId ?? "unknown"} (${source.grantScope ?? "unknown"})`} />
          <IdentityValue label="Signed by" identity={signer} fallback={derived.createdByConsumerInstallId ?? "unknown"} />
          <KeyValue label="Created at" value={derived.createdAt ?? "unknown"} />
        </div>
        <div className="border border-border bg-muted/20 p-4">
          <div className="text-xs uppercase text-muted-foreground">Derived content</div>
          <pre className="mt-2 max-h-[320px] overflow-auto text-xs leading-5">{JSON.stringify(derived.derivedContent ?? null, null, 2)}</pre>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardCard({ dashboard }: { dashboard: FederationBrainDashboardContent }) {
  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Dashboard</CardTitle>
        <CardDescription>
          {dashboard.input?.fileName ? `${dashboard.input.fileName} · ${dashboard.input.rows ?? 0} rows` : "Signed dashboard content"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboard.widgets?.map((widget, index) => (
            <div key={`${widget.label ?? "widget"}-${index}`} className="border border-border p-4">
              <div className="text-xs uppercase text-muted-foreground">{widget.kind ?? "metric"}</div>
              <div className="mt-2 text-sm font-medium">{widget.label ?? `Widget ${index + 1}`}</div>
              <div className="mt-3 text-2xl font-semibold tabular-nums">{String(widget.value ?? "-")}</div>
            </div>
          ))}
        </div>
        <AdapterNotes notes={dashboard.adapterNotes} />
      </CardContent>
    </Card>
  );
}

function ReportCard({ report }: { report: FederationBrainReportContent }) {
  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Referral report</CardTitle>
        <CardDescription>
          {report.input?.fileName ? `${report.input.fileName} · ${report.input.rows ?? 0} rows` : "Signed report content"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.sections?.map((section, index) => (
          <div key={`${section.heading ?? "section"}-${index}`} className="border border-border p-4">
            <div className="text-sm font-semibold">{section.heading ?? `Section ${index + 1}`}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body ?? ""}</p>
          </div>
        ))}
        <AdapterNotes notes={report.adapterNotes} />
      </CardContent>
    </Card>
  );
}

function TableCard({ table }: { table: FederationBrainTableContent }) {
  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Table</CardTitle>
        <CardDescription>{table.summary ?? "Signed table content"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-auto border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                {(table.columns ?? []).map((column) => <th key={column} className="px-3 py-2">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {(table.rows ?? []).slice(0, 8).map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {(table.columns ?? []).map((column) => <td key={column} className="px-3 py-2">{String(row[column] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AdapterNotes notes={table.adapterNotes} />
      </CardContent>
    </Card>
  );
}

function AdapterNotes({ notes }: { notes: readonly string[] | undefined }) {
  if (!notes?.length) return null;
  return (
    <div className="border border-border bg-muted/20 p-4">
      <div className="text-xs uppercase text-muted-foreground">LLM-authored narrative</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </div>
  );
}

function DeniedState({ read }: { read: Extract<FederationBrainRead, { status: "denied" }> }) {
  const verificationReports = read.verificationReports ?? [];
  const consumer = read.identities?.consumer;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card className="rounded-md border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-red-400" />
            Consent enforcement
          </CardTitle>
          <CardDescription>The consumer read was blocked by the federation read path.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <KeyValue label="KO" value={read.id} />
          <IdentityValue label="Consumer" identity={consumer} fallback={read.asConsumer ?? "unspecified"} />
          <KeyValue label="Reason" value={read.reason} />
        </CardContent>
      </Card>
      <ReceiptPanel
        receiptEvents={Object.entries(read.receipts.byEvent)}
        koChainValid={read.receiptVerification.koChainValid}
        globalAnchorValid={read.receiptVerification.globalAnchorValid}
      />
      {verificationReports.length > 0 ? (
        <VerificationReportsPanel reports={verificationReports} />
      ) : null}
    </div>
  );
}

function ProofTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof ShieldCheck;
}) {
  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div className="mt-2 truncate text-lg font-semibold">{value}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

function ProofPanel({ read }: { read: Extract<FederationBrainRead, { status: "allowed" }> }) {
  const producer = read.identities?.producer;
  const signer = read.identities?.signer;
  const consumer = read.identities?.consumer;
  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          Provenance
        </CardTitle>
        <CardDescription>Identity and source metadata attached to the signed KO.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <KeyValue label="Tenant" value={read.tenant} />
        <KeyValue label="Source" value={read.provenance.source} />
        {read.consent.grantId ? <KeyValue label="Grant" value={read.consent.grantId} /> : null}
        {read.consent.recipient ? <KeyValue label="Recipient" value={formatConsentRecipient(read.consent.recipient)} /> : null}
        <IdentityValue label="Producer" identity={producer} fallback={read.creatorInstallId} />
        <IdentityValue label="Signer" identity={signer} fallback={read.signerInstallId} />
        {consumer ? <IdentityValue label="Consumer" identity={consumer} fallback={read.asConsumer ?? ""} /> : null}
        <KeyValue label="Stored at" value={read.provenance.storedAt} />
      </CardContent>
    </Card>
  );
}

function formatConsentRecipient(recipient: NonNullable<Extract<FederationBrainRead, { status: "allowed" }>["consent"]["recipient"]>): string {
  const id = recipient.id ?? "unknown";
  const type = recipient.type ?? "unknown";
  return recipient.role ? `${type}: ${id} / ${recipient.role}` : `${type}: ${id}`;
}

function IdentityValue({
  label,
  identity,
  fallback,
}: {
  label: string;
  identity?: FederationBrainIdentityDisplay;
  fallback: string;
}) {
  const display = identity?.label ?? compactInstallId(fallback);
  const installId = identity?.installId ?? fallback;
  return (
    <div className="grid gap-1 sm:grid-cols-[130px_1fr]">
      <div className="text-muted-foreground">{label}</div>
      <details className="min-w-0">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-medium">
          <span>{display}</span>
          {identity?.verified ? <Badge variant="outline">verified</Badge> : null}
        </summary>
        <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
          <div className="break-all">Install: {installId}</div>
          {identity?.publicKeyFingerprint ? <div>Key: {identity.publicKeyFingerprint}</div> : null}
        </div>
      </details>
    </div>
  );
}

function VerificationReportsPanel({ reports }: { reports: readonly FederationBrainVerificationReport[] }) {
  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Verification reports
        </CardTitle>
        <CardDescription>Signed correctness checks attached to this Knowledge Object.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {reports.map((report) => (
          <div key={`${report.verificationKoId}-${report.receiptHash}`} className="border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={report.verdict === "pass" ? "default" : "destructive"}>
                Verdict {report.verdict}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{new Date(report.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-3 space-y-2">
              <KeyValue label="Report KO" value={report.verificationKoId} />
              <KeyValue label="Verifier" value={report.verifierInstallId} />
              <KeyValue label="Report hash" value={compactHash(report.verificationContentHash)} />
            </div>
            {report.failedChecks.length > 0 || report.warningChecks.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {report.failedChecks.length > 0 ? (
                  <CheckList tone="failed" checks={report.failedChecks} />
                ) : null}
                {report.warningChecks.length > 0 ? (
                  <CheckList tone="warning" checks={report.warningChecks} />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CheckList({
  tone,
  checks,
}: {
  tone: "failed" | "warning";
  checks: readonly string[];
}) {
  const className = tone === "failed" ? "text-red-300" : "text-amber-300";
  return (
    <div className={cn("text-xs", className)}>
      <span>{tone === "failed" ? "Failed" : "Warnings"}: </span>
      <span className="inline-flex flex-wrap gap-1">
        {checks.map((check) => (
          <span
            key={check}
            className="cursor-help rounded-sm border border-current/30 px-1 font-mono"
            title={describeFederationCheck(check)}
            aria-label={describeFederationCheck(check)}
          >
            {check}
          </span>
        ))}
      </span>
    </div>
  );
}

function ReceiptPanel({
  receiptEvents,
  koChainValid,
  globalAnchorValid,
}: {
  receiptEvents: [string, number][];
  koChainValid: boolean;
  globalAnchorValid: boolean;
}) {
  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="h-4 w-4" />
          Receipts
        </CardTitle>
        <CardDescription>Persisted event counts and tamper-evidence checks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant={koChainValid ? "default" : "destructive"}>
            KO chain {koChainValid ? "valid" : "invalid"}
          </Badge>
          <Badge variant={globalAnchorValid ? "default" : "destructive"}>
            Global anchor {globalAnchorValid ? "valid" : "invalid"}
          </Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {receiptEvents.length > 0 ? receiptEvents.map(([eventType, count]) => (
            <div key={eventType} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
              <span className="capitalize">{formatEventLabel(eventType)}</span>
              <span className="font-mono text-xs text-muted-foreground">{count}</span>
            </div>
          )) : (
            <div className="text-muted-foreground">No receipts yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[130px_1fr]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all font-mono text-xs">{value}</div>
    </div>
  );
}
