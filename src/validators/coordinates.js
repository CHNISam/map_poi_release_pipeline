'use strict';
/**
 * Coordinate checks — custom business checks beyond JSON schema
 * Severity: mostly BLOCK, swapped/out-of-bbox are WARNING.
 */
const { SEVERITY } = require('./severity');

// Guangdong extended bbox (for 深圳/佛山 + noise filter)
const GUANGDONG = { latMin: 20.0, latMax: 25.5, lngMin: 109.5, lngMax: 117.5 };
const CORE = { latMin: 22.0, latMax: 24.5, lngMin: 112.5, lngMax: 115.5 };

function checkCoordinates(row, idx) {
  const errs = [];
  const { latitude: lat, longitude: lng } = row;
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    errs.push({ row: idx, col: 'latitude/longitude', code: 'missing-coordinate', message: `lat/lng missing or NaN`, severity: SEVERITY.BLOCK });
    return errs;
  }
  if (lat === 0 && lng === 0) {
    errs.push({ row: idx, col: 'latitude', code: 'zero-coordinate', message: '0,0 null island rejected', severity: SEVERITY.BLOCK });
  }
  if (lat < -90 || lat > 90) errs.push({ row: idx, col: 'latitude', code: 'lat-out-of-range', message: `lat ${lat} outside [-90,90]`, severity: SEVERITY.BLOCK });
  if (lng < -180 || lng > 180) errs.push({ row: idx, col: 'longitude', code: 'lng-out-of-range', message: `lng ${lng} outside [-180,180]`, severity: SEVERITY.BLOCK });

  // suspected swapped: lat suspiciously >90 or lat looks like lng (113.x) while lng looks like lat (22.x)
  const swappedLat = lng, swappedLng = lat;
  const swappedInCore = swappedLat >= CORE.latMin && swappedLat <= CORE.latMax && swappedLng >= CORE.lngMin && swappedLng <= CORE.lngMax;
  const originalInCore = lat >= CORE.latMin && lat <= CORE.latMax && lng >= CORE.lngMin && lng <= CORE.lngMax;
  if (!originalInCore && swappedInCore) {
    errs.push({ row: idx, col: 'latitude', code: 'suspected-swapped', message: `suspected lat/lng swapped (${lat},${lng} → ${swappedLat},${swappedLng} in core)`, severity: SEVERITY.WARNING });
  }

  const inGuangdong = lat >= GUANGDONG.latMin && lat <= GUANGDONG.latMax && lng >= GUANGDONG.lngMin && lng <= GUANGDONG.lngMax;
  if (!inGuangdong) {
    errs.push({ row: idx, col: 'latitude', code: 'out-of-guangdong', message: `outside Guangdong bbox ${lat},${lng}`, severity: SEVERITY.WARNING });
  } else if (!originalInCore) {
    errs.push({ row: idx, col: 'latitude', code: 'out-of-core', message: `outside core bbox ${lat},${lng} (needs review)`, severity: SEVERITY.WARNING });
  }
  return errs;
}

module.exports = { checkCoordinates, GUANGDONG, CORE };
