#!/usr/bin/env python3
"""Zip archives without the builder's metadata.

Usage:
  scripts/zip-clean.py make <dir> <out.zip>   zips <dir> (its name as the top folder)
  scripts/zip-clean.py rewrite <archive>      rewrites a zip, .apk or .ipa in place

What is left out: owners (Unix UID/GID extra fields), extended attributes and resource forks
(__MACOSX/, ._ files), the extra fields' own times, and the files' times: every entry gets the
same time, SOURCE_DATE_EPOCH (else the last commit's, else 1980-01-01). What stays: names,
contents, permissions and symlinks, and each entry's compression as it was (an APK keeps its
native libraries and resources.arsc stored, as Android wants them; align and sign after this).
"""
import os
import stat
import subprocess
import sys
import time
import zipfile


def epoch():
    if os.environ.get("SOURCE_DATE_EPOCH"):
        return int(os.environ["SOURCE_DATE_EPOCH"])
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%ct"], capture_output=True, text=True, check=True)
        return int(out.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError):
        return 315532800  # 1980-01-01, zip's first


STAMP = time.gmtime(max(epoch(), 315532800))[:6]


def junk(name):
    base = name.rstrip("/").rsplit("/", 1)[-1]
    return name.startswith("__MACOSX/") or base.startswith("._") or base == ".DS_Store"


def info(name, mode, compress):
    z = zipfile.ZipInfo(name, date_time=STAMP)
    z.create_system = 3  # Unix: the permissions below mean what they say
    z.external_attr = (mode & 0xFFFF) << 16
    if name.endswith("/"):
        z.external_attr |= 0x10  # MS-DOS directory bit
    z.compress_type = compress
    z.extra = b""
    return z


def make(src, out):
    src = os.path.abspath(src.rstrip("/"))
    top = os.path.basename(src)
    with zipfile.ZipFile(out, "w") as z:
        for root, dirs, files in os.walk(src, followlinks=False):
            dirs.sort()
            rel = os.path.relpath(root, os.path.dirname(src))
            z.writestr(info(rel + "/", 0o40755, zipfile.ZIP_STORED), b"")
            for f in sorted(files + [d for d in dirs if os.path.islink(os.path.join(root, d))]):
                path = os.path.join(root, f)
                name = f"{rel}/{f}"
                if junk(name):
                    continue
                st = os.lstat(path)
                if stat.S_ISLNK(st.st_mode):
                    z.writestr(info(name, stat.S_IFLNK | 0o755, zipfile.ZIP_STORED), os.readlink(path))
                    continue
                mode = stat.S_IFREG | (0o755 if st.st_mode & 0o111 else 0o644)
                with open(path, "rb") as h:
                    z.writestr(info(name, mode, zipfile.ZIP_DEFLATED), h.read())
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
    _ = top


def rewrite(path):
    tmp = path + ".clean"
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w") as dst:
        for e in src.infolist():
            if junk(e.filename):
                continue
            mode = e.external_attr >> 16
            if not mode:
                mode = (stat.S_IFDIR | 0o755) if e.is_dir() else (stat.S_IFREG | 0o644)
            dst.writestr(info(e.filename, mode, e.compress_type), src.read(e))
    os.replace(tmp, path)


def main(argv):
    if len(argv) == 3 and argv[0] == "make":
        make(argv[1], argv[2])
    elif len(argv) == 2 and argv[0] == "rewrite":
        rewrite(argv[1])
    else:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
