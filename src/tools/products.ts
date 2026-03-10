import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import { formatListResponse, PRODUCT_FIELDS } from "../utils/list-formatter.js";

export function registerProductTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_products",
    "List products/services with optional search",
    {
      search: z.string().optional().describe("Search by name or code"),
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
    },
    async ({ search, page, limit }) => {
      const params: Record<string, unknown> = { currentPage: page, pageSize: limit };
      if (search) params.searchString = search;
      const result = await http.get(endpoints.products.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: PRODUCT_FIELDS, page, limit }) }] };
    }
  );

  server.tool(
    "get_product",
    "Get a single product by ID",
    { id: z.number().describe("Product ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.products.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_product",
    "Create a new product or service",
    {
      name: z.string().describe("Product name"),
      type: z.number().optional().default(1).describe("1=Service, 3=NonInventory, 5=Inventory"),
      code: z.string().optional().describe("Product code/SKU"),
      description: z.string().optional().describe("Description"),
      sellPrice: z.number().optional().describe("Selling price"),
      buyPrice: z.number().optional().describe("Buying price"),
      unitName: z.string().optional().describe("Unit name (e.g., piece, hour)"),
      barcode: z.string().optional().describe("Barcode"),
      vatType: z.number().optional().default(1).describe("1=Vat, 2=VatExempt, 3=NoVat"),
    },
    async (params) => {
      const result = await http.post(endpoints.products.create(c()), params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_product",
    "Update an existing product or service",
    {
      id: z.number().describe("Product ID to update"),
      name: z.string().optional().describe("Product name"),
      type: z.number().optional().describe("1=Service, 3=NonInventory, 5=Inventory"),
      code: z.string().optional().describe("Product code/SKU"),
      description: z.string().optional().describe("Description"),
      sellPrice: z.number().optional().describe("Selling price"),
      buyPrice: z.number().optional().describe("Buying price"),
      unitName: z.string().optional().describe("Unit name (e.g., piece, hour)"),
      barcode: z.string().optional().describe("Barcode"),
      vatType: z.number().optional().describe("1=Vat, 2=VatExempt, 3=NoVat"),
    },
    async ({ id, ...data }) => {
      const result = await http.put(endpoints.products.update(c(), id), data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_product",
    "Delete a product or service",
    { id: z.number().describe("Product ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.products.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
