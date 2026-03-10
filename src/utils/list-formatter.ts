/**
 * Shared formatter for FlowAccount list API responses.
 * Extracts pagination info and returns a compact summary.
 */

interface ListApiResponse {
  data?: {
    total?: number;
    currentPage?: number;
    list?: Record<string, unknown>[];
  };
  status?: boolean;
  message?: string;
}

interface FormatOptions {
  /** Fields to pick from each item for display */
  fields: string[];
  /** Current page number (1-based) */
  page: number;
  /** Items per page */
  limit: number;
  /** Optional status map override (defaults to DOCUMENT_STATUS) */
  statusMap?: Record<number, string>;
}

/**
 * Status codes from FlowAccount open-api official definitions.
 * @see https://github.com/flowaccount/open-api — ReceivableInvoiceStatus
 * Covers: quotations, tax-invoices, receipts, billing-notes, cash-invoices, purchase-orders
 */
export const DOCUMENT_STATUS: Record<number, string> = {
  1: "awaiting",
  3: "approved",
  5: "approved_and_processed",
  7: "void",
  9: "deleted",
};

/**
 * Expense-specific status codes.
 * @see https://github.com/flowaccount/open-api — ExpenseStatus
 */
export const EXPENSE_STATUS: Record<number, string> = {
  1: "awaiting",
  3: "approved",
  4: "pending_payment",
  5: "paid",
  6: "paid_by_slip",
  7: "void",
  9: "approved_and_processed",
  11: "received",
  23: "received_by_slip",
};

function formatDate(d: unknown): string {
  if (!d || typeof d !== "string") return "";
  return d.replace("T00:00:00", "").substring(0, 10);
}

function statusLabel(s: unknown, map: Record<number, string> = DOCUMENT_STATUS): string {
  if (typeof s === "number") return map[s] ?? `unknown(${s})`;
  if (typeof s === "string") return s;
  return "";
}

export function formatListResponse(raw: unknown, opts: FormatOptions): string {
  const res = raw as ListApiResponse;
  const total = res?.data?.total ?? 0;
  const list = res?.data?.list ?? [];
  const page = opts.page;
  const totalPages = Math.ceil(total / opts.limit) || 1;

  const header = `แสดง ${list.length} จาก ${total} รายการ (หน้า ${page}/${totalPages})`;

  if (list.length === 0) {
    return `${header}\n\nไม่พบรายการ`;
  }

  const sMap = opts.statusMap ?? DOCUMENT_STATUS;
  const rows = list.map((item) => {
    const row: Record<string, unknown> = {};
    for (const f of opts.fields) {
      let val = item[f];
      if (f === "publishedOn" || f === "dueDate") val = formatDate(val);
      if (f === "status") val = statusLabel(val, sMap);
      if (val !== undefined && val !== null && val !== "") row[f] = val;
    }
    return row;
  });

  return `${header}\n\n${JSON.stringify(rows, null, 2)}`;
}

/** Standard document list fields */
export const DOC_FIELDS = [
  "recordId",
  "documentSerial",
  "contactName",
  "publishedOn",
  "dueDate",
  "subTotal",
  "total",
  "totalAfterDiscount",
  "status",
];

/** Contact list fields */
export const CONTACT_FIELDS = [
  "contactId",
  "contactCode",
  "contactName",
  "contactTaxId",
  "contactEmail",
  "contactPhoneNumber",
  "contactGroup",
  "contactType",
];

/** Product list fields */
export const PRODUCT_FIELDS = [
  "productId",
  "productCode",
  "name",
  "sellPrice",
  "buyPrice",
  "unitName",
  "type",
];

/**
 * Build query params for document list API calls.
 * Matches the actual FlowAccount web app behavior:
 *   - Uses currentPage/pageSize (not offset/limit)
 *   - range=0 → show all, range=5 → custom date range with startDate/endDate
 *   - Default sort by documentSerial descending
 */
export function buildDocListParams(opts: {
  page: number;
  limit: number;
  startDate?: string;
  endDate?: string;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    currentPage: opts.page,
    pageSize: opts.limit,
    sortBy: JSON.stringify([{ name: "documentSerial", sortOrder: "desc" }]),
    filter: "[]",
    filterColumnValue: "{}",
    filterStatus: 0,
    searchString: "",
    totalRecords: 0,
  };

  if ((opts.startDate && !opts.endDate) || (!opts.startDate && opts.endDate)) {
    throw new Error("Both startDate and endDate must be provided together for date filtering");
  }

  if (opts.startDate && opts.endDate) {
    params.range = 5;
    params.startDate = opts.startDate;
    params.endDate = opts.endDate;
    // Extract year/month from startDate (yyyy-MM-dd)
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})/.exec(opts.startDate);
    if (dateParts) {
      params.year = parseInt(dateParts[1], 10);
      params.month = parseInt(dateParts[2], 10);
    } else {
      params.year = 0;
      params.month = 0;
    }
  } else {
    params.range = 0;
    params.year = 0;
    params.month = 0;
  }

  return params;
}
