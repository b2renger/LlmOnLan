"""Check every large file of a downloaded repo against the sha256 Hugging Face publishes for it.
   python verify_sha.py <repo> <local dir>   -> prints OK or each mismatch / missing file; exit 1 on any problem."""
import hashlib, json, os, sys, urllib.request

repo, local = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}?blobs=true", timeout=60) as r:
    meta = json.load(r)
bad = 0
checked = 0
for s in meta.get("siblings", []):
    lfs = s.get("lfs")
    if not lfs:
        continue
    path = os.path.join(local, s["rfilename"])
    if not os.path.exists(path):
        print(f"[sha] MISSING {s['rfilename']}"); bad += 1; continue
    if os.path.getsize(path) != lfs["size"]:
        print(f"[sha] SIZE {s['rfilename']}: {os.path.getsize(path)} != {lfs['size']}"); bad += 1; continue
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(16 * 1024 * 1024), b""):
            h.update(chunk)
    if h.hexdigest() != lfs["sha256"]:
        print(f"[sha] MISMATCH {s['rfilename']}"); bad += 1
    checked += 1
print(f"[sha] {repo}: {checked} large files checked, {bad} problem(s)" + ("" if bad else " - OK"))
sys.exit(1 if bad else 0)
