'use strict';
/**
 * Sync contract enum from map-miniprogram source-of-truth
 * Reads common/poiCapabilities.js & common/constants.js, writes contracts/poi.schema.json enum.
 * Ensures single source of truth — do not manually edit enum.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../../map-miniprogram');
const OUT = path.resolve(__dirname, '../contracts/poi.schema.json');

function extractPoiTypes() {
  const c = fs.readFileSync(path.join(REPO, 'common/constants.js'), 'utf8');
  const m = c.match(/POI_TYPE_MAP\s*=\s*\{([^}]+)\}/s);
  if (!m) throw new Error('POI_TYPE_MAP not found');
  const keys = [...m[1].matchAll(/\b(\d+)\s*:/g)].map(x => x[1]);
  return keys.sort();
}
function main() {
  const types = extractPoiTypes();
  const schema = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const field = schema.fields.find(f => f.name === 'category_id');
  field.constraints.enum = types;
  fs.writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n');
  console.log(`synced category_id enum = [${types.join(',')}] → ${path.relative(process.cwd(), OUT)}`);
}
if (require.main === module) main();
module.exports = { extractPoiTypes };
