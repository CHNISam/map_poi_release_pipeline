'use strict';
/**
 * Severity — mapped from Dagster AssetCheckSeverity
 * PASS: ok
 * WARNING: worth attention, not blocking by default (like Dagster WARN)
 * BLOCK: mechanical blocking (like Dagster ERROR + blocking:true)
 */
const SEVERITY = { PASS: 'PASS', WARNING: 'WARNING', BLOCK: 'BLOCK' };

function maxSeverity(results) {
  if (results.some(r => r.severity === SEVERITY.BLOCK)) return SEVERITY.BLOCK;
  if (results.some(r => r.severity === SEVERITY.WARNING)) return SEVERITY.WARNING;
  return SEVERITY.PASS;
}

module.exports = { SEVERITY, maxSeverity };
