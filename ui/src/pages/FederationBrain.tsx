import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Database, FileJson, Lock, ReceiptText, ShieldCheck } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "@/lib/router";
import {
  federationBrainApi,
  type FederationBrainDashboardContent,
  type FederationBrainRead,
  type FederationBrainVerificationReport,
} from "../api/federationBrain";
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

function compactHash(value: string | undefined): string {
  if (!value) return "unknown";
  const [prefix, hash] = value.split(":");
  if (!hash || hash.length <= 18) return value;
  return `${prefix}:${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatEventLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function statusTone(read: FederationBrainRead | undefined) {
  if (!read) return "border-border bg-card text-foreground";
  if (read.status === "denied") return "border-red-500/30 bg-red-950/15 text-red-100";
  return "border-emerald-500/25 bg-emerald-950/15 text-emerald-100";
}

export function FederationBrain() {
  const params = useParams<{ koId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const koId = params.koId ?? "";
  const asConsumer = searchParams.get("asConsumer") ?? undefined;
  const [draftKoId, setDraftKoId] = useState(koId);
  const [draftConsumer, setDraftConsumer] = useState(asConsumer ?? "");

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

  const dashboard = data?.status === "allowed" && isDashboardContent(data.content) ? data.content : null;
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
              </div>
              <h1 className="mt-3 break-words text-2xl font-semibold tracking-normal sm:text-3xl">
                {dashboard?.title ?? data?.id ?? "Federation Knowledge Object"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-current/75">
                {data?.status === "denied"
                  ? data.reason
                  : dashboard?.summary ?? "Open a signed Knowledge Object to inspect provenance, consent, and receipts."}
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
          <AllowedState read={data} dashboard={dashboard} receiptEvents={receiptEvents} />
        ) : (
          <Card className="rounded-md">
            <CardContent className="py-8 text-sm text-muted-foreground">Enter a KO id to open the public demo view.</CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function AllowedState({
  read,
  dashboard,
  receiptEvents,
}: {
  read: Extract<FederationBrainRead, { status: "allowed" }>;
  dashboard: FederationBrainDashboardContent | null;
  receiptEvents: [string, number][];
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ProofTile label="Content hash" value={compactHash(read.contentHash)} icon={FileJson} />
        <ProofTile label="Signature" value={read.verification.signature} icon={ShieldCheck} />
        <ProofTile label="Consent" value={read.consent.status === "enforced" ? "read-time enforced" : "local owner"} icon={Lock} />
        <ProofTile label="Receipts" value={`${read.receipts.total} persisted`} icon={ReceiptText} />
      </div>

      {dashboard ? (
        <Card className="rounded-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dashboard</CardTitle>
            <CardDescription>
              {dashboard.input?.fileName ? `${dashboard.input.fileName} · ${dashboard.input.rows ?? 0} rows` : "Signed dashboard content"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dashboard.widgets?.map((widget, index) => (
              <div key={`${widget.label ?? "widget"}-${index}`} className="border border-border p-4">
                <div className="text-xs uppercase text-muted-foreground">{widget.kind ?? "metric"}</div>
                <div className="mt-2 text-sm font-medium">{widget.label ?? `Widget ${index + 1}`}</div>
                <div className="mt-3 text-2xl font-semibold tabular-nums">{String(widget.value ?? "-")}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-md">
          <CardContent className="py-5">
            <pre className="max-h-[420px] overflow-auto text-xs leading-5">{JSON.stringify(read.content, null, 2)}</pre>
          </CardContent>
        </Card>
      )}

      {read.verificationReports.length > 0 ? (
        <VerificationReportsPanel reports={read.verificationReports} />
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

function DeniedState({ read }: { read: Extract<FederationBrainRead, { status: "denied" }> }) {
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
          <KeyValue label="Consumer" value={read.asConsumer ?? "unspecified"} />
          <KeyValue label="Reason" value={read.reason} />
        </CardContent>
      </Card>
      <ReceiptPanel
        receiptEvents={Object.entries(read.receipts.byEvent)}
        koChainValid={read.receiptVerification.koChainValid}
        globalAnchorValid={read.receiptVerification.globalAnchorValid}
      />
      {read.verificationReports.length > 0 ? (
        <VerificationReportsPanel reports={read.verificationReports} />
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
        <KeyValue label="Creator install" value={read.creatorInstallId} />
        <KeyValue label="Signer install" value={read.signerInstallId} />
        <KeyValue label="Stored at" value={read.provenance.storedAt} />
      </CardContent>
    </Card>
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
                  <div className="text-xs text-red-300">Failed: {report.failedChecks.join(", ")}</div>
                ) : null}
                {report.warningChecks.length > 0 ? (
                  <div className="text-xs text-amber-300">Warnings: {report.warningChecks.join(", ")}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
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
