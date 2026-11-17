#!/usr/bin/env python3
"""Fails when a package carries the builder's personal data.

Usage: scripts/privacy-check.py <file or directory>...

Looks through every file (and every file inside .zip, .apk, .tpk, .wgt and .ipa archives,
nested ones included) for what identifies whoever built it, read from this machine at run time
so that none of it is written in the repo:

- the home directory ($HOME) and the user name ($USER, when it is 4 characters or longer);
- git's user.name and user.email;
- REEL_PRIVATE_WORDS: more words to look for, comma-separated (e.g. in the git-ignored .env).

Prints each hit with the file and what was found, and exits 1 if there is any.
"""
import io
import os
import subprocess
import sys
import zipfile

ARCHIVES = (".zip", ".apk", ".tpk", ".wgt", ".ipa", ".aab", ".jar")


def git(key):
    try:
        return subprocess.run(["git", "config", "--get", key], capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def needles():
    words = {os.environ.get("HOME", ""), git("user.name"), git("user.email")}
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
                    if not info.is_dir():
                        scan(f"{name}!{info.filename}", z.read(info), found, words)
            return
        except zipfile.BadZipFile:
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
        kind = "home directory" if what.startswith("/") else "personal word"
        print(f"privacy-check: {name}: {kind} ({len(what)} chars) x{n}", file=sys.stderr)
    if found:
        print(f"privacy-check: {len(found)} file(s) carry personal data", file=sys.stderr)
        return 1
    print(f"privacy-check: clean ({len(words)} words checked)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
