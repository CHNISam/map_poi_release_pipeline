'use strict';
/**
 * Blocking Gate — mechanical, Dagster-inspired
 * No agent discretion: any BLOCK count >0 → exit 1.
 */
const { guard } = require('../environments/guard');

function evaluateGate({ candidate, diff, env }) {
  const blocking = (candidate.validationReport || []).filter(r => r.severity === 'BLOCK').length
    + (candidate.qualityReport || []).filter(r => r.severity === 'BLOCK').length;
  const conflicts = diff?.stats?.conflict ?? diff?.CONFLICT?.length ?? 0;
  const envCheck = guard({ targetEnvId: env.resourceEnv, targetDb: env.dbName || 'map', targetSuffix: env.cloudFunctionSuffix, gatePass: true });
  const pass = blocking === 0 && conflicts === 0 && envCheck.pass;
  return {
    pass,
    reason: pass ? 'GATE_PASS' : `GATE_BLOCK: blocking=${blocking} conflict=${conflicts} envPass=${envCheck.pass}`,
    blockingCount: blocking,
    conflictCount: conflicts,
    envCheck,
    timestamp: new Date().toISOString()
  };
}

module.exports = { evaluateGate };
