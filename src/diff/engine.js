'use strict';
/**
 * Data Diff engine — join diff on stable _id (in-memory, Frictionless/data-diff pattern)
 * No hash/bisection needed for 5-8k rows; pure Map join.
 *
 * Outputs: { INSERT, UPDATE, UNCHANGED, CONFLICT, REJECTED, SUSPECTED_DUPLICATE }
 * UPDATE includes changedFields.
 */
function diff({ candidateRows, devRows, rejectedIds = new Set(), opts = {} }) {
  const devMap = new Map(devRows.map(r => [r._id, r]));
  const candMap = new Map(candidateRows.map(r => [r._id, r]));

  const INSERT = [], UPDATE = [], UNCHANGED = [], CONFLICT = [], REJECTED = [];
  const changed = (a, b) => {
    const fields = ['category_id', 'name', 'address', 'latitude', 'longitude', 'city'];
    const diff = [];
    for (const f of fields) {
      if (f === 'latitude' || f === 'longitude') {
        if (Math.abs((a[f] ?? 0) - (b[f] ?? 0)) > 1e-7) diff.push(f);
      } else if ((a[f] ?? '') !== (b[f] ?? '')) diff.push(f);
    }
    // photo_cloud_ids semantic compare
    const pa = JSON.stringify([...(a.photo_cloud_ids || [])].sort());
    const pb = JSON.stringify([...(b.photo_cloud_ids || [])].sort());
    if (pa !== pb) diff.push('photo_cloud_ids');
    return diff;
  };

  for (const row of candidateRows) {
    if (rejectedIds.has(row._id)) { REJECTED.push(row); continue; }
    const dev = devMap.get(row._id);
    if (!dev) INSERT.push(row);
    else {
      const fields = changed(row, dev);
      if (fields.length === 0) UNCHANGED.push(row);
      else if (!opts.forceUpdate) CONFLICT.push({ _id: row._id, before: dev, after: row, changedFields: fields });
      else UPDATE.push({ _id: row._id, before: dev, after: row, changedFields: fields });
    }
  }

  // suspected duplicate: name+round(lat,3)+round(lng,3)
  const bucket = new Map();
  for (const r of candidateRows) {
    const k = `${String(r.name).trim().toLowerCase()}|${Number(r.latitude).toFixed(3)}|${Number(r.longitude).toFixed(3)}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(r);
  }
  const SUSPECTED_DUPLICATE = [...bucket.values()].filter(v => v.length > 1).map(group => ({ key: `${group[0].name}|${group[0].latitude}|${group[0].longitude}`, rows: group }));

  return { INSERT, UPDATE, UNCHANGED, CONFLICT, REJECTED, SUSPECTED_DUPLICATE,
    stats: { insert: INSERT.length, update: UPDATE.length, unchanged: UNCHANGED.length, conflict: CONFLICT.length, rejected: REJECTED.length, suspectedDuplicateGroups: SUSPECTED_DUPLICATE.length } };
}

module.exports = { diff };
