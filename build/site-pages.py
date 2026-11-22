#!/usr/bin/env python3
"""Writes the website's pages, one static page per language, from one template and the strings
of each language: site/index.html in English (the root) and site/<dir>/index.html for the others.
The pages are committed, so the site stays a folder of files with nothing to build when served.

Usage: build/site-pages.py [--check]

--check: writes nothing; fails when a committed page differs from what this script writes.

Sources (site/i18n/, not published):
- template.html: the page, its texts as {{key}}. A text with links is {{key|href|href…}}: the
  string marks each link as <a>…</a> without attributes, and they take the hrefs in order, so a
  translation can move a link within its sentence but never changes where it leads.
  {{@name}} is filled in here: the language, the path to the root (assets), the canonical and
  hreflang links, the language redirect (root only) and the iPhone source's address.
- <lang>.json: every key of en.json, translated. Plain text: no markup other than <a>…</a>.

Fails, naming the language and key, on a key missing from a language or unknown to the
template, or a translation whose links do not match the English one.
"""
import html
import json
import os
import re
import sys
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(REPO, "site")
I18N = os.path.join(SITE, "i18n")

# Where the site is served (site/deploy/fly.toml): canonical and hreflang links are absolute.
ORIGIN = "https://reel-site.fly.dev/"
# The AltStore and SideStore source of the iPhone and iPad app, a release asset.
SOURCE = "https://github.com/exzos28/reel/releases/latest/download/altstore.json"

# (language tag, folder): the app's languages (app/locales). English is the root.
LANGS = [
    ("en", ""), ("ru", "ru"), ("uk", "uk"), ("pl", "pl"), ("de", "de"), ("fr", "fr"),
    ("es", "es"), ("it", "it"), ("pt-BR", "pt-br"), ("tr", "tr"), ("ja", "ja"), ("zh-CN", "zh-cn"),
]

TOKEN = re.compile(r"\{\{([^{}]+)\}\}")


class Fail(Exception):
    pass


def text(value):
    # Text and double-quoted attributes alike.
    return html.escape(value, quote=False).replace('"', "&quot;")


def redirect():
    # A browser asking for another of these languages first goes to its page; English, crawlers
    # and visitors without scripts stay on the root. Only the root redirects: /de/ stays /de/.
    pages = {}
    for tag, folder in LANGS[1:]:
        pages.setdefault(tag.lower(), folder)
    for tag, folder in LANGS[1:]:
        pages.setdefault(tag.lower().split("-")[0], folder)  # pt-PT -> pt-BR, zh -> zh-CN
    return "\n".join([
        "<script>",
        "  // The visitor's language, before anything loads: a browser that asks for another language",
        "  // this site has goes to its page, keeping the #section (build/site-pages.py writes the list).",
        "  (function () {",
        "    var pages = " + json.dumps(pages, separators=(",", ":")) + ";",
        '    var asked = navigator.languages || [navigator.language || ""], trad = false;',
        "    for (var i = 0; i < asked.length; i++) {",
        '      var tag = String(asked[i]).toLowerCase(), base = tag.split("-")[0];',
        '      if (base === "en") return;',
        "      // Chinese in traditional characters (and the plain zh a browser lists after it) is not",
        "      // sent to the simplified page.",
        '      if (base === "zh" && !/-(hans|cn|sg)\\b/.test(tag) && (trad || /-(hant|tw|hk|mo)\\b/.test(tag))) { trad = true; continue; }',
        "      var to = pages[tag] || pages[base];",
        '      if (to) { location.replace(to + "/" + location.hash); return; }',
        "    }",
        "  })();",
        "</script>",
    ])


def breakable(url):
    # The source's address may wrap after each "/" of its path, not inside the repository's
    # (github.com/<owner>/<repo>, which build/package-check.py allows as one string).
    parts = url.split("/")
    return "/<wbr>".join([text("/".join(parts[:5]))] + [text(p) for p in parts[5:]])


def links(folder):
    url = lambda f: ORIGIN + (f + "/" if f else "")
    out = ['<link rel="canonical" href="%s">' % url(folder)]
    out += ['<link rel="alternate" hreflang="%s" href="%s">' % (tag, url(f)) for tag, f in LANGS]
    out.append('<link rel="alternate" hreflang="x-default" href="%s">' % url(""))
    return "\n".join(out)


def anchors(value):
    return value.count("<a>"), value.count("</a>")


def render(template, strings, english, tag, folder):
    computed = {
        "lang": tag,
        "base": "../" if folder else "",
        "generated": "<!-- Written by build/site-pages.py from site/i18n/: edit the template or the strings and run it. -->",
        "links": links(folder),
        "redirect": "" if folder else redirect(),
        "source": breakable(SOURCE),
        "source_q": text(urllib.parse.quote(SOURCE, safe="")),
    }

    def fill(m):
        name, *hrefs = m.group(1).split("|")
        if name.startswith("@"):
            if name[1:] not in computed:
                raise Fail("template: unknown {{%s}}" % name)
            return computed[name[1:]]
        if name not in strings:
            raise Fail("%s: no string %s" % (tag, name))
        value = strings[name]
        if anchors(value) != (len(hrefs), len(hrefs)) or anchors(value) != anchors(english[name]):
            raise Fail("%s: %s needs %d link(s) as <a>…</a>, like the English" % (tag, name, len(hrefs)))
        if re.search(r"<(?!/?a>)", value):
            raise Fail("%s: %s has markup other than <a>…</a>" % (tag, name))
        # A name with a hyphen never breaks at it: a word joiner (zero width) after the hyphen.
        out = text(value).replace("TV-Store", "TV-&#8288;Store")
        for href in hrefs:
            out = out.replace("&lt;a&gt;", '<a href="%s">' % text(href), 1)
        return out.replace("&lt;/a&gt;", "</a>")

    # A {{@…}} alone on its line that is empty here leaves no blank line.
    template = re.sub(r"^\{\{@redirect\}\}\n", lambda m: m.group(0) if not folder else "", template, flags=re.M)
    return TOKEN.sub(fill, template)


def load(name):
    with open(os.path.join(I18N, name), encoding="utf-8") as f:
        return json.load(f)


def pages():
    with open(os.path.join(I18N, "template.html"), encoding="utf-8") as f:
        template = f.read()
    english = load("en.json")
    used = {m.group(1).split("|")[0] for m in TOKEN.finditer(template)}
    used = {k for k in used if not k.startswith("@")}
    if used != set(english):
        raise Fail("en: keys the template has and en.json lacks: %s; unused: %s"
                   % (sorted(used - set(english)) or "none", sorted(set(english) - used) or "none"))
    out = {}
    for tag, folder in LANGS:
        strings = load(tag + ".json")
        if set(strings) != set(english):
            raise Fail("%s: missing %s, unknown %s" % (tag, sorted(set(english) - set(strings)) or "none",
                                                      sorted(set(strings) - set(english)) or "none"))
        path = os.path.join(SITE, folder, "index.html") if folder else os.path.join(SITE, "index.html")
        out[path] = render(template, strings, english, tag, folder)
    return out


def main(argv):
    check = argv == ["--check"]
    if argv and not check:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        out = pages()
    except Fail as e:
        print("site-pages: %s" % e, file=sys.stderr)
        return 1
    stale, wrote = [], 0
    for path, page in out.items():
        try:
            with open(path, encoding="utf-8") as f:
                same = f.read() == page
        except FileNotFoundError:
            same = False
        if same:
            continue
        if check:
            stale.append(os.path.relpath(path, REPO))
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(page)
            wrote += 1
            print("site-pages: wrote %s" % os.path.relpath(path, REPO), file=sys.stderr)
    if stale:
        print("site-pages: out of date, run build/site-pages.py: %s" % ", ".join(stale), file=sys.stderr)
        return 1
    print("site-pages: %d pages, %d written" % (len(out), wrote), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
