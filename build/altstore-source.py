#!/usr/bin/env python3
"""The AltStore / SideStore source of a release: altstore.json, listing that release's iOS .ipa.

Usage: build/altstore-source.py <reel-ios.ipa> <version> [--repo <owner/name>] [-o <altstore.json>]

A viewer adds the source once, as releases/latest/download/altstore.json (README.md), and AltStore
or SideStore installs reel from it, signs it with the viewer's Apple ID and offers each new
release's .ipa as an update. build/publish-release.sh writes it into every release beside the
.ipa (docs/releasing.md).

The format is AltStore's (faq.altstore.io, "Make a Source"). What AltStore checks against the
.ipa is read from the .ipa itself, so the two always match: the bundle id, the version and build
(CFBundleShortVersionString, CFBundleVersion; they must be <version>, app/nsh.json's), the
lowest iOS, the entitlements its code signature carries and its Info.plist's *UsageDescription
texts (AltStore refuses to install an app whose permissions the source does not list). The
version's notes are its CHANGELOG.md section; only this version is listed (AltStore offers the
first one; older ones serve only devices the newest does not support, and every build has the
same lowest iOS). --repo: the releases' repository (default exzos28/reel).
"""
import argparse
import hashlib
import json
import pathlib
import plistlib
import re
import struct
import sys
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent
CHANGELOG = REPO / "CHANGELOG.md"
# The 1024 px app icon (app/nsh.json's "ios"), read from the release's tag: it stays as it was.
ICON = "app/icon/icon@2x.png"
TINT = "#E5383B"  # reel's red (app/nsh.json's theme)
DEVELOPER = "exzos"  # the licensor (NOTICE)
SUBTITLE = "Pick a film. It plays in seconds."
DESCRIPTION = (
    "Films and series from torrents, on your iPhone and iPad. reel streams a torrent as it "
    "arrives: it fetches the start of a film and plays, up to 4K and HDR, with no ads.\n\n"
    "It searches the Torznab source you enter in Settings (your own Jackett, Prowlarr or "
    "JacRed); reel comes with no sources of its own.\n\n"
    "Free for any noncommercial use (PolyForm Noncommercial 1.0.0)."
)
SOURCE_DESCRIPTION = (
    "reel for iPhone and iPad, from its GitHub releases. AltStore or SideStore installs it "
    "with your Apple ID and offers each new version as an update."
)
# AltStore leaves these out of the comparison: every signed app has them.
IGNORED_ENTITLEMENTS = {"application-identifier", "com.apple.developer.team-identifier"}


def die(msg):
    print(f"altstore-source.py: {msg}", file=sys.stderr)
    sys.exit(1)


def signature_entitlements(binary):
    """The entitlements' keys in a Mach-O's code signature (every slice of a fat binary)."""
    u32 = lambda fmt, at: struct.unpack_from(fmt, binary, at)  # noqa: E731
    slices = [0]
    if binary[:4] == b"\xca\xfe\xba\xbe":  # fat: nfat_arch, then (cputype, subtype, offset, size, align)
        (n,) = u32(">I", 4)
        slices = [u32(">I", 8 + 20 * i + 8)[0] for i in range(n)]
    keys = set()
    for base in slices:
        magic, _, _, _, ncmds = u32("<IIIII", base)
        if magic not in (0xFEEDFACF, 0xFEEDFACE):
            die("the app's executable is not a Mach-O")
        at = base + (32 if magic == 0xFEEDFACF else 28)
        for _ in range(ncmds):
            cmd, size = u32("<II", at)
            if cmd == 0x1D:  # LC_CODE_SIGNATURE: a SuperBlob of (type, offset) slots, big-endian
                (dataoff,) = u32("<I", at + 8)
                blob = base + dataoff
                sb_magic, _, count = u32(">III", blob)
                for i in range(count if sb_magic == 0xFADE0CC0 else 0):
                    slot, offset = u32(">II", blob + 12 + 8 * i)
                    e_magic, length = u32(">II", blob + offset)
                    if slot == 5 and e_magic == 0xFADE7171:  # the entitlements' XML plist
                        ents = plistlib.loads(binary[blob + offset + 8:blob + offset + length])
                        if ents.get("get-task-allow") is False:
                            ents.pop("get-task-allow")
                        keys.update(ents)
            at += size
    return keys


def read_ipa(path):
    """The app's Info.plist, and the entitlements and privacy texts of it and its extensions."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        apps = sorted({m.group(1) for n in names if (m := re.match(r"(Payload/[^/]+\.app)/", n))})
        if len(apps) != 1:
            die(f"{path}: expected one Payload/*.app, found {len(apps)}")
        app = apps[0]
        bundles = [app] + sorted({m.group(1) for n in names if (m := re.match(rf"({re.escape(app)}/PlugIns/[^/]+\.appex)/", n))})
        info, entitlements, privacy = None, set(), {}
        for bundle in bundles:
            plist = plistlib.loads(z.read(f"{bundle}/Info.plist"))
            info = info or plist
            entitlements |= signature_entitlements(z.read(f"{bundle}/{plist['CFBundleExecutable']}"))
            privacy.update({k: v for k, v in plist.items() if k.endswith("UsageDescription")})
    return info, sorted(entitlements - IGNORED_ENTITLEMENTS), dict(sorted(privacy.items()))


def changelog(version):
    """The version's date and its CHANGELOG.md section (build/changes.py writes both)."""
    text = CHANGELOG.read_text() if CHANGELOG.exists() else ""
    m = re.search(rf"^## {re.escape(version)} \((\d{{4}}-\d\d-\d\d)\)\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m or not m.group(2).strip():
        die(f"CHANGELOG.md has no dated section for {version}")
    return m.group(1), m.group(2).strip()


def source(ipa, version, repo):
    info, entitlements, privacy = read_ipa(ipa)
    if info.get("CFBundleShortVersionString") != version:
        die(f"{ipa}: CFBundleShortVersionString is {info.get('CFBundleShortVersionString')!r}, not {version!r} (an .ipa of another version?)")
    for key in ("CFBundleIdentifier", "CFBundleVersion", "MinimumOSVersion"):
        if not info.get(key):
            die(f"{ipa}: no {key} in its Info.plist")
    date, notes = changelog(version)
    data = pathlib.Path(ipa).read_bytes()
    bundle_id = info["CFBundleIdentifier"]
    icon = f"https://raw.githubusercontent.com/{repo}/v{version}/{ICON}"
    name = info.get("CFBundleDisplayName") or info.get("CFBundleName") or "reel"
    return {
        "name": name,
        "identifier": f"{bundle_id}.source",
        "subtitle": SUBTITLE,
        "description": SOURCE_DESCRIPTION,
        "iconURL": icon,
        "website": f"https://github.com/{repo}",
        "tintColor": TINT,
        "apps": [
            {
                "name": name,
                "bundleIdentifier": bundle_id,
                "developerName": DEVELOPER,
                "subtitle": SUBTITLE,
                "localizedDescription": DESCRIPTION,
                "iconURL": icon,
                "tintColor": TINT,
                "category": "entertainment",
                "versions": [
                    {
                        "version": info["CFBundleShortVersionString"],
                        "buildVersion": str(info["CFBundleVersion"]),
                        "date": f"{date}T00:00:00Z",
                        "localizedDescription": notes,
                        "downloadURL": f"https://github.com/{repo}/releases/download/v{version}/reel-ios.ipa",
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "minOSVersion": info["MinimumOSVersion"],
                    }
                ],
                "appPermissions": {"entitlements": entitlements, "privacy": privacy},
            }
        ],
        "news": [],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("ipa")
    p.add_argument("version")
    p.add_argument("--repo", default="exzos28/reel")
    p.add_argument("-o", "--out")
    a = p.parse_args()
    text = json.dumps(source(a.ipa, a.version.removeprefix("v"), a.repo), indent=2, ensure_ascii=False) + "\n"
    if a.out:
        pathlib.Path(a.out).write_text(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
