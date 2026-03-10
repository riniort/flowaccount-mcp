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
  unitName: z.string().optional().describe("Unit name (e.g., piece, hour, unit)"),
  pricePerUnit: z.number().describe("Price per unit"),
  discount: z.number().optional().describe("Discount amount per item"),
  vatType: z.number().optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
});

export function registerQuotationTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_quotations",
    "List quotation documents with optional date filtering and pagination",
    {
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
      startDate: z.string().optional().describe("Filter start date (yyyy-MM-dd)"),
      endDate: z.string().optional().describe("Filter end date (yyyy-MM-dd)"),
      status: z.number().optional().describe("Filter by status: 0=all, 1=awaiting, 3=approved, 5=approvedAndProcessed, 7=void"),
    },
    async ({ page, limit, startDate, endDate, status }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate, filterStatus: status });
      const result = await http.get(endpoints.quotations.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, page, limit }) }] };
    }
  );

  server.tool(
    "get_quotation",
    "Get a single quotation by ID with full details",
    { id: z.number().describe("Quotation record ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.quotations.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_quotation",
    "Create a new quotation document",
    {
      contactName: z.string().describe("Customer name"),
      contactTaxId: z.string().optional().describe("Customer tax ID"),
      contactAddress: z.string().optional().describe("Customer address"),
      contactEmail: z.string().optional().describe("Customer email"),
      publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
      creditDays: z.number().optional().default(30).describe("Credit days"),
      dueDate: z.string().optional().describe("Due date (yyyy-MM-dd)"),
      items: z.array(itemSchema).min(1).describe("Line items on the quotation"),
      isVatInclusive: z.boolean().optional().default(true).describe("Prices include VAT?"),
      discountPercentage: z.number().optional().describe("Overall discount percentage"),
      remarks: z.string().optional().describe("Remarks shown on document"),
      internalNotes: z.string().optional().describe("Internal notes (not shown to customer)"),
      salesName: z.string().optional().describe("Salesperson name"),
      projectName: z.string().optional().describe("Project name"),
    },
    async ({ items, ...rest }) => {
      const result = await http.post(endpoints.quotations.create(c()), { ...rest, productItems: items });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_quotation",
    "Update an existing quotation (only when status is awaiting)",
    {
      id: z.number().describe("Quotation record ID to update"),
      contactName: z.string().optional().describe("Customer name"),
      publishedOn: z.string().optional().describe("Document date (yyyy-MM-dd)"),
      items: z.array(itemSchema).optional().describe("Updated line items"),
      remarks: z.string().optional().describe("Remarks"),
      internalNotes: z.string().optional().describe("Internal notes"),
    },
    async ({ id, items, ...data }) => {
      const body = items ? { ...data, productItems: items } : data;
      const result = await http.put(endpoints.quotations.update(c(), id), body);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_quotation",
    "Delete a quotation (only when status is awaiting)",
    { id: z.number().describe("Quotation record ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.quotations.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "change_quotation_status",
    "Change the status of a quotation",
    {
      id: z.number().describe("Quotation record ID"),
      status: z
        .enum(["awaiting", "approved", "approvedandprocessed", "rejected", "voided"])
        .describe("New status"),
    },
    async ({ id, status }) => {
      const result = await http.post(
        endpoints.quotations.changeStatus(c(), id, status),
        {}
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
