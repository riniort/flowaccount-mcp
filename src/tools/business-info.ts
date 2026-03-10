import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import { endpoints } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";

export function registerBusinessInfoTools(
  server: McpServer,
  http: FlowAccountHttpClient,
  tokenManager: TokenManager
) {
  const c = () => tokenManager.getCulture();

  server.tool(
    "get_business_info",
    "Get the current company/business information (name, address, tax ID, etc.)",
    {},
    async () => {
      const result = await http.get(endpoints.businessInfo.me());
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_bank_accounts",
    "List configured bank accounts for the business",
    {},
    async () => {
      const result = await http.get(endpoints.businessInfo.bankAccounts(c()));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
