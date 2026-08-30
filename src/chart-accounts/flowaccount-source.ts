import { BASE, endpoints } from "../api/endpoints.js";
import type { FlowAccountHttpClient } from "../api/http-client.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { ChartAccountSource } from "./types.js";

const CATEGORY_CODES: Record<string, number> = {
  assets: 1,
  liabilities: 2,
  equity: 3,
  revenue: 4,
  expenses: 5,
};

interface OpenApiChartAccount {
  id?: number;
  code?: string | number;
  category?: string;
  nameLocal?: string;
  nameForeign?: string | null;
}

export class FlowAccountChartAccountSource implements ChartAccountSource {
  constructor(
    private readonly http: FlowAccountHttpClient,
    private readonly tokenManager: TokenManager
  ) {}

  async fetchAccounts(companyCode: string) {
    // Initialize authentication before checking company identity. The OpenAPI
    // endpoint is scoped by the same bearer token and X-Company-Id header.
    await this.tokenManager.getAuthHeaders(BASE.OPENAPI);
    assertActiveCompany(this.tokenManager, companyCode);
    const response = await this.http.get<{
      status?: boolean;
      message?: string;
      data?: { total?: number; accounts?: OpenApiChartAccount[] };
    }>(endpoints.chartOfAccounts.list());
    assertActiveCompany(this.tokenManager, companyCode);
    if (response.status === false) {
      throw new Error(response.message || "FlowAccount chart-of-accounts request failed");
    }
    const accounts = response.data?.accounts ?? [];
    return accounts.map((account) => {
      const categoryName = String(account.category ?? "").trim();
      const categoryCode = CATEGORY_CODES[categoryName.toLowerCase()];
      if (!categoryCode) {
        throw new Error(`Unknown FlowAccount account category "${categoryName}"`);
      }
      return {
        accountCode: String(account.code ?? "").trim(),
        accountId: Number(account.id),
        nameLocal: String(account.nameLocal ?? account.nameForeign ?? account.code ?? "").trim(),
        nameForeign: account.nameForeign?.trim() || undefined,
        categoryCode,
        categoryName,
        // The official endpoint returns selectable/postable accounts. Control
        // accounts are not returned and therefore cannot be used by expenses.
        accountType: "sub_account" as const,
        isActive: true,
      };
    });
  }
}

function assertActiveCompany(tokenManager: TokenManager, expected: string): void {
  const actual = tokenManager.getCompanySupportCode();
  if (!actual || actual !== expected) {
    throw new Error(
      `Chart-account company mismatch: expected active company ${expected}, got ${actual || "unknown"}`
    );
  }
}
