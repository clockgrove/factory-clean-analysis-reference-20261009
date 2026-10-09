import test from 'node:test';
import assert from 'node:assert/strict';
import {addEntry, removeEntry, editNote, readTriage, writeTriage, triageKey, ownedDetail, serviceOverview, selectionLabel} from '../../public/triage.js';
import {createState, transition, announcement} from '../../public/state.js';
const incident = id => ({id, title: `Incident ${id}`, service: 'Billing', severity: 'high', status: 'open'});
const storage = value => ({getItem: key => { assert.equal(key, triageKey); return value; }});
test('ordered unique recognition snapshots, plain-text notes and removal delete all personal metadata', () => {
  let entries = addEntry([], incident('A')); entries = addEntry(entries, incident('B'));
  entries = editNote(entries, 'A', '<sample> & "quoted"\nnext line');
  assert.equal(addEntry(entries, {...incident('A'), title: 'new title'}), entries);
  assert.deepEqual(entries.map(x => x.id), ['A', 'B']);
  assert.equal(entries[0].title, 'Incident A');
  assert.equal(editNote(entries, 'A', 'x'.repeat(1001)), entries);
  let raw;
  assert.equal(writeTriage({setItem: (key, value) => { assert.equal(key, triageKey); raw = value; }}, entries), '');
  assert.deepEqual(readTriage(storage(raw)).entries, entries);
  entries = removeEntry(entries, 'A'); entries = addEntry(entries, incident('A'));
  assert.deepEqual(entries.map(x => x.id), ['B', 'A']); assert.equal(entries[1].note, '');
});
test('malformed persistence salvages valid entries and reports limits; read/write errors retain visit state', () => {
  const current = addEntry([], incident('CURRENT'));
  for (const raw of ['{', 'null', '[]', '{"version":2,"entries":[]}']) {
    const loaded = readTriage(storage(raw), current); assert.equal(loaded.entries, current); assert.match(loaded.message, /could not be read/);
  }
  const entry = addEntry([], incident('A'))[0];
  const loaded = readTriage(storage(JSON.stringify({version: 1, entries: [null, entry, {...entry, note: 'duplicate'}, {...entry, id: 'B', note: 7}, {...entry, id: 'C', note: 'x'.repeat(1001)}, {...entry, id: 'D'}]})));
  assert.deepEqual(loaded.entries.map(x => x.id), ['A', 'D']); assert.match(loaded.message, /invalid or duplicated/);
  assert.equal(readTriage(storage(JSON.stringify({version: 1, entries: []})), current).entries, current);
  const unavailable = {getItem() { throw Error('read denied'); }, setItem() { throw Error('quota'); }};
  assert.equal(readTriage(unavailable, current).entries, current);
  assert.match(writeTriage(unavailable, current), /could not be saved/); assert.equal(current[0].id, 'CURRENT');
});
test('only currently owned loaded full details authorize adding; close, replacement and intent invalidate writers', () => {
  let s = createState(), entries = [];
  s = transition(s, {type: 'detail:select', id: 'A'}); s = transition(s, {type: 'detail:start'}); const old = s.detail.token;
  assert.equal(ownedDetail(s, old), false);
  s = transition(s, {type: 'detail:success', token: old, data: incident('A')}); assert.equal(ownedDetail(s, old), true);
  entries = addEntry(entries, s.detail.data); entries = editNote(entries, 'A', 'keep');
  for (const event of [{type: 'detail:close'}, {type: 'detail:select', id: 'B'}, {type: 'intent', patch: {q: 'new'}}]) {
    s = transition(s, event); assert.equal(ownedDetail(s, old), false);
    for (const type of ['detail:success', 'detail:failure', 'detail:finish']) assert.equal(transition(s, {type, token: old, data: incident('A'), error: 'late'}), s);
  }
  assert.equal(entries[0].note, 'keep');
  s = transition(s, {type: 'result:start'}); s = transition(s, {type: 'result:failure', token: s.resultOp.token, error: 'query failed'});
  entries = removeEntry(entries, 'A'); assert.equal(announcement(s), 'query failed'); assert.deepEqual(entries, []);
});
test('overview retains backend measures, ordering and unavailable averages without inventing absent data', () => {
  assert.equal(serviceOverview({total: 0}), null);
  assert.deepEqual(serviceOverview({services: []}), []);
  const services = [
    {service: 'Search', incidentCount: 3, unresolvedCount: 2, highSeverityCount: 1, averageResolutionHours: 1.5},
    {service: 'Billing', incidentCount: 2, unresolvedCount: 2, highSeverityCount: 2, averageResolutionHours: null},
    {service: 'Accounts', incidentCount: 8, unresolvedCount: 5, highSeverityCount: 4, averageResolutionHours: 0}
  ];
  const sorted = serviceOverview({services}); assert.deepEqual(sorted.map(x => x.service), ['Accounts', 'Billing', 'Search']);
  assert.equal(sorted[1].averageResolutionHours, null); assert.equal(services[0].service, 'Search');
  assert.equal(selectionLabel(createState().intent), 'All incidents');
  assert.match(selectionLabel({...createState().intent, q: '<sample>', status: ['in_progress']}), /Search: <sample> · status: in progress/);
});
test('service metadata is owned with rows through history, saved recall, failed retry and stale cleanup', () => {
  const data = {page: 1, total: 1, totalPages: 1, items: [incident('A')], summary: {services: [{service: 'Billing', unresolvedCount: 1}]}};
  let s = transition(createState(), {type: 'result:start'});
  s = transition(s, {type: 'result:success', token: s.resultOp.token, data}); const snapshot = s.result;
  for (const event of [{type: 'address', intent: {q: 'other'}}, {type: 'restore', view: {q: 'other'}}]) {
    s = transition(s, {type: 'result:start'}); const old = s.resultOp.token;
    s = transition(s, event); s = transition(s, {type: 'result:start'});
    s = transition(s, {type: 'result:failure', token: s.resultOp.token, error: 'current failure'});
    for (const type of ['result:success', 'result:failure', 'result:finish']) assert.equal(transition(s, {type, token: old, data, error: 'old failure'}), s);
    assert.equal(s.result, snapshot); assert.equal(s.result.data.summary.services, data.summary.services);
    assert.equal(announcement(s), 'current failure');
    const failed = s.resultOp.token; s = transition(s, {type: 'result:start'});
    assert.equal(transition(s, {type: 'result:finish', token: failed}), s); assert.equal(s.resultOp.pending, true);
  }
});
