# reel website

The public page about reel: what it is, how it works, platforms and their status. It is a static
site with no build step: `index.html`, `style.css`, `icon.svg` and the Geist font in `fonts/`
(SIL Open Font License, `fonts/Geist-OFL.txt`). No scripts, no trackers, nothing loaded from
other hosts.

## Preview

Serve the folder over HTTP (fonts do not load from `file://` in every browser):

```sh
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

GitHub Pages serves a branch's root or its `/docs` folder, or whatever a workflow uploads. Two
ways that need no change to this repo's workflows:

- **A `gh-pages` branch.** Push the contents of `site/` to its own branch and pick it in
  *Settings → Pages → Deploy from a branch → gh-pages / (root)*:
  ```sh
  git subtree push --prefix site origin gh-pages
  ```
  Run it again after every change to `site/`.
- **A Pages workflow** (later, if wanted): a job with `actions/upload-pages-artifact` (`path: site`)
  and `actions/deploy-pages`, and *Settings → Pages → Source: GitHub Actions*.

The page uses relative paths only, so it works both at `https://<user>.github.io/reel/` and on a
custom domain.

## Before the repository goes public

- The GitHub links (`https://github.com/exzos28/reel`) are placeholders while the repository is
  private; each one has a comment next to it in `index.html`.
- Update the platform statuses when builds change, from `scripts/build.sh`, `docs/ci.md` and
  `.github/workflows/`. Packages are described as coming to GitHub Releases; once the first
  release is published, link to it.

## Rules for the content

- reel ships no content sources: never name trackers, indexers or sites, and no "free movies"
  wording. The user connects their own search source.
- No screenshots or posters of commercial films. The app pictures are drawn in HTML and CSS with
  public-domain titles.
- Keep the TMDB notice and the AniList and Jikan credits in the footer.
- Raster images, if ever added: PNG at 1x, `@2x` and `@3x`. Prefer SVG or CSS.
