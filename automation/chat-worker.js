// Echode AI chat (prepared 2026-11-08, NOT YET DEPLOYED).
// Cloudflare Worker: answers visitor questions ONLY from the published
// Echode + HoustonDeafNetwork directory data (the 5 live data.js files).
// No framework, no wrangler dependencies. Plain fetch handler.
//
// SETUP: deploy as a Cloudflare Worker named echode-ai-chat.
// Bindings: one AI binding named AI (Workers AI), plus one KV
// namespace binding named QUESTIONS (namespace
// echode-ai-chat-questions) for anonymous question logging.
// NO secrets: nothing in this Worker needs a key, a token, or any
// credential. The deploy helper pattern in
// ~/workspace/custom-connectors/custom.cloudflare/bin/deploy_hdn_worker.py
// adapts directly (new script name, ai + kv_namespace bindings, no
// plain-text vars, no secrets to re-save).
//
// QUESTION LOGGING: every question that reaches the model and gets an
// answer is logged to KV (including "I don't know" answers, which are
// the most useful for FAQs). Rate-limited (429) and invalid requests
// are never logged. Each entry stores ONLY the raw question text, the
// city scope, and an ISO timestamp — no IP address, no user agent, no
// names, no answer text. The visitor IP is read for the in-memory
// rate limits only and is never stored anywhere. Writes go through
// ctx.waitUntil so logging never delays the answer.
//
// COST: Workers AI free tier is 10,000 Neurons/day and the Workers Free
// plan allows 100,000 requests/day. A short grounded answer costs on
// the order of 25 Neurons, so the free tier covers roughly 400 chats a
// day. The per-IP daily cap below (20/day) is the guardrail that keeps
// one visitor from eating that budget; the account-level free tier is
// the backstop behind it.

// Model: verified current in the Cloudflare Workers AI model list
// (developers.cloudflare.com/workers-ai/models/), flagship tier,
// 32K context. Llama 3.1 8B Instruct, FP8.
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Only these origins may POST. The two production domains, their www
// variants, and the GitHub Pages preview (same pattern as the form
// Workers).
const ALLOWED_ORIGINS = [
  "https://echode.com",
  "https://www.echode.com",
  "https://houstondeafnetwork.com",
  "https://www.houstondeafnetwork.com",
  "https://longster.github.io",
];

// City codes the widget sends. SAT is the internal code for San
// Antonio (the public page is /satx/). HTX is Houston, served by the
// HDN data file. ALL is the Echode homepage: every source.
const DATA_URLS = {
  ATX: ["https://echode.com/atx/data.js"],
  DFW: ["https://echode.com/dfw/data.js"],
  SAT: ["https://echode.com/satx/data.js"],
  TX: ["https://echode.com/tx/data.js"],
  HTX: ["https://houstondeafnetwork.com/data.js"],
  ALL: [
    "https://echode.com/atx/data.js",
    "https://echode.com/dfw/data.js",
    "https://echode.com/satx/data.js",
    "https://echode.com/tx/data.js",
    "https://houstondeafnetwork.com/data.js",
  ],
};

// City labels for the grounding text.
const CITY_LABELS = {
  ATX: "Austin",
  DFW: "Dallas - Fort Worth",
  SAT: "San Antonio",
  TX: "Texas statewide",
  HTX: "Houston",
};

// Best-effort per-IP rate limits, in-memory only, so they reset when
// the Worker isolate recycles. Friction, not a security boundary.
// Burst: 5 questions per minute. Daily cap: 20 questions per day.
const minuteHits = new Map();
const dayCounts = new Map();
function burstLimited(ip) {
  const now = Date.now();
  const list = (minuteHits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  minuteHits.set(ip, list);
  return list.length > 5;
}
function dayLimited(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = ip + ":" + day;
  const n = (dayCounts.get(key) || 0) + 1;
  dayCounts.set(key, n);
  return n > 20;
}

// In-memory cache of the fetched data.js files, 1 hour. The daily
// syncs rewrite data.js once a day, so an hour of staleness is fine
// and keeps the Worker from re-fetching on every question.
const CACHE_TTL = 3_600_000;
const cache = new Map(); // url -> { at, data }
async function fetchData(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  let data = null;
  try {
    const res = await fetch(url, { headers: { Accept: "*/*" } });
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/const SITE_DATA = (\{[\s\S]*\});/);
      if (m) data = JSON.parse(m[1]);
    }
  } catch {
    data = null;
  }
  // Serve stale cache rather than fail when a fetch blips.
  if (!data && hit) return hit.data;
  if (data) cache.set(url, { at: Date.now(), data });
  return data;
}

// Compact one data file into grounding lines. Listings carry name,
// category, and website. Events carry name, date, and location.
// Jobs carry title, organization, and location. Descriptions are
// left out on purpose: they would triple the prompt size and the
// name plus category is what an answer needs.
// Events are marked (upcoming) or (past) from the Worker's own
// date, so the model never has to do date math: a small model
// answers "I don't know" to "coming up" about half the time when
// it must compare dates itself.
export function buildGrounding(data, label) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const lines = [];
  const dir = data.directory || [];
  if (dir.length) {
    lines.push("[" + label + " listings]");
    for (const r of dir) {
      lines.push("- " + [r.name || "", r.category || "", r.website || ""].filter(Boolean).join(" | "));
    }
  }
  const evs = data.events || [];
  if (evs.length) {
    lines.push("[" + label + " events]");
    for (const e of evs) {
      const d = e.date || "no date";
      const mark = /^\d{4}-\d{2}-\d{2}$/.test(d) ? (d >= today ? " (upcoming)" : " (past)") : "";
      lines.push("- " + [e.name || "", d + mark, e.location || ""].filter(Boolean).join(" | "));
    }
  }
  const jobs = data.postings || [];
  if (jobs.length) {
    lines.push("[" + label + " jobs]");
    for (const j of jobs) {
      lines.push("- " + [j.name || "", j.category || "", j.description || ""].filter(Boolean).join(" | "));
    }
  }
  return lines.join("\n");
}

// Which files a city scope reads, and the label each file gets in the
// grounding text. A city page reads only its own file, so the answer
// matches what the visitor sees on that page. The homepage reads all
// five. Houston reads the HDN file.
export function scopeFiles(city) {
  const urls = DATA_URLS[city] || DATA_URLS.ALL;
  return urls.map((url) => {
    if (url.indexOf("houstondeafnetwork.com") > -1) return { url, label: "Houston" };
    if (url.indexOf("/atx/") > -1) return { url, label: "Austin" };
    if (url.indexOf("/dfw/") > -1) return { url, label: "Dallas - Fort Worth" };
    if (url.indexOf("/satx/") > -1) return { url, label: "San Antonio" };
    return { url, label: "Texas statewide" };
  });
}

const SYSTEM_PROMPT = [
  "You answer questions about the Echode and Houston Deaf Network directories.",
  "Answer ONLY from the directory data below. Never invent a name, a date, a link, an address, or a detail that is not in the data.",
  "If the answer is not in the data, say \"I don't know\" and suggest the visitor ask through the suggest form instead of guessing.",
  "Today's date is given with the data below. Events in the data are already marked (upcoming) or (past); use those marks to judge whether an event is coming up.",
  "Keep answers short, about 150 words at most. Plain, direct language. Short sentences.",
  "When you name a listing, event, or job, use its exact name from the data.",
].join(" ");

// Sources shown under an answer: the grounded names that actually
// appear in the answer text, in grounding order, at most 5. This is
// a plain text match, not the model claiming its own sources.
export function findSources(answer, files) {
  const lower = String(answer || "").toLowerCase();
  const found = [];
  for (const f of files) {
    for (const r of (f.directory || []).concat(f.events || []).concat(f.postings || [])) {
      const name = r.name || "";
      if (name.length > 3 && lower.indexOf(name.toLowerCase()) > -1 && !found.includes(name)) {
        found.push(name);
        if (found.length >= 5) return found;
      }
    }
  }
  return found;
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

// Log one answered question to KV. Key: q:<ISO timestamp>:<short
// random>. Value: {question, city, ts} and nothing else. Runs via
// ctx.waitUntil so it never delays the answer; any KV failure is
// swallowed so logging can never break a chat answer.
function logQuestion(env, ctx, question, city) {
  try {
    if (!env.QUESTIONS || !ctx || typeof ctx.waitUntil !== "function") return;
    const ts = new Date().toISOString();
    const rand = crypto.randomUUID().slice(0, 8);
    const key = "q:" + ts + ":" + rand;
    const value = JSON.stringify({ question, city, ts });
    ctx.waitUntil(
      env.QUESTIONS.put(key, value).catch(() => {})
    );
  } catch {
    // Logging must never break the answer.
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
    if (burstLimited(ip)) {
      return jsonResponse(origin, 429, { ok: false, error: "rate_limited" });
    }
    if (dayLimited(ip)) {
      return jsonResponse(origin, 429, { ok: false, error: "daily_limit" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(origin, 400, { ok: false, error: "bad_json" });
    }
    const question = String(body.question || "").trim();
    if (!question) {
      return jsonResponse(origin, 400, { ok: false, error: "empty_question" });
    }
    if (question.length > 500) {
      return jsonResponse(origin, 400, { ok: false, error: "question_too_long" });
    }
    const city = String(body.city || "ALL").trim().toUpperCase();
    const files = scopeFiles(CITY_LABELS[city] ? city : "ALL");

    // Fetch and ground. If every source fails, say so rather than
    // answering from nothing.
    const parts = [];
    const loaded = [];
    for (const f of files) {
      const data = await fetchData(f.url);
      if (!data) continue;
      loaded.push(data);
      parts.push(buildGrounding(data, f.label));
    }
    if (!loaded.length) {
      return jsonResponse(origin, 502, { ok: false, error: "data_unavailable" });
    }
    const grounding = parts.join("\n");

    let answer;
    try {
      const today = new Date().toLocaleDateString("en-US", {
        timeZone: "America/Chicago",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const out = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT + "\n\nToday is " + today + ".\n\n" + grounding },
          { role: "user", content: question },
        ],
        max_tokens: 300,
        temperature: 0.3,
      });
      answer = String(out.response || "").trim();
      if (!answer) throw new Error("empty AI response");
    } catch {
      return jsonResponse(origin, 502, { ok: false, error: "ai_failed" });
    }

    // Log the answered question (including "I don't know" answers)
    // before returning. Rate-limited and invalid requests return
    // earlier in this handler, so they are never logged.
    logQuestion(env, ctx, question, CITY_LABELS[city] ? city : "ALL");

    return jsonResponse(origin, 200, {
      ok: true,
      answer,
      sources: findSources(answer, loaded),
    });
  },
};
