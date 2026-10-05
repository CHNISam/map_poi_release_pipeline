'use strict';
/**
 * Stable _id + source_hash generation
 * Deterministic, idempotent — second run with same source must yield same _id.
 *
 * Strategy:
 * - If raw has stable external id (Shenzhen id from 原始数据), use `shenzhen:{id}`
 * - Else (Foshan etc): `foshan:{sha256(normalize(name)+| +normalize(address)+| +lat5+| +lng5).slice(0,12)}`
 * - Fallback generic: `poi:{sha256(...)}`
 *
 * source_hash = sha256(canonical JSON without _id/source_hash) for row-level change detection.
 */
const crypto = require('crypto');

function round5(n) {
  return Number(n).toFixed(5);
}

function normalizeForHash(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stableId(row, raw) {
  const externalId = raw && (raw.id ?? raw.ID ?? raw._id ?? raw.poi_id);
  if (externalId && String(externalId).trim()) {
    // prefix by source city heuristic if possible
    const pref = row.city && /深圳/.test(row.city) ? 'shenzhen' : raw.city === '1' ? 'shenzhen' : 'ext';
    return `${pref}:${String(externalId).trim()}`;
  }
  const key = `${normalizeForHash(row.name)}|${normalizeForHash(row.address)}|${round5(row.latitude)}|${round5(row.longitude)}`;
  const h = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  // Foshan has no id, use foshan prefix for traceability
  if (row.city && /佛山/.test(row.city) || /佛山/.test(row.address)) return `foshan:${h}`;
  return `poi:${h}`;
}

function sourceHash(row) {
  const payload = JSON.stringify({
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    category_id: row.category_id,
    photo_cloud_ids: row.photo_cloud_ids,
    desc: row.desc
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = { stableId, sourceHash, round5 };
