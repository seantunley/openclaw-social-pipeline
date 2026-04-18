# OpenClaw Social Pipeline

A native OpenClaw plugin for end-to-end social media content creation and publishing, plus a standalone operator dashboard.

## What It Does

- **Content generation** — research, draft variants, scoring, selection
- **Marketing Psychology** — applies 30+ behavioral psychology principles to content
- **Humanizer** — detects and rewrites 29 AI writing patterns for natural tone
- **Image & video generation** — OpenClaw native media generation with platform-specific aspect ratios
- **Postiz integration** — media upload, scheduling, publishing, and analytics via API or CLI
- **Approval workflow** — human review gate before any publishing
- **Dashboard** — standalone React app for operators to manage the full pipeline

## Architecture

```
openclaw-social-pipeline/
  plugins/openclaw-social-pipeline/     # OpenClaw plugin (installable)
    openclaw.plugin.json                # Plugin manifest
    src/
      tools/          # 35+ agent-facing tools
      services/       # Postiz adapter, pipeline, approvals, analytics
      taskflow/       # Durable run state controller
      schemas/        # Zod schemas + Drizzle DB schema
      db/             # SQLite database init
    lobster/          # Deterministic workflow definitions
    skills/           # Vendored Humanizer + Marketing Psychology
    dashboard-api/    # Fastify REST API for the dashboard
  dashboard/social-pipeline-dashboard/  # Standalone React dashboard
```

## Install as OpenClaw Plugin

```bash
# Clone into OpenClaw's plugin directory
git clone https://github.com/seantunley/openclaw-social-pipeline ~/.openclaw/plugins/openclaw-social-pipeline

# Install root workspace deps
cd ~/.openclaw/plugins/openclaw-social-pipeline
npm install

# Build the plugin
cd plugins/openclaw-social-pipeline
mkdir -p dist/data                 # SQLite database lands here
cp .env.example .env               # Fill in POSTIZ_API_KEY, ANTHROPIC_API_KEY, FAL_API_KEY
npm install
npm run build

# Register with OpenClaw
openclaw plugins install --dangerously-force-unsafe-install ~/.openclaw/plugins/openclaw-social-pipeline/plugins/openclaw-social-pipeline
```

> **Note:** The `--dangerously-force-unsafe-install` flag is required because the plugin includes `child_process` calls (Postiz CLI) and network requests (Postiz API, fal.ai). This is expected behavior for a publishing pipeline.

### Persistent Services (Linux/macOS)

Copy the systemd user units from `docs/systemd/` to run the API and dashboard as background services:

```bash
cp docs/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now social-pipeline-api social-pipeline-dashboard
```

The API runs on port 3000, the dashboard on port 3001.

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required secrets:
- `ANTHROPIC_API_KEY` — for LLM content generation
- `POSTIZ_API_KEY` — for publishing (if using API mode)
- `POSTIZ_API_BASE_URL` — Postiz API endpoint

Optional:
- `FAL_API_KEY` — for image/video generation via fal.ai
- `IMGBB_API_KEY` — for permanent image hosting

### Run the Dashboard

```bash
# Install dependencies
cd dashboard/social-pipeline-dashboard
npm install

# Start the dashboard (port 3001)
npm run dev
```

### Run the API Server

```bash
cd plugins/openclaw-social-pipeline
npm install
npm run start:api    # Starts Fastify on port 3000
```

### Run Both Together

From the workspace root:

```bash
npm install
npm run dev          # Starts API (3000) + Dashboard (3001) concurrently
```

## Pipeline Stages

1. **Collect** — gather content brief
2. **Research** — topic and audience research
3. **Marketing Psychology** — apply persuasion principles
4. **Draft Variants** — generate multiple content versions
5. **Score & Select** — rank and choose best draft
6. **Humanize** — remove AI writing patterns
7. **Compliance Check** — brand and tone validation
8. **Media Generation** — create images or video
9. **Approval** — human review gate
10. **Upload to Postiz** — push media assets
11. **Create Post** — create the post in Postiz
12. **Schedule/Publish** — schedule or immediately publish
13. **Analytics Sync** — pull performance data back
14. **Feedback Writeback** — feed insights into future runs

## Agent Tools

The plugin exposes 35+ tools to the OpenClaw agent:

| Category | Tools |
|----------|-------|
| Campaigns | `social_campaign_create`, `social_campaign_update`, `social_brief_create`, `social_brief_list` |
| Runs | `social_run_create`, `social_run_list`, `social_run_get`, `social_run_retry_stage`, `social_run_cancel` |
| Drafting | `social_research_generate`, `social_draft_generate`, `social_draft_score`, `social_draft_select` |
| Skills | `social_apply_marketing_psychology`, `social_apply_humanizer` |
| Media | `social_image_generate`, `social_video_generate`, `social_media_regenerate`, `social_media_select` |
| Approval | `social_submit_for_approval`, `social_approve`, `social_reject`, `social_request_revision` |
| Postiz | `social_postiz_auth_status`, `social_postiz_integrations_list`, `social_postiz_upload_media`, `social_postiz_create_post`, `social_postiz_schedule_post`, `social_postiz_set_post_status`, `social_postiz_list_posts`, `social_postiz_post_analytics`, `social_postiz_platform_analytics` |
| Config | `social_config_get`, `social_config_set`, `social_dashboard_summary`, `social_dashboard_pipeline_state` |

## Dashboard Pages

- **Overview** — pipeline health, status counts, pending approvals
- **Runs** — searchable/filterable run list
- **Run Detail** — full pipeline timeline with stage outputs
- **Approvals** — pending approval queue with quick actions
- **Campaigns** — campaign management
- **Media Studio** — image/video gallery with regeneration
- **Schedule** — Postiz schedule view
- **Analytics** — performance charts and top performers
- **Settings** — full pipeline configuration

## Tech Stack

- **Plugin**: TypeScript, Drizzle ORM, SQLite, Zod
- **API**: Fastify, CORS
- **Dashboard**: React 18, Vite, Tailwind CSS, TanStack Query, Recharts, Lucide Icons
- **LLM**: Anthropic Claude SDK
- **Publishing**: Postiz API/CLI

## License

MIT
