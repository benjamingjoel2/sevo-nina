/**
 * Nina & Sevo — RSVP backend (Google Apps Script, bound to the RSVP Google Sheet)
 *
 * What it does
 *  - POST from the website: saves the RSVP in the "RSVPs" tab (one row per guest; a second reply updates it)
 *    and sends a WhatsApp message to Sevo and Nina through CallMeBot.
 *  - GET ?id=<guest-id>: returns that guest's details from the "Guests" tab, so the site greets them by name.
 *
 * Setup (once): see rsvp-setup.md in the project. The CallMeBot keys live in
 * Project Settings → Script properties, never in this code:
 *   SEVO_PHONE  e.g. +6281234567890      SEVO_KEY  (from CallMeBot)
 *   NINA_PHONE  e.g. +4412345678901      NINA_KEY  (from CallMeBot)
 *   NOTIFY_EMAILS  optional, e.g. sevo@example.com, nina@example.com  (email alerts too)
 */

const RSVP_SHEET = 'RSVPs';
const GUEST_SHEET = 'Guests';
const RSVP_HEADERS = ['Guest ID', 'Names', 'Attending', 'Guests', 'Message', 'First reply', 'Last updated', 'Replies', 'Known guest'];
const GUEST_HEADERS = ['id', 'names', 'seats', 'international', 'side', 'message', 'ninaNote', 'sevoNote'];

/** Run this once from the editor (select "setup" → Run) to create both tabs with headers. */
function setup() {
  sheet_(RSVP_SHEET, RSVP_HEADERS);
  const g = sheet_(GUEST_SHEET, GUEST_HEADERS);
  if (g.getLastRow() < 2) g.appendRow(['anna-ben', 'Anna and Ben', 2, 'yes', 'nina', '', '', '']);
}

/** Run this from the editor to check both WhatsApp numbers receive a message. */
function testWhatsApp() {
  notify_('✅ Nina & Sevo RSVP alerts are connected.');  // also sends the test email if NOTIFY_EMAILS is set
}

function doGet(e) {
  const id = clean_(e && e.parameter && e.parameter.id).toLowerCase();
  if (!id) return json_({ ok: false, error: 'missing id' });
  const g = findGuest_(id);
  return json_(g ? { ok: true, guest: g } : { ok: false, error: 'not found' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }

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
