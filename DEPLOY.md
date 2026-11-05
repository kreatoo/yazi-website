# Deployment

The site is published to GitHub Pages at **https://yazi.krea.to**.

## How it gets there

`.github/workflows/pages.yml` runs on every push to `main` and on pull requests.

1. Rebuild the pages with `python3 tools/build.py`.
2. **Fail if the committed HTML does not match the rebuild.** The generated
   files are checked in so the site opens without a build, which means a stale
   page is possible if someone edits a module and forgets to rebuild. This step
   makes that impossible to merge.
3. Check every internal link and anchor with `python3 tools/check-links.py`.
4. Check `CNAME` still says `yazi.krea.to`.
5. Upload the repository root as the Pages artifact and deploy.

A pull request runs steps 1–4 and stops. Only `main` deploys.

## One-time setup

In the repository settings:

- **Pages → Build and deployment → Source: GitHub Actions.**
- **Pages → Custom domain: `yazi.krea.to`**, then enable *Enforce HTTPS* once
  the certificate is issued.

At the DNS provider, point the host at Pages:

```
yazi.krea.to.  CNAME  <owner>.github.io.
```

`CNAME` in the repository root tells Pages which host to serve. It must match
the custom domain setting, which is why the workflow checks it.

## Working locally

```sh
python3 tools/build.py          # regenerate the pages
python3 tools/check-links.py    # verify internal links and anchors
python3 -m http.server 8000     # preview at http://localhost:8000
```

Install the pre-commit guard so a stale build cannot be committed:

```sh
ln -s ../../tools/pre-commit.sh .git/hooks/pre-commit
```

## What is not deployed

`tools/*.cjs` are browser harnesses for local verification. They depend on a
Playwright install and are not part of the published site. They are excluded
from the artifact by `.gitignore` conventions rather than by the workflow,
because the artifact is the repository root.
