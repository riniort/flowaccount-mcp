/**
 * FlowAccount API Health Check
 *
 * Standalone script that verifies all critical API endpoints,
 * response schemas, and status code mappings still work correctly.
 *
 * Usage: npm run health-check
 * Exit codes: 0=HEALTHY, 1=BROKEN (critical), 2=DEGRADED (warnings)
 */

import { loadConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { TokenManager } from "../auth/token-manager.js";
import { FlowAccountHttpClient } from "../api/http-client.js";

import { checkConnectivity } from "./checks/connectivity.js";
import { checkDocuments, collectedDocStatuses } from "./checks/documents.js";
import { checkExpenses, collectedExpenseStatuses } from "./checks/expenses.js";
import { checkContacts } from "./checks/contacts.js";
import { checkProducts } from "./checks/products.js";
import { checkBusinessInfo } from "./checks/business-info.js";
import { checkStatusCodes } from "./checks/status-codes.js";
import { buildReport, printReport, exitCode } from "./reporter.js";
import type { CheckResult } from "./types.js";

async function main() {
  logger.info("FlowAccount API Health Check starting...");

  const config = loadConfig();
  // Force headless for health check (no interactive browser needed)
  config.headless = true;
  const tokenManager = new TokenManager(config);

  try {
    await tokenManager.initialize();
  } catch (err) {
    logger.error(`Authentication failed: ${(err as Error).message}`);
    const report = buildReport([{
      name: "auth.initialize",
      group: "Authentication",
      passed: false,
      severity: "CRITICAL",
      message: `Authentication failed: ${(err as Error).message}`,
      durationMs: 0,
    }]);
    printReport(report);
    process.exit(1);
  }

  const http = new FlowAccountHttpClient(tokenManager);
  const culture = tokenManager.getCulture();
  const results: CheckResult[] = [];

  // 1. Connectivity (must pass before continuing)
  const connResults = await checkConnectivity(http, culture);
  results.push(...connResults);

  const hasCriticalConnFail = connResults.some((r) => !r.passed && r.severity === "CRITICAL");
  if (hasCriticalConnFail) {
    logger.error("Connectivity check failed — skipping remaining checks");
    const report = buildReport(results);
    printReport(report);
    process.exit(exitCode(report));
  }

  // 2. Run remaining checks in parallel
  const [docResults, expResults, contactResults, productResults, bizResults] =
    await Promise.all([
      checkDocuments(http, culture),
      checkExpenses(http, culture),
      checkContacts(http, culture),
      checkProducts(http, culture),
      checkBusinessInfo(http, culture),
    ]);

  results.push(...docResults, ...expResults, ...contactResults, ...productResults, ...bizResults);

  // 3. Status code validation (uses data collected from doc/expense checks)
  results.push(...checkStatusCodes(collectedDocStatuses, collectedExpenseStatuses));

  // Report
  const report = buildReport(results);
  printReport(report);
  process.exit(exitCode(report));
}

main().catch((err) => {
  logger.error(`Health check crashed: ${(err as Error).message}`);
  process.exit(1);
});
