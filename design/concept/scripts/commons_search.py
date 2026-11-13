"""Search Wikimedia Commons and print file title, size and license.

Usage: python3 -I commons_search.py "query one" "query two" ...
Only files whose license is "Public domain" should be used in mockups.
"""
import json
import sys
import urllib.parse
import urllib.request

UA = {"User-Agent": "reel-design-mockups/0.1"}


def api(params):
    params = dict(params, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=30))


for q in sys.argv[1:]:
    r = api(dict(action="query", generator="search", gsrsearch=q + " filetype:bitmap",
                 gsrnamespace=6, gsrlimit=6, prop="imageinfo",
                 iiprop="url|size|extmetadata"))
    print("==", q)
    pages = sorted(r.get("query", {}).get("pages", {}).values(), key=lambda p: p["index"])
    for p in pages:
        ii = p["imageinfo"][0]
        lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value")
        print(f"  {p['title'][:90]} | {ii['width']}x{ii['height']} | {lic}")
