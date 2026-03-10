import type { FlowAccountHttpClient, Endpoint } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import { buildDocListParams } from "../../utils/list-formatter.js";
import { ENVELOPE_DATA_REQUIRED, DOC_LIST_CRITICAL, DOC_DETAIL_CRITICAL, DOC_DETAIL_OPTIONAL, PRODUCT_ITEM_CRITICAL } from "../schemas.js";
import type { CheckResult } from "../types.js";

interface DocType {
  name: string;
  list: (c: string) => Endpoint;
  get: (c: string, id: number) => Endpoint;
}

/** Check 3 representative document types covering CORE + BIZ APIs */
const DOC_TYPES: DocType[] = [
  { name: "quotations", list: endpoints.quotations.list, get: endpoints.quotations.get },
  { name: "tax_invoices", list: endpoints.taxInvoices.list, get: endpoints.taxInvoices.get },
  { name: "cash_invoices", list: endpoints.cashInvoices.list, get: endpoints.cashInvoices.get },
];

/** Collected status codes for later validation */
export const collectedDocStatuses: { docType: string; code: number }[] = [];

function checkFields(obj: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((f) => !(f in obj));
}

export async function checkDocuments(
  http: FlowAccountHttpClient,
  culture: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const dt of DOC_TYPES) {
    // --- List check ---
    const t0 = Date.now();
    try {
      const params = buildDocListParams({ page: 1, limit: 5 });
      const res = await http.get<Record<string, unknown>>(dt.list(culture), params);
      const data = res?.data as Record<string, unknown> | undefined;

      // Envelope check
      const envMissing: string[] = [];
      if (!data) envMissing.push("data");
      else {
        for (const f of ENVELOPE_DATA_REQUIRED) {
          if (!(f in data)) envMissing.push(`data.${f}`);
        }
        if (data.list && !Array.isArray(data.list)) envMissing.push("data.list (not array)");
      }

      if (envMissing.length > 0) {
        results.push({
          name: `documents.${dt.name}.list`,
          group: "Documents",
          passed: false,
          severity: "CRITICAL",
          message: `Envelope structure changed for ${dt.name}`,
          details: { missingFields: envMissing },
          durationMs: Date.now() - t0,
        });
        continue; // skip detail check
      }

      // Item field check (only if items exist)
      const list = data!.list as Record<string, unknown>[];
      let itemMissing: string[] = [];
      if (list.length > 0) {
        itemMissing = checkFields(list[0], DOC_LIST_CRITICAL);
        // Collect status codes
        for (const item of list) {
          if (typeof item.status === "number") {
            collectedDocStatuses.push({ docType: dt.name, code: item.status });
          }
        }
      }

      results.push({
        name: `documents.${dt.name}.list`,
        group: "Documents",
        passed: itemMissing.length === 0,
        severity: itemMissing.length > 0 ? "CRITICAL" : "INFO",
        message: itemMissing.length === 0
          ? `${dt.name} list OK (${list.length} items)`
          : `${dt.name} list items missing critical fields`,
        details: itemMissing.length > 0 ? { missingFields: itemMissing } : undefined,
        durationMs: Date.now() - t0,
      });

      // --- Detail check (only if we have items) ---
      if (list.length > 0) {
        const t1 = Date.now();
        try {
          const firstId = list[0].recordId as number;
          const detail = await http.get<Record<string, unknown>>(dt.get(culture, firstId));
          const detailData = detail?.data as Record<string, unknown> | undefined;
          const detailList = detailData?.list as Record<string, unknown>[] | undefined;
          const item = detailList?.[0];

          if (!item) {
            results.push({
              name: `documents.${dt.name}.detail`,
              group: "Documents",
              passed: false,
              severity: "CRITICAL",
              message: `${dt.name} detail returned no item`,
              durationMs: Date.now() - t1,
            });
            continue;
          }

          const critMissing = checkFields(item, DOC_DETAIL_CRITICAL);
          const optMissing = checkFields(item, DOC_DETAIL_OPTIONAL);

          // Check productItems internal structure
          let prodItemMissing: string[] = [];
          if (Array.isArray(item.productItems) && (item.productItems as unknown[]).length > 0) {
            const pi = (item.productItems as Record<string, unknown>[])[0];
            prodItemMissing = checkFields(pi, PRODUCT_ITEM_CRITICAL);
          }

          const allCritical = [...critMissing, ...prodItemMissing.map((f) => `productItems[0].${f}`)];
          const severity = allCritical.length > 0 ? "CRITICAL" : optMissing.length > 0 ? "WARNING" : "INFO";

          results.push({
            name: `documents.${dt.name}.detail`,
            group: "Documents",
            passed: allCritical.length === 0,
            severity: allCritical.length > 0 ? "CRITICAL" : optMissing.length > 0 ? "WARNING" : "INFO",
            message: allCritical.length === 0
              ? `${dt.name} detail OK`
              : `${dt.name} detail missing critical fields`,
            details: allCritical.length > 0 ? { missingFields: allCritical } : undefined,
            durationMs: Date.now() - t1,
          });
        } catch (err) {
          results.push({
            name: `documents.${dt.name}.detail`,
            group: "Documents",
            passed: false,
            severity: "CRITICAL",
            message: `${dt.name} detail failed: ${(err as Error).message}`,
            durationMs: Date.now() - t1,
          });
        }
      }
    } catch (err) {
      results.push({
        name: `documents.${dt.name}.list`,
        group: "Documents",
        passed: false,
        severity: "CRITICAL",
        message: `${dt.name} list failed: ${(err as Error).message}`,
        durationMs: Date.now() - t0,
      });
    }
  }

  return results;
}
