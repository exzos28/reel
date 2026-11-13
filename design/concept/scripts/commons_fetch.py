"""Download public-domain images from Wikimedia Commons into design/concept/img/.

Usage: python3 -I commons_fetch.py <out_dir>
Each entry: local name, Commons file title, width to fetch. The script refuses
any file whose Commons license is not "Public domain" and writes CREDITS.md.
"""
import json
import time
import sys
import urllib.error
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
    # more film stills (landscape backdrop cards on browse screens)
    ("still-night.jpg", "File:Night Of The Living Dead trailer screenshot.jpg", 1280),
    ("still-friday.jpg", "File:His Girl Friday 3.jpg", 1280),
    ("still-detour.jpg", "File:Tom Neal-Edmund MacDonald in Detour.jpg", 940),
    ("still-sherlock.png", "File:Silent film theater in Sherlock Jr., 1924, with Buster Keaton.png", 1280),
    ("still-caligari.jpg", "File:Publicity still for The Cabinet of Dr. Caligari (1920) 03.jpg", 1280),
    ("still-moon.jpg", "File:Méliès Trip to the Moon cannon still.jpg", 1280),
    ("still-metropolis-lobby.jpg", "File:Metropolis (1927) - US Lobby Card.jpg", 1280),
    ("still-phantom.jpg", "File:The Phantom of the Opera (1925) - 11.jpg", 864),
    # series: Flash Gordon serials (1936, 1938, 1940) as three seasons
    ("poster-flash.jpg", "File:Flash Gordon (serial).jpg", 600),
    ("poster-flash-mars.jpg", "File:Flashgordontriptomars.jpg", 600),
    ("still-flash-1.jpg", "File:Flash Gordon Conquers the Universe (1940) 1.jpg", 1200),
    ("still-flash-2.jpg", "File:Flash Gordon Conquers the Universe (1940) 2.jpg", 1200),
    ("still-flash-lobby.jpg", "File:Flash Gordon Conquers the Universe lobby card.jpg", 966),
    ("still-flash-mars.jpg", "File:Flash Gordon's Trip to Mars chapter 8 lobby card.jpg", 973),
    ("still-flash-hawkmen.png", "File:Flash Gordon serial (1936) hawkmen guards heil 2.png", 661),
    ("still-flash-shannon.jpg", "File:Frank Shannon in Flash Gordon Conquers the Universe (1940).jpg", 916),
    # other public-domain serials and series
    ("poster-vampires.jpg", "File:Les Vampires - Satanas.jpg", 600),
    ("still-vampires.jpg", "File:Musidora in Les Vampires.jpg", 1280),
    ("still-vampires-2.jpg", "File:Musidora - Irma Vep - Les Vampires.jpg", 1280),
    ("poster-fantomas.jpg", "File:Fantômas - Louis Feuillade (1913).jpg", 600),
    ("poster-judex.jpg", "File:Judex - Arthur Bernède - fascicule 2.jpg", 600),
    ("poster-pauline.jpg", "File:Perilsofpauline.jpg", 580),
    ("still-pauline.jpg", "File:Pearl White in The Perils of Pauline.jpg", 1280),
    ("poster-undersea.jpg", "File:Underseakingdomserial.jpg", 580),
    ("still-bonanza.jpg", "File:Bonanza main cast 1959.JPG", 899),
    ("still-phantom-creeps.jpg", "File:Dorothy Arnold in The Phantom Creeps.jpg", 1237),
    ("poster-zorro.jpg", "File:Zorro's Fighting Legion poster.jpg", 500),
    ("poster-lone-ranger.jpg", "File:Lonerangerserial.JPG", 500),
]


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    for wait in (10, 30, 60, 0):
        try:
            return urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or not wait:
                raise
            time.sleep(wait)  # rate limited: back off and retry


# Commons serves (and rate-limits less) only these thumbnail widths: https://w.wiki/GHai
STEPS = (250, 330, 500, 960, 1280, 1920, 3840)


def info(title, width):
    width = next(w for w in STEPS if w >= width)
    params = dict(action="query", titles=title, prop="imageinfo",
                  iiprop="url|extmetadata", iiurlwidth=width, format="json")
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    r = json.loads(fetch(url))
    page = next(iter(r["query"]["pages"].values()))
    return page["imageinfo"][0]


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
credits = ["# Image credits", "", "All images are public domain, from Wikimedia Commons.", ""]
# Files already downloaded and credited are kept without asking the API again.
old_credits = {}
if (out / "CREDITS.md").exists():
    for line in (out / "CREDITS.md").read_text().splitlines():
        if line.startswith("- `"):
            old_credits[line[3:line.index("`", 3)]] = line
for name, title, width in FILES:
    if (out / name).exists() and f"[{title}]" in old_credits.get(name, ""):
        credits.append(old_credits[name])
        print(f"have {name}")
        continue
    time.sleep(6)  # Commons answers 429 to quick bursts
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
    data = fetch(src)
    (out / name).write_bytes(data)
    print(f"ok {name} {len(data) // 1024} KB")
(out / "CREDITS.md").write_text("\n".join(credits) + "\n")
