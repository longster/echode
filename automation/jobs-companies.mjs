// Echode jobs pull: which companies to read, and how a location maps
// to the Serves codes the sync already understands.
//
// EXPANDABILITY (the whole point of this file):
//   - Adding a company = one entry in COMPANIES (name, org label,
//     parser type, board URLs). No script-logic change.
//   - Adding a city = one row in CITY_MAP (pattern + Serves code).
//     City pages already exist per Serves code; the sync publishes
//     a job to every city in its Serves list, so a new city page
//     picks up jobs the moment its code is in the map.
//   - Adding a board type = one parser function in jobs-pull.mjs
//     plus the parser name here. Phase 2 entries below show the
//     shape; their parsers are NOT built yet.
//
// Location rules (applied by the script, driven by this file):
//   - A role passes the filter only if its location is in Texas
//     (a Texas city name, "TX", or "Texas") or is remote.
//   - A role based in a Texas city gets [CITY, TX]; a remote role,
//     or one with no specific Texas city, gets [TX] only.

export const COMPANIES = [
  {
    key: "csd",
    name: "CSD",
    org: "CSD",
    parser: "paylocity",
    boards: [
      // CSD's own Paylocity board. The list is a single page; the
      // roles are embedded as JSON (window.pageData) in the HTML.
      "https://recruiting.paylocity.com/recruiting/jobs/All/d2a65e66-c4d9-4759-aa6d-6aed04c56b1f/Communication-Service-for-the-Deaf-Inc",
    ],
  },
  {
    key: "sorenson",
    name: "Sorenson",
    org: "Sorenson",
    parser: "ukg",
    boards: [
      // UKG Pro Recruiting board. The list loads from a JSON POST
      // endpoint; the script scrapes a fresh antiforgery token
      // from this page on every run.
      "https://recruiting2.ultipro.com/SOR1001SORE/JobBoard/1fe5e40e-4e0c-4b11-86e3-9a8e1f396263/?q=&o=postedDateDesc",
    ],
  },
  {
    key: "purple",
    name: "Purple",
    org: "Purple",
    parser: "taleo",
    boards: [
      // Oracle Taleo, org=PRPL. Two boards; they overlap heavily
      // (same requisition ids), so the script dedupes by rid and
      // keeps the first board's link.
      "https://phg.tbe.taleo.net/phg01/ats/careers/v2/searchResults?org=PRPL&cws=52",
      "https://phg.tbe.taleo.net/phg01/ats/careers/v2/searchResults?org=PRPL&cws=53",
    ],
  },
  {
    key: "masterword",
    name: "MasterWord",
    org: "MasterWord",
    parser: "wordpress",
    boards: [
      // MasterWord's own WordPress careers page: Elementor
      // accordions, one per role, with "Location:" / "Status:"
      // lines in the body. No per-role page and no ATS; the
      // parser links each role to the page with ?role=<slug>.
      "https://www.masterword.com/careers/",
    ],
  },
  {
    key: "lsa",
    name: "LSA",
    org: "LSA",
    parser: "lever",
    boards: [
      // Lever public postings API (no auth): one GET returns the
      // whole board as JSON. The parser keeps only the "American
      // Sign Language Interpreters" team; the rest of the board
      // is spoken-language interpreters.
      "https://api.lever.co/v0/postings/lsaweb?mode=json",
    ],
  },
  {
    key: "propio",
    name: "Propio",
    org: "Propio",
    parser: "greenhouse",
    boards: [
      // Greenhouse public Job Board API (no auth): one GET
      // returns every job as JSON. The parser keeps only
      // ASL-titled roles; the rest of the board is
      // spoken-language interpreting.
      "https://boards-api.greenhouse.io/v1/boards/propiolanguageservices/jobs",
    ],
  },
  // PHASE 2 (not built — parser interface only, add when ready):
  // {
  //   key: "convo",
  //   name: "Convo",
  //   org: "Convo",
  //   parser: "rippling", // JS-rendered board; needs a browser fetch.
  //   boards: ["https://ats.rippling.com/en-US/convo-communications-llc/jobs"],
  // },
  // {
  //   key: "purple-corporate",
  //   name: "Purple",
  //   org: "Purple",
  //   parser: "adp", // JS-loaded; the session cid must be obtained
  //   // fresh from https://zpconnect.com/careers/ on every run,
  //   // never hardcoded.
  //   boards: ["https://zpconnect.com/careers/"],
  // },
];

// Location text -> Serves code. Order matters only for display;
// a location can match more than one row (rare) and gets all codes.
export const CITY_MAP = [
  { pattern: /austin/i, code: "ATX" },
  { pattern: /houston/i, code: "HTX" },
  { pattern: /dallas|fort worth|ft\.?\s*worth/i, code: "DFW" },
  { pattern: /san antonio/i, code: "SAT" },
];

// A role is Texan if its location matches one of these, or a city
// above. A role is remote if it matches REMOTE_PATTERN, or the
// parser flagged it remote.
export const TEXAS_PATTERN = /\bTX\b|Texas/i;
export const REMOTE_PATTERN = /remote|work from home|wfh/i;
