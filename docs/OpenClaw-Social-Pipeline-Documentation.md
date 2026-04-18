---
title: "OpenClaw Social Pipeline"
subtitle: "Complete Documentation — Installation, Configuration, Tools & Dashboard Guide"
author: "OpenClaw"
date: "April 2026"
---

<div style="page-break-after: always;"></div>

# OpenClaw Social Pipeline

## Complete Documentation

**Version:** 1.0.0
**Date:** April 2026
**Repository:** github.com/seantunley/openclaw-social-pipeline

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Installation](#3-installation)
4. [Configuration](#4-configuration)
5. [The Content Pipeline](#5-the-content-pipeline)
6. [Dashboard Guide](#6-dashboard-guide)
7. [Agent Tool Reference](#7-agent-tool-reference)
8. [Skills Reference](#8-skills-reference)
9. [Postiz Integration](#9-postiz-integration)
10. [Supported Platforms](#10-supported-platforms)
11. [API Reference](#11-api-reference)
12. [Troubleshooting](#12-troubleshooting)

<div style="page-break-after: always;"></div>

---

## 1. Overview

The OpenClaw Social Pipeline is a native OpenClaw plugin that provides end-to-end social media content creation and publishing. It handles everything from research and content generation to approval workflows, scheduling, and analytics — all orchestrated through OpenClaw's agent system.

### What It Does

- **Researches** topics and trends, saves findings to a browsable library
- **Generates** multiple content draft variants using AI
- **Applies Marketing Psychology** — 30+ behavioral persuasion principles
- **Humanizes** content — detects and rewrites 29 AI writing patterns
- **Optimizes for SEO & GEO** — platform search discoverability + AI search citation
- **Generates images and videos** — fal.ai integration with editorial-quality prompt engineering
- **Manages approvals** — human review gate before any publishing
- **Publishes via Postiz** — media upload, scheduling, and publishing to 11 platforms
- **Tracks analytics** — pulls performance data back from Postiz
- **Learns continuously** — extracts patterns from edits, rejections, and analytics to improve future content

### Key Components

| Component | Purpose |
|-----------|---------|
| **OpenClaw Plugin** | 55 agent-facing tools, registered via `openclaw.plugin.json` |
| **Lobster Workflows** | Deterministic pipeline execution (research → publish) |
| **Task Flow** | Durable state tracking across 20 pipeline statuses |
| **Dashboard** | Standalone React app for operators (localhost:3001) |
| **Dashboard API** | Fastify REST server backing the dashboard (localhost:3000) |
| **4 Vendored Skills** | Humanizer, Marketing Psychology, Content Learning, Social SEO & GEO |
| **Postiz Adapter** | Swappable CLI/API integration for publishing |

<div style="page-break-after: always;"></div>

---

## 2. Architecture

### System Diagram

```
                    OpenClaw Agent
                         |
                    55 Plugin Tools
                         |
         ┌───────────────┼───────────────┐
         |               |               |
    Lobster Workflows  Task Flow    Skills (4)
    (3 YAML files)   (State Machine)    |
         |               |         ┌────┴────┐
         |               |    Humanizer  Marketing
         |               |    SEO/GEO    Psychology
         |               |    Learning
         |               |
    ┌────┴────┐    ┌─────┴─────┐
    |         |    |           |
Pipeline   Media  Approval  Analytics
Service   Service Service   Service
    |         |
    |    fal.ai (images/video)
    |
    └──── Postiz Adapter ────┐
              |               |
         CLI Adapter    API Adapter
              |               |
         Postiz CLI     Postiz REST API
              |               |
              └───────┬───────┘
                      |
            11 Social Platforms
```

### Data Flow

```
Research → Psychology → Draft Variants → Score → Select → Humanize
    → SEO/GEO → Compliance → Media Gen → Approval → Postiz Upload
    → Create Post → Schedule → Publish → Analytics Sync → Learning
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Plugin Runtime | TypeScript, Node.js |
| Database | SQLite via Drizzle ORM |
| API Server | Fastify + CORS |
| Dashboard | React 18, Vite, Tailwind CSS, TanStack Query, Recharts |
| LLM | Anthropic Claude SDK |
| Media Generation | fal.ai (nano-banana-2, Kling v3, Wan 2.7, Sora 2, LongCat) |
| Publishing | Postiz API / CLI |

<div style="page-break-after: always;"></div>

---

## 3. Installation

### Prerequisites

- Node.js 18+
- npm
- An OpenClaw workspace (or standalone mode)

### Install as OpenClaw Plugin

```bash
cd your-openclaw-workspace/plugins
git clone https://github.com/seantunley/openclaw-social-pipeline.git
cd openclaw-social-pipeline/plugins/openclaw-social-pipeline
npm install
npm run build
```

Reference in your OpenClaw agent configuration:

```json
{
  "plugins": ["./plugins/openclaw-social-pipeline"]
}
```

### Environment Variables

Create a `.env` file in the plugin directory:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...          # LLM content generation

# Required for publishing
POSTIZ_API_KEY=your-postiz-api-key    # Postiz publishing
POSTIZ_API_BASE_URL=https://app.postiz.com/api

# Required for media generation (when fal.ai is selected)
FAL_API_KEY=your-fal-key              # fal.ai image/video generation

# Optional
IMGBB_API_KEY=your-imgbb-key         # Permanent image hosting
DATABASE_PATH=./data/social-pipeline.db
API_PORT=3000
DASHBOARD_PORT=3001
IMAGE_PROVIDER=fal                    # 'fal' or leave empty
VIDEO_PROVIDER=fal                    # 'fal' or leave empty
```

### Run the Dashboard

```bash
# Terminal 1: API server
cd plugins/openclaw-social-pipeline
npm run start:api

# Terminal 2: Dashboard
cd dashboard/social-pipeline-dashboard
npm install
npm run dev
```

Dashboard opens at **http://localhost:3001**
API runs at **http://localhost:3000**

<div style="page-break-after: always;"></div>

---

## 4. Configuration

All settings are configurable via the **Settings** page in the dashboard or through the `social_config_set` agent tool.

### General Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Default Platforms | `["linkedin"]` | Platforms for new content runs |
| Max Variants | `3` | Draft variants generated per run |
| Approval Before Schedule | `true` | Require approval before scheduling |
| Approval Before Publish | `true` | Require approval before publishing |

### Humanizer Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | `true` | Run humanizer on all drafts |
| Aggressiveness | `5` | 1-10 scale (1=light fixes, 10=full rewrite) |

### Marketing Psychology Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | `true` | Apply psychology principles to drafts |
| Default Intensity | `5` | 1-10 scale (1=subtle, 10=maximum persuasion) |

### Media Generation Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Default Mode | `image` | `image`, `video`, `both`, or `none` |
| Provider | `fal` | `fal` for fal.ai integration |
| Image Model | `nano-banana-2` | fal.ai image model |
| Video Model | `kling-v3` | `kling-v3`, `wan-2.7`, `sora-2`, `longcat` |

### Postiz Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Adapter Mode | `api` | `api` or `cli` |
| API Base URL | (from env) | Postiz API endpoint |
| Analytics Sync Frequency | `6h` | How often to pull analytics |

### Pipeline Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Stage Retry Limit | `3` | Max retries per failed stage |
| Auto Analytics Sync | `true` | Automatically sync analytics |
| Nightly Summary Job | `false` | Run daily performance summary |

<div style="page-break-after: always;"></div>

---

## 5. The Content Pipeline

### Pipeline Stages

The Lobster workflow executes these stages in order:

| # | Stage | Status | Description |
|---|-------|--------|-------------|
| 1 | **Collect** | `collecting` | Gathers content brief, campaign context |
| 2 | **Research** | `researching` | Researches topic, audience, trends. Saves to Research Library |
| 3 | **Marketing Psychology** | `applying_psychology` | Applies 30+ persuasion principles |
| 4 | **Draft Variants** | `drafting` | Generates multiple content versions |
| 5 | **Score & Select** | `scoring` | Ranks drafts on relevance, engagement, clarity, brand fit |
| 6 | **Humanize** | `humanizing` | Removes 29 AI writing patterns |
| 7 | **SEO & GEO** | `checking_compliance` | Optimizes for platform search + AI citation |
| 8 | **Compliance** | `checking_compliance` | Brand voice and tone validation |
| 9 | **Media Generation** | `generating_media` | Creates images/video via fal.ai |
| 10 | **Approval** | `awaiting_approval` | Pauses for human review |
| 11 | **Upload to Postiz** | `uploading_to_postiz` | Uploads media assets |
| 12 | **Create Post** | `creating_post` | Creates the post in Postiz |
| 13 | **Schedule** | `scheduled` | Schedules for publishing |
| 14 | **Publish** | `published` | Post goes live |
| 15 | **Analytics Sync** | `analytics_synced` | Pulls performance data back |

### Pipeline State Machine

Valid status transitions:

```
queued → collecting → researching → applying_psychology → drafting
→ scoring → humanizing → checking_compliance → generating_media
→ awaiting_approval → approved → uploading_to_postiz → creating_post
→ scheduled → published → analytics_pending → analytics_synced

Any stage can transition to: failed, cancelled
failed → queued (retry), cancelled
rejected → queued (retry), cancelled
```

### Starting a Pipeline Run

**Via the agent:**
```
"Create a LinkedIn campaign about AI in supply chain for logistics managers"
```
The agent calls `social_campaign_create` → `social_run_create` → pipeline executes automatically.

**Via the dashboard:**
Navigate to Campaigns → Create Campaign → then Runs → New Run.

**Via API:**
```
POST /api/social/runs
{
  "campaign_id": "...",
  "platform": "linkedin",
  "brief": { "topic": "AI in supply chain", "audience": "logistics managers" },
  "media_mode": "image"
}
```

<div style="page-break-after: always;"></div>

---

## 6. Dashboard Guide

The dashboard is a standalone React application at **http://localhost:3001**.

### Pages

#### Overview
The main dashboard showing:
- Pipeline health (total runs, pending approvals, scheduled, published)
- Status breakdown chart
- Recent failures
- Upcoming scheduled posts

#### Runs
Searchable, filterable list of all content runs.
- Filter by status, platform, campaign
- Click any run to see full detail
- Actions: View, Cancel, Retry

#### Run Detail
Full pipeline view for a single run:
- Vertical timeline showing all stages with status icons
- Tabbed panels: Brief, Research, Psychology, Drafts, Humanized, Compliance, Media, Approval, Postiz State, Analytics
- Actions: Retry Stage, Regenerate Media, Approve, Reject, Send to Postiz

#### Approvals
Dedicated approval queue:
- Cards showing content preview, platform, media thumbnail
- Quick actions: Approve, Reject, Request Revision
- Notes input for rejection/revision

#### Campaigns
Campaign management:
- Create campaigns with target platforms, audience, objectives
- View runs per campaign
- Campaign performance overview

#### Research Library
Research findings from pipeline runs:
- Expandable rows with topic, brief, angle, sources
- Filter tabs: Pending, Approved, Promoted, Rejected
- **"Create Content Run"** button promotes a finding to a queued run
- Source links with platform badges

#### Learnings
Content patterns learned from edits, rejections, and analytics:
- Category filters (tone, hook, CTA, vocabulary, etc.)
- Confidence bars showing pattern strength
- Source badges (from edit, rejection, analytics, operator rule)
- **"Add Rule"** button for explicit brand rules (100% confidence)

#### Media Studio
Image and video gallery:
- Filter by type, run, status
- Expand for prompt text, regenerate controls
- Aspect ratio selection

#### Schedule (Drag-and-Drop Calendar)
Publishing calendar with three views:
- **Month view** — 42-cell grid with draggable post cards
- **Week view** — Hourly slots with drag-and-drop
- **List view** — Chronological list
- Drag a post to reschedule it
- Color-coded by platform

#### Inbox
Postiz social inbox — mentions, comments, likes, shares:
- Filter by type: All, Comments, Mentions, Likes, Shares
- Reply inline to any comment
- Like/react to posts
- Platform-colored author badges
- Relative timestamps

#### Analytics
Performance dashboard:
- Summary cards (impressions, engagement, clicks, CTR)
- Engagement over time line chart
- Performance by platform bar chart
- Top performing posts list

#### Settings
Full configuration panel:
- General, Humanizer, Marketing Psychology, Media, Postiz, Pipeline sections
- Toggle switches, number inputs, multi-select for platforms
- Save button with confirmation

<div style="page-break-after: always;"></div>

---

## 7. Agent Tool Reference

The plugin exposes **55 tools** to the OpenClaw agent. Below is the complete reference.

### Campaign Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_campaign_create` | `name`, `description`, `target_platforms[]`, `audience`, `objective`, `cta_style`, `posting_windows` | Create a new campaign |
| `social_campaign_update` | `id`, `...partial fields` | Update a campaign |
| `social_brief_create` | `campaign_id`, `platform`, `topic`, `audience_segment`, `goal`, `tone`, `cta` | Create a content brief |
| `social_brief_list` | `campaign_id?` | List briefs |

**Example conversation:**
> **User:** "Create a campaign for our Q2 product launch on LinkedIn and Twitter"
> **Agent:** `social_campaign_create({ name: "Q2 Product Launch", target_platforms: ["linkedin", "twitter"], objective: "product_launch" })`

### Run Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_run_create` | `campaign_id`, `platform`, `brief{}`, `media_mode?` | Create a content run |
| `social_run_list` | `status?`, `campaign_id?`, `platform?`, `limit?`, `offset?` | List runs with filters |
| `social_run_get` | `run_id` | Full run detail with all stages |
| `social_run_retry_stage` | `run_id`, `stage_name` | Retry a failed stage |
| `social_run_cancel` | `run_id` | Cancel a run |

**Example conversation:**
> **User:** "What's the status of our pipeline?"
> **Agent:** `social_run_list({ status: "awaiting_approval" })` → "You have 3 runs waiting for approval..."

### Drafting Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_research_generate` | `run_id` | Generate research for a run |
| `social_draft_generate` | `run_id`, `variant_count?` | Generate draft variants |
| `social_draft_score` | `run_id` | Score all drafts |
| `social_draft_select` | `run_id`, `draft_id` | Select a draft |

### Skill Application Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_apply_marketing_psychology` | `run_id`, `principles?[]`, `intensity?` | Apply psychology principles |
| `social_apply_humanizer` | `run_id`, `aggressiveness?` | Remove AI writing patterns |

### Media Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_image_generate` | `run_id`, `prompt?`, `aspect_ratio?` | Generate image via fal.ai |
| `social_video_generate` | `run_id`, `prompt?`, `aspect_ratio?`, `duration?` | Generate video via fal.ai |
| `social_media_regenerate` | `run_id`, `asset_id`, `new_prompt?` | Regenerate specific media |
| `social_media_select` | `run_id`, `asset_id` | Select media for the run |

**fal.ai Models:**
| Type | Model | Max Duration | Quality |
|------|-------|-------------|---------|
| Image | `nano-banana-2` | — | Editorial photography quality |
| Video | `kling-v3` (default) | 10s | Best quality/cost |
| Video | `wan-2.7` | 15s | Smooth motion |
| Video | `sora-2` | 25s | Premium quality |
| Video | `longcat` | 60s | Long-form content |

### Approval Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_submit_for_approval` | `run_id` | Submit for human review |
| `social_approve` | `run_id`, `reviewer`, `notes?` | Approve content |
| `social_reject` | `run_id`, `reviewer`, `notes` | Reject content |
| `social_request_revision` | `run_id`, `reviewer`, `notes`, `rerun_stages?[]` | Request changes |

**Example conversation:**
> **User:** "Approve the LinkedIn post about supply chain AI"
> **Agent:** `social_approve({ run_id: "...", reviewer: "Sean", notes: "Good to go" })`

### Postiz Publishing Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_postiz_auth_status` | — | Check Postiz connection |
| `social_postiz_integrations_list` | — | List connected platforms |
| `social_postiz_upload_media` | `run_id`, `asset_id` | Upload media to Postiz |
| `social_postiz_create_post` | `run_id`, `integration_id`, `content?` | Create post in Postiz |
| `social_postiz_schedule_post` | `run_id`, `post_id`, `scheduled_for` | Schedule post |
| `social_postiz_set_post_status` | `post_id`, `status` | Update post status |
| `social_postiz_list_posts` | `integration_id?`, `status?` | List posts |
| `social_postiz_post_analytics` | `post_id` | Get post analytics |
| `social_postiz_platform_analytics` | `integration_id`, `start_date?`, `end_date?` | Platform analytics |

### Inbox Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_inbox_status` | — | Check if inbox is available |
| `social_inbox_list` | `page?`, `filter?` | List notifications (comments, mentions, likes, shares) |
| `social_inbox_post_comments` | `post_id` | Get comments for a post |
| `social_inbox_reply` | `post_id`, `content`, `comment_id?` | Reply to a comment |
| `social_inbox_react` | `post_id`, `reaction?` | Like/react to a post |

**Example conversation:**
> **User:** "Check our social inbox"
> **Agent:** `social_inbox_list({ filter: "mention" })` → "3 new mentions: @jane on LinkedIn mentioned your AI article..."

### Research Library Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_research_list` | `status?`, `campaign_id?`, `topic?`, `limit?` | List research findings |
| `social_research_get` | `research_id` | Full detail of a finding |
| `social_research_save` | `topic`, `title`, `brief?`, `angle?`, `platforms?[]`, `sources?[]`, `tags?[]` | Save a finding |
| `social_research_update_status` | `research_id`, `status` | Approve/reject/archive |
| `social_research_promote` | `research_id`, `platform?`, `campaign_id?` | Promote to content run |

**Example conversation:**
> **User:** "Show me pending research"
> **Agent:** `social_research_list({ status: "pending" })` → "5 pending findings..."
> **User:** "Promote the supply chain one to a LinkedIn run"
> **Agent:** `social_research_promote({ research_id: "...", platform: "linkedin" })`

### SEO & GEO Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_seo_geo_score` | `content`, `platform` | Score for SEO + GEO without modifying |
| `social_seo_geo_enhance` | `content`, `platform`, `context?` | Enhance content for SEO + GEO |
| `social_seo_geo_generate` | `topic`, `platform`, `key_facts?[]`, `experience_statement?`, `target_audience?` | Generate SEO/GEO-optimized post from scratch |

**SEO Scoring (platform search):**
- Keyword Optimization (25%)
- Hashtag Strategy (15%)
- Content Discoverability (20%)
- Technical Elements (15%)
- Search Intent Alignment (25%)

**GEO Scoring (AI citation):**
- Citability (30%)
- Authority / E-E-A-T (25%)
- Structural Clarity (20%)
- Entity Clarity (15%)
- Cross-Platform Amplification (10%)

### Content Learning Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_learning_list` | `category?`, `platform?`, `active?`, `limit?` | List learned patterns |
| `social_learning_get_applicable` | `platform`, `campaign_id?`, `min_confidence?` | Get learnings for prompt injection |
| `social_learning_extract_from_edit` | `original_draft`, `edited_draft`, `platform`, `run_id?` | Extract patterns from edits |
| `social_learning_extract_from_feedback` | `notes`, `action`, `draft_content?`, `platform` | Extract from rejections |
| `social_learning_add_rule` | `category`, `content`, `platform?`, `tags?[]` | Add explicit rule (100% confidence) |
| `social_learning_deactivate` | `learning_id` | Deactivate a learning |

**Learning Categories:** `tone`, `structure`, `hook`, `cta`, `vocabulary`, `platform`, `topic`, `media`, `timing`, `audience`, `avoidance`, `psychology`

**Example conversation:**
> **User:** "Add a rule: never use clickbait on LinkedIn"
> **Agent:** `social_learning_add_rule({ category: "avoidance", content: "Never use clickbait headlines on LinkedIn", platform: "linkedin" })`

### Configuration Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `social_config_get` | `key?` | Get config or specific key |
| `social_config_set` | `key`, `value` | Set config value |
| `social_dashboard_summary` | — | Dashboard summary stats |
| `social_dashboard_pipeline_state` | — | Current pipeline state |

<div style="page-break-after: always;"></div>

---

## 8. Skills Reference

### Humanizer
Detects and rewrites 29 AI writing patterns. Configured via aggressiveness level (1-10).

**Patterns detected:** overuse of "delve", "in today's landscape", "it's important to note", "game-changer", excessive hedging, "leverage", "unlock the power of", tricolon abuse, "seamless integration", "cutting-edge", "empower", "revolutionize", em-dash overuse, and 16 more.

### Marketing Psychology
Applies 30+ behavioral psychology principles across 6 categories:

- **Attention & Hook:** Pattern Interrupt, Curiosity Gap, Negativity Bias, Specificity, Contrast
- **Trust & Credibility:** Social Proof, Authority, Consistency, Mere Exposure, Halo Effect
- **Engagement & Action:** Loss Aversion, Scarcity, Reciprocity, Zeigarnik Effect, IKEA Effect
- **Memory & Shareability:** Von Restorff Effect, Rhyme-as-Reason, Story Arc, Peak-End Rule, Chunking
- **Emotional Triggers:** Identity Appeal, Aspiration Gap, Belonging, Autonomy, Competence
- **Platform-Specific:** LinkedIn Professional Identity, Twitter Hot Takes, Instagram Visual Metaphor, TikTok Pattern Interrupt, YouTube Curiosity Thumbnail

### Social SEO & GEO
Dual optimization for platform search (SEO) and AI search citation (GEO).

**SEO:** Keyword placement, hashtag strategy (platform-specific counts and mix), discoverability signals, technical elements (alt text, captions), search intent alignment.

**GEO:** Citability (quotable facts in 134-167 word blocks), E-E-A-T authority signals, structural readability, entity clarity, cross-platform amplification potential.

Includes platform-specific playbooks for LinkedIn, YouTube, Reddit, Instagram, TikTok, Pinterest, and VK.

### Content Learning
Continuous learning from operator behavior:
- **Draft edits** → extracts tone, structure, vocabulary patterns
- **Rejections** → extracts avoidance rules from reviewer notes
- **Analytics** → compares top vs bottom performers for winning patterns
- **Operator rules** → explicit rules at 100% confidence

Confidence scoring (0.0-1.0) with monthly decay. Learnings are injected into drafting prompts automatically.

<div style="page-break-after: always;"></div>

---

## 9. Postiz Integration

### Connection Modes

| Mode | When to Use |
|------|------------|
| **API** (default) | Dashboard + server-side integrations. Set `POSTIZ_API_KEY` and `POSTIZ_API_BASE_URL` |
| **CLI** | Local automation via `npx postiz` commands |

### Supported Operations

- Check authentication status
- List connected platform integrations
- Upload media (images, videos)
- Create posts with media attachments
- Schedule posts for specific times
- Update post status
- Fetch post analytics (impressions, clicks, likes, shares, engagement rate)
- Fetch platform-level analytics

### Publishing Flow

```
1. Content approved
2. Media uploaded to Postiz → receives media IDs
3. Post created in Postiz with content + media IDs
4. Post scheduled for configured time slot
5. Postiz publishes at scheduled time
6. Analytics synced back periodically
```

<div style="page-break-after: always;"></div>

---

## 10. Supported Platforms

| Platform | ID | Character Limit | Hashtag Strategy |
|----------|----|----------------|-----------------|
| LinkedIn | `linkedin` | 3,000 | 3-5 (broad + niche mix) |
| Twitter/X | `twitter` | 280 / 4,000 (premium) | 1-2 |
| Instagram | `instagram` | 2,200 | 5-15 (broad + mid + niche) |
| Facebook | `facebook` | 63,206 | 1-3 |
| TikTok | `tiktok` | 2,200 | 3-5 |
| YouTube | `youtube` | 5,000 | 3-5 in description |
| Threads | `threads` | 500 | 1-3 |
| Bluesky | `bluesky` | 300 | 0-2 |
| Pinterest | `pinterest` | 500 | 0 (keyword SEO only) |
| Reddit | `reddit` | 40,000 | 0 (no hashtags) |
| VK | `vk` | 15,895 | 3-7 |

### Platform Aspect Ratios

| Platform | Image Aspect Ratio | Video Aspect Ratio |
|----------|-------------------|-------------------|
| Instagram Feed | 4:5 | 4:5 |
| Instagram Reel | 9:16 | 9:16 |
| Instagram Carousel | 4:5 | — |
| LinkedIn | 1:1 | 16:9 |
| Twitter/X | 16:9 | 16:9 |
| TikTok | 9:16 | 9:16 |
| YouTube | 16:9 | 16:9 |
| YouTube Short | 9:16 | 9:16 |
| Facebook | 1:1 | 16:9 |
| Pinterest | 4:5 | 9:16 |
| Reddit | 16:9 | 16:9 |
| VK | 16:9 | 16:9 |

<div style="page-break-after: always;"></div>

---

## 11. API Reference

The dashboard API runs on port 3000. All endpoints are prefixed with `/api/social/`.

### Runs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/runs` | List runs (query: `status`, `campaign_id`, `platform`) |
| `POST` | `/api/social/runs` | Create run |
| `GET` | `/api/social/runs/:id` | Get run detail |
| `POST` | `/api/social/runs/:id/retry-stage` | Retry stage (body: `stage_name`) |
| `POST` | `/api/social/runs/:id/cancel` | Cancel run |
| `PATCH` | `/api/social/runs/:id/reschedule` | Reschedule (body: `scheduledAt`) |

### Approvals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/social/runs/:id/approve` | Approve (body: `reviewer`, `notes?`) |
| `POST` | `/api/social/runs/:id/reject` | Reject (body: `reviewer`, `notes`) |
| `POST` | `/api/social/runs/:id/request-revision` | Request revision |

### Drafts & Media

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/social/runs/:id/regenerate-draft` | Regenerate drafts |
| `POST` | `/api/social/runs/:id/regenerate-media` | Regenerate media |
| `POST` | `/api/social/runs/:id/select-draft` | Select draft (body: `draft_id`) |
| `POST` | `/api/social/runs/:id/select-media` | Select media (body: `asset_id`) |

### Postiz

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/postiz/auth-status` | Check Postiz connection |
| `GET` | `/api/social/postiz/integrations` | List connected platforms |
| `POST` | `/api/social/runs/:id/postiz/upload` | Upload media |
| `POST` | `/api/social/runs/:id/postiz/create-post` | Create post |
| `POST` | `/api/social/runs/:id/postiz/schedule` | Schedule post |
| `GET` | `/api/social/runs/:id/postiz/analytics` | Get analytics |

### Research

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/research` | List research (query: `status`, `topic`) |
| `POST` | `/api/social/research` | Create research item |
| `GET` | `/api/social/research/:id` | Get research detail |
| `PATCH` | `/api/social/research/:id` | Update status |
| `POST` | `/api/social/research/:id/promote` | Promote to content run |
| `DELETE` | `/api/social/research/:id` | Delete |

### Learnings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/learnings` | List learnings (query: `category`, `platform`) |
| `POST` | `/api/social/learnings/rule` | Add operator rule |
| `DELETE` | `/api/social/learnings/:id` | Deactivate |

### Inbox

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/inbox/status` | Check availability |
| `GET` | `/api/social/inbox` | List notifications |
| `GET` | `/api/social/inbox/post/:postId/comments` | Get comments |
| `POST` | `/api/social/inbox/post/:postId/reply` | Reply |
| `POST` | `/api/social/inbox/post/:postId/react` | React |

### Config & Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/social/config` | Get full config |
| `PUT` | `/api/social/config` | Update config |
| `GET` | `/api/social/summary` | Dashboard summary |
| `GET` | `/api/social/health` | Health check |

<div style="page-break-after: always;"></div>

---

## 12. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Dashboard shows no data | Start the API server: `npm run start:api` in the plugin directory |
| Settings won't save | Verify API is running and base URL is `/api/social` |
| fal.ai images not generating | Set `FAL_API_KEY` in `.env` and `IMAGE_PROVIDER=fal` |
| Postiz connection fails | Verify `POSTIZ_API_KEY` and `POSTIZ_API_BASE_URL` in `.env` |
| Pipeline stuck at a stage | Use `social_run_retry_stage` or retry from the Run Detail page |
| No inbox notifications | Connect platforms in Postiz first, then check `POSTIZ_API_KEY` |
| Learnings not applied | Check confidence > 0.3 and learning is `active: true` |

### Database Location

Default: `./data/social-pipeline.db` (SQLite)

Override with `DATABASE_PATH` environment variable.

### Logs

API server logs to stdout at the configured `LOG_LEVEL` (default: `info`).

Set `LOG_LEVEL=debug` for verbose output.

---

**OpenClaw Social Pipeline** | Version 1.0.0 | April 2026
**Repository:** github.com/seantunley/openclaw-social-pipeline
**License:** MIT
