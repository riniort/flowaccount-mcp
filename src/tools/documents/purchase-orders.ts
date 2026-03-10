import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../../api/http-client.js";
import { endpoints } from "../../api/endpoints.js";
import type { TokenManager } from "../../auth/token-manager.js";
import { formatListResponse, DOC_FIELDS } from "../../utils/list-formatter.js";

const itemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  unitName: z.string().optional(),
  pricePerUnit: z.number(),
  discount: z.number().optional(),
  vatType: z.number().optional().default(1),
});

export function registerPurchaseOrderTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_purchase_orders",
    "List purchase order documents (ใบสั่งซื้อ)",
    {
      offset: z.number().optional().default(0),
      limit: z.number().optional().default(20),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    },
    async ({ offset, limit, startDate, endDate }) => {
      const params: Record<string, unknown> = { offset, limit };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const result = await http.get(endpoints.purchaseOrders.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: DOC_FIELDS, offset, limit }) }] };
    }
  );

  server.tool(
    "get_purchase_order",
    "Get a single purchase order by ID",
    { id: z.number().describe("Purchase order record ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.purchaseOrders.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_purchase_order",
    "Create a new purchase order (ใบสั่งซื้อ)",
    {
      contactName: z.string().describe("Supplier name"),
      contactTaxId: z.string().optional(),
      contactAddress: z.string().optional(),
      publishedOn: z.string().describe("Document date (yyyy-MM-dd)"),
      dueDate: z.string().optional(),
      items: z.array(itemSchema).min(1),
      isVatInclusive: z.boolean().optional().default(true),
      remarks: z.string().optional(),
    },
    async ({ items, ...rest }) => {
      const result = await http.post(endpoints.purchaseOrders.create(c()), { ...rest, productItems: items });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_purchase_order",
    "Update an existing purchase order (only when status is draft)",
    {
      id: z.number().describe("Purchase order record ID to update"),
      contactName: z.string().optional().describe("Supplier name"),
      contactTaxId: z.string().optional(),
      contactAddress: z.string().optional(),
      publishedOn: z.string().optional().describe("Document date (yyyy-MM-dd)"),
      dueDate: z.string().optional(),
      items: z.array(itemSchema).optional().describe("Updated line items"),
      remarks: z.string().optional(),
    },
    async ({ id, items, ...data }) => {
      const body = items ? { ...data, productItems: items } : data;
      const result = await http.put(endpoints.purchaseOrders.update(c(), id), body);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_purchase_order",
    "Delete a purchase order (only if status allows)",
    { id: z.number().describe("Purchase order record ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.purchaseOrders.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
