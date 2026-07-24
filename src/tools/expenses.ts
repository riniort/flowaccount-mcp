import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import { formatListResponse, DOC_FIELDS, EXPENSE_STATUS, buildDocListParams } from "../utils/list-formatter.js";
import { uploadDocumentAttachment } from "./attachments.js";

// Expense items require chart-of-accounts category fields (company-specific).
// Use list_expense_categories to discover available categories for your company.
const expenseItemSchema = z.object({
  description: z.string().describe("Item description"),
  quantity: z.number().describe("Quantity"),
  pricePerUnit: z.number().describe("Price per unit"),
  discount: z.number().optional().describe("Discount amount"),
  vatType: z.number().optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
  // Accountant-category mode is mandatory. Business-category IDs are not
  // exposed because accepting them would allow a document to use the wrong UI mode.
  expenseDebitId: z.number().positive().describe("Required debit chart-of-account ID in accountant-category mode"),
  expenseDebitCode: z.string().trim().min(1).describe("Required debit account code in accountant-category mode"),
  expenseCreditId: z.number().positive().describe("Required credit chart-of-account ID in accountant-category mode"),
  expenseCreditCode: z.string().trim().min(1).describe("Required credit account code in accountant-category mode"),
  expenseDebitCategory: z.number().optional().default(5).describe("Debit category type"),
  expenseCreditCategory: z.number().optional().default(2).describe("Credit category type"),
});

const expenseCreateFields = {
  contactName: z.string().describe("Supplier/vendor name"),
  contactTaxId: z.string().optional().describe("Supplier tax ID"),
  contactAddress: z.string().optional().describe("Supplier address"),
  publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
  dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
  items: z.array(expenseItemSchema).min(1).describe("Expense line items"),
  isVatInclusive: z.boolean().optional().default(true).describe("Prices include VAT?"),
  reference: z.string().trim().min(1).describe(
    "Required source document number; stored in FlowAccount field เลขที่อ้างอิง (reference)"
  ),
  remarks: z.string().optional().describe("Remarks/notes shown on document"),
  internalNotes: z.string().optional().describe("Internal notes"),
  receivedTaxInvoiceNumber: z.string().trim().min(1).optional().describe(
    "เลขที่ใบกำกับภาษีที่ได้รับ; used only when calculated VAT is greater than 0 and defaults to reference if omitted"
  ),
  receivedTaxInvoiceDate: z.string().optional().describe(
    "วันที่ใบกำกับภาษีที่ได้รับ (yyyy-MM-dd); defaults to publishedOn"
  ),
  receivedTaxForm: z.number().int().optional().default(1).describe(
    "FlowAccount tax form code for the received supplier invoice (default 1)"
  ),
};

const expenseCreateSchema = z.object(expenseCreateFields);
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
const referencesInFlight = new Set<string>();

type ExpenseRecord = Record<string, unknown> & {
  recordId?: number;
  reference?: string;
  documentSerial?: string;
  status?: number;
  supplierInvoices?: Array<Record<string, unknown>>;
  productItems?: Array<Record<string, unknown>>;
};

export async function findExpenseByExactReference(
  http: FlowAccountHttpClient,
  culture: string,
  reference: string
): Promise<ExpenseRecord | undefined> {
  const wanted = reference.trim();
  const pageSize = 100;
  for (let page = 1; page <= 100; page++) {
    const result = await http.get<{
      data?: { list?: ExpenseRecord[]; total?: number };
    }>(endpoints.expenses.list(culture), {
      ...buildDocListParams({ page, limit: pageSize, filterStatus: 0 }),
      searchString: wanted,
    });
    const list = result?.data?.list ?? [];
    for (const candidate of list) {
      if (String(candidate.reference ?? "").trim() === wanted) return candidate;
      if (candidate.recordId && candidate.reference == null) {
        const detail = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
          endpoints.expenses.get(culture, candidate.recordId)
        );
        const record = detail?.data?.list?.[0];
        if (record && String(record.reference ?? "").trim() === wanted) return record;
      }
    }
    const total = result?.data?.total ?? list.length;
    if (page * pageSize >= total || list.length === 0) break;
  }
  return undefined;
}

function toProductItem(item: z.infer<typeof expenseItemSchema>) {
  const vatRate = item.vatType === 1 ? 7 : 0;
  return {
    expenseDescription: item.description,
    quantity: item.quantity,
    pricePerUnit: String(item.pricePerUnit),
    total: (item.pricePerUnit - (item.discount || 0)) * item.quantity,
    discountPerItem: item.discount || 0,
    vatRate,
    withHeldPerItem: 0,
    // The user's FlowAccount workflow uses the accountant category selector,
    // which is driven directly by the debit/credit chart-of-account fields.
    expenseCategoryId: 0,
    expenseSystemCode: null,
    expenseDebitId: item.expenseDebitId,
    expenseDebitCode: item.expenseDebitCode,
    expenseCreditId: item.expenseCreditId,
    expenseCreditCode: item.expenseCreditCode,
    expenseDebitCategory: item.expenseDebitCategory ?? 5,
    expenseCreditCategory: item.expenseCreditCategory ?? 2,
  };
}

function buildExpenseBody(input: ExpenseCreateInput) {
  const {
    items, publishedOn, dueDate, isVatInclusive, reference,
    receivedTaxInvoiceNumber, receivedTaxInvoiceDate, receivedTaxForm,
    ...rest
  } = input;
  const productItems = items.map((item, i) => ({ no: i, ...toProductItem(item) }));
  const pubDate = publishedOn.includes("T") ? publishedOn : `${publishedOn}T00:00:00`;
  const due = dueDate
    ? (dueDate.includes("T") ? dueDate : `${dueDate}T00:00:00`)
    : pubDate;
  const subTotal = productItems.reduce((sum, item) => sum + item.total, 0);
  const exemptAmount = items.reduce(
    (sum, item, i) => item.vatType === 1 ? sum : sum + productItems[i].total,
    0
  );
  const vatGross = subTotal - exemptAmount;
  const vatableAmount = isVatInclusive ? vatGross / 1.07 : vatGross;
  const vatValue = vatGross - vatableAmount + (isVatInclusive ? 0 : vatableAmount * 0.07);
  const total = exemptAmount + vatableAmount + vatValue;
  const hasVat = vatGross > 0;
  const supplierInvoices = hasVat ? [{
    documentDate: receivedTaxInvoiceDate
      ? (receivedTaxInvoiceDate.includes("T") ? receivedTaxInvoiceDate : `${receivedTaxInvoiceDate}T00:00:00`)
      : pubDate,
    documentSerial: (receivedTaxInvoiceNumber || reference).trim(),
    referenceDocumentType: 13,
    contactBranch: "00000",
    contactName: input.contactName,
    contactTaxId: input.contactTaxId || "",
    total,
    vatValue,
    confirmSave: false,
    taxForm: receivedTaxForm ?? 1,
  }] : [];
  return {
    documentType: 13, ...rest, reference, publishedOn: pubDate, dueDate: due,
    subTotal, totalAfterDiscount: subTotal, exemptAmount, vatableAmount, vatValue,
    totalWithoutVat: subTotal, total, vatRate: hasVat ? 7 : 0, isVat: hasVat,
    isVatInclusive: hasVat ? isVatInclusive : false, isReCalculate: true,
    documentDiscountTypes: 1, discount: 0, withholdingTaxAmount: 0, withHeld: 0,
    expenseCategoryViewType: 1, status: 1, productItems, supplierInvoices,
  };
}

export async function createExpenseGuarded(
  http: FlowAccountHttpClient,
  culture: string,
  input: ExpenseCreateInput
) {
  const reference = input.reference.trim();
  const previewBody = buildExpenseBody({ ...input, reference });
  if (Number(previewBody.vatValue) > 0 && !input.contactTaxId?.trim()) {
    throw new Error(
      "VAT expense requires contactTaxId so FlowAccount can retain received input-tax VAT"
    );
  }
  if (referencesInFlight.has(reference)) {
    throw new Error(`Duplicate expense blocked: reference "${reference}" is already being created`);
  }
  referencesInFlight.add(reference);
  try {
    const duplicate = await findExpenseByExactReference(http, culture, reference);
    if (duplicate) {
      throw new Error(
        `Duplicate expense blocked: reference "${reference}" already exists` +
        ` (recordId=${duplicate.recordId ?? "unknown"}, documentSerial=${duplicate.documentSerial ?? "unknown"})`
      );
    }
    const result = await http.post<{ data?: ExpenseRecord }>(
      endpoints.expenses.create(culture), buildExpenseBody({ ...input, reference })
    );
    const recordId = result?.data?.recordId;
    if (!recordId) throw new Error("Expense creation returned no recordId");
    if (String(result?.data?.reference ?? "").trim() !== reference) {
      let cleanupMessage = " The invalid record was deleted.";
      try {
        await http.delete(endpoints.expenses.delete(culture, recordId));
      } catch (cleanupError) {
        cleanupMessage = ` Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      throw new Error(
        `Expense reference verification failed for record ${recordId}: expected "${reference}", got "${result?.data?.reference ?? ""}".${cleanupMessage}`
      );
    }
    try {
      const expectedBody = buildExpenseBody({ ...input, reference });
      if (Number(expectedBody.vatValue) > 0) {
        const current = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
          endpoints.expenses.get(culture, recordId)
        );
        const saved = current?.data?.list?.[0];
        if (!saved) throw new Error(`Created expense ${recordId} could not be read before tax-invoice update`);
        const expectedNumber = (input.receivedTaxInvoiceNumber || reference).trim();
        const alreadySaved = saved.supplierInvoices?.some(
          (item) => String(item.documentSerial ?? "").trim() === expectedNumber
        );
        if (!alreadySaved) {
          const supplierInvoice = expectedBody.supplierInvoices[0];
          if (!supplierInvoice) throw new Error("Calculated VAT requires received tax-invoice data");
          const attached = await http.post<{
            data?: { total?: number; vatValue?: number; documentSerial?: string };
          }>(
            endpoints.expenses.attachSupplierInvoice(culture, recordId),
            { ...supplierInvoice, referenceDocumentId: recordId }
          );
          if (
            Math.abs(Number(attached?.data?.total) - Number(expectedBody.vatableAmount)) > 0.01 ||
            Math.abs(Number(attached?.data?.vatValue) - Number(expectedBody.vatValue)) > 0.01
          ) {
            throw new Error(
              `Received tax-invoice attachment verification failed for expense ${recordId}: ` +
              `expected taxable amount ${expectedBody.vatableAmount} and VAT ${expectedBody.vatValue}, ` +
              `got ${attached?.data?.total} and ${attached?.data?.vatValue}`
            );
          }
        }
      }
      await getAndVerifyExpense(http, culture, recordId, { ...input, reference });
    } catch (verificationError) {
      let cleanupMessage = " The unverified record was deleted.";
      try {
        await http.delete(endpoints.expenses.delete(culture, recordId));
      } catch (cleanupError) {
        cleanupMessage = ` Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      throw new Error(
        `${verificationError instanceof Error ? verificationError.message : String(verificationError)}.${cleanupMessage}`
      );
    }
    return result;
  } finally {
    referencesInFlight.delete(reference);
  }
}

async function getAndVerifyExpense(
  http: FlowAccountHttpClient,
  culture: string,
  recordId: number,
  input: ExpenseCreateInput
) {
  const result = await http.get<{ data?: { list?: ExpenseRecord[] } }>(
    endpoints.expenses.get(culture, recordId)
  );
  const expense = result?.data?.list?.[0];
  if (!expense) throw new Error(`Created expense ${recordId} could not be read back`);
  if (String(expense.reference ?? "").trim() !== input.reference.trim()) {
    throw new Error(`Created expense ${recordId} has an incorrect reference`);
  }
  if (Number(expense.expenseCategoryViewType) !== 1) {
    throw new Error(`Created expense ${recordId} is not using accountant-category mode`);
  }
  const savedItems = expense.productItems ?? [];
  if (savedItems.length !== input.items.length) {
    throw new Error(`Created expense ${recordId} has an unexpected number of account items`);
  }
  input.items.forEach((expected, index) => {
    const saved = savedItems[index];
    const isAccountantMode =
      Number(saved?.expenseCategoryId) === 0 &&
      saved?.expenseSystemCode == null &&
      Number(saved?.expenseDebitId) === expected.expenseDebitId &&
      String(saved?.expenseDebitCode ?? "").trim() === expected.expenseDebitCode.trim() &&
      Number(saved?.expenseCreditId) === expected.expenseCreditId &&
      String(saved?.expenseCreditCode ?? "").trim() === expected.expenseCreditCode.trim();
    if (!isAccountantMode) {
      throw new Error(
        `Created expense ${recordId} item ${index + 1} failed accountant-category account-code verification`
      );
    }
  });
  const expectedBody = buildExpenseBody(input);
  if (Number(expectedBody.vatValue) > 0) {
    const expectedNumber = (input.receivedTaxInvoiceNumber || input.reference).trim();
    const supplierInvoice = expense.supplierInvoices?.find(
      (item) => String(item.documentSerial ?? "").trim() === expectedNumber
    );
    if (!supplierInvoice) {
      throw new Error(
        `Created expense ${recordId} is missing received tax invoice number "${expectedNumber}"`
      );
    }
  }
  return expense;
}

export function registerExpenseTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  // --- List expense categories from existing expenses ---
  server.tool(
    "list_expense_categories",
    "List available expense categories by extracting unique categories from existing expense documents. Returns category IDs needed for create_expense.",
    {},
    async () => {
      // Fetch a batch of expenses to extract unique categories
      const result = await http.get<{
        data?: {
          list?: Array<{
            productItems?: Array<Record<string, unknown>>;
          }>;
        };
      }>(endpoints.expenses.list(c()), { currentPage: 1, pageSize: 100, range: 0 });

      const categories = new Map<string, Record<string, unknown>>();
      const list = result?.data?.list ?? [];
      for (const expense of list) {
        for (const pi of expense.productItems ?? []) {
          const debitId = Number(pi.expenseDebitId);
          const creditId = Number(pi.expenseCreditId);
          const debitCode = String(pi.expenseDebitCode ?? "").trim();
          const creditCode = String(pi.expenseCreditCode ?? "").trim();
          if (
            debitId > 0 &&
            creditId > 0 &&
            debitCode &&
            creditCode
          ) {
            const key = [
              debitId,
              debitCode,
              creditId,
              creditCode,
              Number(pi.expenseDebitCategory ?? 5),
              Number(pi.expenseCreditCategory ?? 2),
            ].join(":");
            if (categories.has(key)) continue;
            categories.set(key, {
              expenseCategoryId: Number(pi.expenseCategoryId ?? 0),
              nameLocal: pi.expenseCategoryNameLocal,
              nameForeign: pi.expenseCategoryNameForeign,
              expenseSystemCode: pi.expenseSystemCode,
              expenseDebitId: debitId,
              expenseDebitCode: debitCode,
              expenseDebitCategory: pi.expenseDebitCategory,
              expenseDebitNameLocal: pi.expenseDebitNameLocal,
              expenseCreditId: creditId,
              expenseCreditCode: creditCode,
              expenseCreditCategory: pi.expenseCreditCategory,
              expenseCreditNameLocal: pi.expenseCreditNameLocal,
            });
          }
        }
      }

      const cats = Array.from(categories.values());
      if (cats.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No complete accountant-mode debit/credit account pairs were found in the sampled expenses. Create an accountant-mode expense in the FlowAccount UI first, then this tool can discover its account pair.",
          }],
        };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(cats, null, 2) }] };
    }
  );

  // --- List expenses ---
  server.tool(
    "list_expenses",
    "List expense documents with optional date range",
    {
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
      startDate: z.string().optional().describe("Filter start date (yyyy-MM-dd)"),
      endDate: z.string().optional().describe("Filter end date (yyyy-MM-dd)"),
      status: z.number().optional().describe("Filter by status: 0=all, 1=awaiting, 3=approved, 4=pendingPayment, 5=paid, 7=void"),
    },
    async ({ page, limit, startDate, endDate, status }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate, filterStatus: status });
      const result = await http.get(endpoints.expenses.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, page, limit, statusMap: EXPENSE_STATUS }) }] };
    }
  );

  // --- Get single expense ---
  server.tool(
    "get_expense",
    "Get a single expense document by ID",
    { id: z.number().describe("Expense document ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.expenses.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Create expense ---
  server.tool(
    "create_expense",
    "Create an expense after blocking any existing document with the exact same reference. The source document number is required and stored in เลขที่อ้างอิง.",
    expenseCreateFields,
    async (input) => {
      const result = await createExpenseGuarded(http, c(), input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_expense_with_attachment",
    "Atomically create, read-back verify, and attach a local file to an expense. Exact duplicate references are blocked. If verification or upload fails, only the expense created by this call is rolled back.",
    {
      ...expenseCreateFields,
      filePath: z.string().min(1).describe("Absolute path of the PDF or other supported attachment"),
    },
    async ({ filePath, ...input }) => {
      let recordId: number | undefined;
      try {
        const created = await createExpenseGuarded(http, c(), input);
        recordId = created.data?.recordId;
        if (!recordId) throw new Error("Expense creation returned no recordId");
        const verifiedBeforeUpload = await getAndVerifyExpense(http, c(), recordId, input);
        const attachment = await uploadDocumentAttachment(http, c(), "expenses", recordId, filePath);
        const verified = await getAndVerifyExpense(http, c(), recordId, input);
        return { content: [{ type: "text" as const, text: JSON.stringify({
          created: true,
          verified: true,
          attachmentUploaded: true,
          rolledBack: false,
          recordId,
          documentSerial: verified.documentSerial ?? verifiedBeforeUpload.documentSerial,
          reference: verified.reference,
          attachment,
        }, null, 2) }] };
      } catch (error) {
        let rollbackError: unknown;
        if (recordId) {
          try {
            await http.delete(endpoints.expenses.delete(c(), recordId));
          } catch (rollbackFailure) {
            rollbackError = rollbackFailure;
          }
        }
        const reason = error instanceof Error ? error.message : String(error);
        const rollback = recordId
          ? rollbackError
            ? ` Rollback of record ${recordId} also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            : ` Created record ${recordId} was rolled back.`
          : " No document was created.";
        throw new Error(`create_expense_with_attachment failed: ${reason}.${rollback}`);
      }
    }
  );

  // --- Update expense metadata ---
  server.tool(
    "update_expense",
    "Update an existing expense document (only when status is awaiting)",
    {
      id: z.number().describe("Expense document ID to update"),
      reference: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Source document number stored in FlowAccount field เลขที่อ้างอิง (reference)"
        ),
      remarks: z.string().optional().describe("Remarks/notes shown on document"),
      internalNotes: z.string().optional().describe("Internal notes"),
    },
    async ({ id, ...data }) => {
      const current = await http.get<{
        data?: { list?: Array<Record<string, unknown>> };
      }>(endpoints.expenses.get(c(), id));
      const existing = current?.data?.list?.[0];
      if (!existing) {
        throw new Error(`Expense ${id} not found`);
      }
      const result = await http.put(endpoints.expenses.update(c(), id), {
        ...existing,
        ...data,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Delete expense ---
  server.tool(
    "delete_expense",
    "Delete an expense document (only if status is awaiting)",
    { id: z.number().describe("Expense document ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.expenses.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Record payment ---
  server.tool(
    "record_expense_payment",
    "Record a payment for an expense document",
    {
      id: z.number().describe("Expense document ID"),
      paymentMethod: z.number().describe("1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard"),
      paymentDate: z.string().describe("Payment date (yyyy-MM-dd)"),
      paymentAmount: z.number().describe("Payment amount"),
      bankAccountId: z.number().optional().describe("Bank account ID (for transfer/cheque)"),
      remarks: z.string().optional().describe("Payment remarks"),
    },
    async ({ id, ...paymentData }) => {
      const result = await http.post(endpoints.expenses.recordPayment(c(), id), paymentData);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
