// Echode: Notion -> per-city data.js sync.
// Runs in the GitHub Action (see .github/workflows/echode-notion-sync.yml)
// and locally: NOTION_TOKEN=... DATABASE_ID_DIRECTORY=... \
//   DATABASE_ID_EVENTS=... DATABASE_ID_JOBS=... node automation/sync.mjs
// Regenerates atx/data.js and tx/data.js from the shared ECHODE
// Notion workspace (the same databases that feed HDN). Each city
// page publishes only rows that serve it.
//
// PUBLISH RULES (mirror the HDN sync's gates, plus the Serves gate):
//   Directory: Status = "Active" only, and Serves includes the city.
//   Events: Status = "Upcoming" AND Source does NOT contain
//     "PENDING REVIEW", and Serves includes the city.
//   Jobs: Status = "Active" only, and Serves includes the city.
//   News: Status = "Published" only; each city page gets the
//     newest Published item whose Serves includes it (or null).
//     News is best-effort: if the News database cannot be read
//     (for example the integration has not been connected to it
//     yet), the sync warns and publishes news: null rather than
//     failing the whole run.
// The approval gate is absolute: each database publishes only rows
// in its approved state, and if a database has no Status property,
// the sync FAILS for that database and publishes nothing from it.
//
// PROPERTY MAP (verified against the live databases 2026-10-23):
//   Directory: Name (title), Category (select), Description
//     (rich_text), Website (url), Facebook (url), Instagram (url),
//     LinkedIn (url), Logo (files), Last verified (date),
//     Status (select), Serves (multi-select), Origin (select).
//   Events: Name (title), Date (date), Location (rich_text),
//     Description (rich_text), Link (url), Source (rich_text),
//     Status (select), Serves (multi-select).
//   Jobs: Title (title), Organization (rich_text), Description
//     (rich_text), Link (url), Expiry date (date), Status (select),
//     Serves (multi-select).
//   News (Echode News): Headline (title), Link (url), Date (date),
//     Serves (multi-select), Status (select). Its database ID is
//     baked in below (DATABASE_ID_NEWS env can override); database
//     IDs are identifiers, not secrets.
// Logos: a Directory row's Logo file is fetched and embedded as a
// data URI; otherwise the previous data.js logo for that record is
// kept (same behavior as the HDN sync).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";
const MAX_LOGO_BYTES = 500_000;

// Cities published by this sync. Add a row here when a new city
// page opens (Phase 7); the code is the Serves value in Notion.
const CITIES = [
  { code: "ATX", dir: "atx" },
  { code: "TX", dir: "tx" },
];

// Echode News database (created 2026-10-23 in the ECHODE workspace).
const NEWS_DB_ID = process.env.DATABASE_ID_NEWS || "8946b47d-e077-4a48-b2ef-90bd93a210bd";

const MAP = {
  directory: {
    category: "Category",
    description: "Description",
    website: "Website",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    verified: "Last verified",
    logo: "Logo",
    status: "Status",
    serves: "Serves",
  },
  events: {
    date: "Date",
    location: "Location",
    description: "Description",
    link: "Link",
    source: "Source",
    status: "Status",
    serves: "Serves",
  },
  news: {
    link: "Link",
    date: "Date",
    status: "Status",
    serves: "Serves",
  },
  jobs: {
    organization: "Organization",
    description: "Description",
    link: "Link",
    status: "Status",
    serves: "Serves",
  },
};

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error("NOTION_TOKEN is not set.");
  process.exit(1);
}
for (const key of ["DATABASE_ID_DIRECTORY", "DATABASE_ID_EVENTS", "DATABASE_ID_JOBS"]) {
  if (!process.env[key]) {
    console.error(key + " is not set.");
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

async function getSchema(dbId) {
  const db = await notionFetch("/databases/" + dbId);
  const props = {};
  let titleProp = null;
  for (const [name, def] of Object.entries(db.properties || {})) {
    props[name] = def.type;
    if (def.type === "title") titleProp = name;
  }
  return { titleProp, props };
}

async function queryByStatus(dbId, statusProp, statusValue) {
  const rows = [];
  let cursor = undefined;
  do {
    const body = await notionFetch("/databases/" + dbId + "/query", {
      method: "POST",
      body: JSON.stringify({
        filter: { property: statusProp, select: { equals: statusValue } },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    rows.push(...(body.results || []));
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return rows;
}

function readTitle(page, schema) {
  const p = page.properties?.[schema.titleProp];
  return p?.title?.map((t) => t.plain_text).join("") || "";
}
function readText(page, name) {
  const p = page.properties?.[name];
  if (!p) return "";
  if (p.type === "rich_text") return (p.rich_text || []).map((t) => t.plain_text).join("");
  if (p.type === "title") return (p.title || []).map((t) => t.plain_text).join("");
  return "";
}
// Category may be a select (one value) or, after the 2026-10-23
// multi-category conversion, a multi_select (up to two values:
// primary plus one more). Read either shape into a list.
function readCategoryList(page, name) {
  const p = page.properties?.[name];
  if (!p) return [];
  if (p.type === "multi_select") return (p.multi_select || []).map((o) => o.name).filter(Boolean).slice(0, 2);
  if (p.type === "select") return p.select?.name ? [p.select.name] : [];
  return [];
}

function readSelect(page, name) {
  return page.properties?.[name]?.select?.name || "";
}
function readUrl(page, name) {
  return page.properties?.[name]?.url || "";
}
function readDate(page, name) {
  return page.properties?.[name]?.date?.start || "";
}
function readMultiSelect(page, name) {
  const p = page.properties?.[name];
  if (!p || p.type !== "multi_select") return [];
  return (p.multi_select || []).map((o) => o.name);
}
function readFileUrl(page, name) {
  const files = page.properties?.[name]?.files || [];
  const f = files[0];
  if (!f) return "";
  if (f.type === "file") return f.file?.url || "";
  if (f.type === "external") return f.external?.url || "";
  return "";
}

async function logoToDataUri(url) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_LOGO_BYTES) {
      console.warn("Logo over size cap, skipping: " + url.slice(0, 80));
      return "";
    }
    return "data:" + type + ";base64," + buf.toString("base64");
  } catch (err) {
    console.warn("Logo fetch failed, skipping: " + err.message);
    return "";
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function isInstagramUrl(u) {
  if (!u) return false;
  try {
    return new URL(u).hostname.replace(/^www\./, "") === "instagram.com";
  } catch {
    return false;
  }
}

function readOldData(path) {
  if (!existsSync(path)) return null;
  const src = readFileSync(path, "utf8");
  const match = src.match(/const SITE_DATA = (\{[\s\S]*\});/);
  if (!match) return null;
  try {
    return new Function("return (" + match[1] + ")")();
  } catch {
    return null;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // ---- Directory (Status = "Active", gated per city by Serves) ----
  const dirDb = process.env.DATABASE_ID_DIRECTORY;
  const dirSchema = await getSchema(dirDb);
  if (!("Status" in dirSchema.props)) {
    throw new Error("Directory has no Status property. Refusing to publish.");
  }
  const dirRows = await queryByStatus(dirDb, MAP.directory.status, "Active");
  const directoryAll = [];
  for (const page of dirRows) {
    const m = MAP.directory;
    const name = readTitle(page, dirSchema);
    if (!name) continue;
    directoryAll.push({
      name,
      categoryList: readCategoryList(page, m.category),
      description: readText(page, m.description),
      websiteRaw: readUrl(page, m.website),
      facebook: readUrl(page, m.facebook),
      instagramRaw: ("Instagram" in dirSchema.props) ? readUrl(page, m.instagram) : "",
      linkedin: readUrl(page, m.linkedin),
      verified: readDate(page, m.verified),
      logoUrl: readFileUrl(page, m.logo),
      serves: readMultiSelect(page, m.serves),
    });
  }

  // ---- Events (Upcoming, no PENDING REVIEW marker, Serves gate) ----
  const evDb = process.env.DATABASE_ID_EVENTS;
  const evSchema = await getSchema(evDb);
  if (!("Status" in evSchema.props)) {
    throw new Error("Events has no Status property. Refusing to publish.");
  }
  const evRows = await queryByStatus(evDb, MAP.events.status, "Upcoming");
  const eventsAll = evRows
    .map((page) => {
      const m = MAP.events;
      return {
        name: readTitle(page, evSchema),
        date: readDate(page, m.date),
        location: readText(page, m.location),
        description: readText(page, m.description),
        link: readUrl(page, m.link),
        source: readText(page, m.source),
        serves: readMultiSelect(page, m.serves),
      };
    })
    .filter((e) => e.name && !String(e.source || "").includes("PENDING REVIEW"));

  // ---- Jobs -> postings (Status = "Active", Serves gate) ----
  const jobDb = process.env.DATABASE_ID_JOBS;
  const jobSchema = await getSchema(jobDb);
  if (!("Status" in jobSchema.props)) {
    throw new Error("Jobs has no Status property. Refusing to publish.");
  }
  const jobRows = await queryByStatus(jobDb, MAP.jobs.status, "Active");
  const postingsAll = jobRows
    .map((page) => {
      const m = MAP.jobs;
      return {
        name: readTitle(page, jobSchema),
        organization: readText(page, m.organization),
        description: readText(page, m.description),
        link: readUrl(page, m.link),
        serves: readMultiSelect(page, m.serves),
      };
    })
    .filter((j) => j.name);

  // ---- News (Published only; newest per city wins) ----
  let newsAll = [];
  try {
    const newsSchema = await getSchema(NEWS_DB_ID);
    if (!("Status" in newsSchema.props)) throw new Error("News has no Status property.");
    const newsRows = await queryByStatus(NEWS_DB_ID, MAP.news.status, "Published");
    newsAll = newsRows
      .map((page) => ({
        title: readTitle(page, newsSchema),
        link: readUrl(page, MAP.news.link),
        date: readDate(page, MAP.news.date),
        created: page.created_time || "",
        serves: readMultiSelect(page, MAP.news.serves),
      }))
      .filter((n) => n.title && n.link)
      .sort((a, b) => (b.date || b.created).localeCompare(a.date || a.created));
  } catch (err) {
    console.warn("News skipped (continuing without it): " + err.message);
    newsAll = [];
  }

  // ---- Emit one data.js per city ----
  for (const city of CITIES) {
    const dataPath = city.dir + "/data.js";
    const old = readOldData(dataPath);
    const oldLogos = new Map(((old && old.directory) || []).map((r) => [r.name, r.logo || ""]));
    const oldByName = new Map(((old && old.directory) || []).map((r) => [r.name, r]));

    const directory = [];
    for (const r of directoryAll) {
      if (!r.serves.includes(city.code)) continue;
      let logo = r.logoUrl ? await logoToDataUri(r.logoUrl) : "";
      if (!logo) logo = oldLogos.get(r.name) || "";
      let website = r.websiteRaw;
      let ig = r.instagramRaw || (oldByName.get(r.name)?.instagram || "");
      if (isInstagramUrl(website)) {
        if (!ig) ig = website;
        website = "";
      }
      directory.push({
        name: r.name,
        category: r.categoryList[0] || "",
        categories: r.categoryList,
        description: r.description,
        website,
        facebook: r.facebook,
        instagram: ig,
        linkedin: r.linkedin,
        verified: r.verified || oldByName.get(r.name)?.verified || today,
        logo,
      });
    }
    directory.sort(byName);

    const events = eventsAll
      .filter((e) => e.serves.includes(city.code))
      .map(({ source, serves, ...rest }) => rest)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const postings = postingsAll
      .filter((j) => j.serves.includes(city.code))
      .map((j) => ({
        name: j.name,
        category: j.organization || "Job Opening",
        description: j.description,
        website: j.link,
        facebook: "",
        instagram: "",
        linkedin: "",
        verified: today,
        logo: "",
      }))
      .sort(byName);

    const newsHit = newsAll.find((n) => n.serves.includes(city.code));
    const next = {
      generated: today,
      source: "Notion CMS, ECHODE workspace",
      city: city.code,
      directory,
      events,
      postings,
      news: newsHit ? { title: newsHit.title, link: newsHit.link, date: newsHit.date } : null,
    };
    const strip = (d) => {
      if (!d) return "";
      const copy = { ...d };
      delete copy.generated;
      return JSON.stringify(copy);
    };
    if (old && strip(next) === strip(old)) {
      console.log(city.code + ": no changes. " + dataPath + " untouched.");
      continue;
    }
    writeFileSync(dataPath, "const SITE_DATA = " + JSON.stringify(next) + ";\n");
    console.log(
      city.code + ": wrote " + dataPath + ": " + directory.length +
      " directory, " + events.length + " events, " + postings.length + " postings."
    );
  }
}

main().catch((err) => {
  console.error("Sync failed: " + err.message);
  process.exit(1);
});
