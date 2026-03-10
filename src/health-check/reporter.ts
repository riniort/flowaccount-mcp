import type { CheckResult, HealthCheckReport } from "./types.js";

export function buildReport(results: CheckResult[]): HealthCheckReport {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const criticalFailures = results.filter((r) => !r.passed && r.severity === "CRITICAL").length;
  const warnings = results.filter((r) => !r.passed && r.severity === "WARNING").length;

  let overallStatus: HealthCheckReport["overallStatus"] = "HEALTHY";
  if (criticalFailures > 0) overallStatus = "BROKEN";
  else if (warnings > 0) overallStatus = "DEGRADED";

  return {
    timestamp: new Date().toISOString(),
    totalChecks: results.length,
    passed,
    failed,
    criticalFailures,
    warnings,
    results,
    overallStatus,
  };
}

export function printReport(report: HealthCheckReport): void {
  const line = "=".repeat(56);
  const w = (s: string) => process.stderr.write(s + "\n");

  w("");
  w(line);
  w("  FlowAccount API Health Check");
  w(`  ${report.timestamp}`);
  w(line);
  w("");

  const icon =
    report.overallStatus === "HEALTHY" ? "HEALTHY" :
    report.overallStatus === "DEGRADED" ? "DEGRADED" : "BROKEN";
  w(`  OVERALL: ${icon}`);
  w("");

  // Group results
  const groups = new Map<string, CheckResult[]>();
  for (const r of report.results) {
    const arr = groups.get(r.group) || [];
    arr.push(r);
    groups.set(r.group, arr);
  }

  for (const [group, checks] of groups) {
    const groupPassed = checks.filter((c) => c.passed).length;
    w(`  --- ${group} (${groupPassed}/${checks.length} passed) ---`);

    for (const c of checks) {
      const tag = c.passed ? "[PASS]" : "[FAIL]";
      const sev = c.passed ? "" : ` [${c.severity}]`;
      const dur = `(${c.durationMs}ms)`;
      const name = c.name.padEnd(38);
      w(`  ${tag} ${name} ${dur}${sev}`);

      if (!c.passed) {
        w(`    ${c.message}`);
        if (c.details?.missingFields?.length) {
          w(`    Missing: ${c.details.missingFields.join(", ")}`);
        }
        if (c.details?.unknownStatusCodes?.length) {
          for (const u of c.details.unknownStatusCodes) {
            w(`    Unknown status ${u.code} in ${u.docType} (${u.count}x)`);
          }
        }
      }
    }
    w("");
  }

  w(line);
  w(`  Total: ${report.totalChecks} checks | ${report.passed} passed | ${report.failed} failed`);
  w(line);
  w("");
}

export function exitCode(report: HealthCheckReport): number {
  if (report.criticalFailures > 0) return 1;
  if (report.warnings > 0) return 2;
  return 0;
}
