/**
 * Local web server (npm run web). Serves the page and the rules file, and
 * routes /api/* to the same handlers the Vercel functions use.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { handleFeedback, handleGenerate, handleLookup, handleSubject, sendJson } from './handlers.js';

const STATIC = {
  '/': { file: new URL('./index.html', import.meta.url), type: 'text/html' },
  '/validator.js': { file: new URL('../validator.js', import.meta.url), type: 'text/javascript' },
};
const API = { '/api/lookup': handleLookup, '/api/generate': handleGenerate, '/api/subject': handleSubject, '/api/feedback': handleFeedback };

export function createApp() {
  return createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    const asset = req.method === 'GET' && STATIC[path === '/index.html' ? '/' : path];
    if (asset) {
      res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` });
      return res.end(await readFile(asset.file));
    }
    if (API[path]) return API[path](req, res);
    sendJson(res, 404, { error: 'Not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!config.openaiApiKey) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }
  createApp().listen(config.port, () => console.log(`Raphie Outreach running at http://localhost:${config.port}`));
}
