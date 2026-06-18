# Alteryx Explainer

Upload an Alteryx workflow (`.yxmd` / `.yxmc`) and get a clean, plain-English summary:
the outcome up top (what you actually get), then the workflow broken into ~5 parts,
each with its own summary and step-by-step explanation.

- Frontend: React + Vite (static)
- Backend: one serverless function that calls the **Groq** API (your key stays on the server)

---

## 1. Get a Groq API key

Create a free key at https://console.groq.com/keys

## 2. Install

```bash
npm install
```

## 3. Run locally

The app and the API live in the same project, so use Vercel's dev server (it runs
both `vite` and the `/api` function together):

```bash
npm i -g vercel        # one time
vercel dev
```

Set your key when prompted, or create a `.env` file:

```
GROQ_API_KEY=your_groq_key_here
```

(Plain `npm run dev` runs only the frontend — the `/api/explain-alteryx` call needs
`vercel dev` or a deployment.)

## 4. Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com → New Project → import the repo (framework auto-detects as Vite).
3. Project → Settings → Environment Variables → add:
   - `GROQ_API_KEY` = your key
4. Deploy. Every push redeploys automatically.

That's it — the key lives only in Vercel's env vars, never in the browser.

---

## Project structure

```
alteryx-explainer/
├─ index.html
├─ package.json
├─ vite.config.js
├─ src/
│  ├─ main.jsx
│  └─ AlteryxExplainer.jsx     # the whole UI + XML parser
└─ api/
   └─ explain-alteryx.js       # Groq call (server-side, holds the key)
```

## Notes

- `.yxzp` is a zipped package, not raw XML — unzip it and upload the `.yxmd` inside.
- The model used is `llama-3.3-70b-versatile`. Change it in `api/explain-alteryx.js`.
- If Groq is unreachable, the app still produces a basic explanation from the parsed
  workflow structure (offline fallback).
- Other hosts work the same way: put the function in `netlify/functions/` for Netlify,
  or expose `/api/explain-alteryx` from any Node backend. Rule stays the same — key on
  the server, frontend calls your endpoint.
