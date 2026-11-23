/**
 * Reads for the admin billing dashboard (D-024): the Cloud Billing export in
 * BigQuery and Cloud Monitoring time series, both over REST. Auth is the
 * functions' runtime service account through google-auth-library (already
 * installed via firebase-admin; loaded lazily like agent/models.ts), so no
 * extra packages. Only aggregates are read; nothing here writes.
 */
import { BillingRows, MonthWindow, UsageSeries } from "../core/billing";

/** A failed Google API call. `status` is the HTTP status (0 when unknown). */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason = "",
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Minimal authenticated REST client; faked in tests. */
export interface RestClient {
  request(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown>;
}

/** RestClient using Application Default Credentials (the runtime service account in Cloud Functions). */
export function defaultRestClient(): RestClient {
  let client: Promise<{ request: (opts: Record<string, unknown>) => Promise<{ data: unknown }> }> | null = null;
  const getClient = async () => {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    return (await auth.getClient()) as unknown as { request: (opts: Record<string, unknown>) => Promise<{ data: unknown }> };
  };
  return {
    async request(method, url, body) {
      client ??= getClient();
      client.catch(() => (client = null));
      try {
        const res = await (await client).request({ url, method, data: body, responseType: "json" });
        return res.data;
      } catch (e) {
        const err = e as { response?: { status?: number; data?: { error?: { message?: string; errors?: { reason?: string }[] } } }; message?: string };
        const apiError = err.response?.data?.error;
        throw new GoogleApiError(
          err.response?.status ?? 0,
          apiError?.message ?? err.message ?? "Google API call failed",
          apiError?.errors?.[0]?.reason ?? "",
        );
      }
    },
  };
}

/** True when BigQuery says the dataset or export table does not exist yet. */
export function isNotFound(e: unknown): boolean {
  if (!(e instanceof GoogleApiError)) return false;
  return e.status === 404 || e.reason === "notFound" || /^Not found: (Dataset|Table)/i.test(e.message);
}

// ---------------------------------------------------------------------------
// BigQuery

const BQ = "https://bigquery.googleapis.com/bigquery/v2";

interface BqField { name: string }
interface BqResponse {
  jobComplete?: boolean;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: BqField[] };
  rows?: { f?: { v?: unknown }[] }[];
  pageToken?: string;
}

type Param = { name: string; type: "STRING" | "INT64"; value: string | number };

/** Runs a standard-SQL query and returns rows as plain objects (scalar columns only). */
export async function runQuery(
  api: RestClient,
  projectId: string,
  location: string,
  query: string,
  params: Param[],
): Promise<Record<string, unknown>[]> {
  let res = (await api.request("POST", `${BQ}/projects/${projectId}/queries`, {
    query,
    useLegacySql: false,
    location,
    timeoutMs: 20_000,
    parameterMode: "NAMED",
    queryParameters: params.map((p) => ({
      name: p.name,
      parameterType: { type: p.type },
      parameterValue: { value: String(p.value) },
    })),
  })) as BqResponse;

  const jobId = res.jobReference?.jobId;
  const jobLocation = res.jobReference?.location ?? location;
  const resultsUrl = (pageToken?: string) =>
    `${BQ}/projects/${projectId}/queries/${encodeURIComponent(jobId ?? "")}?location=${encodeURIComponent(jobLocation)}` +
    `&timeoutMs=20000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;

  for (let attempt = 0; !res.jobComplete; attempt++) {
    if (!jobId || attempt >= 3) throw new GoogleApiError(0, "BigQuery query did not finish in time");
    res = (await api.request("GET", resultsUrl())) as BqResponse;
  }

  const fields = (res.schema?.fields ?? []).map((f) => f.name);
  const out: Record<string, unknown>[] = [];
  for (let page = 0; ; page++) {
    for (const row of res.rows ?? []) {
      const obj: Record<string, unknown> = {};
      (row.f ?? []).forEach((cell, i) => (obj[fields[i] ?? `_${i}`] = cell?.v ?? null));
      out.push(obj);
    }
    if (!res.pageToken || !jobId || page >= 20) break;
    res = (await api.request("GET", resultsUrl(res.pageToken))) as BqResponse;
  }
  return out;
}

const CREDITS = "IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)";

export function billingQueries(table: string): { services: string; skus: string; daily: string; totals: string } {
  const where = "WHERE project.id = @project AND invoice.month = @month";
  return {
    services: `SELECT service.description AS service, SUM(cost) AS cost, SUM(${CREDITS}) AS credits
FROM ${table} ${where} GROUP BY service ORDER BY cost DESC`,
    skus: `SELECT service.description AS service, sku.description AS sku, SUM(cost) AS cost, SUM(${CREDITS}) AS credits,
  SUM(IFNULL(usage.amount_in_pricing_units, 0)) AS usage, ANY_VALUE(usage.pricing_unit) AS unit
FROM ${table} ${where} GROUP BY service, sku ORDER BY cost DESC LIMIT @limit`,
    daily: `SELECT FORMAT_DATE('%F', DATE(usage_start_time, @tz)) AS date, SUM(cost) AS cost, SUM(${CREDITS}) AS credits
FROM ${table} ${where} GROUP BY date ORDER BY date`,
    totals: `SELECT invoice.month AS invoice_month, ANY_VALUE(currency) AS currency, SUM(cost) AS cost, SUM(${CREDITS}) AS credits,
  FORMAT_TIMESTAMP('%FT%TZ', MAX(export_time)) AS export_time
FROM ${table} WHERE project.id = @project AND invoice.month IN (@month, @previous) GROUP BY invoice_month`,
  };
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export interface BillingReadOptions {
  projectId: string;
  dataset: string;
  location: string;
  topSkus: number;
  timeZone: string;
}

/**
 * Billing rows for the month and the month before, or null when the export
 * dataset or table does not exist yet. Other failures throw.
 */
export async function readBillingRows(api: RestClient, window: MonthWindow, o: BillingReadOptions): Promise<BillingRows | null> {
  const table = `\`${o.projectId}.${o.dataset}.gcp_billing_export_v1_*\``;
  const q = billingQueries(table);
  const base: Param[] = [
    { name: "project", type: "STRING", value: o.projectId },
    { name: "month", type: "STRING", value: window.invoiceMonth },
  ];
  const run = (sql: string, extra: Param[] = []) => runQuery(api, o.projectId, o.location, sql, [...base, ...extra]);
  try {
    const [services, skus, daily, totals] = await Promise.all([
      run(q.services),
      run(q.skus, [{ name: "limit", type: "INT64", value: o.topSkus }]),
      run(q.daily, [{ name: "tz", type: "STRING", value: o.timeZone }]),
      run(q.totals, [{ name: "previous", type: "STRING", value: window.previousInvoiceMonth }]),
    ]);
    return {
      services: services.map((r) => ({ service: str(r.service), cost: n(r.cost), credits: n(r.credits) })),
      skus: skus.map((r) => ({
        service: str(r.service),
        sku: str(r.sku),
        cost: n(r.cost),
        credits: n(r.credits),
        usage: n(r.usage),
        unit: str(r.unit),
      })),
      daily: daily.map((r) => ({ date: str(r.date), cost: n(r.cost), credits: n(r.credits) })),
      totals: totals.map((r) => ({
        invoiceMonth: str(r.invoice_month),
        currency: str(r.currency),
        cost: n(r.cost),
        credits: n(r.credits),
        exportTime: r.export_time ? str(r.export_time) : null,
      })),
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cloud Monitoring

const MONITORING = "https://monitoring.googleapis.com/v3";

interface TimeSeries {
  metric?: { labels?: Record<string, string> };
  resource?: { labels?: Record<string, string> };
  points?: { value?: { int64Value?: string; doubleValue?: number } }[];
}

export interface SeriesSum {
  labels: Record<string, string>;
  value: number;
}

/**
 * Sums a metric over [start, end) with one alignment period covering the whole
 * window, grouped by the given label fields ("resource.label.x" / "metric.label.y").
 */
export async function sumTimeSeries(
  api: RestClient,
  projectId: string,
  metricType: string,
  start: Date,
  end: Date,
  groupBy: string[],
): Promise<SeriesSum[]> {
  const seconds = Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000));
  const out: SeriesSum[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const u = new URL(`${MONITORING}/projects/${projectId}/timeSeries`);
    u.searchParams.set("filter", `metric.type="${metricType}"`);
    u.searchParams.set("interval.startTime", start.toISOString());
    u.searchParams.set("interval.endTime", end.toISOString());
    u.searchParams.set("aggregation.alignmentPeriod", `${seconds}s`);
    u.searchParams.set("aggregation.perSeriesAligner", "ALIGN_SUM");
    u.searchParams.set("aggregation.crossSeriesReducer", "REDUCE_SUM");
    for (const g of groupBy) u.searchParams.append("aggregation.groupByFields", g);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = (await api.request("GET", u.toString())) as { timeSeries?: TimeSeries[]; nextPageToken?: string };
    for (const ts of res.timeSeries ?? []) {
      const value = (ts.points ?? []).reduce((s, p) => s + n(p.value?.int64Value ?? p.value?.doubleValue ?? 0), 0);
      out.push({ labels: { ...(ts.resource?.labels ?? {}), ...(ts.metric?.labels ?? {}) }, value });
    }
    pageToken = res.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

export const USAGE_METRICS = {
  tokens: "aiplatform.googleapis.com/publisher/online_serving/token_count",
  requests: "run.googleapis.com/request_count",
  reads: "firestore.googleapis.com/document/read_ops_count",
  writes: "firestore.googleapis.com/document/write_ops_count",
  deletes: "firestore.googleapis.com/document/delete_ops_count",
} as const;

/** Usage for [start, end) from Cloud Monitoring. */
export async function readUsageSeries(api: RestClient, projectId: string, start: Date, end: Date): Promise<UsageSeries> {
  const sum = (metric: string, groupBy: string[] = []) => sumTimeSeries(api, projectId, metric, start, end, groupBy);
  const total = (rows: SeriesSum[]) => rows.reduce((s, r) => s + r.value, 0);
  const [tokens, requests, reads, writes, deletes] = await Promise.all([
    sum(USAGE_METRICS.tokens, ["resource.label.model_user_id", "metric.label.type"]),
    sum(USAGE_METRICS.requests, ["resource.label.service_name"]),
    sum(USAGE_METRICS.reads),
    sum(USAGE_METRICS.writes),
    sum(USAGE_METRICS.deletes),
  ]);
  return {
    tokens: tokens.map((r) => ({ model: r.labels.model_user_id ?? "unknown", type: r.labels.type ?? "", count: r.value })),
    requests: requests.map((r) => ({ service: r.labels.service_name ?? "unknown", count: r.value })),
    firestore: { reads: total(reads), writes: total(writes), deletes: total(deletes) },
  };
}
