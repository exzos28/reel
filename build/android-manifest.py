#!/usr/bin/env python3
"""reel's own parts of an Android APK's manifest and resources, which `nsh package` cannot add
(nsh.json's `android` section has only `targetSdk` and `usesCleartextTraffic`).

Usage: build/android-manifest.py <app.apk> <res dir> <aapt2> <android.jar>

Rewrites the APK in place (align and sign it after this):

- the activity takes the configuration changes NSH's leaves out (`touchscreen`, `mcc`/`mnc`,
  `colorMode`: a TV's HDR mode, `fontWeightAdjustment`: bold text, `assetsPaths`: a phone's
  wallpaper colours…) instead of being made again: NSH's activity starts its app over then, on
  Home, and the player stayed on "Starting";
- Android TV: the launcher's entry (`LEANBACK_LAUNCHER`), the banner (`android:banner`, from
  `<res dir>`: `drawable/banner`), and no touchscreen or leanback required, so the same APK
  installs on a phone and a TV;
- the launcher icon (`android:icon`, `android:roundIcon`): `<res dir>`'s adaptive `mipmap/icon`
  instead of NSH's square picture, which a launcher shrinks into a white circle;
- the app's links (nsh.json `schemes`) go to reel's own activity (`app.reel.views.Link`):
  NSH 0.6.1's Android runtime drops them (it does not read the schemes app.json claims);
- reel's code runs at the process's start (`app.reel.views.Start`, a provider): every activity
  gets reel's native views and the remote's keys (OK, media keys) from its first frame;
- `<res dir>`'s resources are linked with the APK's own (aapt2), its resource ids kept.

The manifest is edited as it is in the APK (Android's binary XML), so everything NSH wrote stays
as NSH wrote it.
"""
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

ANDROID = "http://schemas.android.com/apk/res/android"
NO = 0xFFFFFFFF

# Chunk types (frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h).
XML, STRING_POOL, RESOURCE_MAP = 0x0003, 0x0001, 0x0180
NS_START, NS_END, ELEMENT_START, ELEMENT_END, CDATA = 0x0100, 0x0101, 0x0102, 0x0103, 0x0104
UTF8 = 0x100

# Value types.
TYPE_REFERENCE, TYPE_STRING, TYPE_INT_HEX, TYPE_INT_BOOLEAN = 0x01, 0x03, 0x11, 0x12

# Attributes reel sets (android.R.attr), and the theme of an activity with nothing to show: the
# platform's public ids, checked against android.jar on every run (`check_ids`).
ATTR_NAME, ATTR_CONFIG_CHANGES, ATTR_REQUIRED, ATTR_BANNER = 0x01010003, 0x0101001F, 0x0101028E, 0x010103F2
ATTR_ICON, ATTR_ROUND_ICON = 0x01010002, 0x0101052C
ATTR_THEME, ATTR_EXPORTED, ATTR_EXCLUDE_FROM_RECENTS, ATTR_NO_HISTORY = 0x01010000, 0x01010010, 0x01010017, 0x0101022D
ATTR_AUTHORITIES = 0x01010018
THEME_NO_DISPLAY = 0x01030055  # @android:style/Theme.NoDisplay
TRUE = 0xFFFFFFFF
# reel's activity for the app's links (app/android/java/app/reel/views/Link.java).
LINK_ACTIVITY = "app.reel.views.Link"
# reel's provider that runs at the process's start (app/android/java/app/reel/views/Start.java).
START_PROVIDER = "app.reel.views.Start"

# android:configChanges values (ActivityInfo.CONFIG_*) the activity takes as well as NSH's.
CONFIG_CHANGES = {
    "mcc": 0x0001,
    "mnc": 0x0002,
    "touchscreen": 0x0008,
    "colorMode": 0x4000,
    "grammaticalGender": 0x8000,
    "fontWeightAdjustment": 0x10000000,
    "assetsPaths": 0x80000000,
}


class Attr:
    def __init__(self, ns, name, resid, raw, kind, data):
        self.ns, self.name, self.resid, self.raw, self.kind, self.data = ns, name, resid, raw, kind, data


class Node:
    """A namespace (kind NS_START: `prefix`, `uri`), an element (ELEMENT_START: `ns`, `name`,
    `attrs`) or text (CDATA), with its children and what its end chunk carries."""

    def __init__(self, kind, line, comment):
        self.kind, self.line, self.comment = kind, line, comment
        self.children, self.end_line, self.end_comment = [], line, None
        self.ns = self.name = self.prefix = self.uri = self.text = None
        self.attrs, self.special, self.cdata = [], (0, 0, 0), (0, 0)

    def elements(self, name=None):
        for c in self.children:
            if c.kind == ELEMENT_START and (name is None or c.name == name):
                yield c

    def attr(self, resid):
        return next((a for a in self.attrs if a.resid == resid), None)

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


def element(name, attrs, line):
    e = Node(ELEMENT_START, line, None)
    e.name, e.attrs = name, attrs
    return e


def android_name(value):
    return Attr(ANDROID, "name", ATTR_NAME, value, TYPE_STRING, value)


# --- Reading ---------------------------------------------------------------------------------


def read_strings(data, at):
    _, header, size, count, styles, flags, start, _ = struct.unpack_from("<HHIIIIII", data, at)
    if styles:
        raise ValueError("a string pool with styles")
    offsets = struct.unpack_from(f"<{count}I", data, at + header)
    out = []
    for off in offsets:
        p = at + start + off
        if flags & UTF8:
            n = data[p]
            p += 2 if n & 0x80 else 1  # the length in UTF-16 units, then in bytes
            n = data[p]
            if n & 0x80:
                n = ((n & 0x7F) << 8) | data[p + 1]
                p += 1
            p += 1
            out.append(data[p:p + n].decode("utf-8"))
        else:
            n = struct.unpack_from("<H", data, p)[0]
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", data, p + 2)[0]
                p += 2
            p += 2
            out.append(data[p:p + 2 * n].decode("utf-16-le"))
    return out, flags & UTF8, size


def parse(data):
    kind, header, total = struct.unpack_from("<HHI", data, 0)
    if kind != XML:
        raise ValueError("not Android's binary XML")
    at, strings, utf8, ids = header, [], UTF8, []
    root = Node(None, 0, None)
    stack = [root]
    s = lambda i: None if i == NO else strings[i]
    while at < total:
        kind, header, size = struct.unpack_from("<HHI", data, at)
        if kind == STRING_POOL:
            strings, utf8, _ = read_strings(data, at)
        elif kind == RESOURCE_MAP:
            ids = list(struct.unpack_from(f"<{(size - header) // 4}I", data, at + header))
        elif kind in (NS_START, NS_END, ELEMENT_START, ELEMENT_END, CDATA):
            line, comment = struct.unpack_from("<II", data, at + 8)
            ext = at + header
            if kind in (NS_START, ELEMENT_START, CDATA):
                node = Node(kind, line, s(comment))
                if kind == NS_START:
                    prefix, uri = struct.unpack_from("<II", data, ext)
                    node.prefix, node.uri = s(prefix), s(uri)
                elif kind == ELEMENT_START:
                    ns, name, a_start, a_size, count, i_id, i_class, i_style = struct.unpack_from("<IIHHHHHH", data, ext)
                    node.ns, node.name, node.special = s(ns), s(name), (i_id, i_class, i_style)
                    for i in range(count):
                        a_ns, a_name, raw, _, _, vtype, value = struct.unpack_from("<IIIHBBI", data, ext + a_start + i * a_size)
                        resid = ids[a_name] if a_name < len(ids) else 0
                        node.attrs.append(Attr(s(a_ns), s(a_name), resid, s(raw), vtype, s(value) if vtype == TYPE_STRING else value))
                else:
                    text, _, _, vtype, value = struct.unpack_from("<IHBBI", data, ext)
                    node.text, node.cdata = s(text), (vtype, value)
                stack[-1].children.append(node)
                if kind != CDATA:
                    stack.append(node)
            else:
                node = stack.pop()
                node.end_line, node.end_comment = line, s(comment)
        at += size
    if len(stack) != 1:
        raise ValueError("unbalanced XML")
    return root, utf8


# --- Writing ---------------------------------------------------------------------------------


def encode_string(text, utf8):
    if utf8:
        b = text.encode("utf-8")
        n16 = len(text.encode("utf-16-le")) // 2

        def length(n):
            return bytes([n]) if n < 0x80 else bytes([(n >> 8) | 0x80, n & 0xFF])

        return length(n16) + length(len(b)) + b + b"\0"
    b = text.encode("utf-16-le")
    n = len(b) // 2
    head = struct.pack("<H", n) if n < 0x8000 else struct.pack("<HH", (n >> 16) | 0x8000, n & 0xFFFF)
    return head + b + b"\0\0"


def serialize(root, utf8):
    # The pool: attribute names with a resource id first (the resource map covers them), then
    # every other string. An attribute name without an id never shares a mapped entry.
    mapped, other = [], []
    for n in root.walk():
        for a in n.attrs:
            if a.resid and (a.name, a.resid) not in mapped:
                mapped.append((a.name, a.resid))
    mapped.sort(key=lambda m: m[1])
    index = {}

    def ref(text):
        if text is None:
            return NO
        if text not in index:
            index[text] = len(mapped) + len(other)
            other.append(text)
        return index[text]

    def name_ref(a):
        return mapped.index((a.name, a.resid)) if a.resid else ref(a.name)

    body = bytearray()

    def node_header(kind, size, line, comment):
        return struct.pack("<HHIII", kind, 16, size, line, ref(comment))

    def write(n):
        if n.kind == NS_START:
            body.extend(node_header(NS_START, 24, n.line, n.comment) + struct.pack("<II", ref(n.prefix), ref(n.uri)))
        elif n.kind == CDATA:
            vtype, value = n.cdata
            value = ref(n.text) if vtype == TYPE_STRING else value
            body.extend(node_header(CDATA, 28, n.line, n.comment) + struct.pack("<IHBBI", ref(n.text), 8, 0, vtype, value))
            return
        elif n.kind == ELEMENT_START:
            attrs = b"".join(
                struct.pack("<IIIHBBI", ref(a.ns), name_ref(a), ref(a.raw), 8, 0, a.kind, ref(a.data) if a.kind == TYPE_STRING else a.data)
                for a in n.attrs
            )
            ext = struct.pack("<IIHHHHHH", ref(n.ns), ref(n.name), 20, 20, len(n.attrs), *n.special)
            body.extend(node_header(ELEMENT_START, 16 + len(ext) + len(attrs), n.line, n.comment) + ext + attrs)
        for c in n.children:
            write(c)
        if n.kind == NS_START:
            body.extend(node_header(NS_END, 24, n.end_line, n.end_comment) + struct.pack("<II", ref(n.prefix), ref(n.uri)))
        elif n.kind == ELEMENT_START:
            body.extend(node_header(ELEMENT_END, 24, n.end_line, n.end_comment) + struct.pack("<II", ref(n.ns), ref(n.name)))

    for c in root.children:
        write(c)

    strings = [m[0] for m in mapped] + other
    data = bytearray()
    offsets = []
    for t in strings:
        offsets.append(len(data))
        data.extend(encode_string(t, utf8))
    while len(data) % 4:
        data.append(0)
    start = 28 + 4 * len(strings)
    pool = struct.pack("<HHIIIIII", STRING_POOL, 28, start + len(data), len(strings), 0, utf8, start, 0)
    pool += struct.pack(f"<{len(strings)}I", *offsets) + bytes(data)
    rmap = struct.pack("<HHI", RESOURCE_MAP, 8, 8 + 4 * len(mapped)) + struct.pack(f"<{len(mapped)}I", *(m[1] for m in mapped))
    out = pool + rmap + bytes(body)
    return struct.pack("<HHI", XML, 8, 8 + len(out)) + out


# --- reel's changes --------------------------------------------------------------------------


def is_link(intent_filter):
    """A filter for links of the app's schemes (VIEW, BROWSABLE, `<data android:scheme>`)."""
    names = {(c.name, a.data) for c in intent_filter.elements() for a in c.attrs if a.resid == ATTR_NAME}
    schemes = [d for d in intent_filter.elements("data") if any(a.name == "scheme" for a in d.attrs)]
    return ("action", "android.intent.action.VIEW") in names and ("category", "android.intent.category.BROWSABLE") in names and bool(schemes)


def is_launcher(activity):
    for f in activity.elements("intent-filter"):
        names = {(c.name, a.data) for c in f.elements() for a in c.attrs if a.resid == ATTR_NAME}
        if ("action", "android.intent.action.MAIN") in names and ("category", "android.intent.category.LAUNCHER") in names:
            return f
    return None


def set_attr(node, attr):
    """Sets `attr` on `node`, keeping the order Android reads them in (by resource id)."""
    if node.special != (0, 0, 0):
        raise ValueError(f"<{node.name}> has id, class or style attributes: not edited")
    node.attrs = [a for a in node.attrs if not (a.ns == attr.ns and a.name == attr.name)]
    node.attrs.append(attr)
    node.attrs.sort(key=lambda a: (a.resid == 0, a.resid, a.name))


def edit(root, banner, icon, package):
    manifest = next(n for n in root.walk() if n.kind == ELEMENT_START and n.name == "manifest")
    app = next(manifest.elements("application"))
    launchers = [(a, f) for a in app.elements("activity") for f in [is_launcher(a)] if f]
    if len(launchers) != 1:
        raise ValueError(f"expected one launcher activity, found {len(launchers)}")
    activity, launcher = launchers[0]

    changes = activity.attr(ATTR_CONFIG_CHANGES)
    value = sum(CONFIG_CHANGES.values()) | (changes.data if changes else 0)
    set_attr(activity, Attr(ANDROID, "configChanges", ATTR_CONFIG_CHANGES, None, TYPE_INT_HEX, value))

    leanback = "android.intent.category.LEANBACK_LAUNCHER"
    if not any(a.data == leanback for c in launcher.elements("category") for a in c.attrs):
        launcher.children.append(element("category", [android_name(leanback)], launcher.line))

    # Before <application>, as a manifest lists them.
    features = {a.data for f in manifest.elements("uses-feature") for a in f.attrs if a.resid == ATTR_NAME}
    at = manifest.children.index(app)
    for name in ("android.software.leanback", "android.hardware.touchscreen"):
        if name not in features:
            required = Attr(ANDROID, "required", ATTR_REQUIRED, None, TYPE_INT_BOOLEAN, 0)
            manifest.children.insert(at, element("uses-feature", [android_name(name), required], app.line))
            at += 1

    set_attr(app, Attr(ANDROID, "banner", ATTR_BANNER, None, TYPE_REFERENCE, banner))
    set_attr(app, Attr(ANDROID, "icon", ATTR_ICON, None, TYPE_REFERENCE, icon))
    set_attr(app, Attr(ANDROID, "roundIcon", ATTR_ROUND_ICON, None, TYPE_REFERENCE, icon))

    links = [f for f in activity.elements("intent-filter") if is_link(f)]
    if links and not any(a.data == LINK_ACTIVITY for x in app.elements("activity") for a in x.attrs if a.resid == ATTR_NAME):
        for f in links:
            activity.children.remove(f)
        link = element("activity", [
            Attr(ANDROID, "theme", ATTR_THEME, None, TYPE_REFERENCE, THEME_NO_DISPLAY),
            android_name(LINK_ACTIVITY),
            Attr(ANDROID, "exported", ATTR_EXPORTED, None, TYPE_INT_BOOLEAN, TRUE),
            Attr(ANDROID, "excludeFromRecents", ATTR_EXCLUDE_FROM_RECENTS, None, TYPE_INT_BOOLEAN, TRUE),
            Attr(ANDROID, "noHistory", ATTR_NO_HISTORY, None, TYPE_INT_BOOLEAN, TRUE),
        ], links[0].line)
        link.children = links
        app.children.insert(app.children.index(activity) + 1, link)

    if not any(a.data == START_PROVIDER for x in app.elements("provider") for a in x.attrs if a.resid == ATTR_NAME):
        start = element("provider", [
            android_name(START_PROVIDER),
            Attr(ANDROID, "exported", ATTR_EXPORTED, None, TYPE_INT_BOOLEAN, 0),
            Attr(ANDROID, "authorities", ATTR_AUTHORITIES, f"{package}.reel", TYPE_STRING, f"{package}.reel"),
        ], activity.line)
        app.children.insert(app.children.index(activity), start)
    return manifest


# --- Resources -------------------------------------------------------------------------------


def check_ids(aapt2, jar, work):
    """The ids above are the ones aapt2 gives these attributes and the theme with `jar`."""
    with open(f"{work}/ids.xml", "w") as f:
        f.write(f"""<manifest xmlns:android="{ANDROID}" package="ids.check">
  <uses-feature android:name="x" android:required="false" />
  <application android:banner="@android:drawable/btn_star" android:icon="@android:drawable/btn_star"
      android:roundIcon="@android:drawable/btn_star">
    <provider android:name="x" android:authorities="ids.check" android:exported="false" />
    <activity android:name="x" android:theme="@android:style/Theme.NoDisplay" android:configChanges="mcc"
        android:excludeFromRecents="true" android:noHistory="true" />
  </application>
</manifest>
""")
    subprocess.run([aapt2, "link", "-I", jar, "--manifest", f"{work}/ids.xml", "-o", f"{work}/ids.apk"], check=True)
    tree = subprocess.run([aapt2, "dump", "xmltree", "--file", "AndroidManifest.xml", f"{work}/ids.apk"],
                          capture_output=True, text=True, check=True).stdout
    found = {m.group(1): int(m.group(2), 16) for m in re.finditer(r"android:(\w+)\((0x[0-9a-f]{8})\)", tree)}
    want = {"name": ATTR_NAME, "configChanges": ATTR_CONFIG_CHANGES, "required": ATTR_REQUIRED, "banner": ATTR_BANNER,
            "icon": ATTR_ICON, "roundIcon": ATTR_ROUND_ICON,
            "theme": ATTR_THEME, "exported": ATTR_EXPORTED, "excludeFromRecents": ATTR_EXCLUDE_FROM_RECENTS,
            "noHistory": ATTR_NO_HISTORY, "authorities": ATTR_AUTHORITIES}
    wrong = {n: hex(found.get(n, 0)) for n, rid in want.items() if found.get(n) != rid}
    theme = re.search(r"android:theme\(0x[0-9a-f]{8}\)=@(0x[0-9a-f]{8})", tree)
    if not theme or int(theme.group(1), 16) != THEME_NO_DISPLAY:
        wrong["Theme.NoDisplay"] = theme.group(1) if theme else "none"
    if wrong:
        raise ValueError(f"android.jar gives other ids: {wrong}")


def resources(aapt2, apk):
    """An APK's resources (`aapt2 dump resources`): {"type/name": id}, {file: "type/name"}."""
    out = subprocess.run([aapt2, "dump", "resources", apk], capture_output=True, text=True, check=True).stdout
    ids, files, name = {}, {}, None
    for line in out.splitlines():
        if m := re.match(r"\s*resource (0x[0-9a-f]{8}) (\S+)", line):
            name = m.group(2)
            ids[name] = int(m.group(1), 16)
        elif (m := re.search(r"\(file\) (\S+)", line)) and name:
            files[m.group(1)] = name
    return ids, files


def link(apk, res, aapt2, jar, package, work):
    """Links the APK's resources and `res`'s into `work`/res.apk, the APK's ids kept."""
    old, files = resources(aapt2, apk)
    # reel's own, from an earlier run on this APK, are made again from `res`: their names, and
    # what aapt2 made of their inline parts (`$banner__0`).
    reel = set()
    for d, _, fs in os.walk(res):
        kind = os.path.basename(d).split("-")[0]  # drawable-xhdpi: drawable
        reel.update((kind, f.split(".")[0]) for f in fs if d != res)
    is_reel = lambda name: any(name == f"{k}/{n}" or name.startswith(f"{k}/${n}__") for k, n in reel)
    flats = []
    carried = [f for f, name in files.items() if not is_reel(name)]
    if carried:
        # NSH's (the launcher icon): compiled again from the APK's files, as they are.
        with zipfile.ZipFile(apk) as z:
            for f in carried:
                if z.read(f)[:2] == b"\x03\x00":
                    raise ValueError(f"{f}: an XML resource of the APK's, which aapt2 cannot compile again")
            z.extractall(f"{work}/apk", carried)
        subprocess.run([aapt2, "compile", "--no-crunch", "--dir", f"{work}/apk/res", "-o", f"{work}/apk.zip"], check=True)
        flats.append(f"{work}/apk.zip")
    subprocess.run([aapt2, "compile", "--dir", res, "-o", f"{work}/reel.zip"], check=True)
    flats.append(f"{work}/reel.zip")
    with open(f"{work}/ids.txt", "w") as f:
        f.writelines(f"{package}:{name} = 0x{rid:08x}\n" for name, rid in sorted(old.items()))
    with open(f"{work}/AndroidManifest.xml", "w") as f:
        f.write(f'<manifest xmlns:android="{ANDROID}" package="{package}" />\n')
    subprocess.run(
        [aapt2, "link", "-I", jar, "--manifest", f"{work}/AndroidManifest.xml", "--min-sdk-version", "26",
         "--stable-ids", f"{work}/ids.txt", "-o", f"{work}/res.apk", *flats],
        check=True,
    )
    ids, _ = resources(aapt2, f"{work}/res.apk")
    moved = {n for n, rid in old.items() if ids.get(n) != rid}
    if moved:
        raise ValueError(f"resource ids moved: {sorted(moved)}")
    return f"{work}/res.apk", ids


def main(argv):
    if len(argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    apk, res, aapt2, jar = argv
    with zipfile.ZipFile(apk) as z:
        root, utf8 = parse(z.read("AndroidManifest.xml"))
    package = next(n for n in root.walk() if n.kind == ELEMENT_START and n.name == "manifest")
    package = next(a.data for a in package.attrs if a.name == "package" and not a.resid)
    with tempfile.TemporaryDirectory() as work:
        check_ids(aapt2, jar, work)
        linked, ids = link(apk, res, aapt2, jar, package, work)
        for name in ("drawable/banner", "mipmap/icon"):
            if name not in ids:
                raise ValueError(f"no {name} in {res}")
        edit(root, ids["drawable/banner"], ids["mipmap/icon"], package)
        manifest = serialize(root, utf8)
        out = apk + ".new"
        with zipfile.ZipFile(apk) as src, zipfile.ZipFile(linked) as resz, zipfile.ZipFile(out, "w") as dst:
            ours = lambda name: name in ("AndroidManifest.xml", "resources.arsc") or name.startswith("res/")
            for e in src.infolist():
                if e.filename == "AndroidManifest.xml":
                    dst.writestr(e, manifest)
                elif not ours(e.filename):
                    dst.writestr(e, src.read(e))
            for e in resz.infolist():
                if ours(e.filename) and e.filename != "AndroidManifest.xml":
                    # resources.arsc stays stored (Android maps it), as aapt2 wrote it.
                    dst.writestr(e, resz.read(e))
        os.replace(out, apk)
    print(f"android-manifest: TV launcher, banner, icon, configuration changes, links and start in {os.path.basename(apk)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
