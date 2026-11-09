#!/usr/bin/env python3
r"""Re-apply this build's changes to index.html after an artifact sync. Safe to run repeatedly.

  1. Escape also closes the concierge popup
  2. guest-host.js in <head> (guest from the subdomain: benjamin.ninasevo.co)
  3. rsvp.js before </body> (RSVPs + guest list from the Google Sheet)
  4. images inside popups / hidden layers load only when needed (loading="lazy")
  5. old mobile venue line-break typo  content:"\\A"  ->  content:"\A"
  7. page title + social share image (share.jpg)
  6. favicon / home-screen icon (favicon.ico, favicon-32.png, apple-touch-icon.png)
"""
import os, re, sys

p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "index.html")
s = orig = open(p, encoding="utf-8").read()
notes = []

# 1
esc = 'modal.classList.remove("open");}});'
if esc in s and 'cz.classList.remove("open");}});' not in s:
    s = s.replace(esc, 'modal.classList.remove("open");cz.classList.remove("open");}});')
# 2
if "guest-host.js" not in s:
    s = s.replace("</head>", '<script src="guest-host.js"></script>\n</head>', 1)
# 3
if "rsvp.js" not in s:
    s = s.replace("</body>", '<script src="rsvp.js"></script>\n</body>', 1)
# 4 every <img> except the logo (visible straight away)
def lazy(m):
    tag = m.group(0)
    if "loading=" in tag or "gate-logo" in tag:
        return tag
    return tag[:4] + ' loading="lazy" decoding="async"' + tag[4:]
s = re.sub(r"<img\b[^>]*>", lazy, s)
# 5
s = s.replace('content:"\\\\A";white-space:pre}', 'content:"\\A";white-space:pre}')
# 6 favicon (green janur logo)
ICONS = ('<link rel="icon" href="favicon.ico" sizes="any">\n'
         '<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">\n'
         '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n')
if 'href="favicon.ico"' not in s:
    s = re.sub(r'<link[^>]*rel="(?:shortcut )?icon"[^>]*>\s*', '', s)
    s = s.replace("</head>", ICONS + "</head>", 1)

# 7 page title + social share preview (WhatsApp, iMessage, Facebook, ...)
TITLE = "The Wedding of Nina &amp; Sevo - Save the Date"
s = re.sub(r"<title>.*?</title>", "<title>" + TITLE + "</title>", s, count=1, flags=re.S)
SHARE = ('<meta name="description" content="30 – 31 July 2027 · Plataran Borobudur, Yogyakarta, Indonesia">\n'
         '<meta property="og:type" content="website">\n'
         '<meta property="og:site_name" content="Nina &amp; Sevo">\n'
         '<meta property="og:title" content="' + TITLE + '">\n'
         '<meta property="og:description" content="30 – 31 July 2027 · Plataran Borobudur, Yogyakarta, Indonesia">\n'
         '<meta property="og:image" content="https://www.ninasevo.co/share.jpg">\n'
         '<meta property="og:image:width" content="1200">\n'
         '<meta property="og:image:height" content="630">\n'
         '<meta property="og:image:alt" content="Pencil drawing of a terrace overlooking the misty jungle and mountains near Borobudur">\n'
         '<meta name="twitter:card" content="summary_large_image">\n'
         '<meta name="twitter:title" content="' + TITLE + '">\n'
         '<meta name="twitter:image" content="https://www.ninasevo.co/share.jpg">\n')
if 'property="og:image"' not in s:
    s = s.replace("</head>", SHARE + "</head>", 1)

# iPhone fix: iOS ignores audio.volume (always 1), so a volume-based fade-out never ends and the
# music never stops. Stop after the fade's step count as well.
FADE_OLD = "if(audio.volume<=0){ clearInterval(fadeTimer); if(cb) cb(); }"
FADE_NEW = "if(audio.volume<=0||++fadeN>=steps){ clearInterval(fadeTimer); if(cb) cb(); }"
if FADE_OLD in s:
    s = s.replace(FADE_OLD, FADE_NEW).replace("let el=null, on=false, fadeTimer=null;",
                                              "let el=null, on=false, fadeTimer=null, fadeN=0;")
    s = s.replace("const steps=40, dt=dur*1000/steps, dv=audio.volume/steps;",
                  "const steps=40, dt=dur*1000/steps, dv=audio.volume/steps; fadeN=0;")
    if "fadeTimer=null, fadeN=0;" not in s or "dv=audio.volume/steps; fadeN=0;" not in s:
        notes.append("WARNING: iPhone sound fade-out fix only partly applied")

# sanity checks the sync relies on
for needle in ("let db", "let guest", "const guestId", "function nameFromId", "function showGuest", 'db.doc("rsvps/"'):
    if needle not in s:
        notes.append(f"WARNING: index.html no longer contains `{needle}` - rsvp.js may need adapting")
if 'cz.classList.remove("open")' not in s:
    notes.append("WARNING: could not patch the Escape handler")

if s != orig:
    open(p, "w", encoding="utf-8").write(s)
    print("index.html patched")
else:
    print("index.html already up to date")
for n in notes:
    print(n, file=sys.stderr)
sys.exit(1 if notes else 0)
