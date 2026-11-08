#!/usr/bin/env python3
r"""Re-apply this build's changes to index.html after an artifact sync. Safe to run repeatedly.

  1. Escape also closes the concierge popup
  2. guest-host.js in <head> (guest from the subdomain: benjamin.ninasevo.co)
  3. rsvp.js before </body> (RSVPs + guest list from the Google Sheet)
  4. images inside popups / hidden layers load only when needed (loading="lazy")
  5. old mobile venue line-break typo  content:"\\A"  ->  content:"\A"
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
