import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import type { TokenManager } from "../../auth/token-manager.js";
import { formatListResponse, DOC_FIELDS, buildDocListParams } from "../../utils/list-formatter.js";

const itemSchema = z.object({
  name: z.string().describe("Item name"),
  description: z.string().optional(),
  quantity: z.number(),
  unitName: z.string().optional(),
  pricePerUnit: z.number(),
  discount: z.number().optional(),
  vatType: z.number().optional().default(1),
});

export function registerReceiptTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_receipts",
    "List receipt documents (ใบเสร็จรับเงิน)",
    {
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
      startDate: z.string().optional().describe("Filter start date (yyyy-MM-dd)"),
      endDate: z.string().optional().describe("Filter end date (yyyy-MM-dd)"),
    },
    async ({ page, limit, startDate, endDate }) => {
      const params = buildDocListParams({ page, limit, startDate, endDate });
      const result = await http.get(endpoints.receipts.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, page, limit }) }] };
    }
  );

  server.tool(
    "get_receipt",
    "Get a single receipt by ID",
    { id: z.number().describe("Receipt record ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.receipts.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_receipt",
    "Create a new receipt document (ใบเสร็จรับเงิน)",
    {
      contactName: z.string().describe("Customer name"),
      contactTaxId: z.string().optional(),
      contactAddress: z.string().optional(),
      publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
      items: z.array(itemSchema).min(1).describe("Line items"),
      isVatInclusive: z.boolean().optional().default(true),
      remarks: z.string().optional(),
    },
    async ({ items, ...rest }) => {
      const result = await http.post(endpoints.receipts.create(c()), { ...rest, productItems: items });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_receipt",
    "Update an existing receipt (only when status is awaiting)",
    {
      id: z.number().describe("Receipt record ID to update"),
      contactName: z.string().optional().describe("Customer name"),
      contactTaxId: z.string().optional(),
      contactAddress: z.string().optional(),
      publishedOn: z.string().optional().describe("Document date (yyyy-MM-dd)"),
      items: z.array(itemSchema).optional().describe("Updated line items"),
      remarks: z.string().optional(),
    },
    async ({ id, items, ...data }) => {
      const body = items ? { ...data, productItems: items } : data;
      const result = await http.put(endpoints.receipts.update(c(), id), body);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_receipt",
    "Delete a receipt (only if status allows)",
    { id: z.number().describe("Receipt record ID") },
    async ({ id }) => {
      const result = await http.delete(endpoints.receipts.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "record_receipt_payment",
    "Record a payment on a receipt",
    {
      id: z.number().describe("Receipt record ID"),
      paymentMethod: z.number().describe("1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard"),
      paymentDate: z.string().describe("Payment date (yyyy-MM-dd)"),
      paymentAmount: z.number().describe("Payment amount"),
      bankAccountId: z.number().optional().describe("Bank account ID"),
      remarks: z.string().optional(),
    },
    async ({ id, ...paymentData }) => {
      const result = await http.post(endpoints.receipts.recordPayment(c(), id), paymentData);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
