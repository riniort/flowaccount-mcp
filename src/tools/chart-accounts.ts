import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASE } from "../api/endpoints.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { ChartAccountService } from "../chart-accounts/service.js";
import type { CompanyCacheRecord } from "../chart-accounts/types.js";

export function registerChartAccountTools(
  server: McpServer,
  service: ChartAccountService,
  tokenManager: TokenManager
): void {
  server.tool(
    "get_account_by_code",
    "Resolve a chart-of-account code to the authoritative account ID and category for the active FlowAccount company.",
    {
      accountCode: z.string().trim().min(1).describe("Account code, including dots or letters, for example 51121.02"),
    },
    async ({ accountCode }) => {
      const company = await activeCompany(tokenManager);
      await service.ensureChartCache(company);
      const account = service.getAccountByCode(company.companyCode, accountCode);
      if (!account) {
        throw new Error(
          `Cannot resolve account: companyCode=${company.companyCode}, accountCode=${accountCode}, reason=not found`
        );
      }
      return json(account);
    }
  );

  server.tool(
    "search_chart_of_accounts",
    "Search the active company's chart of accounts by code or Thai/English name.",
    {
      query: z.string().trim().min(1).describe("Account code or Thai/English account name"),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ query, limit }) => {
      const company = await activeCompany(tokenManager);
      await service.ensureChartCache(company);
      return json({ companyCode: company.companyCode, accounts: service.searchAccounts(company.companyCode, query, limit) });
    }
  );

  server.tool(
    "refresh_chart_of_accounts",
    "Force an atomic full refresh of the active company's chart-of-accounts cache from FlowAccount.",
    {},
    async () => {
      const company = await activeCompany(tokenManager);
      return json(await service.refreshChartCache(company));
    }
  );

  server.tool(
    "get_chart_cache_status",
    "Return chart-of-accounts cache status for the active FlowAccount company without forcing a refresh.",
    {},
    async () => {
      const company = await activeCompany(tokenManager);
      return json({
        companyCode: company.companyCode,
        cache: service.getCacheStatus(company.companyCode) ?? { syncStatus: "missing" },
      });
    }
  );
}

async function activeCompany(tokenManager: TokenManager): Promise<CompanyCacheRecord> {
  await tokenManager.getAuthHeaders(BASE.OPENAPI);
  const companyCode = tokenManager.getCompanySupportCode();
  if (!companyCode) throw new Error("Cannot determine the active FlowAccount company code");
  return {
    companyCode,
    nameLocal: companyCode,
    lastVerifiedAt: new Date().toISOString(),
  };
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
