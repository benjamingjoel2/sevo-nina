#!/usr/bin/env python3
"""Guest-list sync between the "Wedding Guest List — Nina & Sevo" artifact and the RSVP Google Sheet.

Usage (Claude runs this from the scheduled sync):
  1. Export the artifact's `guests` collection with ArtifactData (action list, out_dir=<DIR>),
     which writes <DIR>/guests/<id>.json files.
  2. python3 tools/sync-guests.py <DIR>
     - pushes the guest list to the Sheet's Guests tab (adds / updates / removes)
     - reads the RSVPs back and writes <DIR>/rsvp-updates.json: the guests whose `rsvp` field in the
       artifact should change (true = attending, false = declined).
  3. Apply rsvp-updates.json to the artifact with one ArtifactData batch of `update` writes, each pinned
     with if_version (the version ArtifactData's list/get reported for that doc).

The shared secret is read from tools/sync-key (same value as the Sheet's SYNC_KEY script property).
"""
import glob, json, os, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RSVP_JS = os.path.join(ROOT, "rsvp.js")
KEY_FILE = os.path.join(ROOT, "tools", "sync-key")


def sheet_url():
    for line in open(RSVP_JS, encoding="utf-8"):
        if "const SHEET_URL" in line:
            return line.split('"')[1]
    sys.exit("no SHEET_URL in rsvp.js")


def call(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main(export_dir):
    key = open(KEY_FILE).read().strip()
    url = sheet_url()
    docs = {}
    for f in sorted(glob.glob(os.path.join(export_dir, "guests", "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        data = d.get("data", d) if isinstance(d, dict) else {}
        gid = os.path.basename(f)[:-5]
        docs[gid] = {"data": data}
    if not docs:
        sys.exit("no guests found in export - refusing to sync an empty list")

    guests = [{"id": gid, "names": v["data"].get("names", ""), "seats": v["data"].get("seats", 1),
               "international": v["data"].get("international", True) is not False,
               "side": v["data"].get("side", ""), "group": v["data"].get("group", "")}
              for gid, v in docs.items()]
    res = call(url, {"action": "syncGuests", "key": key, "guests": guests})
    print("guests -> sheet:", res)
    if not res.get("ok"):
        sys.exit(1)

    rs = call(url + "?" + urllib.parse.urlencode({"action": "rsvps", "key": key}))
    if not rs.get("ok"):
        sys.exit(f"rsvps: {rs}")
    updates = {}
    for r in rs["rsvps"]:
        gid = r["id"]
        if gid in docs and docs[gid]["data"].get("rsvp") is not r["attending"]:
            updates[gid] = {"rsvp": r["attending"]}
    json.dump(updates, open(os.path.join(export_dir, "rsvp-updates.json"), "w"), indent=1)
    print(f"rsvps in sheet: {len(rs['rsvps'])}; artifact rsvp fields to update: {len(updates)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
