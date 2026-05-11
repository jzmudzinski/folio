#!/usr/bin/env bun
import { startStdioServer } from "../src/mcp/server";

startStdioServer().catch((e) => {
  console.error("folio-mcp fatal:", e);
  process.exit(1);
});
