# Vinicunca Event Check-in

## Vercel deployment

Keep the **Vite** framework preset. Use `npm run build` as the build command and `dist` as the output directory. Leave the install command at `npm install`. Vite serves the built dashboard, and `api/[...path].ts` forwards `/api/*` requests to the Express routes in `server.ts` as a Vercel Function.

After pushing changes, redeploy the latest `main` commit. Add these server-side variables in Vercel Project Settings → Environment Variables, enabled for Production (and Preview if desired):

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Optional: `GEMINI_MODEL` (defaults to `gemini-2.5-flash`), `VINICUNCA_SITE_URL` (defaults to `https://thevinicunca.com/`), and `ELEVENLABS_TTS_MODEL_ID` (defaults to `eleven_flash_v2_5`). Do not use a `VITE_` prefix for secrets. Do not commit `.env` files.

The assistant reads the public `thevinicunca.com` homepage and up to four same-domain pages on first conversation, then caches that text for 30 minutes. The Gemini API key is used only on the server. The Supabase project must have the tables required by the app (`event_attendees` and `event_checkins`) and allow the server key to access them. On deployment, verify `/api/health` and `/api/voice-config` return JSON rather than a Vercel 404. `realtimeListeningReady`, `elevenLabsVoiceReady`, and `conversationalAIReady` should all be `true` when the corresponding variables are set.

## Local development

Run `npm install`, create a local `.env` with the server-side variables above, then run `npm run dev`. Open the displayed local address in Chrome or Edge and allow microphone access.
