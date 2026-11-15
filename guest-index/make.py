#!/usr/bin/env python3
"""Build guests.json - the hosted list of guest images the app's updater reads
(Bootbox/web/js/apps/emulator.js, PACK_INDEX_URL).

  python3 guest-index/make.py            # rewrite guest-index/guests.json from entries.json
  gh release upload guest-index guest-index/guests.json --clobber

entries.json holds one record per published image: guest key, version, api level, release
URL, cached file name, compressed size, and the load.js that was generated with the image
(its file table is copied into the list). `api` is the level of app/engine support an image
needs: an app boots the newest image whose api lies inside its guest's pack.api range, so
raise it whenever an image needs something older apps do not have.
"""
import json, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
entries = json.load(open(os.path.join(here, "entries.json")))
out = {"format": 1, "guests": {}}
for e in entries:
    src = open(os.path.join(root, e["loadjs"])).read()
    m = re.search(r'\{"files": \[.*?\], "remote_package_size": (\d+)\}', src)
    meta = json.loads(m.group(0))
    rec = {"v": e["v"], "api": e["api"], "url": e["url"], "name": e["name"], "size": e["size"],
           "mb": round(e["size"] / 1048576), "rawSize": meta["remote_package_size"], "files": meta["files"]}
    assert rec["name"].endswith("-%d.data.gz" % rec["rawSize"]), "cache name must carry the expanded size"
    end = 0
    for f in sorted(meta["files"], key=lambda f: f["start"]):
        assert f["start"] == end and f["filename"].startswith("/pack/"), f
        end = f["end"]
    assert end == rec["rawSize"]
    if e.get("args"): rec["args"] = e["args"]
    if e.get("notes"): rec["notes"] = e["notes"]
    out["guests"].setdefault(e["guest"], []).append(rec)
json.dump(out, open(os.path.join(here, "guests.json"), "w"), indent=1)
print({k: [r["v"] for r in v] for k, v in out["guests"].items()})
