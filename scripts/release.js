#!/usr/bin/env node
'use strict';
const { program } = require('commander');
program
  .name('poi-release')
  .description('POI Release Harness CLI — review → gate → apply → verify')
  .option('--env <env>', 'target env (dev only today)', 'dev')
  .option('--source <path...>', 'source CSV paths (repeatable)')
  .option('--out <dir>', 'release out dir')
  .option('--release <dir>', 'existing release dir')
  .option('--dry-run', 'do not write DB', true)
  .option('--allow-out-of-core', 'acknowledge out-of-core WARNING as non-blocking')
  .option('--force-update', 'allow CONFLICT to become UPDATE');

program.command('review').description('canonicalize + validate + diff (dry-run)').action(async () => {
  console.log('[review] TODO: implement Phase 1+2. See docs/HARNESS_ENGINEERING.md §15 for manual steps.');
  console.log('  This stub validates the harness is scaffolded. Full implementation in next ticket.');
});
program.command('gate').description('evaluate blocking gate').action(async () => {
  console.log('[gate] TODO: implement gate.js mechanical check.');
});
program.command('apply').description('DEV apply (transactional)').action(async () => {
  console.log('[apply] BLOCK unless gate PASS — mechanical guard enforced.');
});
program.command('verify').description('read-back verify').action(async () => {
  console.log('[verify] TODO: implement readback checkpoint.');
});
program.command('check-env').description('verify env guard').action(() => {
  const { guard } = require('../src/environments/guard');
  const path = require('path');
  const candidates = [
    path.resolve(__dirname, '../../map-miniprogram/scripts/env-config.json'),
    'D:\\work\\map\\source code\\map-miniprogram\\scripts\\env-config.json'
  ];
  try {
    let cfg = null, lastErr = null;
    for (const p of candidates) { try { cfg = require(p); break; } catch(e){ lastErr=e; } }
    if (!cfg) throw lastErr;
    const dev = cfg.environments.dev.resourceEnv;
    const res = guard({ targetEnvId: dev, targetDb: 'map', targetSuffix: '_v2', gatePass: true });
    console.log(res);
  } catch (e) { console.error(e.message); process.exit(1); }
});
program.parse();
