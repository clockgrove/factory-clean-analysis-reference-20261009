import {addEntry, removeEntry, editNote, readTriage, writeTriage, ownedDetail, serviceOverview, selectionLabel, noteLimit} from './triage.js';
import {createState, transition, queryParams, savedView, announcement, isResultCurrent, canPaginate, addressIntent} from './state.js';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const human = value => String(value).replaceAll('_', ' ');
const utc = value => value ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not resolved';
const facets = {service: ['Accounts', 'Billing', 'Search', 'Uploads', 'Notifications', 'Integrations'], status: ['open', 'in_progress', 'resolved'], severity: ['critical', 'high', 'medium', 'low']};
let state = transition(createState(), {type: 'address', intent: addressIntent(new URLSearchParams(location.search))});
function writeAddress(method) {
  history[method](null, '', `${location.pathname}?${queryParams(state.intent)}${location.hash}`);
}
writeAddress('replaceState');
let resultController, detailController, exportController;
let returnIncident = null, returnElement = null;
let renderedResult, renderedBlocked, renderedDetail, renderedIntent;
const storageKey = 'incident-explorer.views.v1';
let views = [];
let triage = [], triageMessage = '';
try { const loaded = readTriage(localStorage); triage = loaded.entries; triageMessage = loaded.message; }
catch { triageMessage = 'Triage storage is unavailable. Your list will last only for this visit.'; }
const triageNodes = new Map();
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(stored)) views = stored.filter(v => v && typeof v.name === 'string' && v.view && typeof v.view === 'object').map(v => ({name: v.name.slice(0, 80), view: savedView(v.view)}));
} catch { $('storage-message').textContent = 'Saved views could not be read. You can still explore incidents.'; }

function dispatch(event) { const next = transition(state, event); if (next === state) return; state = next; render(); }
function restoreFocus() {
  const button = [...$('rows').querySelectorAll('button')].find(b => b.dataset.incident === returnIncident);
  const target = returnElement?.isConnected && !returnElement.disabled ? returnElement : button && !button.disabled ? button : $('results');
  target.focus();
}
function closeDetail() {
  detailController?.abort();
  dispatch({type: 'detail:close'});
}
function change(event) {
  const next = transition(state, event);
  if (next === state) return;
  $('to').setCustomValidity('');
  resultController?.abort(); detailController?.abort(); exportController?.abort();
  state = next;
  if (event.type === 'address') { $('search').value = state.intent.q; renderedIntent = undefined; writeAddress('replaceState'); }
  else writeAddress('pushState');
  render(); loadResults();
}
async function checked(response) {
  if (response.ok) return response;
  let message = `Request failed (${response.status}).`;
  try { const body = await response.json(); if (typeof body.error?.message === 'string') message = body.error.message; } catch { /* Preserve the HTTP error when no structured error is available. */ }
  throw new Error(message);
}
const errorText = error => error instanceof Error ? error.message : 'The request failed. Please retry.';
async function loadResults() {
  resultController?.abort();
  const controller = resultController = new AbortController();
  dispatch({type: 'result:start'});
  const token = state.resultOp.token, params = queryParams(state.intent);
  try {
    const response = await checked(await fetch(`/api/incidents?${params}`, {signal: controller.signal}));
    const data = await response.json();
    const ownsResult = token === state.resultOp.token && state.resultOp.pending;
    dispatch({type: 'result:success', token, data});
    if (ownsResult) writeAddress('replaceState');
  } catch (error) { if (error.name !== 'AbortError') dispatch({type: 'result:failure', token, error: errorText(error)}); }
  finally { dispatch({type: 'result:finish', token}); }
}
async function loadDetail() {
  detailController?.abort();
  const controller = detailController = new AbortController();
  dispatch({type: 'detail:start'});
  const {token, id} = state.detail;
  try {
    const response = await checked(await fetch(`/api/incidents/${encodeURIComponent(id)}`, {signal: controller.signal}));
    dispatch({type: 'detail:success', token, data: await response.json()});
  } catch (error) { if (error.name !== 'AbortError') dispatch({type: 'detail:failure', token, error: errorText(error)}); }
  finally { dispatch({type: 'detail:finish', token}); }
}
async function exportCSV() {
  exportController?.abort();
  const controller = exportController = new AbortController();
  dispatch({type: 'export:start'});
  const token = state.exportOp.token, params = queryParams(state.intent, {pagination: false});
  let url;
  try {
    const response = await checked(await fetch(`/api/export.csv?${params}`, {signal: controller.signal}));
    const blob = await response.blob();
    if (token !== state.exportOp.token || !state.exportOp.pending) return;
    url = URL.createObjectURL(blob);
    const link = node('a'); link.href = url; link.download = 'incidents.csv'; document.body.append(link); link.click(); link.remove();
    dispatch({type: 'export:success', token});
  } catch (error) { if (error.name !== 'AbortError') dispatch({type: 'export:failure', token, error: errorText(error)}); }
  finally { if (url) { const downloadURL = url; setTimeout(() => URL.revokeObjectURL(downloadURL), 1000); } dispatch({type: 'export:finish', token}); }
}
const renderedMessages = new WeakMap();
function operationMessage(element, message, retry, error = false) {
  const previous = renderedMessages.get(element);
  if (previous && previous.message === message && previous.retry === retry && previous.error === error) return;
  renderedMessages.set(element, {message, retry, error});
  element.replaceChildren(); element.classList.toggle('error', error);
  if (!message) return;
  element.append(node('span', message));
  if (retry) { const button = node('button', 'Retry', 'secondary'); button.type = 'button'; button.addEventListener('click', retry); element.append(button); }
}
function renderControls() {
  const intent = state.intent;
  const signature = JSON.stringify(intent);
  if (signature === renderedIntent) return;
  renderedIntent = signature;
  // Updating values in place preserves keyboard focus and typed search while requests complete.
  if (document.activeElement !== $('search')) $('search').value = intent.q;
  for (const key of ['from', 'to', 'sort', 'direction']) $(key).value = intent[key];
  $('page-size').value = intent.pageSize;
  for (const key of Object.keys(facets)) for (const input of $(key).querySelectorAll('input')) input.checked = intent[key].includes(input.value);
  $('active-filters').replaceChildren();
  for (const key of ['q', 'service', 'status', 'severity', 'from', 'to']) {
    const values = Array.isArray(intent[key]) ? intent[key] : intent[key] ? [intent[key]] : [];
    for (const value of values) {
      const label = `${key === 'q' ? 'Search' : human(key)}: ${key === 'status' ? human(value) : value}`;
      const button = node('button', `${label} ×`); button.type = 'button'; button.setAttribute('aria-label', `Clear ${label}`);
      button.addEventListener('click', () => change({type: 'intent', patch: {[key]: Array.isArray(state.intent[key]) ? state.intent[key].filter(v => v !== value) : ''}}));
      $('active-filters').append(button);
    }
  }
  if (!$('active-filters').children.length) $('active-filters').append(node('span', 'No search or filters applied', 'muted'));
}
function renderOverview() {
  const snapshot = state.result;
  $('overview-selection').textContent = snapshot ? `${isResultCurrent(state) ? 'Completed selection' : 'Previous completed selection'}: ${selectionLabel(snapshot.intent)}${isResultCurrent(state) ? '' : ` · Requested now: ${selectionLabel(state.intent)}`}` : `Requested selection: ${selectionLabel(state.intent)}`;
  const container = $('service-measures'); container.replaceChildren();
  const services = serviceOverview(snapshot?.data.summary);
  if (!snapshot) { container.append(node('p', state.resultOp.error ? 'Service measures could not load. Use the results Retry control.' : 'Service measures will appear when results load.')); return; }
  if (services === null) { container.append(node('p', 'Service measures are unavailable from this backend version.')); return; }
  if (!services.length) { container.append(node('p', 'No matching services. Try clearing a filter or changing your search.')); return; }
  const list = node('div', undefined, 'service-grid');
  for (const service of services) {
    const card = node('section', undefined, 'service-card'); card.append(node('h4', service.service));
    const measures = node('dl');
    for (const [label, value] of [['Matching incidents', service.incidentCount], ['Unresolved incidents', service.unresolvedCount], ['Critical or high severity', service.highSeverityCount], ['Average resolution (hours)', service.averageResolutionHours === null ? 'Unavailable' : service.averageResolutionHours.toLocaleString(undefined, {maximumFractionDigits: 2})]]) measures.append(node('dt', label), node('dd', String(value)));
    card.append(measures); list.append(card);
  }
  container.append(list);
}
function updateTriage(next) {
  if (next === triage) return;
  triage = next;
  try { triageMessage = writeTriage(localStorage, triage); }
  catch { triageMessage = 'Triage changes are available for this visit, but browser storage is unavailable.'; }
  renderTriage();
}
function renderTriage() {
  $('triage-storage').textContent = triageMessage;
  const list = $('triage-list');
  for (const [id, row] of triageNodes) if (!triage.some(entry => entry.id === id)) { row.remove(); triageNodes.delete(id); }
  list.querySelector('.triage-empty')?.remove();
  if (!triage.length) list.append(node('li', 'No triage incidents yet. Open full incident details to add one.', 'triage-empty muted'));
  for (const entry of triage) {
    if (triageNodes.has(entry.id)) continue;
    const row = node('li'), heading = node('p', `${entry.id} · ${entry.title}`), info = node('p', `${entry.service} · ${human(entry.severity)} · ${human(entry.status)}`, 'muted');
    const open = node('button', 'Open details', 'secondary'), remove = node('button', 'Remove', 'secondary'); open.type = remove.type = 'button';
    open.setAttribute('aria-label', `Open triage incident ${entry.id}`); remove.setAttribute('aria-label', `Remove triage incident ${entry.id} and its note`);
    open.addEventListener('click', () => { returnIncident = null; returnElement = open; dispatch({type: 'detail:select', id: entry.id}); loadDetail(); });
    remove.addEventListener('click', () => { updateTriage(removeEntry(triage, entry.id)); $('triage-title').tabIndex = -1; $('triage-title').focus(); });
    const label = node('label', `Personal note for ${entry.id} (1000 characters maximum)`), note = node('textarea');
    note.id = `triage-note-${entry.id}`; label.htmlFor = note.id; note.maxLength = noteLimit; note.value = entry.note; note.rows = 3;
    note.addEventListener('input', () => updateTriage(editNote(triage, entry.id, note.value)));
    const actions = node('div', undefined, 'triage-actions'); actions.append(open, remove);
    row.append(heading, info, actions, label, note); list.append(row); triageNodes.set(entry.id, row);
  }
}
function renderSnapshot() {
  const current = isResultCurrent(state), blocked = state.resultOp.pending || !current;
  $('results').dataset.stale = String(!current && !!state.result);
  $('freshness').textContent = state.resultOp.pending ? (state.result ? 'Updating · previous results shown' : 'Loading…') : !current && state.result ? 'Previous results · selections have changed' : state.result ? 'Current selections' : '';
  $('results').setAttribute('aria-busy', String(state.resultOp.pending));
  operationMessage($('result-message'), state.resultOp.error || (state.resultOp.pending ? (state.result ? 'Updating results. Rows and summaries below belong to the previous completed query.' : 'Loading incidents and summaries…') : !state.result ? 'No results loaded.' : !state.result.data.total ? 'No incidents match these selections. Try clearing a filter or changing your search.' : ''), state.resultOp.error ? loadResults : null, !!state.resultOp.error);
  const data = state.result?.data;
  if (state.result !== renderedResult) {
    $('summary').replaceChildren();
    for (const [label, key] of [['Matching incidents', 'total'], ['Unresolved', 'unresolved'], ['Critical + high', 'highSeverity']]) {
      const card = node('div', undefined, 'metric'); card.append(node('strong', data ? data.summary[key].toLocaleString() : '—'), node('span', label)); $('summary').append(card);
    }
    const days = data?.summary.openedByDay || [], maximum = Math.max(1, ...days.map(d => d.count));
    $('chart-bars').replaceChildren();
    for (const day of days) { const bar = node('span'); bar.style.height = `${day.count / maximum * 100}%`; $('chart-bars').append(bar); }
    $('chart-text').textContent = data ? days.length ? days.map(d => `${d.date}: ${d.count} incident${d.count === 1 ? '' : 's'}`).join('; ') : 'No matching incidents were opened in this range.' : 'Daily counts will appear when results load.';
  }
  if (state.result !== renderedResult || blocked !== renderedBlocked) {
    $('rows').replaceChildren();
    for (const item of data?.items || []) {
      const row = node('tr'), cell = node('td'), button = node('button', undefined, 'incident-link');
      button.type = 'button'; button.dataset.incident = item.id; button.disabled = blocked;
      button.append(node('span', item.id), document.createTextNode(item.title));
      button.addEventListener('click', () => { returnIncident = item.id; returnElement = button; dispatch({type: 'detail:select', id: item.id}); loadDetail(); });
      cell.append(button); row.append(cell, node('td', item.service));
      const severity = node('td'); severity.append(node('span', human(item.severity), `badge ${item.severity}`)); row.append(severity, node('td', human(item.status)), node('td', utc(item.openedAt))); $('rows').append(row);
    }
    renderedResult = state.result; renderedBlocked = blocked;
  }
  $('previous').disabled = !canPaginate(state) || state.intent.page <= 1;
  $('next').disabled = !canPaginate(state) || state.intent.page >= (data?.totalPages || 0);
  $('page-label').textContent = data ? data.totalPages ? `Page ${data.page} of ${data.totalPages} · ${data.total.toLocaleString()} incidents${current ? '' : ' (previous query)'}` : '0 incidents · no pages' : 'Pages unavailable';
}
function renderDetail() {
  const detail = state.detail, dialog = $('detail');
  if (!detail.id) { renderedDetail = null; if (dialog.open) { dialog.close(); restoreFocus(); } return; }
  if (renderedDetail && ['token', 'id', 'pending', 'data', 'error'].every(key => renderedDetail[key] === detail[key])) return;
  const contentHadFocus = $('detail-content').contains(document.activeElement);
  renderedDetail = detail;
  $('detail-title').textContent = detail.data ? `${detail.data.id} · ${detail.data.title}` : `Incident ${detail.id}`;
  $('detail-content').replaceChildren();
  if (detail.pending || detail.error || !detail.data) {
    const message = node('div', undefined, 'operation-message'); operationMessage(message, detail.error || 'Loading complete incident details…', detail.error ? loadDetail : null, !!detail.error); $('detail-content').append(message);
  } else {
    const fields = node('dl', undefined, 'detail-fields');
    for (const [key, label] of [['id', 'ID'], ['title', 'Title'], ['description', 'Description'], ['service', 'Service'], ['severity', 'Severity'], ['status', 'Status'], ['openedAt', 'Opened (UTC)'], ['resolvedAt', 'Resolved (UTC)'], ['team', 'Team'], ['region', 'Region'], ['tags', 'Tags']]) {
      const value = detail.data[key];
      fields.append(node('dt', label), node('dd', key.endsWith('At') ? utc(value) : Array.isArray(value) ? value.join(', ') || 'None' : key === 'status' ? human(value) : String(value ?? '—')));
    }
    $('detail-content').append(fields);
    const token = detail.token, id = detail.id;
    const added = triage.some(entry => entry.id === id);
    const add = node('button', added ? 'Already in triage' : 'Add to triage'); add.type = 'button'; add.disabled = added;
    add.addEventListener('click', () => {
      if (!ownedDetail(state, token)) return;
      updateTriage(addEntry(triage, state.detail.data));
      add.textContent = 'Already in triage'; add.disabled = true; $('close-detail').focus();
    });
    $('detail-content').append(add);
  }
  if (!dialog.open) { dialog.showModal(); $('close-detail').focus(); }
  else if (contentHadFocus) $('close-detail').focus();
}
function render() {
  renderControls(); renderSnapshot(); renderOverview(); renderDetail();
  $('export').disabled = state.exportOp.pending;
  operationMessage($('export-message'), state.exportOp.error || (state.exportOp.pending ? 'Preparing a CSV of all matching incidents…' : ''), state.exportOp.error ? exportCSV : null, !!state.exportOp.error);
  $('announcement').textContent = announcement(state);
}
function renderViews() {
  $('views').replaceChildren();
  if (!views.length) $('views').append(node('li', 'No saved views yet.', 'muted'));
  views.forEach((entry, index) => {
    const row = node('li'), open = node('button', entry.name, 'secondary'), remove = node('button', 'Delete', 'secondary'); open.type = remove.type = 'button';
    open.setAttribute('aria-label', `Open saved view ${entry.name}`); remove.setAttribute('aria-label', `Delete saved view ${entry.name}`);
    open.addEventListener('click', () => { $('search').value = entry.view.q; change({type: 'restore', view: entry.view}); });
    remove.addEventListener('click', () => { views.splice(index, 1); persistViews(); renderViews(); $('view-name').focus(); });
    row.append(open, remove); $('views').append(row);
  });
}
function persistViews() {
  try { localStorage.setItem(storageKey, JSON.stringify(views)); $('storage-message').textContent = 'Saved views updated in this browser.'; }
  catch { $('storage-message').textContent = 'Browser storage is unavailable. These views will last only for this visit.'; }
}
function queryPatch() {
  const patch = {q: $('search').value, from: $('from').value, to: $('to').value};
  for (const key of Object.keys(facets)) patch[key] = [...$(key).querySelectorAll('input:checked')].map(input => input.value);
  return patch;
}
function applyForm() {
  $('to').setCustomValidity($('from').value && $('to').value && $('from').value > $('to').value ? 'Choose an end date on or after the start date.' : '');
  if ($('query-form').reportValidity()) change({type: 'intent', patch: queryPatch()});
}
for (const [key, values] of Object.entries(facets)) for (const value of values) {
  const label = node('label', undefined, 'check'), input = node('input'); input.type = 'checkbox'; input.name = key; input.value = value;
  label.append(input, document.createTextNode(human(value))); $(key).append(label);
}
$('query-form').addEventListener('submit', event => { event.preventDefault(); applyForm(); });
$('query-form').addEventListener('change', event => { if (event.target !== $('search')) applyForm(); });
$('clear').addEventListener('click', () => { $('search').value = ''; $('to').setCustomValidity(''); change({type: 'intent', patch: {q: '', service: [], status: [], severity: [], from: '', to: ''}}); });
for (const key of ['sort', 'direction']) $(key).addEventListener('change', () => change({type: 'intent', patch: {[key]: $(key).value}}));
$('page-size').addEventListener('change', () => change({type: 'intent', patch: {pageSize: Number($('page-size').value)}}));
$('previous').addEventListener('click', () => change({type: 'page', delta: -1}));
$('next').addEventListener('click', () => change({type: 'page', delta: 1}));
$('export').addEventListener('click', exportCSV);
$('close-detail').addEventListener('click', closeDetail);
$('detail').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
$('save-form').addEventListener('submit', event => { event.preventDefault(); const name = $('view-name').value.trim(); if (!name) { $('view-name').setCustomValidity('Enter a view name.'); $('view-name').reportValidity(); return; } views.push({name, view: savedView(state.intent)}); persistViews(); renderViews(); $('view-name').value = ''; });
$('view-name').addEventListener('input', () => $('view-name').setCustomValidity(''));
window.addEventListener('popstate', () => change({type: 'address', intent: addressIntent(new URLSearchParams(location.search))}));
renderViews(); renderTriage(); render(); loadResults();
