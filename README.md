# RESUMELARP 🎭

> *"Trust me bro, I built that"* — An interactive resume recall map for interview prep.

Upload your resume, turn it into an interactive mind map, annotate each talking point with STAR stories, drill yourself with flashcards, and track your recall confidence. Works offline, syncs to the cloud when you sign in.

## Features

- 📄 **Resume Import** — PDF, DOCX, PNG, TXT — file never leaves your browser
- 🗺️ **Infinite Canvas** — Drag, zoom, pan — Obsidian/Figma-style workspace
- 🔗 **Cards & Wires** — Hierarchical nodes with arrows and cross-links
- ⭐ **STAR Notes** — Situation, Task, Action, Result for each talking point
- 🧠 **Drill Mode** — Flashcard-style self-quizzing with confidence tracking
- 🔴🟡🟢 **Recall Confidence** — Track what you know vs what needs more prep
- 📂 **Multi-Canvas** — Create multiple maps, switch between them
- 🔐 **Auth** — Google/GitHub OAuth via Supabase
- ☁️ **Cloud Sync** — Maps persist in Postgres, accessible from any device
- 🤝 **Real-time Collaboration** — Share maps, see live edits + presence
- 🔗 **Share Links** — Public shareable links for any map
- 📱 **Responsive** — Works on mobile (drawer slides up)

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Vite |
| Backend | Supabase (Postgres + Auth + Realtime) |
| Auth | Google & GitHub OAuth via Supabase Auth |
| Database | PostgreSQL with Row Level Security |
| Real-time | Supabase Realtime (Postgres CDC) |
| PDF Parsing | pdf.js |
| DOCX Parsing | mammoth.js |
| Deployment | Vercel |

## Quick Start

```bash
# Clone
git clone https://github.com/HARSHCRR/RESUMELARP.git
cd RESUMELARP

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Run locally
npm run dev
```

## Supabase Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy your Project URL and anon key into `.env`
3. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
4. Go to **Authentication → Providers** and enable:
   - Google (you'll need a Google Cloud OAuth client ID)
   - GitHub (you'll need a GitHub OAuth app)
5. Set the Site URL in **Authentication → URL Configuration** to your deployment URL

## Deploy to Vercel

```bash
npm run build
# Push to GitHub, then connect repo to Vercel
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel env vars
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ index.html│  │ cloud.js │  │ localStorage  │ │
│  │ (canvas)  │←→│(Supabase)│←→│  (offline)    │ │
│  └──────────┘  └────┬─────┘  └───────────────┘ │
└──────────────────────┼──────────────────────────┘
                       │
              ┌────────▼────────┐
              │    Supabase     │
              │  ┌───────────┐  │
              │  │ Postgres  │  │
              │  │  (maps)   │  │
              │  └───────────┘  │
              │  ┌───────────┐  │
              │  │   Auth    │  │
              │  │(OAuth 2.0)│  │
              │  └───────────┘  │
              │  ┌───────────┐  │
              │  │ Realtime  │  │
              │  │(WebSocket)│  │
              │  └───────────┘  │
              └─────────────────┘
```

## Keyboard Shortcuts

| Action | Key |
|---|---|
| Add child | Tab |
| Add sibling | Enter |
| Rename | E |
| Open/close detail | Space |
| Delete | Delete |
| Draw arrow | L |
| Confidence | 1 2 3 |
| Collapse | C |
| Fit to screen | F |
| Tidy layout | T |
| Search | / |
| Drill mode | D |
| Switch canvas | M |

## License

MIT
