# Briefed

A template-driven legal case brief automation engine. Upload a judgment (PDF, DOCX, or TXT) and Briefed extracts the 7 required sections: Relevant Facts, Issue, Holding, Ratio Decidendi, Reasoning, Dissent, and Notes. Results can be exported to PDF.

No API key required. Runs entirely on a Node.js server.

## Live demo

Once deployed to Render (see below), your public URL will look like:
`https://briefed.onrender.com`

## Run locally

Requires Node.js 16 or later.

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy to Render (free)

1. Push this repo to GitHub.
2. Go to https://render.com and sign in with GitHub.
3. Click **New > Web Service** and pick this repo.
4. Render auto-detects `render.yaml`. Click **Apply**.
5. Wait ~2 minutes for first build. Your URL is shown at the top of the service page.

## Project structure

| File | Purpose |
|------|---------|
| `Briefed.html` | Frontend (upload, render results, export to PDF) |
| `server.js` | HTTP server, serves frontend and `/extract` endpoint |
| `engine.js` | Extraction logic for the 7 sections |
| `package.json` | Node config and start script |
| `render.yaml` | Render deployment config |

## License

Private use.
