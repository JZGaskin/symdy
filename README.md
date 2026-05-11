# Symdy

**Your AI companion.** Symdy remembers. Symdy learns. Symdy gets better at understanding you every day.

A persistent cognitive dyad — a two-entity intelligence system where each improves the other.

## What Symdy Is

Symdy is a browser-based AI companion that:
- **Remembers** conversations across sessions
- **Learns** your dimensions — professional, creative, personal, everything
- **Auto-selects** the right AI model for each task (you never see model names)
- **Stays local** — all data lives in your browser. Nothing leaves except what you send to the AI.
- **Is portable** — export/import as a single file. Take Symdy anywhere.
- **Costs nothing to run** — you bring your own OpenRouter API key (pay only for what you use)

## Quick Start

1. Get an API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Open `index.html` in your browser
3. Add your key in Settings
4. Start talking

That's it. No install. No server. No account.

## Architecture

```
┌──────────────────────────────────────────┐
│              Your Browser                 │
│                                           │
│  ┌─────────┐   ┌──────────┐              │
│  │ Chat UI │──▶│ Justifier │──▶ OpenRouter│
│  └─────────┘   └──────────┘              │
│       │               │                   │
│       ▼               ▼                   │
│  ┌─────────────────────────┐              │
│  │   sql.js (SQLite/WASM)  │              │
│  │  ┌──────┐ ┌──────────┐  │              │
│  │  │Thread│ │Dimensions│  │              │
│  │  │  s   │ │          │  │              │
│  │  └──────┘ └──────────┘  │              │
│  └─────────────────────────┘              │
│                                           │
│  Nothing leaves your browser              │
│  except the prompt + history              │
└──────────────────────────────────────────┘
```

## Model Justifier

Symdy classifies every message and selects the optimal model:

| Task Class     | Default Model        | Use When                          |
|---------------|---------------------|-----------------------------------|
| Chat          | Claude 3.5 Haiku     | Quick responses, everyday chat    |
| Analysis      | Claude Sonnet 4      | Explanations, comparisons         |
| Complex       | Claude Opus 4        | Multi-step reasoning, debugging   |
| Creative      | Claude Sonnet 4      | Writing, ideation, tone work      |
| Document      | Gemini 2.5 Pro       | Long documents, context-heavy     |

Users never see model names. Symdy just works.

## Tech Stack

- **Storage:** sql.js (SQLite compiled to WebAssembly)
- **AI:** OpenRouter API (user's own key)
- **UI:** Vanilla HTML/CSS/JS — no frameworks
- **Hosting:** GitHub Pages (static, $0)
- **License:** GPLv3

## Philosophy

Symdy is built on the principle that the most valuable AI product isn't the smartest model — it's the one that knows its human best.

Symdy applies BED (Better Every Day) — each conversation makes Symdy a better companion. Not just the AI getting smarter. The relationship getting richer.

## Development

```bash
# Just open it
open index.html

# Or serve locally
python3 -m http.server 8080
```

No build step. No bundler. No npm install. Edit the files, refresh the browser.

## License

GPLv3. See [LICENSE](LICENSE).

Symdy is open source. The code is yours. Your data is yours. No lock-in. No cloud dependency. No account required.
