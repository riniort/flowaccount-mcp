import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import { buildDocListParams } from "../../utils/list-formatter.js";
import type { CheckResult } from "../types.js";

/**
 * Verify all 3 base URLs are reachable and auth works.
 * - CORE API (api-core-canary) via quotations list (uses buildDocListParams)
 * - BIZ API (business-api) via cash-invoices list
 * - PROFILE API (profile) via /users/me
 */
export async function checkConnectivity(
  http: FlowAccountHttpClient,
  culture: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // CORE API — use quotations (not contacts, which doesn't support documentSerial sort)
  const t0 = Date.now();
  try {
    const params = buildDocListParams({ page: 1, limit: 1 });
    const res = await http.get<Record<string, unknown>>(endpoints.quotations.list(culture), params);
    const hasData = res && typeof res === "object" && "data" in res;
    results.push({
      name: "connectivity.core_api",
      group: "Connectivity",
      passed: hasData,
      severity: "CRITICAL",
      message: hasData ? "CORE API (api-core-canary) reachable" : "CORE API response missing 'data' field",
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    results.push({
      name: "connectivity.core_api",
      group: "Connectivity",
      passed: false,
      severity: "CRITICAL",
      message: `CORE API unreachable: ${(err as Error).message}`,
      durationMs: Date.now() - t0,
    });
  }

  // BIZ API
  const t1 = Date.now();
  try {
    const params = buildDocListParams({ page: 1, limit: 1 });
    const res = await http.get<Record<string, unknown>>(endpoints.cashInvoices.list(culture), params);
    const hasData = res && typeof res === "object" && "data" in res;
    results.push({
      name: "connectivity.biz_api",
      group: "Connectivity",
      passed: hasData,
      severity: "CRITICAL",
      message: hasData ? "BIZ API (business-api) reachable" : "BIZ API response missing 'data' field",
      durationMs: Date.now() - t1,
    });
  } catch (err) {
    results.push({
      name: "connectivity.biz_api",
      group: "Connectivity",
      passed: false,
      severity: "CRITICAL",
      message: `BIZ API unreachable: ${(err as Error).message}`,
      durationMs: Date.now() - t1,
    });
  }

  // PROFILE API
  const t2 = Date.now();
  try {
    const res = await http.get<Record<string, unknown>>(endpoints.businessInfo.me());
    const ok = res && typeof res === "object";
    results.push({
      name: "connectivity.profile_api",
      group: "Connectivity",
      passed: ok,
      severity: "CRITICAL",
      message: ok ? "PROFILE API (profile) reachable" : "PROFILE API returned invalid response",
      durationMs: Date.now() - t2,
    });
  } catch (err) {
    results.push({
      name: "connectivity.profile_api",
      group: "Connectivity",
      passed: false,
      severity: "CRITICAL",
      message: `PROFILE API unreachable: ${(err as Error).message}`,
      durationMs: Date.now() - t2,
    });
  }

  return results;
}
