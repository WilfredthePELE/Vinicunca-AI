import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Enforce HMR disabled in AI Studio container environment
process.env.DISABLE_HMR = 'true';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

const CSV_PATH = path.resolve(process.cwd(), 'src', 'data', 'invitations.csv');

// Parse CSV string into array of objects
function parseCSV(csvString: string) {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const nameIndex = headers.indexOf('name') !== -1 ? headers.indexOf('name') : 0;
  const tierIndex = headers.indexOf('tier') !== -1 ? headers.indexOf('tier') : 1;
  const tableIndex = headers.indexOf('table') !== -1 ? headers.indexOf('table') : 2;

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;

    // Handle quoted values
    const values = [];
    let insideQuotes = false;
    let currentVal = '';
    for (let char of row) {
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(currentVal.trim());
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal.trim());

    records.push({
      name: values[nameIndex] || 'Guest',
      tier: values[tierIndex] || 'Invited Attendee',
      table: values[tableIndex] || 'Sanctuary 01',
    });
  }

  return records;
}

// In-memory guest list cache
let guestList: Array<{ name: string; tier: string; table: string }> = [];

try {
  if (fs.existsSync(CSV_PATH)) {
    const raw = fs.readFileSync(CSV_PATH, 'utf-8');
    guestList = parseCSV(raw);
  }
} catch (e) {
  console.error('Error reading initial CSV:', e);
}

// Endpoints for CSV management
app.get('/api/invitations', (_req, res) => {
  res.json({ guests: guestList });
});

app.post('/api/invitations', (req, res) => {
  try {
    const { csvContent } = req.body;
    if (!csvContent) {
      return res.status(400).json({ error: 'No CSV content provided' });
    }

    const parsed = parseCSV(csvContent);
    if (parsed.length === 0) {
      return res.status(400).json({ error: 'Could not find any guest rows in CSV' });
    }

    guestList = parsed;

    // Save to disk
    try {
      fs.writeFileSync(CSV_PATH, csvContent, 'utf-8');
    } catch (err) {
      console.warn('Could not persist to disk, keeping in memory', err);
    }

    return res.json({ success: true, count: guestList.length, guests: guestList });
  } catch (error) {
    console.error('Error uploading CSV:', error);
    return res.status(500).json({ error: 'Failed to process CSV' });
  }
});

// Fast fuzzy matching function
function findGuestFuzzy(queryName: string) {
  if (!queryName) return null;
  const q = queryName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  // 1. Direct match
  const direct = guestList.find(
    (g) => g.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() === q
  );
  if (direct) return direct;

  // 2. Contains match
  const contains = guestList.find((g) => {
    const gn = g.name.toLowerCase();
    return gn.includes(q) || q.includes(gn);
  });
  if (contains) return contains;

  // 3. Word token overlap
  const qWords = q.split(/\s+/).filter((w) => w.length > 2);
  for (const guest of guestList) {
    const gWords = guest.name.toLowerCase().split(/\s+/);
    for (const qw of qWords) {
      if (gWords.some((gw) => gw.includes(qw) || qw.includes(gw))) {
        return guest;
      }
    }
  }

  return null;
}

// Ultra-fast instant invitation checking endpoint
app.post('/api/check-invitation', (req, res) => {
  const { name } = req.body;
  const match = findGuestFuzzy(name || '');

  if (match) {
    return res.json({
      found: true,
      guest: match,
      reply: `Looking at you closely. Welcome to the Vinicunca, ${match.name}. Your invitation is confirmed. Access is granted to ${match.table}.`,
    });
  } else {
    return res.json({
      found: false,
      reply: `Looking at you closely. I have searched our invitation sheet, but do not find a reservation under ${name || 'that name'}. Please check your credentials.`,
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  // Serve static assets from public folder (e.g. video files)
  const publicPath = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
  }

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vinicunca AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
