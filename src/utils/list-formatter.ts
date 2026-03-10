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
  /** Current offset used in the query */
  offset: number;
  /** Current limit used in the query */
  limit: number;
}

const STATUS_MAP: Record<number, string> = {
  0: "draft",
  1: "awaiting",
  2: "approved",
  3: "rejected",
  4: "voided",
  5: "partial",
  6: "paid",
  7: "expired",
  8: "deposited",
};

function formatDate(d: unknown): string {
  if (!d || typeof d !== "string") return "";
  return d.replace("T00:00:00", "").substring(0, 10);
}

function statusLabel(s: unknown): string {
  if (typeof s === "number") return STATUS_MAP[s] ?? String(s);
  if (typeof s === "string") return s;
  return "";
}

export function formatListResponse(raw: unknown, opts: FormatOptions): string {
  const res = raw as ListApiResponse;
  const total = res?.data?.total ?? 0;
  const list = res?.data?.list ?? [];
  const page = Math.floor(opts.offset / opts.limit) + 1;
  const totalPages = Math.ceil(total / opts.limit);

  const header = `แสดง ${list.length} จาก ${total} รายการ (หน้า ${page}/${totalPages || 1})`;

  if (list.length === 0) {
    return `${header}\n\nไม่พบรายการ`;
  }

  const rows = list.map((item) => {
    const row: Record<string, unknown> = {};
    for (const f of opts.fields) {
      let val = item[f];
      if (f === "publishedOn" || f === "dueDate") val = formatDate(val);
      if (f === "status") val = statusLabel(val);
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
