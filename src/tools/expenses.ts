import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import { formatListResponse, DOC_FIELDS, EXPENSE_STATUS, buildDocListParams } from "../utils/list-formatter.js";

// Expense items require chart-of-accounts category fields (company-specific).
// Use list_expense_categories to discover available categories for your company.
const expenseItemSchema = z.object({
  description: z.string().describe("Item description"),
  quantity: z.number().describe("Quantity"),
  pricePerUnit: z.number().describe("Price per unit"),
  discount: z.number().optional().describe("Discount amount"),
  vatType: z.number().optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
  // Expense category fields (required for CORE API)
  expenseCategoryId: z.number().describe("Expense category ID (from list_expense_categories)"),
  expenseSystemCode: z.number().describe("Expense system code (from list_expense_categories)"),
  expenseDebitId: z.number().describe("Debit chart-of-account ID (from list_expense_categories)"),
  expenseDebitCode: z.string().describe("Debit account code (from list_expense_categories)"),
  expenseCreditId: z.number().describe("Credit chart-of-account ID (from list_expense_categories)"),
  expenseCreditCode: z.string().describe("Credit account code (from list_expense_categories)"),
  expenseDebitCategory: z.number().optional().default(5).describe("Debit category type"),
  expenseCreditCategory: z.number().optional().default(2).describe("Credit category type"),
});

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
    expenseCategoryId: item.expenseCategoryId,
    expenseSystemCode: item.expenseSystemCode,
    expenseDebitId: item.expenseDebitId,
    expenseDebitCode: item.expenseDebitCode,
    expenseCreditId: item.expenseCreditId,
    expenseCreditCode: item.expenseCreditCode,
    expenseDebitCategory: item.expenseDebitCategory ?? 5,
    expenseCreditCategory: item.expenseCreditCategory ?? 2,
  };
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

      const categories = new Map<number, Record<string, unknown>>();
      const list = result?.data?.list ?? [];
      for (const expense of list) {
        for (const pi of expense.productItems ?? []) {
          const catId = pi.expenseCategoryId as number;
          if (catId && !categories.has(catId)) {
            categories.set(catId, {
              expenseCategoryId: catId,
              nameLocal: pi.expenseCategoryNameLocal,
              nameForeign: pi.expenseCategoryNameForeign,
              expenseSystemCode: pi.expenseSystemCode,
              expenseDebitId: pi.expenseDebitId,
              expenseDebitCode: pi.expenseDebitCode,
              expenseDebitCategory: pi.expenseDebitCategory,
              expenseDebitNameLocal: pi.expenseDebitNameLocal,
              expenseCreditId: pi.expenseCreditId,
              expenseCreditCode: pi.expenseCreditCode,
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
            text: "No expense categories found. Create an expense in the FlowAccount UI first, then this tool can discover available categories.",
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
    },
    async ({ page, limit, startDate, endDate }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate });
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
    "Create a new expense document. Each item requires expense category fields — use list_expense_categories first to get the required IDs.",
    {
      contactName: z.string().describe("Supplier/vendor name"),
      contactTaxId: z.string().optional().describe("Supplier tax ID"),
      contactAddress: z.string().optional().describe("Supplier address"),
      publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
      dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
      items: z.array(expenseItemSchema).min(1).describe("Expense line items"),
      isVatInclusive: z.boolean().optional().default(true).describe("Prices include VAT?"),
      remarks: z.string().optional().describe("Remarks/notes shown on document"),
      internalNotes: z.string().optional().describe("Internal notes"),
    },
    async ({ items, publishedOn, dueDate, ...rest }) => {
      const productItems = items.map((item, i) => ({ no: i, ...toProductItem(item) }));
      const pubDate = publishedOn.includes("T") ? publishedOn : `${publishedOn}T00:00:00`;
      const due = dueDate
        ? (dueDate.includes("T") ? dueDate : `${dueDate}T00:00:00`)
        : pubDate;

      const body = {
        documentType: 13,
        ...rest,
        publishedOn: pubDate,
        dueDate: due,
        vatRate: 0,
        status: 1,
        productItems,
      };

      const result = await http.post(endpoints.expenses.create(c()), body);
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
