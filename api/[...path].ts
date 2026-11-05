import type { Request, Response } from 'express';
// Keep the TypeScript extension so Vercel's bundler includes server.ts in the
// function bundle instead of leaving Node an unresolved extensionless import.
import app, { initializeApp } from '../server.ts';

/** Route every /api/* request through the shared Express API. */
export default async function handler(req: Request, res: Response) {
  try {
    await initializeApp();
    app(req, res);
  } catch (error) {
    console.error('API initialization failed:', error);
    if (!res.headersSent) {
      res.status(503).json({ error: 'The service is not ready. Check the server configuration.' });
    }
  }
}
