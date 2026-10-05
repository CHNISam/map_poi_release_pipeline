// Example — copy to env.config.js and fill from map-miniprogram/scripts/env-config.json
// Do NOT commit real credentials.
// Harness reads map-miniprogram/scripts/env-config.json at runtime via absolute path,
// so this file is only for pipeline-local overrides / docs.

module.exports = {
  dev: {
    resourceEnv: 'dev-5gzz7rxdbcf5d7dc',
    dbName: 'map',
    cloudFunctionSuffix: '_v2',
    // db connection injected via env vars, not committed:
    // DB_HOST, DB_PORT, DB_USER, DB_PASSWORD must be set in process.env
  },
  prod: {
    resourceEnv: 'prod-6gv6kwxe65437245',
    dbName: 'map',
    cloudFunctionSuffix: '',
    note: 'PROD apply is BLOCKED by gate until explicit approval token — do not enable'
  }
};
