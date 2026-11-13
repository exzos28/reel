"""Download public-domain images from Wikimedia Commons into design/concept/img/.

Usage: python3 -I commons_fetch.py <out_dir>
Each entry: local name, Commons file title, width to fetch. The script refuses
any file whose Commons license is not "Public domain" and writes CREDITS.md.
"""
import json
import time
import sys
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "reel-design-mockups/0.1"}

FILES = [
    # posters (portrait)
    ("poster-metropolis.jpg", "File:Boris Bilinski (1900-1948) Plakat für den Film Metropolis (1).jpg", 600),
    ("poster-nosferatu.jpg", "File:Film Nosferatu (van F, SFA008003709.jpg", 600),
    ("poster-sherlock.jpg", "File:Sherlock jr poster.jpg", 600),
    ("poster-detour.jpg", "File:Detour (poster).jpg", 600),
    ("poster-charade.jpg", "File:Charade (1963 poster).jpg", 600),
    ("poster-friday.jpg", "File:His Girl Friday (1940 poster).jpg", 600),
    ("poster-night.jpg", "File:Night Of The Living Dead (1968) - Poster.jpg", 600),
    ("poster-general.jpg", "File:Buster Keaton on the cow-catcher in The General.jpg", 900),
    # stills (landscape)
    ("still-charade.jpg", "File:Charade 1963 Audrey Hepburn.jpg", 1920),
    ("still-charade-2.jpg", "File:Charade 1963 Audrey Hepburn and Cary Grant.jpg", 1920),
    ("still-metropolis.jpg", "File:Metropolis (1927) - Hel.jpg", 960),
    ("still-nosferatu.png", "File:Nosferatu (1922) - Count Orlok Standing In A Wooden Doorway.png", 1280),
    ("still-general.jpg", "File:Buster Keaton on the cow-catcher in The General.jpg", 1280),
]


def info(title, width):
    params = dict(action="query", titles=title, prop="imageinfo",
                  iiprop="url|extmetadata", iiurlwidth=width, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
    page = next(iter(r["query"]["pages"].values()))
    return page["imageinfo"][0]


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
credits = ["# Image credits", "", "All images are public domain, from Wikimedia Commons.", ""]
for name, title, width in FILES:
    time.sleep(3)  # Commons answers 429 to quick bursts
    ii = info(title, width)
    lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value")
    if lic != "Public domain":
        print(f"SKIP {name}: license {lic!r}")
        continue
    credits.append(f"- `{name}`: [{title}]({ii['descriptionurl']}), {lic}")
    if (out / name).exists():
        print(f"have {name}")
        continue
    src = ii.get("thumburl") or ii["url"]
    data = urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60).read()
    (out / name).write_bytes(data)
    print(f"ok {name} {len(data) // 1024} KB")
(out / "CREDITS.md").write_text("\n".join(credits) + "\n")
