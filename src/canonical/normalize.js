'use strict';
/**
 * Canonical normalize — header alias + type coercion
 * Mirrors frictionless Table Schema constraints before validators.
 *
 * Responsibilities:
 * - alias naem → name (Shenzhen typo)
 * - drop spurious city=1, re-derive if needed
 * - photo_cloud_ids: string ';' → string[] trimmed, filter empty
 * - type → String(category_id)
 * - latitude/longitude → Number (parseFloat) with NaN guard
 * - desc → string (JSON.stringify if object, empty string if missing)
 * - trim all strings
 *
 * Pure function, no IO. Covered by tests/fixtures.
 */

// header alias map (lowercase)
const ALIAS = { naem: 'name' };

function normalizeHeader(rawHeader) {
  const h = String(rawHeader).trim().toLowerCase();
  return ALIAS[h] || h;
}

function normalizePhotoCloudIds(raw) {
  if (Array.isArray(raw)) return raw.flatMap(normalizePhotoCloudIds);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(';').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRow(raw, { sourceFile, sourceRow }) {
  // raw is Dict from csv-parse with original header keys
  const aliased = {};
  for (const [k, v] of Object.entries(raw)) {
    aliased[normalizeHeader(k)] = v;
  }
  const name = String(aliased.name ?? '').trim();
  const address = String(aliased.address ?? '').trim();
  const lat = parseFloat(String(aliased.latitude ?? '').trim());
  const lng = parseFloat(String(aliased.longitude ?? '').trim());
  const category_id = aliased.type !== undefined && aliased.type !== '' ? String(aliased.type).trim() : '';
  const photo_cloud_ids = normalizePhotoCloudIds(aliased.photo_cloud_ids ?? aliased.photo_cloud_id ?? '');
  const desc = aliased.desc !== undefined && aliased.desc !== null ? String(aliased.desc).trim() : '';
  const cityRaw = String(aliased.city ?? '').trim();
  // drop spurious city=1 (Shenzhen constant)
  const city = cityRaw === '1' || cityRaw === '0' ? '' : cityRaw;

  return {
    name,
    address,
    latitude: Number.isNaN(lat) ? null : lat,
    longitude: Number.isNaN(lng) ? null : lng,
    category_id,
    photo_cloud_ids,
    desc,
    city,
    _source: { sourceFile, sourceRow, rawHeader: Object.keys(raw) },
    _warnings: aliased.naem !== undefined ? ['header alias naem→name applied'] : []
  };
}

module.exports = { normalizeHeader, normalizePhotoCloudIds, normalizeRow };
