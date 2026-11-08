/**
 * Nina & Sevo — RSVP backend (Google Apps Script, bound to the RSVP Google Sheet)
 *
 * What it does
 *  - POST from the website: saves the RSVP in the "RSVPs" tab (one row per guest; a second reply updates it)
 *    and sends a WhatsApp message to Sevo and Nina through CallMeBot.
 *  - GET ?id=<guest-id>: returns that guest's details from the "Guests" tab, so the site greets them by name.
 *  - Guests tab: type the names and the id + personal invitation link fill in automatically
 *    (or use the menu Wedding → Create missing links after pasting a whole list).
 *
 * Setup (once): see rsvp-setup.md in the project. The CallMeBot keys live in
 * Project Settings → Script properties, never in this code:
 *   SEVO_PHONE  e.g. +6281234567890      SEVO_KEY  (from CallMeBot)
 *   NINA_PHONE  e.g. +4412345678901      NINA_KEY  (from CallMeBot)
 *   NOTIFY_EMAILS  optional, e.g. sevo@example.com, nina@example.com  (email alerts too)
 *   SYNC_KEY    secret shared with Claude's guest-list sync (copies the "Wedding Guest List" artifact
 *               into the Guests tab and reads RSVPs back). Without it, the sync endpoints refuse everything.
 */

const RSVP_SHEET = 'RSVPs';
const GUEST_SHEET = 'Guests';
const RSVP_HEADERS = ['Guest ID', 'Names', 'Attending', 'Guests', 'Message', 'First reply', 'Last updated', 'Replies', 'Known guest'];
const GUEST_HEADERS = ['id', 'names', 'seats', 'international', 'side', 'group', 'message', 'ninaNote', 'sevoNote', 'link'];
const GUEST_DOMAIN = 'ninasevo.co';   // each guest's link: https://<id>.ninasevo.co
const RESERVED_IDS = ['www', 'mail', 'api', 'admin'];

/** Run this once from the editor (select "setup" → Run) to create both tabs with headers. */
function setup() {
  sheet_(RSVP_SHEET, RSVP_HEADERS);
  const g = sheet_(GUEST_SHEET, GUEST_HEADERS);
  if (g.getLastRow() < 2) g.appendRow(['', 'Anna and Ben', 2, 'yes', 'nina', '', '', '', '']);
  fillLinks_();
}

// ---------- invitation links

/** Adds the "Wedding" menu to the Sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Wedding').addItem('Create missing links', 'fillLinks_').addToUi();
}

/** Typing or pasting names in the Guests tab fills in the id and link straight away. */
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === GUEST_SHEET) fillLinks_();
}

/** For every guest row with names: makes an id if it has none, and writes the link. Existing ids are never changed. */
function fillLinks_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(GUEST_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  let linkCol = head.indexOf('link');
  if (linkCol === -1) { linkCol = head.length; sh.getRange(1, linkCol + 1).setValue('link').setFontWeight('bold'); }
  const idCol = head.indexOf('id'), nameCol = head.indexOf('names');
  const n = sh.getLastRow() - 1;
  const ids = sh.getRange(2, idCol + 1, n, 1).getValues().map(r => String(r[0]).trim().toLowerCase());
  const names = sh.getRange(2, nameCol + 1, n, 1).getValues().map(r => String(r[0]).trim());
  const links = sh.getRange(2, linkCol + 1, n, 1).getValues().map(r => String(r[0]));
  const taken = new Set(ids.filter(Boolean));
  let changed = false;
  for (let i = 0; i < n; i++) {
    if (!names[i] && !ids[i]) continue;
    if (!ids[i]) {
      let id;
      const base = slug_(names[i]);
      id = base;
      for (let k = 2; taken.has(id) || RESERVED_IDS.includes(id); k++) id = base + '-' + k;
      taken.add(id); ids[i] = id; changed = true;
    }
    const link = 'https://' + ids[i] + '.' + GUEST_DOMAIN;
    if (links[i] !== link) { links[i] = link; changed = true; }
  }
  if (!changed) return;
  sh.getRange(2, idCol + 1, n, 1).setValues(ids.map(v => [v]));
  sh.getRange(2, linkCol + 1, n, 1).setValues(links.map(v => [v]));
}

/** "Anna & Ben Müller" → "anna-ben-muller" */
function slug_(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/đ/g, 'd').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae')
    .replace(/&/g, ' ').replace(/\band\b/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'guest';
}

/** Run this from the editor to check both WhatsApp numbers receive a message. */
function testWhatsApp() {
  notify_('✅ Nina & Sevo RSVP alerts are connected.');  // also sends the test email if NOTIFY_EMAILS is set
}

function doGet(e) {
  const prm = (e && e.parameter) || {};
  if (prm.action === 'rsvps') {
    if (!syncKeyOk_(prm.key)) return json_({ ok: false, error: 'forbidden' });
    return json_({ ok: true, rsvps: listRsvps_() });
  }
  const id = clean_(prm.id).toLowerCase();
  if (!id) return json_({ ok: false, error: 'missing id' });
  const g = findGuest_(id);
  return json_(g ? { ok: true, guest: g } : { ok: false, error: 'not found' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (body.action === 'syncGuests') {
    if (!syncKeyOk_(body.key)) return json_({ ok: false, error: 'forbidden' });
    return json_(syncGuests_(body.guests));
  }

  const id = clean_(body.guestId).toLowerCase().slice(0, 80);
  if (!/^[a-z0-9-]+$/.test(id)) return json_({ ok: false, error: 'bad guest id' });
  const attending = body.attending === true;
  const guests = Math.max(0, Math.min(20, parseInt(body.guests, 10) || 0));
  const message = clean_(body.message).slice(0, 1000);
  const known = findGuest_(id);
  const names = known ? known.names : clean_(body.names).slice(0, 120);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let isUpdate = false;
  try {
    const sh = sheet_(RSVP_SHEET, RSVP_HEADERS);
    const now = new Date();
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const i = ids.indexOf(id);
    if (i === -1) {
      sh.appendRow([id, cell_(names), attending ? 'Yes' : 'No', guests, cell_(message), now, now, 1, known ? 'Yes' : 'No']);
    } else {
      isUpdate = true;
      const row = i + 2;
      const replies = Number(sh.getRange(row, 8).getValue()) || 1;
      sh.getRange(row, 2, 1, 8).setValues([[cell_(names), attending ? 'Yes' : 'No', guests, cell_(message), sh.getRange(row, 6).getValue(), now, replies + 1, known ? 'Yes' : 'No']]);
    }
  } finally {
    lock.releaseLock();
  }

  const text = (isUpdate ? '✏️ RSVP updated: ' : '💌 New RSVP: ') + names +
    (attending ? ' — attending, ' + guests + (guests === 1 ? ' guest' : ' guests') : ' — declining') +
    (message ? '\n"' + message + '"' : '') +
    (known ? '' : '\n(link id "' + id + '" is not on the guest list)');
  try { notify_(text); } catch (err) { console.error(err); } // the RSVP is already saved even if WhatsApp fails

  return json_({ ok: true });
}

// ---------- guest-list sync (from the "Wedding Guest List" artifact)

function syncKeyOk_(key) {
  const want = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  return !!want && want.length >= 20 && String(key || '') === want;
}

/** Makes the Guests tab match the list: adds new guests, updates changed ones, removes guests no longer on it.
 *  Columns the list doesn't have (message, ninaNote, sevoNote) are left as they are. */
function syncGuests_(guests) {
  if (!Array.isArray(guests) || guests.length === 0 || guests.length > 2000) return { ok: false, error: 'empty or invalid list' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(GUEST_SHEET, GUEST_HEADERS);
    let head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim());
    GUEST_HEADERS.forEach(h => { if (head.indexOf(h) === -1) { sh.getRange(1, head.length + 1).setValue(h).setFontWeight('bold'); head.push(h); } });
    const col = h => head.indexOf(h);
    const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues() : [];
    const byId = {};
    rows.forEach((r, i) => { const id = String(r[col('id')]).trim().toLowerCase(); if (id) byId[id] = i; });

    const incoming = {};
    guests.forEach(g => {
      const id = clean_(g && g.id).toLowerCase();
      if (!/^[a-z0-9-]{1,63}$/.test(id) || !clean_(g.names)) return;
      incoming[id] = g;
    });
    let added = 0, updated = 0, removed = 0;
    const out = [];
    rows.forEach(r => {
      const id = String(r[col('id')]).trim().toLowerCase();
      if (!id || !incoming[id]) { removed++; return; }
      const g = incoming[id], before = JSON.stringify(r);
      fillRow_(r, col, id, g);
      if (JSON.stringify(r) !== before) updated++;
      out.push(r);
      delete incoming[id];
    });
    Object.keys(incoming).forEach(id => {
      const r = head.map(() => '');
      fillRow_(r, col, id, incoming[id]);
      out.push(r); added++;
    });
    out.sort((a, b) => String(a[col('names')]).localeCompare(String(b[col('names')])));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (out.length) sh.getRange(2, 1, out.length, head.length).setValues(out);
    return { ok: true, total: out.length, added: added, updated: updated, removed: removed };
  } finally {
    lock.releaseLock();
  }
}

function fillRow_(r, col, id, g) {
  r[col('id')] = id;
  r[col('names')] = cell_(clean_(g.names).slice(0, 200));
  r[col('seats')] = Math.max(1, Math.min(20, parseInt(g.seats, 10) || 1));
  r[col('international')] = g.international === false ? 'no' : 'yes';
  r[col('side')] = ['nina', 'sevo', 'both'].includes(g.side) ? g.side : '';
  r[col('group')] = ['family', 'friends'].includes(g.group) ? g.group : '';
  r[col('link')] = 'https://' + id + '.' + GUEST_DOMAIN;
}

function listRsvps_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(RSVP_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, RSVP_HEADERS.length).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => ({ id: String(r[0]).trim().toLowerCase(), attending: String(r[2]).trim().toLowerCase() === 'yes',
                 guests: Number(r[3]) || 0, updated: r[6] ? new Date(r[6]).toISOString() : '' }));
}

// ---------- helpers

function notify_(text) {
  const p = PropertiesService.getScriptProperties();
  // Email alerts (comma-separated addresses in NOTIFY_EMAILS) — work straight away, no sign-up needed
  const emails = (p.getProperty('NOTIFY_EMAILS') || '').trim();
  if (emails) {
    try { MailApp.sendEmail(emails, text.split('\n')[0].slice(0, 120), text); } catch (err) { console.error('Email: ' + err); }
  }
  [['SEVO_PHONE', 'SEVO_KEY'], ['NINA_PHONE', 'NINA_KEY']].forEach(([ph, k]) => {
    const phone = p.getProperty(ph), key = p.getProperty(k);
    if (!phone || !key) return;
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone) +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) console.error('CallMeBot ' + ph + ': ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  });
}

function findGuest_(id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(GUEST_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = rows[0].map(h => String(h).trim());
  const col = name => head.indexOf(name);
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][col('id')]).trim().toLowerCase() !== id) continue;
    const v = name => col(name) >= 0 ? rows[r][col(name)] : '';
    const intl = String(v('international')).trim().toLowerCase();
    const g = { id: id, names: String(v('names')).trim() };
    if (v('seats') !== '') g.seats = Number(v('seats')) || undefined;
    if (intl) g.international = !['no', 'false', 'local', 'n'].includes(intl);
    ['side', 'message', 'ninaNote', 'sevoNote'].forEach(k => { if (String(v(k)).trim()) g[k] = String(v(k)).trim(); });
    return g.names ? g : null;
  }
  return null;
}

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function clean_(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim(); }

// stops a guest's text being read by Sheets as a formula
function cell_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
