// Echode submission intake (Phase 4).
// Cloudflare Worker: receives the Echode suggest / get-listed forms,
// writes a row to Notion, and emails an acknowledgment plus an owner
// notification. Modeled directly on the HDN intake Worker
// (hdn-form-intake) with three Echode additions: a News type that
// lands in the Echode News database as a Draft, a City field that
// becomes the Serves tag on every row, and Origin = "Submitted".
// No framework, no wrangler dependencies. Plain fetch handler.
//
// SETUP: paste this file into a Cloudflare Worker named
// echode-form-intake and set these secrets (dashboard Settings >
// Variables and Secrets):
//   NOTION_TOKEN (the same "HDN Website Automation" token),
//   DATABASE_ID_DIRECTORY, DATABASE_ID_EVENTS, DATABASE_ID_JOBS,
//   DATABASE_ID_MESSAGES, DATABASE_ID_NEWS,
//   RESEND_API_KEY (the same key the HDN Worker uses),
//   FROM_EMAIL, OWNER_EMAIL.
// NOTE: redeploying a Worker wipes its secret bindings; re-save the
// secrets after any redeploy (lesson from the HDN Worker).
// FROM_EMAIL must be an address on a Resend-verified domain.
// info@houstondeafnetwork.com works today; an @echode.com sender
// needs echode.com verified in Resend first.
//
// PROPERTY MAP, verified against the live databases 2026-10-23.
//   Directory: Name (title), Category (select, 9 options below),
//     Description (rich_text), Website (url), Facebook (url),
//     Instagram (url), LinkedIn (url), Logo (files),
//     Last verified (date), Notes (rich_text), Status (select:
//     Active / Pending review / Archived), Serves (multi-select),
//     Origin (select).
//   Events: Name (title), Date (date), Location (rich_text),
//     Description (rich_text), Link (url), Source (rich_text),
//     Status (select), Serves (multi-select), Origin (select).
//   Jobs: Title (title), Organization (rich_text), Description
//     (rich_text), Link (url), Expiry date (date), Status (select),
//     Serves (multi-select), Origin (select).
//   Messages: Name (title), Email (email), Type (select),
//     Message (rich_text), Status (select: New / Replied / Done),
//     Submitted (date).
//   News (Echode News): Headline (title), Link (url), Date (date),
//     Serves (multi-select), Status (select: Published / Draft).
//
// HOLDING-STATE RULES (the approval gate). Nothing publishes until
// the owner approves it in Notion; the syncs enforce the same rules
// on the publish side.
//   Directory: Status = "Pending review" (owner flips to "Active").
//   Events: Status = "Upcoming" AND Source = "Form submission -
//     PENDING REVIEW" (the sync treats that marker as unpublished;
//     owner approves by clearing the marker).
//   Jobs: Status = "Filled" (owner flips to "Active").
//   News: Status = "Draft" (owner flips to "Published").
//   Messages: Status = "New" (a queue, never published).
// The Worker reads each target database schema at runtime and only
// writes to properties that actually exist, so a missing optional
// property never breaks intake.

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

// Only these origins may POST. The production domain and the
// GitHub Pages preview.
const ALLOWED_ORIGINS = [
  "https://echode.com",
  "https://www.echode.com",
  "https://longster.github.io",
];

const LISTING_TYPES = ["general", "business", "event", "job", "resource", "correction", "other", "news", "city"];

// Route the form's listing_type to a Notion database (env key).
const TYPE_TO_DB = {
  business: "DATABASE_ID_DIRECTORY",
  resource: "DATABASE_ID_DIRECTORY",
  event: "DATABASE_ID_EVENTS",
  job: "DATABASE_ID_JOBS",
  news: "DATABASE_ID_NEWS",
  general: "DATABASE_ID_MESSAGES",
  correction: "DATABASE_ID_MESSAGES",
  other: "DATABASE_ID_MESSAGES",
  city: "DATABASE_ID_MESSAGES",
};

// The form's City labels -> Serves codes. "Another Texas city" and
// anything unrecognized get no Serves tag; the owner tags the row
// during review.
const CITY_TO_SERVES = {
  "Houston": "HTX",
  "Austin": "ATX",
  "Dallas - Fort Worth": "DFW",
  "San Antonio": "SAT",
  "Texas statewide": "TX",
};

// Best-effort per-IP rate limit: 5 submissions per minute. In-memory
// only, so it resets when the Worker isolate recycles. This is spam
// friction, not a security boundary.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(origin, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ""));
}

function firstIsoDate(text) {
  const m = String(text || "").match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  return m ? m[0] : "";
}

// Exact Category option names in the Directory (all 9). A submission
// only gets a Category when the text names one exactly; otherwise
// the owner picks it during review. A non-matching select value
// would make Notion reject the whole page create.
const DIRECTORY_CATEGORIES = [
  "Interpreting Agencies",
  "Organizations & Services",
  "Churches & Ministries",
  "Education & Career",
  "Health & Wellness",
  "Deaf-Owned Business",
  "Deaf-Friendly Business",
  "Social & Meetup",
  "Deaf-Friendly Employers",
];

function matchCategory(text) {
  const lower = String(text || "").toLowerCase();
  for (const c of DIRECTORY_CATEGORIES) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return "";
}

// Split all URLs in the text by destination. The first non-social
// URL is the listing's Website / Link. Social URLs go to their own
// properties, or to Notes when no such property exists.
function classifyUrls(text) {
  const urls = (String(text || "").match(/https?:\/\/[^\s<>"')]+/gi) || []).map((u) =>
    u.replace(/[.,;:!?]+$/, "")
  );
  const out = { website: "", facebook: "", instagram: "", linkedin: "", any: "" };
  for (const u of urls) {
    if (!out.any) out.any = u;
    const host = (u.match(/^https?:\/\/([^/]+)/i) || [])[1] || "";
    if (/facebook\.com$/i.test(host) || host.endsWith(".facebook.com")) {
      if (!out.facebook) out.facebook = u;
    } else if (/instagram\.com$/i.test(host) || host.endsWith(".instagram.com")) {
      if (!out.instagram) out.instagram = u;
    } else if (/linkedin\.com$/i.test(host) || host.endsWith(".linkedin.com")) {
      if (!out.linkedin) out.linkedin = u;
    } else if (!out.website) {
      out.website = u;
    }
  }
  return out;
}

// Value after a "Label:" line, e.g. "Location: 123 Main St". Returns
// "" when no line starts with that label.
function labeledLine(lines, label) {
  const prefix = label.toLowerCase() + ":";
  for (const l of lines) {
    if (l.toLowerCase().startsWith(prefix)) return l.slice(prefix.length).trim();
  }
  return "";
}

// Split the free-text Details box into structured fields. Heuristic:
// first non-empty line = name/title, first non-social URL = link,
// rest = description. The full raw text is always kept (Notes or the
// owner notification email), so a bad parse loses nothing.
function parseDetails(message) {
  const lines = String(message || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0] || "Untitled submission";
  const urls = classifyUrls(message);
  const rest = lines.slice(1).join("\n");
  const description = rest || message;
  return { name, link: urls.website, description, raw: String(message || ""), urls, lines };
}

// Notion property value builders.
const prop = {
  title: (v) => ({ title: [{ text: { content: String(v || "") } }] }),
  richText: (v) => ({ rich_text: [{ text: { content: String(v || "") } }] }),
  url: (v) => ({ url: v || null }),
  email: (v) => ({ email: v || null }),
  date: (v) => (v ? { date: { start: v } } : { date: null }),
  select: (v) => (v ? { select: { name: v } } : { select: null }),
  multiSelect: (arr) => ({ multi_select: (arr || []).map((n) => ({ name: n })) }),
};

async function notionFetch(env, path, options = {}) {
  const res = await fetch(NOTION_API + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error("Notion " + path + " failed: " + (body.message || res.status));
  }
  return body;
}

// Read the database schema so we only write to properties that exist.
// Returns { titleProp: "Name", props: { Name: "title", ... } }.
async function getSchema(env, dbId) {
  const db = await notionFetch(env, "/databases/" + dbId);
  const props = {};
  let titleProp = null;
  for (const [name, def] of Object.entries(db.properties || {})) {
    props[name] = def.type;
    if (def.type === "title") titleProp = name;
  }
  return { titleProp, props };
}

function setIf(props, schema, name, type, value) {
  if (!(name in schema.props)) return;
  if (schema.props[name] !== type) return;
  if (type === "title") props[name] = prop.title(value);
  else if (type === "rich_text") props[name] = prop.richText(value);
  else if (type === "url") props[name] = prop.url(value);
  else if (type === "email") props[name] = prop.email(value);
  else if (type === "date") props[name] = prop.date(value);
  else if (type === "select") props[name] = prop.select(value);
  else if (type === "multi_select") props[name] = prop.multiSelect(value);
}

// The Echode stamp: which city the submission serves, and that it
// came from the form. Both properties are schema-gated.
function stampCity(props, schema, servesCodes) {
  const codes = [...new Set((servesCodes || []).filter(Boolean))];
  if (codes.length) setIf(props, schema, "Serves", "multi_select", codes);
  setIf(props, schema, "Origin", "select", "Submitted");
}

// Send one email through Resend. Throws on failure; callers catch it
// so a mail failure never fails the submission itself.
async function sendEmail(env, to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error("Resend failed: " + (body.message || res.status));
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = corsHeaders(allowed ? origin : ALLOWED_ORIGINS[0]);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return jsonResponse(origin, 405, { ok: false, error: "method_not_allowed" });
    }
    if (!allowed) {
      return jsonResponse(origin, 403, { ok: false, error: "origin_not_allowed" });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return jsonResponse(origin, 429, { ok: false, error: "rate_limited" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(origin, 400, { ok: false, error: "bad_json" });
    }

    // Honeypot: bots fill it, humans never see it. Quietly accept and
    // drop the submission so the bot learns nothing.
    if (body.company) {
      return jsonResponse(origin, 200, { ok: true });
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const type = String(body.listing_type || "").trim();
    const message = String(body.message || "").trim();
    const cityLabel = String(body.city || "").trim();
    if (!name || !isEmail(email) || !LISTING_TYPES.includes(type) || !message) {
      return jsonResponse(origin, 400, { ok: false, error: "invalid_input" });
    }
    // Serves can carry several tags: the primary city plus any
    // "also serves" labels the form sent (e.g. a Houston office
    // that also serves all of Texas gets HTX + TX).
    const alsoLabels = Array.isArray(body.also_serves) ? body.also_serves : [];
    const servesCodes = [CITY_TO_SERVES[cityLabel] || "",
      ...alsoLabels.map((l) => CITY_TO_SERVES[String(l || "").trim()] || "")];
    const today = new Date().toISOString().slice(0, 10);

    const dbKey = TYPE_TO_DB[type];
    const dbId = env[dbKey];
    if (!dbId) {
      return jsonResponse(origin, 500, { ok: false, error: "db_not_configured" });
    }

    const parsed = parseDetails(message);
    let page;
    try {
      const schema = await getSchema(env, dbId);
      const props = {};
      const isMessages = dbKey === "DATABASE_ID_MESSAGES";

      if (isMessages) {
        // General questions, corrections, new-city suggestions: a
        // queue, not a listing. Type only ever takes options that
        // exist in the Messages database; a new-city suggestion is
        // labeled in the message text itself.
        setIf(props, schema, schema.titleProp, "title", name);
        setIf(props, schema, "Email", "email", email);
        const TYPE_LABELS = { general: "General question", correction: "Correction", other: "Something else", city: "Something else" };
        setIf(props, schema, "Type", "select", TYPE_LABELS[type] || "Something else");
        const fullMessage = type === "city"
          ? "New city suggestion: " + (cityLabel || "not specified") + "\n\n" + message
          : message;
        setIf(props, schema, "Message", "rich_text", fullMessage);
        setIf(props, schema, "Status", "select", "New");
        setIf(props, schema, "Submitted", "date", today);
      } else if (dbKey === "DATABASE_ID_NEWS") {
        // News tips land as Drafts. The owner reviews the headline
        // and link, then flips Status to Published; the daily sync
        // picks it up from there. Headline = first line of the
        // details, Link = first URL of any kind, Date = a date in
        // the text or today.
        setIf(props, schema, schema.titleProp, "title", parsed.name);
        setIf(props, schema, "Link", "url", parsed.urls.any || parsed.link);
        setIf(props, schema, "Date", "date", firstIsoDate(message) || today);
        setIf(props, schema, "Status", "select", "Draft");
        stampCity(props, schema, servesCodes);
        // News has no Notes property today. If the owner adds one,
        // the submitter trail lands there automatically.
        setIf(props, schema, "Notes", "rich_text",
          "Submitted by: " + name + " (" + email + ")\n\n" + parsed.raw);
      } else if (dbKey === "DATABASE_ID_EVENTS") {
        // Holding state: Status = "Upcoming" + Source marker. The
        // sync treats any Source containing "PENDING REVIEW" as
        // unpublished. Owner approves by clearing the Source marker.
        setIf(props, schema, schema.titleProp, "title", parsed.name);
        setIf(props, schema, "Date", "date", firstIsoDate(message));
        const loc = labeledLine(parsed.lines, "Location");
        if (loc) setIf(props, schema, "Location", "rich_text", loc);
        setIf(props, schema, "Description", "rich_text", parsed.description);
        setIf(props, schema, "Link", "url", parsed.link);
        setIf(props, schema, "Source", "rich_text", "Form submission - PENDING REVIEW");
        setIf(props, schema, "Status", "select", "Upcoming");
        stampCity(props, schema, servesCodes);
        setIf(props, schema, "Notes", "rich_text",
          "Submitted by: " + name + " (" + email + ")\n\n" + parsed.raw);
      } else if (dbKey === "DATABASE_ID_JOBS") {
        // Holding state: Status = "Filled". The sync treats "Filled"
        // as unpublished. Owner approves by flipping to "Active".
        setIf(props, schema, schema.titleProp, "title", parsed.name);
        const org = labeledLine(parsed.lines, "Organization");
        if (org) setIf(props, schema, "Organization", "rich_text", org);
        setIf(props, schema, "Description", "rich_text", parsed.description);
        setIf(props, schema, "Link", "url", parsed.link);
        // Expiry only when a date on a line mentioning "expir" is found.
        let expiry = "";
        for (const l of parsed.lines) {
          if (/expir/i.test(l)) { expiry = firstIsoDate(l); break; }
        }
        if (expiry) setIf(props, schema, "Expiry date", "date", expiry);
        setIf(props, schema, "Status", "select", "Filled");
        stampCity(props, schema, servesCodes);
        setIf(props, schema, "Notes", "rich_text",
          "Submitted by: " + name + " (" + email + ")\n\n" + parsed.raw);
      } else {
        // Directory (business / resource). Status = "Pending review".
        const notes = [];
        notes.push("Submitted by: " + name + " (" + email + ")");
        notes.push("");
        notes.push(parsed.raw);
        setIf(props, schema, schema.titleProp, "title", parsed.name);
        // Category was a select and is a multi_select after the
        // 2026-10-23 conversion; write whichever shape the field has.
        const catMatch = matchCategory(message);
        if (catMatch && schema.props["Category"] === "multi_select") {
          props["Category"] = prop.multiSelect([catMatch]);
        } else {
          setIf(props, schema, "Category", "select", catMatch);
        }
        setIf(props, schema, "Description", "rich_text", parsed.description);
        setIf(props, schema, "Website", "url", parsed.urls.website);
        setIf(props, schema, "Facebook", "url", parsed.urls.facebook);
        setIf(props, schema, "Instagram", "url", parsed.urls.instagram);
        setIf(props, schema, "LinkedIn", "url", parsed.urls.linkedin);
        setIf(props, schema, "Notes", "rich_text", notes.join("\n"));
        setIf(props, schema, "Status", "select", "Pending review");
        stampCity(props, schema, servesCodes);
      }

      page = await notionFetch(env, "/pages", {
        method: "POST",
        body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
      });
    } catch (err) {
      console.error("Notion create failed:", err.message);
      return jsonResponse(origin, 500, { ok: false, error: "notion_failed" });
    }

    // Emails are best-effort. A mail failure must not fail the submission.
    const pageUrl = page.url || "";
    const cityBit = cityLabel ? " (" + cityLabel + ")" : "";
    ctx.waitUntil(
      (async () => {
        try {
          await sendEmail(
            env,
            email,
            "Thanks for your Echode submission",
            "Hi " + name + ",\n\nThanks for sending this in. Every Echode suggestion is reviewed by a person before anything goes live, and community listings are always free. I will follow up if I need anything else.\n\nLong Duong\nEchode"
          );
        } catch (err) {
          console.error("Ack email failed:", err.message);
        }
        try {
          await sendEmail(
            env,
            env.OWNER_EMAIL,
            "New Echode submission: " + type + cityBit + " from " + name,
            "A new " + type + " submission came in from " + name + cityBit + ".\n\nReview it in Notion: " + pageUrl + "\n\nDetails:\n" + message
          );
        } catch (err) {
          console.error("Owner notification failed:", err.message);
        }
      })()
    );

    return jsonResponse(origin, 200, { ok: true });
  },
};
