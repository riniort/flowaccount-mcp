import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import { buildDocListParams } from "../../utils/list-formatter.js";
import { ENVELOPE_DATA_REQUIRED, DOC_LIST_CRITICAL, EXPENSE_CATEGORY_CRITICAL } from "../schemas.js";
import type { CheckResult } from "../types.js";

/** Collected expense status codes for later validation */
export const collectedExpenseStatuses: number[] = [];

function checkFields(obj: Record<string, unknown>, required: readonly string[]): string[] {
  return required.filter((f) => !(f in obj));
}

export async function checkExpenses(
  http: FlowAccountHttpClient,
  culture: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // --- List check ---
  const t0 = Date.now();
  try {
    const params = buildDocListParams({ page: 1, limit: 5 });
    const res = await http.get<Record<string, unknown>>(endpoints.expenses.list(culture), params);
    const data = res?.data as Record<string, unknown> | undefined;

    // Envelope
    const envMissing: string[] = [];
    if (!data) envMissing.push("data");
    else {
      for (const f of ENVELOPE_DATA_REQUIRED) {
        if (!(f in data)) envMissing.push(`data.${f}`);
      }
    }

    if (envMissing.length > 0) {
      results.push({
        name: "expenses.list",
        group: "Expenses",
        passed: false,
        severity: "CRITICAL",
        message: "Expense list envelope changed",
        details: { missingFields: envMissing },
        durationMs: Date.now() - t0,
      });
      return results;
    }

    const list = (data!.list ?? []) as Record<string, unknown>[];

    // Item fields
    let itemMissing: string[] = [];
    if (list.length > 0) {
      itemMissing = checkFields(list[0], DOC_LIST_CRITICAL);
      for (const item of list) {
        if (typeof item.status === "number") {
          collectedExpenseStatuses.push(item.status);
        }
      }
    }

    results.push({
      name: "expenses.list",
      group: "Expenses",
      passed: itemMissing.length === 0,
      severity: itemMissing.length > 0 ? "CRITICAL" : "INFO",
      message: itemMissing.length === 0
        ? `Expense list OK (${list.length} items)`
        : "Expense list items missing critical fields",
      details: itemMissing.length > 0 ? { missingFields: itemMissing } : undefined,
      durationMs: Date.now() - t0,
    });

    // --- Detail + category fields check ---
    if (list.length > 0) {
      const t1 = Date.now();
      try {
        const firstId = list[0].recordId as number;
        const detail = await http.get<Record<string, unknown>>(endpoints.expenses.get(culture, firstId));
        const detailData = detail?.data as Record<string, unknown> | undefined;
        const detailList = detailData?.list as Record<string, unknown>[] | undefined;
        const item = detailList?.[0];

        if (!item) {
          results.push({
            name: "expenses.detail",
            group: "Expenses",
            passed: false,
            severity: "CRITICAL",
            message: "Expense detail returned no item",
            durationMs: Date.now() - t1,
          });
          return results;
        }

        // Check productItems exists
        const hasProductItems = Array.isArray(item.productItems);
        if (!hasProductItems) {
          results.push({
            name: "expenses.detail",
            group: "Expenses",
            passed: false,
            severity: "CRITICAL",
            message: "Expense detail missing productItems array",
            details: { missingFields: ["productItems"] },
            durationMs: Date.now() - t1,
          });
          return results;
        }

        results.push({
          name: "expenses.detail",
          group: "Expenses",
          passed: true,
          severity: "INFO",
          message: "Expense detail OK",
          durationMs: Date.now() - t1,
        });

        // Check expense category fields in productItems[0]
        const t2 = Date.now();
        const pi = (item.productItems as Record<string, unknown>[])[0];
        if (pi) {
          const catMissing = checkFields(pi, EXPENSE_CATEGORY_CRITICAL);
          results.push({
            name: "expenses.category_fields",
            group: "Expenses",
            passed: catMissing.length === 0,
            severity: catMissing.length > 0 ? "CRITICAL" : "INFO",
            message: catMissing.length === 0
              ? "Expense category fields OK"
              : "Expense category fields missing — create_expense will break",
            details: catMissing.length > 0 ? { missingFields: catMissing } : undefined,
            durationMs: Date.now() - t2,
          });
        }
      } catch (err) {
        results.push({
          name: "expenses.detail",
          group: "Expenses",
          passed: false,
          severity: "CRITICAL",
          message: `Expense detail failed: ${(err as Error).message}`,
          durationMs: Date.now() - t1,
        });
      }
    }
  } catch (err) {
    results.push({
      name: "expenses.list",
      group: "Expenses",
      passed: false,
      severity: "CRITICAL",
      message: `Expense list failed: ${(err as Error).message}`,
      durationMs: Date.now() - t0,
    });
  }

  return results;
}
