import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import type { CheckResult } from "../types.js";

export async function checkBusinessInfo(
  http: FlowAccountHttpClient,
  culture: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // /users/me
  const t0 = Date.now();
  try {
    const res = await http.get<Record<string, unknown>>(endpoints.businessInfo.me());
    const ok = res && typeof res === "object" && Object.keys(res).length > 0;
    results.push({
      name: "business_info.me",
      group: "Business Info",
      passed: ok,
      severity: ok ? "INFO" : "CRITICAL",
      message: ok ? "/users/me OK" : "/users/me returned empty or invalid response",
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    results.push({
      name: "business_info.me",
      group: "Business Info",
      passed: false,
      severity: "CRITICAL",
      message: `/users/me failed: ${(err as Error).message}`,
      durationMs: Date.now() - t0,
    });
  }

  // /banks
  const t1 = Date.now();
  try {
    const res = await http.get<Record<string, unknown>>(endpoints.businessInfo.bankAccounts(culture));
    const ok = res && typeof res === "object";
    results.push({
      name: "business_info.bank_accounts",
      group: "Business Info",
      passed: ok,
      severity: ok ? "INFO" : "CRITICAL",
      message: ok ? "Bank accounts OK" : "Bank accounts returned invalid response",
      durationMs: Date.now() - t1,
    });
  } catch (err) {
    results.push({
      name: "business_info.bank_accounts",
      group: "Business Info",
      passed: false,
      severity: "CRITICAL",
      message: `Bank accounts failed: ${(err as Error).message}`,
      durationMs: Date.now() - t1,
    });
  }

  return results;
}
