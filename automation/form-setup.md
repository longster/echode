# Echode form intake: deploy checklist (Phase 4)

The forms on echode.com (homepage suggest form, Austin and Texas
State get-listed forms) POST to a Cloudflare Worker named
`echode-form-intake`. The Worker code lives in `automation/worker.js`
in this repo. Until the Worker is deployed, the forms show a
"did not send" message; nothing else breaks.

## Step 1: Create the Worker

1. Cloudflare dashboard → Workers & Pages → Create → Worker.
2. Name it exactly `echode-form-intake` (the forms point at
   `https://echode-form-intake.longster.workers.dev/`).
3. Deploy the starter, then Edit code, delete the starter, paste in
   all of `automation/worker.js`, Deploy again.

## Step 2: Set the secrets

Worker → Settings → Variables and Secrets. Add each as a **Secret**:

| Name | Value |
| --- | --- |
| NOTION_TOKEN | The "HDN Website Automation" integration token (same one the HDN Worker and the syncs use) |
| DATABASE_ID_DIRECTORY | 6bdfa6b0-235e-4934-90b5-36ed1a347d48 |
| DATABASE_ID_EVENTS | 991ba195-1d24-471b-87b0-37af4621327d |
| DATABASE_ID_JOBS | fcc6815e-ad64-4f3f-a931-c02f5467245b |
| DATABASE_ID_MESSAGES | 4f2a0e36-d0bc-4223-881d-30632d59e13a |
| DATABASE_ID_NEWS | 8946b47d-e077-4a48-b2ef-90bd93a210bd |
| RESEND_API_KEY | The same Resend key the HDN Worker uses |
| FROM_EMAIL | info@houstondeafnetwork.com (see note) |
| OWNER_EMAIL | info@houstondeafnetwork.com |

All five databases are already shared with the integration, so no
Notion-side step is needed.

FROM_EMAIL note: the sender must sit on a Resend-verified domain.
houstondeafnetwork.com already is. To send as an @echode.com
address later, verify echode.com in Resend and change FROM_EMAIL.

**Warning (learned on the HDN Worker): redeploying a Worker wipes
its secret bindings. After any redeploy, re-save every secret.**

## Step 3: Test together

Tell Bibi the Worker is deployed. We send one test of each type
(listing, event, job, news tip, question) and confirm:

- Rows land in the right Notion database in their holding state
  (Directory "Pending review", Events "Upcoming" with the PENDING
  REVIEW source marker, Jobs "Filled", News "Draft", Messages "New").
- Serves carries the form's city; Origin is "Submitted" where the
  database has that field.
- The acknowledgment and owner emails arrive.

## How submissions publish (unchanged approval gate)

Nothing publishes from the form. The owner approves in Notion:
Directory Status → Active, Events: clear the PENDING REVIEW marker,
Jobs Status → Active, News Status → Published. The daily syncs do
the rest.
