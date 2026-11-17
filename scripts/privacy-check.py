#!/usr/bin/env python3
"""Fails when a package carries the builder's personal data.

Usage: scripts/privacy-check.py <file or directory>...

Looks through every file (and every file inside .zip, .apk, .tpk, .wgt and .ipa archives,
nested ones included) for what identifies whoever built it, read from this machine at run time
so that none of it is written in the repo:

- the home directory ($HOME) and the user name ($USER, when it is 4 characters or longer);
- git's user.name and user.email;
- REEL_PRIVATE_WORDS: more words to look for, comma-separated (e.g. in the git-ignored .env).

Also the metadata an archive keeps of the machine it was made on: owners (a zip's Unix UID/GID
extra fields, a tar's user and group names other than root), and macOS's extended attributes and
resource forks (__MACOSX/, ._ files).

Prints each hit with the file and what was found, and exits 1 if there is any.
"""
import io
import os
import subprocess
import sys
import tarfile
import zipfile

ARCHIVES = (".zip", ".apk", ".tpk", ".wgt", ".ipa", ".aab", ".jar")
TARS = (".tar", ".tar.gz", ".tgz", ".tar.xz")
# Zip extra fields that carry owners: Info-ZIP's Unix (0x7875, 0x5855, 0x7855).
OWNER_FIELDS = (0x7875, 0x5855, 0x7855)


def extra_ids(extra):
    ids, i = [], 0
    while i + 4 <= len(extra):
        tag, size = int.from_bytes(extra[i:i + 2], "little"), int.from_bytes(extra[i + 2:i + 4], "little")
        ids.append(tag)
        i += 4 + size
    return ids


def apple_junk(name):
    base = name.rstrip("/").rsplit("/", 1)[-1]
    return name.startswith("__MACOSX/") or base.startswith("._")


def git(key):
    try:
        return subprocess.run(["git", "config", "--get", key], capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def needles():
    name = git("user.name")
    words = {os.environ.get("HOME", ""), name, git("user.email")}
    # Each part of the name on its own too (a first name in a certificate's subject).
    words.update(part for part in name.split() if len(part) >= 5)
    user = os.environ.get("USER", "")
    if len(user) >= 4:
        words.add(user)
    words.update(w.strip() for w in os.environ.get("REEL_PRIVATE_WORDS", "").split(","))
    words = {w for w in words if len(w) >= 4 and w not in ("/root", "/home")}
    return sorted({w.lower().encode() for w in words})


def scan(name, data, found, words):
    if name.lower().endswith(ARCHIVES):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for info in z.infolist():
                    if any(t in OWNER_FIELDS for t in extra_ids(info.extra)):
                        found.append((f"{name}!{info.filename}", "meta:owner", 1))
                    if apple_junk(info.filename):
                        found.append((f"{name}!{info.filename}", "meta:apple", 1))
                    if not info.is_dir():
                        scan(f"{name}!{info.filename}", z.read(info), found, words)
            return
        except zipfile.BadZipFile:
            pass
    if name.lower().endswith(TARS):
        try:
            with tarfile.open(fileobj=io.BytesIO(data)) as t:
                for m in t.getmembers():
                    if (m.uname or "root") != "root" or (m.gname or "root") not in ("root", "wheel"):
                        found.append((f"{name}!{m.name}", "meta:owner", 1))
                    if apple_junk(m.name):
                        found.append((f"{name}!{m.name}", "meta:apple", 1))
                    if m.isfile():
                        scan(f"{name}!{m.name}", t.extractfile(m).read(), found, words)
            return
        except tarfile.TarError:
            pass
    low = data.lower()
    for w in words:
        n = low.count(w)
        if n:
            found.append((name, w.decode(), n))


def main(paths):
    if not paths:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    words = needles()
    found = []
    for root in paths:
        files = [root] if os.path.isfile(root) else [os.path.join(d, f) for d, _, fs in os.walk(root) for f in fs]
        for f in files:
            if os.path.islink(f):
                continue
            with open(f, "rb") as h:
                scan(f, h.read(), found, words)
    for name, what, n in found:
        # What was found is named by its kind, so the log does not repeat it.
        kind = what if what.startswith("meta:") else "home directory" if what.startswith("/") else "personal word"
        print(f"privacy-check: {name}: {kind} ({len(what)} chars) x{n}", file=sys.stderr)
    if found:
        print(f"privacy-check: {len(found)} file(s) carry personal data", file=sys.stderr)
        return 1
    print(f"privacy-check: clean ({len(words)} words checked)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
