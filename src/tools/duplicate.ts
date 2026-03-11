import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";

// --- Types ---

type Ep = { base: string; path: string };

interface DocTypeConfig {
  get: (c: string, id: number) => Ep;
  create: (c: string) => Ep;
  /** Contact-related fields to copy */
  contactFields: string[];
  /** Extra document-specific fields to copy */
  extraFields: string[];
  /** Whether this document type has dueDate */
  hasDueDate: boolean;
}

// --- Per-type configuration ---

const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = {
  quotations: {
    get: endpoints.quotations.get,
    create: endpoints.quotations.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress", "contactEmail"],
    extraFields: ["creditDays", "salesName", "projectName", "discountPercentage"],
    hasDueDate: true,
  },
  "tax-invoices": {
    get: endpoints.taxInvoices.get,
    create: endpoints.taxInvoices.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress", "contactBranch"],
    extraFields: ["creditDays"],
    hasDueDate: true,
  },
  receipts: {
    get: endpoints.receipts.get,
    create: endpoints.receipts.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress"],
    extraFields: [],
    hasDueDate: false,
  },
  "billing-notes": {
    get: endpoints.billingNotes.get,
    create: endpoints.billingNotes.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress"],
    extraFields: [],
    hasDueDate: true,
  },
  "cash-invoices": {
    get: endpoints.cashInvoices.get,
    create: endpoints.cashInvoices.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress"],
    extraFields: [],
    hasDueDate: false,
  },
  "purchase-orders": {
    get: endpoints.purchaseOrders.get,
    create: endpoints.purchaseOrders.create,
    contactFields: ["contactName", "contactTaxId", "contactAddress"],
    extraFields: [],
    hasDueDate: true,
  },
};

// --- Helper functions ---

/** Strip T00:00:00 from ISO dates → yyyy-MM-dd */
function stripTime(dateStr: unknown): string | undefined {
  if (!dateStr || typeof dateStr !== "string") return undefined;
  return dateStr.replace("T00:00:00", "").substring(0, 10);
}

/** Get today's date as yyyy-MM-dd */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Extract sales document item fields from productItems.
 * API GET returns: discountPerItem, vatRate — but create expects: discount, vatType */
function extractSalesItem(pi: Record<string, unknown>) {
  const item: Record<string, unknown> = {};

  // Direct copy fields
  for (const f of ["name", "description", "quantity", "unitName", "pricePerUnit"]) {
    if (pi[f] !== undefined && pi[f] !== null && pi[f] !== "") {
      item[f] = pi[f];
    }
  }

  // discountPerItem → discount (API response uses discountPerItem, create expects discount)
  const disc = pi.discountPerItem as number | undefined;
  if (disc !== undefined && disc !== null && disc !== 0) {
    item.discount = disc;
  }

  // vatRate → vatType (API response uses vatRate: 7/0, create expects vatType: 1/2/3)
  const vatRate = pi.vatRate as number | undefined;
  if (vatRate === 7) {
    item.vatType = 1; // Vat
  } else if (vatRate === 0 || vatRate === undefined) {
    item.vatType = 3; // NoVat
  }

  return item;
}

/** Extract expense item fields from productItems, mapping field names */
function extractExpenseItem(pi: Record<string, unknown>) {
  // Map vatRate back to vatType: vatRate=7 → vatType=1 (Vat), vatRate=0 → vatType=3 (NoVat)
  const vatRate = pi.vatRate as number | undefined;
  const vatType = vatRate === 7 ? 1 : vatRate === 0 ? 3 : (pi.vatType as number | undefined) ?? 1;

  return {
    // expenseDescription → description (what create_expense expects)
    expenseDescription: pi.expenseDescription,
    quantity: pi.quantity,
    pricePerUnit: String(pi.pricePerUnit),
    total: ((pi.pricePerUnit as number) - ((pi.discountPerItem as number) || 0)) * (pi.quantity as number),
    discountPerItem: pi.discountPerItem || 0,
    vatRate: vatType === 1 ? 7 : 0,
    withHeldPerItem: 0,
    // Chart-of-accounts fields (pass through from source)
    expenseCategoryId: pi.expenseCategoryId,
    expenseSystemCode: pi.expenseSystemCode,
    expenseDebitId: pi.expenseDebitId,
    expenseDebitCode: pi.expenseDebitCode,
    expenseCreditId: pi.expenseCreditId,
    expenseCreditCode: pi.expenseCreditCode,
    expenseDebitCategory: pi.expenseDebitCategory ?? 5,
    expenseCreditCategory: pi.expenseCreditCategory ?? 2,
  };
}

/** Copy non-empty field from source to target */
function copyField(source: Record<string, unknown>, target: Record<string, unknown>, field: string) {
  const val = source[field];
  if (val !== undefined && val !== null && val !== "") {
    target[field] = val;
  }
}

// --- Main registration ---

export function registerDuplicateTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  const docTypes = [
    "quotations", "tax-invoices", "receipts",
    "billing-notes", "cash-invoices", "purchase-orders", "expenses",
  ] as const;

  server.tool(
    "duplicate_document",
    "Duplicate (สร้างซ้ำ) an existing document. Creates a new document with the same data but a new date. Supports all document types: quotations, tax-invoices, receipts, billing-notes, cash-invoices, purchase-orders, expenses.",
    {
      documentType: z.enum(docTypes).describe(
        "Document type to duplicate"
      ),
      id: z.number().describe("Source document record ID to duplicate from"),
      publishedOn: z.string().optional().describe("New document date (yyyy-MM-dd). Defaults to today."),
    },
    async ({ documentType, id, publishedOn }) => {
      const culture = c();
      const newDate = publishedOn || todayStr();

      // --- EXPENSE: special handling ---
      if (documentType === "expenses") {
        return await duplicateExpense(http, culture, id, newDate);
      }

      // --- SALES / PURCHASE DOCUMENTS ---
      const config = DOC_TYPE_CONFIG[documentType];
      if (!config) {
        return { content: [{ type: "text" as const, text: `Unknown document type: ${documentType}` }] };
      }

      // 1. Fetch source document
      const source = await http.get<{
        data?: { list?: Record<string, unknown>[] };
      }>(config.get(culture, id));
      const doc = source?.data?.list?.[0];
      if (!doc) {
        return { content: [{ type: "text" as const, text: `Document not found: ${documentType} #${id}` }] };
      }

      // 2. Build create body
      const body: Record<string, unknown> = {};

      // Contact fields
      for (const f of config.contactFields) {
        copyField(doc, body, f);
      }

      // Date
      body.publishedOn = newDate;
      if (config.hasDueDate) {
        const sourceDue = stripTime(doc.dueDate);
        if (sourceDue) body.dueDate = sourceDue;
      }

      // Items (productItems → rename stays as productItems for direct POST)
      const sourceItems = doc.productItems as Record<string, unknown>[] | undefined;
      if (sourceItems && sourceItems.length > 0) {
        body.productItems = sourceItems.map(extractSalesItem);
      }

      // Common optional fields
      if (doc.isVatInclusive !== undefined) body.isVatInclusive = doc.isVatInclusive;
      copyField(doc, body, "remarks");
      copyField(doc, body, "internalNotes");

      // Extra type-specific fields
      for (const f of config.extraFields) {
        copyField(doc, body, f);
      }

      // 3. Create new document
      const result = await http.post(config.create(culture), body);
      // Create API returns data directly (not wrapped in data.list[])
      const created = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const newSerial = created?.documentSerial || "(new)";
      const newId = created?.recordId || "";

      return {
        content: [{
          type: "text" as const,
          text: `✓ Duplicated ${documentType} #${id} → ${newSerial} (recordId: ${newId})\nDate: ${newDate}\n\n${JSON.stringify(result, null, 2)}`,
        }],
      };
    }
  );
}

// --- Expense duplicate (separate due to different item structure) ---

async function duplicateExpense(
  http: FlowAccountHttpClient,
  culture: string,
  sourceId: number,
  newDate: string,
) {
  // 1. Fetch source expense
  const source = await http.get<{
    data?: { list?: Record<string, unknown>[] };
  }>(endpoints.expenses.get(culture, sourceId));
  const doc = source?.data?.list?.[0];
  if (!doc) {
    return { content: [{ type: "text" as const, text: `Expense not found: #${sourceId}` }] };
  }

  // 2. Build expense create body
  const pubDate = newDate.includes("T") ? newDate : `${newDate}T00:00:00`;
  const sourceDue = stripTime(doc.dueDate);
  const dueDate = sourceDue ? `${sourceDue}T00:00:00` : pubDate;

  const sourceItems = doc.productItems as Record<string, unknown>[] | undefined;
  const productItems = (sourceItems || []).map((item, i) => ({
    no: i,
    ...extractExpenseItem(item),
  }));

  const body: Record<string, unknown> = {
    documentType: 13,
    publishedOn: pubDate,
    dueDate,
    vatRate: 0,
    status: 1,
    productItems,
  };

  // Contact fields
  copyField(doc, body, "contactName");
  copyField(doc, body, "contactTaxId");
  copyField(doc, body, "contactAddress");

  // Optional fields
  if (doc.isVatInclusive !== undefined) body.isVatInclusive = doc.isVatInclusive;
  copyField(doc, body, "remarks");
  copyField(doc, body, "internalNotes");

  // 3. Create new expense
  const result = await http.post(endpoints.expenses.create(culture), body);
  // Create API returns data directly (not wrapped in data.list[])
  const created = (result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const newSerial = created?.documentSerial || "(new)";
  const newId = created?.recordId || "";

  return {
    content: [{
      type: "text" as const,
      text: `✓ Duplicated expense #${sourceId} → ${newSerial} (recordId: ${newId})\nDate: ${newDate}\n\n${JSON.stringify(result, null, 2)}`,
    }],
  };
}
