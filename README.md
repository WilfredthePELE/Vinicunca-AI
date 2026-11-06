# Vinicunca Event Check-in

## Vercel deployment

Keep the **Vite** framework preset. Use `npm run build` as the build command and `dist` as the output directory. Leave the install command at `npm install`. Vite serves the built dashboard, and `api/[...path].ts` forwards `/api/*` requests to the Express routes in `server.ts` as a Vercel Function.

After pushing changes, redeploy the latest `main` commit. Add these server-side variables in Vercel Project Settings → Environment Variables, enabled for Production (and Preview if desired):

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `ADMIN_PIN` (set this to the private spoken code you choose; do not commit it)

Optional: `ADMIN_SESSION_SECRET` (use a long random secret for signing short admin sessions; if absent, the admin code signs sessions), `GEMINI_MODEL` (defaults to `gemini-2.5-flash`), `VINICUNCA_SITE_URL` (defaults to `https://thevinicunca.com/`), and `ELEVENLABS_TTS_MODEL_ID` (defaults to `eleven_flash_v2_5`). Do not use a `VITE_` prefix for secrets. Do not commit `.env` files.

The assistant reads the public `thevinicunca.com` homepage and up to four same-domain pages on first conversation, then caches that text for 30 minutes. The Gemini API key is used only on the server. Run [`supabase/schema.sql`](supabase/schema.sql) once in Supabase Dashboard → SQL Editor to create the required tables. The sample list is [`src/data/sample-attendees.csv`](src/data/sample-attendees.csv). You can upload it through the dashboard after unlocking admin, or import its `id,name,tier,table_name` columns into the `event_attendees` table in Table Editor. Supabase is authoritative in production and will not reseed itself after you intentionally clear registrations. On deployment, verify `/api/health` and `/api/voice-config` return JSON rather than a Vercel 404. `realtimeListeningReady`, `elevenLabsVoiceReady`, `conversationalAIReady`, and `adminReady` should all be `true` when the corresponding variables are set.

## Voice admin controls

Say “Admin code” followed by the private value configured in `ADMIN_PIN`. Admin access expires after 15 minutes. After unlock, ask for arrival totals, search for a named attendee, or say “add registration for [full name]”. To remove everyone, ask to clear registrations and then say “confirm clear registrations” when prompted. CSV replacement also requires an active admin session. Do not use the example phrase from chat as a production secret; choose a private code in Vercel.

## Local development

Run `npm install`, create a local `.env` with the server-side variables above, then run `npm run dev`. Open the displayed local address in Chrome or Edge and allow microphone access.
