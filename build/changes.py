#!/usr/bin/env python3
"""reel's changesets: what each PR changes for the viewer, gathered into a version.

A PR that changes what the viewer sees adds a file to .changes/ (any name, .md):

    ---
    bump: minor
    ---
    Saved films play offline on Windows.

`bump` is patch (fixes only), minor (something new) or major (docs/releasing.md); the text is one
line or a few, for the viewer, as it goes into CHANGELOG.md and the release's notes.

    build/changes.py status            what is pending and the version it makes
    build/changes.py apply             bumps app/nsh.json (version, build + 1), writes the section
                                       into CHANGELOG.md, removes the entries; prints the version
    build/changes.py notes <version>   that version's section of CHANGELOG.md (the release's notes)
    build/changes.py check <base>      fails when the commits since <base> change the app and add
                                       no entry (a PR's check; the no-changeset label skips it)
    build/changes.py version           app/nsh.json's version
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
CHANGES = REPO / ".changes"
NSH = REPO / "app" / "nsh.json"
CHANGELOG = REPO / "CHANGELOG.md"
BUMPS = ("patch", "minor", "major")
HEAD = "# Changelog\n\nWhat each version of reel changed for the viewer. Earlier versions: GitHub Releases.\n"

# What the viewer gets: the app and the TV's platform code. Tests and their stand-ins are not.
APP = ("app/", "platforms/")
NOT_APP = (re.compile(r"\.test\.tsx?$"), re.compile(r"^app/tests/"), re.compile(r"^app/testEngine\.ts$"))


def die(msg: str) -> None:
    print(f"changes.py: {msg}", file=sys.stderr)
    sys.exit(1)


def entries() -> list[tuple[pathlib.Path, str, str]]:
    """The pending entries: (file, bump, text), oldest name first."""
    out = []
    for f in sorted(CHANGES.glob("*.md")):
        if f.name == "README.md":
            continue
        m = re.match(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", f.read_text(), re.S)
        if not m:
            die(f"{f.relative_to(REPO)}: no front matter (---, bump: patch|minor|major, ---, then the text)")
        bump = dict(re.findall(r"^\s*(\w+)\s*:\s*(\S+)\s*$", m.group(1), re.M)).get("bump")
        if bump not in BUMPS:
            die(f"{f.relative_to(REPO)}: bump is {bump!r}, not one of {', '.join(BUMPS)}")
        text = " ".join(m.group(2).split())
        if not text:
            die(f"{f.relative_to(REPO)}: no text")
        out.append((f, bump, text))
    return out


def current() -> tuple[str, int]:
    nsh = json.loads(NSH.read_text())
    return nsh["version"], int(nsh["build"])


def next_version(version: str, bump: str) -> str:
    major, minor, patch = (int(x) for x in version.split("."))
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def biggest(es) -> str:
    return max((b for _, b, _ in es), key=BUMPS.index)


def status() -> None:
    es = entries()
    version, build = current()
    if not es:
        print(f"nothing pending; app/nsh.json is {version} (build {build})")
        return
    print(f"{len(es)} pending: {version} -> {next_version(version, biggest(es))} (build {build + 1})")
    for f, bump, text in es:
        print(f"  {bump:5} {text}  ({f.name})")


def apply() -> None:
    es = entries()
    if not es:
        die("nothing pending in .changes/")
    version, build = current()
    new = next_version(version, biggest(es))
    # Only the two values change: the rest of nsh.json keeps its layout.
    s = NSH.read_text()
    s, n1 = re.subn(r'("version"\s*:\s*)"[^"]*"', rf'\g<1>"{new}"', s, count=1)
    s, n2 = re.subn(r'("build"\s*:\s*)\d+', rf"\g<1>{build + 1}", s, count=1)
    if n1 != 1 or n2 != 1:
        die("app/nsh.json has no version or build to bump")
    NSH.write_text(s)

    lines = [f"## {new} ({datetime.date.today().isoformat()})", ""]
    for bump in reversed(BUMPS):  # the new things first, then the fixes
        lines += [f"- {text}" for _, b, text in es if b == bump]
    section = "\n".join(lines) + "\n"
    old = CHANGELOG.read_text() if CHANGELOG.exists() else HEAD
    rest = old[len(HEAD):] if old.startswith(HEAD) else old
    CHANGELOG.write_text(HEAD + "\n" + section + ("\n" + rest.lstrip("\n") if rest.strip() else ""))
    for f, _, _ in es:
        f.unlink()
    print(new)


def notes(version: str) -> None:
    version = version.removeprefix("v")
    text = CHANGELOG.read_text() if CHANGELOG.exists() else ""
    m = re.search(rf"^## {re.escape(version)}\b.*?\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m or not m.group(1).strip():
        die(f"CHANGELOG.md has no section for {version}")
    print(m.group(1).strip())


def check(base: str) -> None:
    def git(*args: str) -> list[str]:
        r = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
        if r.returncode:
            die(f"git {' '.join(args)}: {r.stderr.strip()}")
        return [x for x in r.stdout.splitlines() if x]

    changed = git("diff", "--name-only", f"{base}...HEAD")
    app = [f for f in changed if f.startswith(APP) and not any(p.search(f) for p in NOT_APP)]
    added = git("diff", "--name-only", "--diff-filter=A", f"{base}...HEAD", "--", ".changes/")
    entries()  # every entry there must read
    if app and not [f for f in added if f.endswith(".md") and not f.endswith("README.md")]:
        shown = "\n  ".join(app[:10]) + ("\n  ..." if len(app) > 10 else "")
        die(
            "this PR changes the app and adds no entry to .changes/ (.changes/README.md says how).\n"
            "If the viewer sees no difference, label the PR no-changeset.\n  " + shown
        )
    print(f"changes.py: ok ({len(app)} app files, {len(added)} entries added)")


def main() -> None:
    args = sys.argv[1:]
    cmd = args[0] if args else ""
    if cmd == "status" and len(args) == 1:
        status()
    elif cmd == "apply" and len(args) == 1:
        apply()
    elif cmd == "notes" and len(args) == 2:
        notes(args[1])
    elif cmd == "check" and len(args) == 2:
        check(args[1])
    elif cmd == "version" and len(args) == 1:
        print(current()[0])
    else:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
