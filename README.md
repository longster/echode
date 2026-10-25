# Echode

Echode is the umbrella front door for Texas Deaf communities, city by city. Slogan: "Establishing Connections." Each city keeps its own local home, run the local way. Echode is the map that points to all of them.

Houston's home is HoustonDeafNetwork.com, live and unchanged. echode.com/htx and echode.com/hdn redirect to it.

## Cities

| Code | City | Status |
| --- | --- | --- |
| HTX | Houston | Live (HoustonDeafNetwork) |
| ATX | Austin | Live |
| DFW | Dallas - Fort Worth | Live |
| SATX | San Antonio | Live |
| TX | Texas statewide | Live |

All four cities plus the statewide layer are live as of 2026-10-25. A new city joins the same way: seeded listings, recurring events, and community submissions.

## This site

- Hand-written HTML, CSS, and JavaScript. No framework, no build step.
- Shared tiers: `shared.css` / `shared.js` on every page, `city.css` / `city.js` on city pages, per-page files for page deltas.
- Pages: home, atx, dfw, satx, tx, design, privacy. Short addresses: /htx and /hdn redirect to HoustonDeafNetwork; /sat redirects to /satx.
- Suggest and Get Listed forms post to a Cloudflare Worker (`automation/worker.js`), which writes Pending rows to Notion and sends ack and owner emails.
- Notion-to-site sync: `automation/sync.mjs`, run daily by `.github/workflows/echode-notion-sync.yml` plus manual runs. It writes each city's `data.js`.
- Analytics: Microsoft Clarity and Google Analytics on every page. See the privacy page for what they collect.
- Dark theme with an Auto / Light / Dark toggle. Open Graph tags, `sitemap.xml`, and `robots.txt` on every page.
- Design system: `design-system.md` is the source of truth, published at echode.com/design.

## Updating

Edit files under `preview/` (the source dir), then snapshot-push to `main`. GitHub Pages republishes in a minute or two. Binary files (logos, favicons) go through the GitHub web UI, never the connector push. After pushes that touch shared files, bump `?v=N` on the changed CSS/JS links and verify live.
