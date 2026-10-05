'use strict';
/**
 * Environment Guard — mechanical blocking, mirrors harness/checks/environment.js
 * Must be called before any write.
 */
const ALLOWED_DEV = 'dev-5gzz7rxdbcf5d7dc';
const ALLOWED_PROD = 'prod-6gv6kwxe65437245'; // never allowed in this phase, but known
const ALLOWED_DB = 'map';

function guard({ targetEnvId, targetDb, targetSuffix, gatePass }) {
  const errors = [];
  if (targetEnvId !== ALLOWED_DEV) errors.push(`BLOCK: targetEnvId=${targetEnvId} must be ${ALLOWED_DEV} (today only DEV allowed)`);
  if (targetEnvId === ALLOWED_PROD) errors.push('BLOCK: PROD write is forbidden in this phase (requires explicit approval token)');
  if (targetDb !== ALLOWED_DB) errors.push(`BLOCK: targetDb=${targetDb} must be ${ALLOWED_DB}`);
  if (targetSuffix !== '_v2') errors.push(`BLOCK: targetSuffix=${targetSuffix} must be _v2 for dev`);
  if (!gatePass) errors.push('BLOCK: gate not PASS');
  return { pass: errors.length === 0, errors, env: targetEnvId, db: targetDb };
}

module.exports = { guard, ALLOWED_DEV, ALLOWED_PROD, ALLOWED_DB };
