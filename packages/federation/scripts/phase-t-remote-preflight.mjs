import { request } from "node:https";
import { URL } from "node:url";

const required = [
  "STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL",
  "STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error("Stacy federation remote preflight skipped.");
  console.error("Set these environment variables to check a real two-machine demo:");
  for (const name of missing) {
    console.error(`- ${name}`);
  }
  console.error("");
  console.error("Example:");
  console.error("STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL=https://producer.example.com \\");
  console.error("STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL=https://consumer.example.com \\");
  console.error("pnpm --filter @arpanstacy/stacy-federation demo:remote:preflight");
  process.exit(0);
}

const producerBase = normalizeHttpsBaseUrl(
  process.env.STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL,
  "producer base",
);
const consumerBase = normalizeHttpsBaseUrl(
  process.env.STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL,
  "consumer base",
);
const urls = {
  producerHealth: new URL("/api/health", producerBase),
  producerRevocations: new URL("/api/federation/revocations", producerBase),
  consumerHealth: new URL("/api/health", consumerBase),
  consumerFederation: new URL("/api/federation", consumerBase),
  consumerRevocations: new URL("/api/federation/revocations", consumerBase),
};

await Promise.all([
  assertHealth(urls.producerHealth, "producer"),
  assertHealth(urls.consumerHealth, "consumer"),
]);

console.log("Stacy federation remote preflight passed.");
console.log(`producer health: ${urls.producerHealth.href}`);
console.log(`producer revocations: ${urls.producerRevocations.href}`);
console.log(`consumer health: ${urls.consumerHealth.href}`);
console.log(`consumer federation: ${urls.consumerFederation.href}`);
console.log(`consumer revocations: ${urls.consumerRevocations.href}`);

function normalizeHttpsBaseUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${label} URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} URL must use https:// for a real cross-machine demo: ${raw}`);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assertHealth(url, label) {
  return new Promise((resolveHealth, rejectHealth) => {
    const allowSelfSigned = process.env.STACY_FEDERATION_REMOTE_ALLOW_SELF_SIGNED === "1";
    const req = request(url, {
      method: "GET",
      timeout: 10_000,
      rejectUnauthorized: !allowSelfSigned,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          rejectHealth(new Error(`${label} health returned HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          if (parsed.status !== "ok") {
            rejectHealth(new Error(`${label} health status is not ok: ${body}`));
            return;
          }
        } catch {
          rejectHealth(new Error(`${label} health did not return JSON: ${body}`));
          return;
        }
        resolveHealth();
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`${label} health timed out after 10000ms`));
    });
    req.on("error", rejectHealth);
    req.end();
  });
}
