import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@arpanstacy/stacy-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stacy-company-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allocates a new issue prefix when company names derive to the same base", async () => {
    const svc = companyService(db);

    const first = await svc.create({ name: "Stacy QA Alpha" });
    const second = await svc.create({ name: "Stacy QA Beta" });

    expect(first.issuePrefix).toBe("STA");
    expect(second.issuePrefix).toBe("STAA");
  });
});
