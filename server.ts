import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';

dotenv.config();

// Enforce HMR disabled in the AI Studio container environment.
process.env.DISABLE_HMR = process.env.DISABLE_HMR || 'true';

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.use(express.json({ limit: '10mb' }));

const DATA_PATH = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const CSV_PATH = path.join(DATA_PATH, 'invitations.csv');
const SEED_CSV_PATH = path.resolve(process.cwd(), 'src', 'data', 'invitations.csv');
const CHECKINS_PATH = path.join(DATA_PATH, 'check-ins.json');

interface Guest {
  id: string;
  name: string;
  tier: string;
  table: string;
}

interface CheckIn {
  attendeeId: string;
  name: string;
  checkedInAt: string;
}

function parseCSV(csvString: string): Guest[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csvString.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length <= 1) return [];

  const headers = rows[0].map((value) => value.toLowerCase());
  const nameIndex = headers.indexOf('name') >= 0 ? headers.indexOf('name') : 0;
  const tierIndex = headers.indexOf('tier');
  const tableIndex = headers.indexOf('table');

  const occurrences = new Map<string, number>();
  return rows.slice(1).flatMap((values) => {
    const name = values[nameIndex]?.trim();
    if (!name) return [];
    const slug = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const occurrence = (occurrences.get(slug) || 0) + 1;
    occurrences.set(slug, occurrence);
    return [{
      id: `guest-${slug}-${occurrence}`,
      name,
      tier: (tierIndex >= 0 ? values[tierIndex] : '')?.trim() || 'Invited Guest',
      table: (tableIndex >= 0 ? values[tableIndex] : '')?.trim() || 'Main Pavilion',
    }];
  });
}

function loadGuests(): Guest[] {
  try {
    const sourcePath = fs.existsSync(CSV_PATH) ? CSV_PATH : SEED_CSV_PATH;
    return fs.existsSync(sourcePath) ? parseCSV(fs.readFileSync(sourcePath, 'utf8')) : [];
  } catch (error) {
    console.error('Unable to read attendee list:', error);
    return [];
  }
}

let guestList = loadGuests();
const checkIns = new Map<string, CheckIn>();
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
// Prefer Supabase's newer server-only secret key, while retaining compatibility
// with projects that still use the legacy service_role key.
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVER_KEY);
let initialization: Promise<void> | undefined;

export async function initializeApp() {
  if (!initialization) {
    initialization = (async () => {
      if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_SERVER_KEY)) {
        throw new Error('Set both SUPABASE_URL and SUPABASE_SECRET_KEY, or leave both unset.');
      }
      if (hasSupabase) await loadSupabaseData();
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

async function supabaseRequest(resource: string, init: RequestInit = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY) throw new Error('Supabase is not configured');
  return fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVER_KEY,
      Authorization: `Bearer ${SUPABASE_SERVER_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function saveGuestsToSupabase(guests: Guest[]) {
  const response = await supabaseRequest('event_attendees?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      tier: guest.tier,
      table_name: guest.table,
    }))),
  });
  if (!response.ok) throw new Error(`Supabase attendee save failed (${response.status})`);
}

async function loadSupabaseData() {
  if (!hasSupabase) return;
  checkIns.clear();
  const attendeesResponse = await supabaseRequest('event_attendees?select=id,name,tier,table_name&order=name.asc');
  if (!attendeesResponse.ok) throw new Error(`Supabase attendee load failed (${attendeesResponse.status})`);
  const attendees = await attendeesResponse.json() as Array<{ id: string; name: string; tier: string; table_name: string }>;
  if (attendees.length > 0) {
    guestList = attendees.map((guest) => ({ id: guest.id, name: guest.name, tier: guest.tier, table: guest.table_name }));
  } else if (guestList.length > 0) {
    await saveGuestsToSupabase(guestList);
  }

  const checkInsResponse = await supabaseRequest('event_checkins?select=attendee_id,name,checked_in_at');
  if (!checkInsResponse.ok) throw new Error(`Supabase check-in load failed (${checkInsResponse.status})`);
  const saved = await checkInsResponse.json() as Array<{ attendee_id: string; name: string; checked_in_at: string }>;
  saved.forEach((record) => checkIns.set(record.attendee_id, {
    attendeeId: record.attendee_id,
    name: record.name,
    checkedInAt: record.checked_in_at,
  }));
}

try {
  if (fs.existsSync(CHECKINS_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CHECKINS_PATH, 'utf8')) as CheckIn[];
    saved.forEach((record) => checkIns.set(record.attendeeId, record));
  }
} catch (error) {
  console.error('Unable to read saved check-ins:', error);
}

function persistCheckIns() {
  fs.mkdirSync(DATA_PATH, { recursive: true });
  fs.writeFileSync(CHECKINS_PATH, JSON.stringify([...checkIns.values()], null, 2), 'utf8');
}

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function scoreName(query: string, guestName: string) {
  const q = normalizeName(query);
  const name = normalizeName(guestName);
  if (q === name) return 1;
  const qWords = new Set(q.split(' ').filter(Boolean));
  const nameWords = new Set(name.split(' ').filter(Boolean));
  const overlap = [...qWords].filter((word) => nameWords.has(word)).length;
  const tokenScore = overlap / Math.max(qWords.size, nameWords.size, 1);
  return Math.max(similarity(q, name), tokenScore);
}

app.get('/api/invitations', (_req, res) => {
  res.json({ total: guestList.length, checkedIn: guestList.filter((guest) => checkIns.has(guest.id)).length });
});

app.post('/api/invitations', async (req, res) => {
  const csvContent = typeof req.body?.csvContent === 'string' ? req.body.csvContent : '';
  const parsed = parseCSV(csvContent);
  if (parsed.length === 0) {
    return res.status(400).json({ error: 'The CSV must include a header row and attendee names.' });
  }

  try {
    if (hasSupabase) await saveGuestsToSupabase(parsed);
    fs.mkdirSync(DATA_PATH, { recursive: true });
    fs.writeFileSync(CSV_PATH, csvContent, 'utf8');
    guestList = parsed;
    return res.json({ success: true, count: guestList.length });
  } catch (error) {
    console.error('Unable to save attendee list:', error);
    return res.status(500).json({ error: 'The attendee list could not be saved. Check the server storage settings.' });
  }
});

app.post('/api/check-in/lookup', (req, res) => {
  const spokenName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (spokenName.length < 2) {
    return res.status(400).json({ error: 'Please provide the attendee name to search for.' });
  }

  const ranked = guestList
    .map((guest) => ({ guest, score: scoreName(spokenName, guest.name) }))
    .filter((match) => match.score >= 0.38)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (ranked.length === 0) return res.json({ status: 'none', candidates: [] });
  const ambiguous = ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08;
  const matches = (ambiguous ? ranked : ranked.slice(0, 1)).map(({ guest }) => ({
    ...guest,
    checkedInAt: checkIns.get(guest.id)?.checkedInAt ?? null,
  }));

  return res.json({ status: ambiguous ? 'ambiguous' : 'one', candidates: matches });
});

app.post('/api/check-in/confirm', async (req, res) => {
  const attendeeId = typeof req.body?.attendeeId === 'string' ? req.body.attendeeId : '';
  const guest = guestList.find((item) => item.id === attendeeId);
  if (!guest) return res.status(404).json({ error: 'That attendee is no longer on the list.' });

  const existing = checkIns.get(guest.id);
  if (existing) return res.json({ status: 'already-checked-in', guest, checkIn: existing });

  const record: CheckIn = {
    attendeeId: guest.id,
    name: guest.name,
    checkedInAt: new Date().toISOString(),
  };
  try {
    if (hasSupabase) {
      const response = await supabaseRequest('event_checkins?on_conflict=attendee_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ attendee_id: guest.id, name: guest.name, checked_in_at: record.checkedInAt }),
      });
      if (!response.ok) throw new Error(`Supabase check-in save failed (${response.status})`);
      const inserted = await response.json() as Array<{ attendee_id: string; name: string; checked_in_at: string }>;
      if (inserted.length === 0) {
        const existingResponse = await supabaseRequest(`event_checkins?attendee_id=eq.${encodeURIComponent(guest.id)}&select=attendee_id,name,checked_in_at`);
        if (!existingResponse.ok) throw new Error(`Supabase duplicate check-in read failed (${existingResponse.status})`);
        const [existing] = await existingResponse.json() as Array<{ attendee_id: string; name: string; checked_in_at: string }>;
        const existingCheckIn: CheckIn = {
          attendeeId: existing.attendee_id,
          name: existing.name,
          checkedInAt: existing.checked_in_at,
        };
        checkIns.set(guest.id, existingCheckIn);
        return res.json({ status: 'already-checked-in', guest, checkIn: existingCheckIn });
      }
    }
    checkIns.set(guest.id, record);
    if (!hasSupabase) persistCheckIns();
  } catch (error) {
    console.error('Unable to save check-in:', error);
    return res.status(500).json({ error: 'The arrival could not be saved. Please ask staff to check in the guest.' });
  }
  return res.json({ status: 'checked-in', guest, checkIn: record });
});

app.get('/api/check-ins/stats', (_req, res) => {
  res.json({ total: guestList.length, checkedIn: guestList.filter((guest) => checkIns.has(guest.id)).length });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, databaseConfigured: hasSupabase });
});

app.get('/api/voice-config', (_req, res) => {
  const ready = Boolean(process.env.ELEVENLABS_API_KEY);
  res.json({ realtimeListeningReady: ready, elevenLabsVoiceReady: ready && Boolean(process.env.ELEVENLABS_VOICE_ID) });
});

app.get('/api/scribe-token', async (_req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ElevenLabs is not configured on the server yet.' });
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.token !== 'string') {
      console.error('ElevenLabs Scribe token request failed:', response.status);
      return res.status(502).json({ error: 'ElevenLabs could not start live listening. Check the API key and account access.' });
    }
    return res.json({ token: body.token });
  } catch (error) {
    console.error('ElevenLabs Scribe token request failed:', error);
    return res.status(502).json({ error: 'Could not connect to ElevenLabs for live listening.' });
  }
});

app.post('/api/speak', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!apiKey || !voiceId) return res.status(503).json({ error: 'ElevenLabs voice is not configured on the server yet.' });
  if (!text || text.length > 700) return res.status(400).json({ error: 'Speech text must be between 1 and 700 characters.' });

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_TTS_MODEL_ID || 'eleven_flash_v2_5',
        voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
      }),
    });
    if (!response.ok || !response.body) {
      const message = await response.text().catch(() => 'ElevenLabs voice request failed.');
      console.error('ElevenLabs TTS request failed:', response.status, message.slice(0, 300));
      return res.status(502).json({ error: 'ElevenLabs could not generate the spoken reply.' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    Readable.fromWeb(response.body as never).pipe(res);
  } catch (error) {
    console.error('ElevenLabs TTS request failed:', error);
    if (!res.headersSent) res.status(502).json({ error: 'Could not connect to ElevenLabs for speech.' });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  await initializeApp();
  const publicPath = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicPath)) app.use(express.static(publicPath));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.resolve(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vinicunca AI server listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;

// Vercel invokes the Express app through api/[...path].ts. Only start a
// listening server when running locally or on a conventional Node host.
if (!process.env.VERCEL) {
  startServer().catch((error) => {
    console.error('Vinicunca AI failed to start:', error);
    process.exitCode = 1;
  });
}
