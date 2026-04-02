# Deploying Tracking Helper

DEPLOY: 
`lukas@S5W-1001:~/Documents/Projects/tracking_helper(master)$ scp -P 4561 -r /home/lukas/Documents/Projects/tracking_helper root@212.132.68.199:~/projects/lukas-reindl/html/tracking`

This project is a **static site**: `index.html`, `styles.css`, and the `js/` folder. There is no build step. You can host it anywhere that serves files over HTTP (including your existing Nginx Docker image).

## Including it in your `lukas-reindl` Nginx image

Yes—you can add this app next to your other pages under `html/`.

Your Dockerfile copies the whole tree:

```dockerfile
COPY ./html /usr/share/nginx/html
```

Put the tracking app in a **subdirectory** so it does not overwrite your site root (for example `tracking` → URL path `/tracking/`):

```text
html/
  index.html              # your main site (or whatever you already have)
  …other pages…
  tracking/
    index.html            # from this repo
    styles.css
    js/
      app.js
      charts.js
      state.js
      storage.js
      timeMath.js
```

After the container runs, open:

`https://your-domain.example/tracking/`  
(or `http://…/tracking/` locally)

**Copy options**

- **Manual:** copy `index.html`, `styles.css`, and the entire `js/` directory into `html/tracking/` in the repo that builds the image.
- **CI / script:** `rsync` or `cp -r` from a clone of `tracking_helper` into `html/tracking/` before `docker build`.
- **Git submodule:** add this repo as `html/tracking` if you want the image build to always pull a pinned commit.

Do not put the app files at `html/` root unless you intend Tracking Helper to **be** the homepage (it would replace or conflict with your existing `index.html`).

## Why a subfolder works without code changes

Assets use **relative** URLs (`styles.css`, `./js/app.js`), and modules import each other with relative paths (`./storage.js`, etc.). The browser resolves them against the page URL, so everything under `/tracking/` keeps working.

The app loads Chart.js from jsDelivr (CDN); no extra files are required for charts.

## Nginx and Docker notes

- Default Nginx already serves static files and directory indexes; `…/tracking/index.html` is served for `/tracking/` when `index` is in the index list (default includes `index.html`).
- You only need a **custom `nginx.conf`** if you add special rules (caching headers, HTTPS in the container, etc.). Your commented `COPY nginx.conf` line can stay as-is for a simple setup.
- **Port:** `EXPOSE 80` matches Nginx’s default; map it when running the container, e.g. `-p 8080:80`.

## Local storage and the subpath

Data is stored in the browser’s **localStorage** for the site **origin** (scheme + host + port), not per URL path. If Tracking Helper lives at `https://example.com/tracking/` and another tool on `https://example.com/` uses the same storage keys, they could theoretically clash. This app uses keys prefixed with its own identifiers; in practice, same-origin subpaths are fine for normal use.

## Quick verification before building the image

From this repository root:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/` — behavior should match what you get under `/tracking/` in Nginx (relative paths behave the same).

## Summary

| Goal | Action |
|------|--------|
| App at `/tracking/` | Place repo files under `html/tracking/` in the image’s `html` tree. |
| App at site root | Copy files into `html/` (only if you want this as the main page). |
| Build step | None required. |
| Backend | None; optional future change only if you add one yourself. |
