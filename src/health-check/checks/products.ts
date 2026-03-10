import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import { ENVELOPE_DATA_REQUIRED, PRODUCT_CRITICAL } from "../schemas.js";
import type { CheckResult } from "../types.js";

export async function checkProducts(
  http: FlowAccountHttpClient,
  culture: string,
): Promise<CheckResult[]> {
  const t0 = Date.now();
  try {
    // Products use simple params (not buildDocListParams — no documentSerial sort)
    const res = await http.get<Record<string, unknown>>(endpoints.products.list(culture), { currentPage: 1, pageSize: 1 });
    const data = res?.data as Record<string, unknown> | undefined;

    const envMissing: string[] = [];
    if (!data) envMissing.push("data");
    else {
      for (const f of ENVELOPE_DATA_REQUIRED) {
        if (!(f in data)) envMissing.push(`data.${f}`);
      }
    }

    if (envMissing.length > 0) {
      return [{
        name: "products.list",
        group: "Products",
        passed: false,
        severity: "CRITICAL",
        message: "Product list envelope changed",
        details: { missingFields: envMissing },
        durationMs: Date.now() - t0,
      }];
    }

    const list = (data!.list ?? []) as Record<string, unknown>[];
    if (list.length === 0) {
      return [{
        name: "products.list",
        group: "Products",
        passed: true,
        severity: "INFO",
        message: "Product list OK (no items to validate fields)",
        durationMs: Date.now() - t0,
      }];
    }

    const missing = PRODUCT_CRITICAL.filter((f) => !(f in list[0]));
    return [{
      name: "products.list",
      group: "Products",
      passed: missing.length === 0,
      severity: missing.length > 0 ? "CRITICAL" : "INFO",
      message: missing.length === 0 ? "Product list OK" : "Product list missing critical fields",
      details: missing.length > 0 ? { missingFields: missing } : undefined,
      durationMs: Date.now() - t0,
    }];
  } catch (err) {
    return [{
      name: "products.list",
      group: "Products",
      passed: false,
      severity: "CRITICAL",
      message: `Product list failed: ${(err as Error).message}`,
      durationMs: Date.now() - t0,
    }];
  }
}
