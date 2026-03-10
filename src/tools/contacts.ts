import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import { formatListResponse, CONTACT_FIELDS } from "../utils/list-formatter.js";

export function registerContactTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "list_contacts",
    "List contacts (customers/suppliers) with optional search",
    {
      search: z.string().optional().describe("Search by name, tax ID, or code"),
      page: z.number().optional().default(1).describe("Page number (default 1)"),
      limit: z.number().optional().default(20).describe("Items per page (max 100)"),
    },
    async ({ search, page, limit }) => {
      const params: Record<string, unknown> = { currentPage: page, pageSize: limit };
      if (search) params.searchString = search;
      const result = await http.get(endpoints.contacts.list(c()), params);
      return { content: [{ type: "text" as const, text: formatListResponse(result, { fields: CONTACT_FIELDS, page, limit }) }] };
    }
  );

  server.tool(
    "get_contact",
    "Get a single contact by ID",
    { id: z.number().describe("Contact ID") },
    async ({ id }) => {
      const result = await http.get(endpoints.contacts.get(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "create_contact",
    "Create a new contact (customer or supplier)",
    {
      contactName: z.string().describe("Contact name"),
      contactType: z.number().optional().default(3).describe("1=Customer, 2=Supplier, 3=Both"),
      contactGroup: z.number().optional().default(1).describe("1=Individual, 3=Business"),
      contactAddress: z.string().optional().describe("Address"),
      contactTaxId: z.string().optional().describe("Tax ID"),
      contactBranch: z.string().optional().describe("Branch name or number"),
      contactEmail: z.string().optional().describe("Email"),
      contactPhoneNumber: z.string().optional().describe("Phone number"),
      contactNote: z.string().optional().describe("Notes"),
    },
    async (params) => {
      const result = await http.post(endpoints.contacts.create(c()), params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_contact",
    "Update an existing contact",
    {
      id: z.number().describe("Contact ID to update"),
      contactName: z.string().optional().describe("Contact name"),
      contactAddress: z.string().optional().describe("Address"),
      contactTaxId: z.string().optional().describe("Tax ID"),
      contactEmail: z.string().optional().describe("Email"),
      contactPhoneNumber: z.string().optional().describe("Phone number"),
      contactNote: z.string().optional().describe("Notes"),
    },
    async ({ id, ...data }) => {
      const result = await http.put(endpoints.contacts.update(c(), id), data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_contact",
    "Delete a contact by ID",
    { id: z.number().describe("Contact ID to delete") },
    async ({ id }) => {
      const result = await http.delete(endpoints.contacts.delete(c(), id));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
