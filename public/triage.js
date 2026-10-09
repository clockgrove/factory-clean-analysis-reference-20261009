// Browser-local personal metadata. No query parameters or canonical incident writes.
export const triageKey = 'incident-explorer.triage.v1';
export const noteLimit = 1000;
const fields = ['id', 'title', 'service', 'severity', 'status'];
const valid = entry => entry && fields.every(key => typeof entry[key] === 'string' && entry[key].trim()) &&
  ['Accounts', 'Billing', 'Search', 'Uploads', 'Notifications', 'Integrations'].includes(entry.service) &&
  ['critical', 'high', 'medium', 'low'].includes(entry.severity) &&
  ['open', 'in_progress', 'resolved'].includes(entry.status) && typeof entry.note === 'string' && entry.note.length <= noteLimit;
export function addEntry(entries, incident) {
  const entry = Object.fromEntries(fields.map(key => [key, incident?.[key]]));
  entry.note = '';
  return !valid(entry) || entries.some(item => item.id === entry.id) ? entries : [...entries, entry];
}
export function removeEntry(entries, id) {
  return entries.some(entry => entry.id === id) ? entries.filter(entry => entry.id !== id) : entries;
}
export function editNote(entries, id, note) {
  if (typeof note !== 'string' || note.length > noteLimit) return entries;
  return entries.some(entry => entry.id === id && entry.note !== note) ? entries.map(entry => entry.id === id ? {...entry, note} : entry) : entries;
}
export function readTriage(storage, current = []) {
  try {
    const raw = storage.getItem(triageKey);
    if (raw === null) return {entries: current, message: ''};
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || !Array.isArray(stored.entries)) throw new Error('Invalid triage format');
    const entries = [], seen = new Set();
    let malformed = false;
    for (const entry of stored.entries) {
      if (!valid(entry) || seen.has(entry.id)) { malformed = true; continue; }
      seen.add(entry.id);
      entries.push(Object.fromEntries([...fields, 'note'].map(key => [key, entry[key]])));
    }
    // A later read must never replace usable visit state.
    return {entries: current.length ? current : entries, message: malformed ? 'Some stored triage entries were invalid or duplicated. Valid entries remain available; check your list before saving changes.' : ''};
  } catch {
    return {entries: current, message: 'Triage could not be read from browser storage. Your current list remains usable for this visit.'};
  }
}
export function writeTriage(storage, entries) {
  try {
    storage.setItem(triageKey, JSON.stringify({version: 1, entries}));
    return '';
  } catch {
    return 'Triage changes are available for this visit, but could not be saved. Reloading may restore an older list.';
  }
}
export function ownedDetail(state, token) {
  return state.detail.token === token && !!state.detail.id && !state.detail.pending && !state.detail.error && state.detail.data?.id === state.detail.id;
}
export function serviceOverview(summary) {
  if (!Array.isArray(summary?.services)) return null;
  return [...summary.services].sort((a, b) => b.unresolvedCount - a.unresolvedCount || (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));
}
export function selectionLabel(intent) {
  const parts = [];
  if (intent.q) parts.push(`Search: ${intent.q}`);
  for (const key of ['service', 'status', 'severity']) if (intent[key].length) parts.push(`${key}: ${intent[key].join(', ').replaceAll('_', ' ')}`);
  if (intent.from || intent.to) parts.push(`Opened UTC: ${intent.from || 'any start'} to ${intent.to || 'any end'}`);
  return parts.join(' · ') || 'All incidents';
}
