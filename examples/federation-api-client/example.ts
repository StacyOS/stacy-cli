import createClient from "openapi-fetch";

import type { paths } from "./src/generated/federation.js";

const koId = process.argv[2];
if (!koId) {
  console.error("Usage: pnpm exec tsx example.ts <ko_id> [base_url] [consumer_install_id]");
  process.exit(1);
}

const baseUrl = process.argv[3] ?? process.env.STACY_FEDERATION_API_BASE_URL ?? "http://127.0.0.1:3000";
const asConsumer = process.argv[4] ?? process.env.STACY_FEDERATION_AS_CONSUMER;

const client = createClient<paths>({ baseUrl });

const { data, error, response } = await client.GET("/api/federation/v1/ko/{id}", {
  params: {
    path: { id: koId },
    query: asConsumer ? { asConsumer } : undefined,
  },
});

if (error) {
  console.error(`Federation API error (${response.status}):`);
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

if (!data) {
  console.error(`Federation API returned ${response.status} without a JSON body.`);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
