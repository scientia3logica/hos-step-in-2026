# HOS Step In 2026
Editable source for Claude Code. Node 22+. Run npm run dev for preview, npm test and npm run build for validation.

## Site
The page is the published Claude artifact (copied in `artifact-source/`) turned into a standalone site that works **without any login**.

- `index.html`, `styles.css`, `app.js` — the artifact's markup, styles and script (3D lab, calculators, member space, experiment logs, Q&A, tutorial).
- `community.js` — storage client. `app.js` was written for the Claude artifact runtime (`window.claude`); this file provides the same calls on top of the site's own API, so nobody needs a Claude account.
- `api.mjs` — Worker API. Shared storage lives in the R2 bucket:
  - `GET/POST /api/db/{messages|models|explogs}`, `DELETE /api/db/{col}/{id}` — any visitor can delete messages, experiment logs and shared models (no login, no delete keys). Deleting a model or log also deletes its uploaded file.
  - `GET/PUT /api/db/lab/dimensions` — shared faucet dimensions.
  - `POST /api/blob`, `GET /_blob/{id}` — uploaded files (20MB max). Served with `nosniff` and a sandbox CSP; only images/videos are shown inline.
  - The older `/api/posts` and `/api/dimensions` endpoints are kept for existing data.

## Hosting setup pending
Connect this repository to Cloudflare Workers Builds, use npm run build and npx wrangler@4 deploy. Create R2 bucket hos-step-in-2026-files and bind as BUCKET. Existing Sites storage is separate; migrate records and uploads before cutover. The live site has not moved.
