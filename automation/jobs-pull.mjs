// Echode: pull open roles from deaf-friendly employers into Notion.
//
// Runs in the GitHub Action (see .github/workflows/echode-notion-sync.yml),
// before sync.mjs, and locally:
//   NOTION_TOKEN=... DATABASE_ID_JOBS=... node automation/jobs-pull.mjs
//
// WHAT IT DOES, once per run:
//   1. Fetches each company's public job board (see jobs-companies.mjs).
//   2. Keeps Texas + remote roles only; maps locations to Serves codes.
//   3. New role -> Notion Jobs row, Status "Filled" (holding, never
//      Active), Origin "Auto", Expiry = run date + 30 days.
//   4. Role still listed -> refreshes its Expiry date. A pulled role
//      that vanished from the board -> Status "Expired" (the sweeper
//      removes it). Rows the pull did not create (form submissions)
//      are never touched. Nothing is ever deleted.
//   5. Copies NOTHING but title, company, location, and link. The
//      link points at the company's own job page to apply.
//
// MODES (local use; the Action runs with no flags):
//   --parse-only   Fetch + parse + filter only. No Notion calls.
//                  Prints per-company counts and examples.
//   --dry-run      Full run, but executes nothing. Prints the plan.
//   --existing <f> Read the existing-rows list from JSON file <f>
//                  instead of querying Notion (local runs, where no
//                  raw token is available).
//   --plan-out <f> Write the action plan as JSON to <f> instead of
//                  executing writes. Pair with --dry-run --existing.
//
// A board fetch that fails is a loud warning, not a fatal error:
// one company's outage must not block the others or the sync.
// A Notion failure is fatal (exit 1), like sync.mjs.

import { COMPANIES, CITY_MAP, TEXAS_PATTERN, REMOTE_PATTERN } from "./jobs-companies.mjs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const UA = "Echode-jobs-pull/1.0 (+https://echode.com)";
const FETCH_TIMEOUT_MS = 60_000;
const WRITE_PAUSE_MS = 600;
const EXPIRY_DAYS = 30;

const token = process.env.NOTION_TOKEN || "";
const jobsDb = process.env.DATABASE_ID_JOBS || "";

// ------------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// "AUSTIN" -> "Austin". Leaves mixed-case text alone, and leaves
// 2-letter state codes ("TX", "NV") uppercase.
function titleCaseWords(s) {
  return String(s || "")
    .split(" ")
    .map((w) => (/^[A-Z]{3,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Dedupe key for a job URL: host lowercased, trailing slash dropped.
function normUrl(u) {
  try {
    const p = new URL(String(u || "").trim());
    return (p.protocol + "//" + p.hostname.toLowerCase() + p.pathname.replace(/\/$/, "") + p.search).toLowerCase();
  } catch {
    return String(u || "").trim().toLowerCase();
  }
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "User-Agent": UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Extract a balanced {...} JSON object starting at `marker`.
// Brace-counts while skipping string literals, so nested objects
// and braces inside strings do not cut the parse short.
function extractBalancedJson(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const open = text.indexOf("{", start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Location -> Serves mapping (driven by jobs-companies.mjs)
// ------------------------------------------------------------------

// A parsed role: { title, location, url, remote?, key?, forceTexas? }
// classify() returns null when the role is out of scope (not Texas,
// not remote), else { serves, display }.
function classify(role) {
  const text = cleanText(role.location);
  // City names can live in the title as well as the location
  // ("Dallas/Fort Worth" role based in Arlington, TX).
  const haystack = cleanText(`${role.title || ""} ${text}`);
  const cities = [];
  for (const c of CITY_MAP) if (c.pattern.test(haystack)) cities.push(c.code);
  const isTexas = role.forceTexas || TEXAS_PATTERN.test(text) || cities.length > 0;
  const isRemote = role.remote || REMOTE_PATTERN.test(text);
  if (!isTexas && !isRemote) return null;
  return { serves: [...new Set([...cities, "TX"])], display: text };
}

// ------------------------------------------------------------------
// Board parsers. Each returns [{ title, location, url, remote?,
// key?, forceTexas? }]. `key` is the within-run dedupe key when the
// URL alone is not stable across a company's boards (Taleo rids).
// ------------------------------------------------------------------

async function parsePaylocity(boardUrl) {
  const html = await fetchText(boardUrl);
  const jsonText = extractBalancedJson(html, "window.pageData");
  if (!jsonText) throw new Error("Paylocity: window.pageData not found");
  const data = JSON.parse(jsonText);
  const jobs = data.Jobs || [];
  // Details URL is the list URL with /All/<uuid>/<slug> swapped for
  // /Details/<JobId>/<slug>.
  const m = boardUrl.match(/^(https:\/\/[^/]+\/recruiting\/jobs)\/All\/[^/]+\/([^/?#]+)/i);
  const detailsBase = m ? `${m[1]}/Details/` : "https://recruiting.paylocity.com/recruiting/jobs/Details/";
  const slug = m ? `/${m[2]}` : "";
  return jobs
    .map((j) => {
      const jl = j.JobLocation || {};
      const placeName = cleanText(j.LocationName);
      // Paylocity marks field roles IsRemote even when the work is
      // tied to one place (Los Angeles, Salinas, California). A
      // role counts as remote only when it has no concrete place.
      const hasPlace = !!(
        jl.City ||
        (placeName && !/^\s*remote(\s+worker\s*-\s*n\/a)?\s*$/i.test(placeName))
      );
      let location = "";
      if (jl.City && jl.State) location = `${titleCaseWords(jl.City)}, ${jl.State}`;
      else if (jl.City) location = titleCaseWords(jl.City);
      // Paylocity's placeholder for a remote role is
      // "Remote Worker - N/A"; show it as plain "Remote".
      else if (/remote worker/i.test(placeName)) location = "Remote";
      else location = titleCaseWords(placeName);
      // State without a city ("AUSTIN", state TX) still belongs
      // on the display string.
      if (jl.State && location && !new RegExp(`\\b${jl.State}\\b`, "i").test(location)) {
        location = `${location}, ${jl.State}`;
      }
      if (!location && j.IsRemote) location = "Remote";
      return {
        title: cleanText(j.JobTitle),
        location,
        url: `${detailsBase}${j.JobId}${slug}`,
        remote: !!j.IsRemote && !hasPlace,
      };
    })
    .filter((r) => r.title && r.url);
}

async function parseUkg(boardUrl) {
  const page = await fetchText(boardUrl);
  const tokenMatch = page.match(/__RequestVerificationToken" type="hidden" value="([^"]+)"/);
  if (!tokenMatch) throw new Error("UKG: antiforgery token not found on board page");
  const tokenValue = tokenMatch[1];
  const base = boardUrl.split("?")[0].replace(/\/$/, "");
  const postUrl = `${base}/JobBoardView/LoadSearchResults`;
  const roles = [];
  const PAGE = 50;
  let skip = 0;
  let total = Infinity;
  let pages = 0;
  while (skip < total && pages < 10) {
    const data = await fetchJson(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        RequestVerificationToken: tokenValue,
      },
      body: JSON.stringify({
        opportunitySearch: {
          QueryString: "",
          Filters: [],
          Top: PAGE,
          Skip: skip,
          // NOTE: do NOT add OrderBy here. Verified 2026-11-06:
          // an OrderBy field makes the endpoint silently return
          // totalCount 0. The default sort is newest-first already.
        },
      }),
    });
    total = data.totalCount ?? 0;
    const opps = data.opportunities || [];
    if (opps.length === 0) break;
    for (const o of opps) {
      const loc = (o.Locations && o.Locations[0]) || {};
      const addr = loc.Address || {};
      let location = "";
      if (addr.City && addr.State && addr.State.Code) {
        // Some boards put a region ("Texas - Remote") in City and
        // the state code alongside it; do not repeat the state.
        const city = addr.City;
        const stateWords = [addr.State.Code, addr.State.Name].filter(Boolean).join("|");
        location = new RegExp(`\\b(${stateWords})\\b`, "i").test(city)
          ? city
          : `${city}, ${addr.State.Code}`;
      } else if (addr.City) location = addr.City;
      else location = cleanText(loc.LocalizedName);
      const remote =
        /remote/i.test(String(o.JobLocationType || "")) || /remote/i.test(cleanText(loc.LocalizedName));
      roles.push({
        title: cleanText(o.Title),
        location,
        url: `${base}/OpportunityDetail?opportunityId=${o.Id}`,
        remote,
      });
    }
    skip += opps.length;
    pages++;
  }
  return roles.filter((r) => r.title && r.url);
}

const TALEO_ROW_RE =
  /<h4 class="oracletaleocwsv2-head-title"><a href="([^"]*viewRequisition[^"]*)"[^>]*>([^<]+)<\/a><\/h4>\s*<div[^>]*>([^<]*)<\/div>\s*<div[^>]*>([^<]*)<\/div>/g;

async function parseTaleo(boardUrl) {
  const roles = [];
  const base = boardUrl.split("?")[0];
  const params = new URL(boardUrl).searchParams;
  const org = params.get("org") || "PRPL";
  const cws = params.get("cws") || "52";
  let rowFrom = 0;
  let pages = 0;
  for (;;) {
    const url = `${base}?org=${org}&cws=${cws}&rowFrom=${rowFrom}`;
    const html = await fetchText(url);
    let found = 0;
    for (const m of html.matchAll(TALEO_ROW_RE)) {
      found++;
      const [, href, rawTitle, , rawLocation] = m;
      const rid = (href.match(/rid=(\d+)/) || [])[1] || "";
      const location = cleanText(decodeEntities(rawLocation));
      const isHomeOffice = /home office/i.test(location);
      roles.push({
        title: cleanText(decodeEntities(rawTitle)),
        location: isHomeOffice ? "Remote" : location,
        url: decodeEntities(href).startsWith("http")
          ? decodeEntities(href)
          : `https://phg.tbe.taleo.net${decodeEntities(href)}`,
        remote: isHomeOffice,
        key: rid ? `taleo:${rid}` : undefined,
        // "Multiple Locations" spans the company's footprint,
        // including Texas. Keep it as a statewide role.
        forceTexas: /multiple locations/i.test(location),
      });
    }
    if (found === 0 || pages >= 40) break;
    rowFrom += found;
    pages++;
  }
  return roles;
}

// Parser registry. Adding a board type = one function here + the
// parser name in jobs-companies.mjs. Unknown names fail loudly.
const PARSERS = { paylocity: parsePaylocity, ukg: parseUkg, taleo: parseTaleo };

// Exported for offline testing (node --input-type=module -e).
export { parsePaylocity, parseUkg, parseTaleo, classify, normUrl };

// ------------------------------------------------------------------
// Notion (direct REST, same shapes as sync.mjs / worker.js)
// ------------------------------------------------------------------

function requireEnv() {
  if (!token) {
    console.error("NOTION_TOKEN is not set.");
    process.exit(1);
  }
  if (!jobsDb) {
    console.error("DATABASE_ID_JOBS is not set.");
    process.exit(1);
  }
}

async function notionFetch(path, options = {}) {
  const res = await fetch(NOTION_API + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Notion " + path + " failed: " + (body.message || res.status));
  return body;
}

async function queryAllJobs() {
  const rows = [];
  let cursor = undefined;
  do {
    const body = await notionFetch("/databases/" + jobsDb + "/query", {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    rows.push(...(body.results || []));
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return rows.map((p) => ({
    id: p.id,
    title: (p.properties?.Title?.title || []).map((t) => t.plain_text).join(""),
    link: p.properties?.Link?.url || "",
    status: p.properties?.Status?.select?.name || "",
    origin: p.properties?.Origin?.select?.name || "",
  }));
}

const prop = {
  title: (v) => ({ title: [{ text: { content: String(v || "") } }] }),
  richText: (v) => ({ rich_text: [{ text: { content: String(v || "") } }] }),
  url: (v) => ({ url: v || null }),
  date: (v) => (v ? { date: { start: v } } : { date: null }),
  select: (v) => (v ? { select: { name: v } } : { select: null }),
  multiSelect: (arr) => ({ multi_select: (arr || []).map((n) => ({ name: n })) }),
};

async function notionWrite(fn) {
  try {
    return await fn();
  } catch (err) {
    if (/429|5\d\d/.test(err.message)) {
      await sleep(5000);
      return fn();
    }
    throw err;
  }
}

async function createJobRow(role, expiry) {
  const properties = {
    Title: prop.title(role.title),
    Organization: prop.richText(role.organization),
    Description: prop.richText(role.description),
    Link: prop.url(role.link),
    "Expiry date": prop.date(expiry),
    Status: prop.select("Filled"),
    Origin: prop.select("Auto"),
    Serves: prop.multiSelect(role.serves),
  };
  return notionWrite(() =>
    notionFetch("/pages", {
      method: "POST",
      body: JSON.stringify({ parent: { database_id: jobsDb }, properties }),
    })
  );
}

async function updateJobRow(pageId, properties) {
  return notionWrite(() =>
    notionFetch("/pages/" + pageId, { method: "PATCH", body: JSON.stringify({ properties }) })
  );
}

// ------------------------------------------------------------------
// Reconcile: pure function of (existing rows, feed roles).
// Exported so it can be unit-checked without touching Notion.
// ------------------------------------------------------------------

export function reconcile(existingRows, feedRoles, expiry) {
  const byLink = new Map();
  for (const r of existingRows) if (r.link) byLink.set(normUrl(r.link), r);
  const seenLinks = new Set();
  const creates = [];
  const refreshes = [];
  for (const role of feedRoles) {
    const key = normUrl(role.link);
    seenLinks.add(key);
    const existing = byLink.get(key);
    if (!existing) {
      creates.push({ ...role, expiry });
      continue;
    }
    // Rows the pull did not create (form submissions) are never
    // touched, even when the same role is also on a board.
    if (existing.origin !== "Auto") continue;
    if (existing.status === "Expired") {
      // Closed, then reposted: back to review.
      refreshes.push({ pageId: existing.id, title: existing.title, relist: true, expiry });
    } else if (existing.status === "Filled" || existing.status === "Active") {
      refreshes.push({ pageId: existing.id, title: existing.title, expiry });
    }
  }
  const expires = [];
  for (const r of existingRows) {
    if (r.origin !== "Auto") continue;
    if (r.status !== "Filled" && r.status !== "Active") continue;
    if (r.link && !seenLinks.has(normUrl(r.link))) {
      expires.push({ pageId: r.id, title: r.title });
    }
  }
  return { creates, refreshes, expires };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, parseOnly: false, existing: null, planOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--parse-only") args.parseOnly = true;
    else if (argv[i] === "--existing") args.existing = argv[++i];
    else if (argv[i] === "--plan-out") args.planOut = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date();
  const expiry = new Date(today.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // ---- 1. Fetch + parse + classify every board ----
  const feedRoles = [];
  const perCompany = [];
  for (const company of COMPANIES) {
    const parse = PARSERS[company.parser];
    if (!parse) throw new Error(`No parser named "${company.parser}" for ${company.name}`);
    let parsed = [];
    let boardError = "";
    try {
      for (const board of company.boards) {
        const rows = await parse(board);
        parsed.push(...rows);
      }
    } catch (err) {
      boardError = err.message;
      console.warn(`WARN: ${company.name} board failed (${boardError}); continuing with other companies.`);
    }
    // Within-run dedupe: by parser key first, then by URL.
    const seen = new Set();
    const unique = [];
    for (const r of parsed) {
      const k = r.key || normUrl(r.url);
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(r);
    }
    let kept = 0;
    for (const r of unique) {
      const c = classify(r);
      if (!c) continue;
      kept++;
      feedRoles.push({
        title: r.title,
        organization: company.org,
        description: c.display,
        link: r.url,
        serves: c.serves,
      });
    }
    perCompany.push({
      company: company.name,
      parsed: unique.length,
      kept,
      error: boardError,
      examples: feedRoles
        .filter((f) => f.organization === company.org)
        .slice(0, 3)
        .map((f) => ({ title: f.title, location: f.description, serves: f.serves })),
    });
  }

  console.log("--- jobs pull: boards ---");
  for (const p of perCompany) {
    console.log(
      `${p.company}: parsed ${p.parsed}, kept ${p.kept} Texas/remote` +
        (p.error ? ` (board error: ${p.error})` : "")
    );
    for (const e of p.examples) {
      console.log(`  e.g. ${e.title} — ${e.location} — [${e.serves.join(", ")}]`);
    }
  }
  if (args.parseOnly) {
    console.log(`Total roles in scope: ${feedRoles.length}`);
    return;
  }

  // ---- 2. Existing rows: live query, or a JSON file (local runs) ----
  let existingRows;
  if (args.existing) {
    const { readFileSync } = await import("node:fs");
    existingRows = JSON.parse(readFileSync(args.existing, "utf8"));
  } else {
    requireEnv();
    existingRows = await queryAllJobs();
  }

  // ---- 3. Reconcile ----
  const plan = reconcile(existingRows, feedRoles, expiry);
  const summary = {
    companies: perCompany.map(({ company, parsed, kept, error }) => ({ company, parsed, kept, error })),
    creates: plan.creates.length,
    refreshes: plan.refreshes.length,
    relists: plan.refreshes.filter((r) => r.relist).length,
    expires: plan.expires.length,
  };

  if (args.planOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args.planOut, JSON.stringify({ summary, plan }, null, 2) + "\n");
    console.log(`Plan written to ${args.planOut}`);
  }

  console.log("--- jobs pull: plan ---");
  console.log(
    `creates ${summary.creates}, expiry refreshes ${summary.refreshes} ` +
      `(${summary.relists} relists), closes ${summary.expires}`
  );
  for (const c of plan.creates.slice(0, 10)) {
    console.log(`  + ${c.organization}: ${c.title} — ${c.description} [${c.serves.join(", ")}]`);
  }
  if (plan.creates.length > 10) console.log(`  ... and ${plan.creates.length - 10} more creates`);
  for (const e of plan.expires.slice(0, 10)) console.log(`  x expire: ${e.title}`);
  if (args.dryRun || args.planOut) {
    console.log(args.dryRun ? "Dry run: nothing written." : "Plan only: nothing written.");
    return;
  }

  // ---- 4. Execute (live run only) ----
  requireEnv();
  for (const c of plan.creates) {
    await createJobRow(c, c.expiry);
    await sleep(WRITE_PAUSE_MS);
  }
  for (const r of plan.refreshes) {
    const props = { "Expiry date": prop.date(r.expiry) };
    if (r.relist) props.Status = prop.select("Filled");
    await updateJobRow(r.pageId, props);
    await sleep(WRITE_PAUSE_MS);
  }
  for (const e of plan.expires) {
    await updateJobRow(e.pageId, { Status: prop.select("Expired") });
    await sleep(WRITE_PAUSE_MS);
  }
  console.log("Done.");
}

const isMain =
  process.argv[1] &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("Jobs pull failed: " + err.message);
    process.exit(1);
  });
}
