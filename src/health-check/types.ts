export type Severity = "CRITICAL" | "WARNING" | "INFO";

export interface CheckResult {
  name: string;
  group: string;
  passed: boolean;
  severity: Severity;
  message: string;
  details?: {
    missingFields?: string[];
    unknownStatusCodes?: { docType: string; code: number; count: number }[];
  };
  durationMs: number;
}

export interface HealthCheckReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  criticalFailures: number;
  warnings: number;
  results: CheckResult[];
  overallStatus: "HEALTHY" | "DEGRADED" | "BROKEN";
}
