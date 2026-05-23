import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Database, ReceiptText } from "lucide-react";

import { federationBrainApi, type FederationMetrics } from "../api/federationBrain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { queryKeys } from "../lib/queryKeys";

export function FederationHealthCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.federationBrain.metrics,
    queryFn: () => federationBrainApi.metrics(),
    refetchInterval: 5_000,
    retry: false,
  });

  if (error) {
    return (
      <Card className="rounded-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Federation health
          </CardTitle>
          <CardDescription>Metrics are temporarily unavailable.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="rounded-md">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Federation health
        </CardTitle>
        <CardDescription>
          {isLoading ? "Loading live install metrics..." : "Live install metrics refresh every 5 seconds."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <HealthMetric icon={Database} label="KOs" value={formatCount(data?.koCount)} />
        <HealthMetric icon={ReceiptText} label="Receipts" value={formatCount(data?.receipts?.total)} />
        <HealthMetric icon={Clock} label="Latest receipt" value={formatTimestamp(data?.mostRecentReceiptAt)} />
        <HealthMetric icon={Activity} label="Roundtrip p50" value={formatMs(data?.federationRoundtripP50Ms)} />
      </CardContent>
    </Card>
  );
}

export function summarizeFederationHealth(metrics: FederationMetrics | undefined): {
  readonly koCount: string;
  readonly receipts: string;
  readonly latestReceipt: string;
  readonly roundtripP50: string;
} {
  return {
    koCount: formatCount(metrics?.koCount),
    receipts: formatCount(metrics?.receipts?.total),
    latestReceipt: formatTimestamp(metrics?.mostRecentReceiptAt),
    roundtripP50: formatMs(metrics?.federationRoundtripP50Ms),
  };
}

function HealthMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-mono text-xs">{value}</span>
    </div>
  );
}

function formatCount(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function formatMs(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value}ms` : "n/a";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}
