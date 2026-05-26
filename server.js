/**
 * BRIEFED SERVER — NO API KEY REQUIRED
 * Usage: node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { extract } = require('./engine');

const PORT = process.env.PORT || 3000;

function readBody(req) {
    return new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', reject);
    });
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, status, data) {
    cors(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function getPath(req) {
    // Strip query string and normalise
  return (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
}

const server = http.createServer(async (req, res) => {
    const method = req.method.toUpperCase();
    const urlPath = getPath(req);

                                   // Log every request
                                   console.log(`[${new Date().toISOString()}] ${method} ${urlPath}`);

                                   // CORS preflight
                                   if (method === 'OPTIONS') {
                                         cors(res);
                                         res.writeHead(204);
                                         res.end();
                                         return;
                                   }

                                   // ── HEAD / — health check (Render uses this to verify the service is up)
                                   if (method === 'HEAD' && (urlPath === '/' || urlPath === '/health')) {
                                         cors(res);
                                         res.writeHead(200);
                                         res.end();
                                         return;
                                   }

                                   // ── GET / — serve the site
                                   if (method === 'GET' && (urlPath === '/' || urlPath === '/index.html' || urlPath === '/Briefed.html')) {
                                         const file = path.join(__dirname, 'Briefed.html');
                                         fs.readFile(file, (err, data) => {
                                                 if (err) {
                                                           console.error('Cannot read Briefed.html:', err.message);
                                                           res.writeHead(500); res.end('Cannot load Briefed.html');
                                                           return;
                                                 }
                                                 cors(res);
                                                 res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                                                 res.end(data);
                                         });
                                         return;
                                   }

                                   // ── GET /health
                                   if (method === 'GET' && urlPath === '/health') {
                                         return sendJSON(res, 200, { status: 'ok', engine: 'local', version: '3.0.0' });
                                   }

                                   // ── POST /extract — main extraction endpoint
                                   if (method === 'POST' && urlPath === '/extract') {
                                         let raw;
                                         try {
                                                 raw = await readBody(req);
                                         } catch(err) {
                                                 console.error('[extract] Failed to read body:', err.message);
                                                 return sendJSON(res, 400, { error: 'Failed to read request body' });
                                         }

      let payload;
                                         try {
                                                 payload = JSON.parse(raw);
                                         } catch(err) {
                                                 console.error('[extract] Invalid JSON:', err.message);
                                                 return sendJSON(res, 400, { error: 'Invalid JSON in request body' });
                                         }

      const { text, filename } = payload;

      if (!text || typeof text !== 'string') {
              return sendJSON(res, 400, { error: 'Missing "text" field in request body' });
      }

      const trimmed = text.trim();
                                         if (trimmed.length < 40) {
                                                 return sendJSON(res, 400, { error: 'Document text too short (minimum 40 characters)' });
                                         }

      try {
              console.log(`[extract] Processing "${filename || 'unnamed'}" — ${trimmed.length} chars`);
              const result = extract(trimmed, filename || '');
              console.log(`[extract] Done — case: "${result.name}"`);
              return sendJSON(res, 200, result);
      } catch(err) {
              console.error('[extract] Engine error:', err.message);
              return sendJSON(res, 500, { error: 'Extraction failed: ' + err.message });
      }
                                   }

                                   // 404 fallback — log what we received so it's easy to debug
                                   console.warn(`[404] No route for ${method} ${urlPath}`);
    cors(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No route: ${method} ${urlPath}` }));
});

server.listen(PORT, () => {
    console.log('');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│  BRIEFED — Local Engine v3.0            │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│  ✅ Running at http://localhost:${PORT}   │`);
    console.log('│  🔑 No API key required                 │');
    console.log('│  📄 Upload PDF, DOCX, or TXT            │');
    console.log('│  ⌨️  Ctrl+C to stop                      │');
    console.log('└─────────────────────────────────────────┘');
    console.log('');
    console.log('Waiting for requests...');
    console.log('');
});
