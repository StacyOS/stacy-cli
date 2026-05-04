#!/usr/bin/env node
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Stacy MCP server:", error);
  process.exit(1);
});
