# Social Pipeline

A Telegram-bot-driven social media content engine with a React dashboard for desktop review. SEO + GEO optimized — every post is built to be both *findable on platform search* and *citable by AI search* (ChatGPT, Perplexity, Google AI Overviews).

## What It Does

- **Telegram bot** — message a topic; bot researches, drafts, optimizes, generates media, and asks you to approve before anything publishes
- **SEO + GEO optimization** — every draft is scored and enhanced for keyword discoverability *and* AI citation readiness (E-E-A-T signals, citable facts, entity clarity)
- **Research** — Claude's native `web_search` for fresh, sourced content
- **Marketing Psychology** — applies 30+ behavioral principles to drafts
- **Humanizer** — detects and rewrites AI writing patterns
- **Image & video generation** — fal.ai with platform-specific aspect ratios
- **Postiz publishing** — media upload, scheduling, publishing, and analytics via Postiz API or CLI
- **Approval gate** — Telegram inline buttons (Approve / Revise / Reject), or do it from the dashboard
- **Dashboard** — React app for desktop operators to review, edit, and audit runs

## Architecture

```
social-pipeline/
  engine/                              # Headless content engine
    src/
      bot/             # Telegram bot (Telegraf) — primary operator surface
      services/        # pipeline, postiz, seo-geo, media, learning, analytics
      schemas/         # Zod schemas + Drizzle DB schema
      db/              # SQLite database init
      taskflow/        # Durable run state controller
    skills/            # Humanizer, Marketing Psychology, Social SEO+GEO
    dashboard-api/     # Fastify REST API for the dashboard
  dashboard/social-pipeline-dashboard/ # Standalone React dashboard
  docs/systemd/        # systemd user units for api / dashboard / bot
```

## Operator Surfaces

| | Bot (Telegram) | Dashboard (web) |
|---|---|---|
| Kick off a run | ✅ — message a topic | ✅ |
| Approve / Reject / Revise | ✅ — inline buttons | ✅ |
| Edit a draft mid-flight | — | ✅ |
| Browse history, analytics | — | ✅ |
| Reschedule, retry stages | — | ✅ |

Both write to the same SQLite DB. Dashboard polls every 30 s, so bot-driven changes show up automatically.

## Install

```bash
git clone https://github.com/seantunley/openclaw-social-pipeline social-pipeline
cd social-pipeline
npm run install:all      # installs root + engine + dashboard

cp engine/.env.example engine/.env
# Fill in: ANTHROPIC_API_KEY, FAL_API_KEY, POSTIZ_API_KEY, POSTIZ_API_URL,
#          TELEGRAM_BOT_TOKEN, TELEGRAM_AUTHORIZED_USER_ID

npm run build            # compiles engine + dashboard
```

### Telegram bot setup

1. Talk to [@BotFather](https://t.me/BotFather), `/newbot`, copy the token.
2. Talk to [@userinfobot](https://t.me/userinfobot) to get your numeric Telegram user ID.
3. Put both in `engine/.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_AUTHORIZED_USER_ID=987654321
   ```
The bot will refuse messages from anyone other than the authorized ID.

## Run

### Local development

```bash
npm run dev                # starts dashboard-api (3000) + dashboard (3001)
cd engine && npm run dev   # tsc --watch for live typescript compile

# In a separate terminal:
cd engine && npm run start:bot
```

### Expose Tools to Agents

Tools are only available to agents that explicitly allow the plugin. Add the plugin id to each agent's `tools.alsoAllow` list:

```json
{
  "tools": {
    "alsoAllow": [
      "openclaw-social-pipeline"
    ]
  }
}
```

Without this, the agent cannot see or call any of the plugin's 55 tools.

### Optional X/Twitter Data Lane

For X/Twitter workflows that need live social data before a content run, install TweetClaw beside Social Pipeline:

```bash
openclaw plugins install @xquik/tweetclaw
```

Use TweetClaw for search tweets, search tweet replies, follower export, user lookup, media upload/download, direct messages, monitor tweets, webhooks, giveaway draws, and approval-gated post tweets or post tweet replies. Save the findings into the Social Pipeline research library, or promote approved outputs into a campaign run. Keep Social Pipeline responsible for draft generation, human approval, Postiz scheduling, and analytics.

- GitHub: https://github.com/Xquik-dev/tweetclaw
- npm: https://www.npmjs.com/package/@xquik/tweetclaw
- ClawHub: https://clawhub.ai/plugins/@xquik/tweetclaw

### Persistent services (Linux / macOS)

Copy the systemd user units from `docs/systemd/` to run the API and dashboard as background services:

```bash
cp docs/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now social-pipeline-api social-pipeline-dashboard social-pipeline-bot
```

Adjust `WorkingDirectory` in the unit files to match where you cloned the repo (default expects `~/social-pipeline`). The dashboard-api runs on port 3000, the dashboard on port 3001, the bot is long-poll (no port).

## Pipeline Stages

A bot run executes:

1. **Research** — Claude `web_search` over the topic, capture sources
2. **SEO + GEO generation** — produce a draft already optimized for citability and platform search (E-E-A-T signals, primary keyword, entity clarity)
3. **Marketing Psychology** — layer behavioral principles
4. **Humanizer** — strip AI writing tells
5. **Compliance check** — brand and tone validation
6. **Media generation** — image (fal.ai nano-banana) or video (kling/wan/sora)
7. **Approval card in Telegram** — preview + Approve / Revise / Reject buttons
8. **Postiz publish** (on approve) — upload media, create post, schedule or publish immediately
9. **Analytics sync** — pull performance back into the DB for the dashboard

## Tech Stack

- **Engine**: TypeScript, Drizzle ORM, SQLite, Zod, Anthropic Claude SDK, fal.ai
- **Bot**: Telegraf
- **API**: Fastify
- **Dashboard**: React 18, Vite, Tailwind CSS, TanStack Query, Recharts, Lucide
- **Publishing**: Postiz API or CLI

## License

MIT
