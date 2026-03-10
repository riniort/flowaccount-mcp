import { DOCUMENT_STATUS, EXPENSE_STATUS } from "../../utils/list-formatter.js";
import type { CheckResult } from "../types.js";

/**
 * Cross-check all collected status values against known maps.
 * Only flags as WARNING — code still works but shows "unknown(X)".
 */
export function checkStatusCodes(
  docStatuses: { docType: string; code: number }[],
  expenseStatuses: number[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const t0 = Date.now();

  // Document status codes
  const unknownDoc: { docType: string; code: number; count: number }[] = [];
  const docCounts = new Map<string, number>();
  for (const { docType, code } of docStatuses) {
    if (!(code in DOCUMENT_STATUS)) {
      const key = `${docType}:${code}`;
      docCounts.set(key, (docCounts.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of docCounts) {
    const [docType, codeStr] = key.split(":");
    unknownDoc.push({ docType, code: parseInt(codeStr, 10), count });
  }

  // Expense status codes
  const unknownExp: { docType: string; code: number; count: number }[] = [];
  const expCounts = new Map<number, number>();
  for (const code of expenseStatuses) {
    if (!(code in EXPENSE_STATUS)) {
      expCounts.set(code, (expCounts.get(code) || 0) + 1);
    }
  }
  for (const [code, count] of expCounts) {
    unknownExp.push({ docType: "expenses", code, count });
  }

  const allUnknown = [...unknownDoc, ...unknownExp];
  const passed = allUnknown.length === 0;

  results.push({
    name: "status_codes.known_values",
    group: "Status Codes",
    passed,
    severity: passed ? "INFO" : "WARNING",
    message: passed
      ? "All status codes match known maps"
      : `Found ${allUnknown.length} unknown status code(s) — will show as "unknown(X)" to users`,
    details: passed ? undefined : { unknownStatusCodes: allUnknown },
    durationMs: Date.now() - t0,
  });

  return results;
}
