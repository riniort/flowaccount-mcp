import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import type { TokenManager } from "../../auth/token-manager.js";
import { formatListResponse, DOC_FIELDS, buildDocListParams } from "../../utils/list-formatter.js";

const itemSchema = z.object({
  name: z.string().describe("Item/product name"),
  description: z.string().optional().describe("Item description"),
  quantity: z.number().describe("Quantity"),
  unitName: z.string().optional().describe("Unit name"),
  pricePerUnit: z.number().describe("Price per unit"),
  discount: z.number().optional().describe("Discount amount"),
  vatType: z.number().optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
});

export function registerTaxInvoiceTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_tax_invoices",
    "List tax invoice documents with optional date filtering",
    {
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
      startDate: z.string().optional().describe("Filter start date (yyyy-MM-dd)"),
      endDate: z.string().optional().describe("Filter end date (yyyy-MM-dd)"),
    },
    async ({ page, limit, startDate, endDate }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate });
      const result = await http.get(endpoints.taxInvoices.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, page, limit }) }] };
    }
  );

  server.tool(
    "get_tax_invoice",
    "Get a single tax invoice by ID",
    { id: z.number().describe("Tax invoice record ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.taxInvoices.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_tax_invoice",
    "Create a new tax invoice (ใบกำกับภาษี)",
    {
      contactName: z.string().describe("Customer name"),
      contactTaxId: z.string().optional().describe("Customer tax ID"),
      contactAddress: z.string().optional().describe("Customer address"),
      contactBranch: z.string().optional().describe("Branch (สำนักงานใหญ่ or branch number)"),
      publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
      dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
      creditDays: z.number().optional().default(30),
      items: z.array(itemSchema).min(1).describe("Line items"),
      isVatInclusive: z.boolean().optional().default(true),
      remarks: z.string().optional(),
      internalNotes: z.string().optional(),
    },
    async ({ items, ...rest }) => {
      const result = await http.post(endpoints.taxInvoices.create(c()), { ...rest, productItems: items });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_tax_invoice",
    "Update an existing tax invoice (only when status is awaiting)",
    {
      id: z.number().describe("Tax invoice record ID to update"),
      contactName: z.string().optional().describe("Customer name"),
      contactTaxId: z.string().optional().describe("Customer tax ID"),
      contactAddress: z.string().optional().describe("Customer address"),
      contactBranch: z.string().optional().describe("Branch"),
      publishedOn: z.string().optional().describe("Document date (yyyy-MM-dd)"),
      dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
      items: z.array(itemSchema).optional().describe("Updated line items"),
      remarks: z.string().optional(),
      internalNotes: z.string().optional(),
    },
    async ({ id, items, ...data }) => {
      const body = items ? { ...data, productItems: items } : data;
      const result = await http.put(endpoints.taxInvoices.update(c(), id), body);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_tax_invoice",
    "Delete a tax invoice (only if status allows)",
    { id: z.number().describe("Tax invoice record ID") },
    async ({ id }) => {
      const result = await http.delete(endpoints.taxInvoices.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "record_tax_invoice_payment",
    "Record a payment on a tax invoice",
    {
      id: z.number().describe("Tax invoice record ID"),
      paymentMethod: z.number().describe("1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard"),
      paymentDate: z.string().describe("Payment date (yyyy-MM-dd)"),
      paymentAmount: z.number().describe("Payment amount"),
      bankAccountId: z.number().optional().describe("Bank account ID"),
      remarks: z.string().optional(),
    },
    async ({ id, ...paymentData }) => {
      const result = await http.post(endpoints.taxInvoices.recordPayment(c(), id), paymentData);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
