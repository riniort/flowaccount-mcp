export type AccountType = "control" | "sub_account";

export interface CompanyCacheRecord {
  companyCode: string;
  companyId?: number;
  nameLocal: string;
  nameForeign?: string;
  lastVerifiedAt: string;
}

export interface ChartAccount {
  companyCode: string;
  accountCode: string;
  accountId: number;
  nameLocal: string;
  nameForeign?: string;
  categoryCode?: number;
  categoryName?: string;
  accountType: AccountType;
  isActive: boolean;
  fetchedAt: string;
}

export interface ChartCacheState {
  companyCode: string;
  schemaVersion: number;
  lastFullSyncAt?: string;
  expiresAt?: string;
  accountCount?: number;
  sourceHash?: string;
  syncStatus?: string;
  lastError?: string;
}

export interface ChartAccountSource {
  fetchAccounts(companyCode: string): Promise<Omit<ChartAccount, "companyCode" | "fetchedAt">[]>;
}
