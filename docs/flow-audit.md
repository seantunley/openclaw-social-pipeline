---
title: "Social Pipeline — Flow Audit & Redesign Recommendations"
date: "2026-04-27"
pdf_options:
  format: A4
  margin: 22mm
  printBackground: true
stylesheet_encoding: utf-8
css: |
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.5; }
  h1 { color: #6f4dab; border-bottom: 2px solid #6f4dab; padding-bottom: 6px; }
  h2 { color: #6f4dab; margin-top: 1.6em; }
  h3 { color: #2c2f3f; margin-top: 1.4em; }
  code, pre { background: #f4f4f7; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  pre { padding: 10px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d4d4dc; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f2f2f7; }
  blockquote { border-left: 4px solid #DC8DCC; padding-left: 12px; color: #4a4a55; margin-left: 0; }
  .callout { background: #f7f5fb; border: 1px solid #e0d8f0; padding: 10px 14px; border-radius: 6px; margin: 1em 0; }
---

# Social Pipeline — Flow Audit & Redesign Recommendations

**Audit date:** 2026-04-27
**Scope:** End-to-end operator workflow from "I want a post" to "post is scheduled to publish"
**Trigger:** Operator question — "From the post composer back to the runs seems odd."

---

## 1. The complaint, decoded

The operator's instinct is correct. The current flow has three structural problems that compound:

1. **Composer is fire-and-forget.** "AI Generate" kicks off a 2-5 minute pipeline run, polls it inline, and on success shows a toast saying "go to Approvals." There is no handoff — no redirect, no live progress on the page the operator is already looking at, no breadcrumb to the work they just kicked off.
2. **The same data appears in five places with five different shapes.** A single run shows up in Composer (as "the thing I just submitted"), Runs (as a table row), RunDetail (as 13 tabs), Approvals (as a card), and Schedule (as a draggable calendar block). Each view answers a different question, but the operator has to know *which* view answers *which* question — that's UX debt.
3. **Approval is buried.** The Approval tab is the 11th of 13 tabs in RunDetail, and RunDetail defaults to the Preview tab. The single most important operator action is two clicks away from where the user lands.

The "Composer → Runs is odd" feeling is real. Composer doesn't navigate anywhere because there's nowhere good to go: RunDetail's default tab isn't relevant for a freshly-started run (no draft yet), and Runs is a list that won't help the operator track *this specific* run they just created.

---

## 2. What's working — preserve these

Before recommending changes, what should not regress:

| Capability | Where it lives | Status |
|---|---|---|
| 7-stage pipeline (research → SEO/GEO → psychology → humanize → media → approve → analytics) | Engine | Load-bearing |
| Brand voice profile injected per run | Engine + BrandVoice page | Load-bearing |
| Continuous learning rule extraction from edits/rejections | Engine + Learnings page | Load-bearing |
| No-fabrication enforcement (hardest rule) | Engine prompts + Compliance tab | Load-bearing |
| SEO/GEO scoring | Engine + RunDetail SEO/GEO tab | Load-bearing |
| Readability scoring with regenerate | RunDetail Readability tab | Load-bearing |
| Multi-platform formatting & character limits | Composer + Engine | Load-bearing |
| Schedule modal with best-times presets and custom date/time picker | ScheduleModal component | Load-bearing |
| Schedule calendar drag-and-drop | Schedule page | Load-bearing |
| Smart Schedule (run AI Generate at a chosen time) | Composer + scheduler worker | Load-bearing |
| Zombie watchdog + approval repair on API restart | Dashboard API server | Load-bearing |

None of the recommendations below remove these — they reorganize how the operator reaches them.

---

## 3. The redesigned flow — three principles

### Principle 1: One workflow, not five views

A run has a clear lifecycle: **drafted → generating → review → scheduled → published → analyzed**. The dashboard should follow that lifecycle, not slice it into pages by data type.

### Principle 2: The work surface is the run itself

Composer should *become* the run while it's being generated, not redirect away. Approvals should be a queue you flow through, not a destination you visit and bounce out of.

### Principle 3: Progressive disclosure, not 13 tabs

Most operators care about the post and the score. Power users want every stage's output. Treat the inspection tabs as a developer drawer, not the primary surface.

---

## 4. Specific recommendations

### 4.1 Composer becomes a live run view (highest impact)

**Today:** Operator types topic → AI Generate → polls 3 minutes inline → toast → navigate to Approvals manually.

**Proposed:** The Composer page transforms in place. The moment a run starts, the Composer panel converts into a **live pipeline view**:

- The PipelineTimeline component (already built, used in RunDetail) appears at the top, showing all 7 stages.
- Each stage streams its result inline as it completes (research summary, SEO score, psychology hook, humanized draft, media, etc.).
- When the run reaches `pending_approval`, an Approve & Schedule button slides up at the top of the panel.
- A breadcrumb shows the run ID and "Open full details →" for the 13-tab inspection.

This is the biggest single win — it turns the dead 2-5 minute wait into a live, transparent process and removes the awkward "go look in another tab" handoff.

### 4.2 Default RunDetail to Approval when status is `pending_approval`

Trivial change, big effect. The default tab should be context-aware:

- `pending_approval` → land on Approval tab
- `approved` and not yet scheduled → land on Approval tab (so the Schedule publish button is visible)
- `running` → land on Pipeline (a new top-level view; see 4.4)
- `completed` and published → land on Analytics
- everything else → Preview

### 4.3 Collapse Approvals page into a true work queue

**Today:** Approvals shows cards, click → RunDetail (which lands on Preview, not Approval). After approving, the user returns to the Approvals list manually.

**Proposed:** Approvals becomes a **focus mode** — the same review surface as RunDetail.Approval, but with two persistent affordances:

- **"Next item"** button after approve/reject (auto-advances to the next pending run).
- **A queue counter** in the sidebar (e.g. "Approvals · 3") so the operator always sees how many are waiting without navigating.

The card grid stays for triage at the top; the focus mode is the working state.

### 4.4 Promote "Pipeline" as a new top-level tab in RunDetail

The 13 current tabs are organized by *artifact* (Brief, Research, SEO/GEO, Psychology…). That's how the engine thinks. The operator thinks in *checkpoints*. Introduce a single "Pipeline" tab as the new default for in-progress runs, containing:

- The PipelineTimeline (already exists)
- Per-stage expand-on-click panels (collapsed by default)
- Inline regenerate buttons for each stage

Keep the 13 specialized tabs, but move them behind a "Stages" sub-nav. Most operators never need them; the few that do still have them.

### 4.5 Unify scheduling into one component (already done — keep it)

The shared ScheduleModal supporting both "create-run" and "schedule-approved" modes is correct. Don't add a third pattern. The drag-and-drop calendar is a fine *secondary* affordance for bulk re-organization, but never the primary path.

### 4.6 Overview becomes the operator's home

**Today:** Stat cards, charts, recent failures, upcoming scheduled. All read-only.

**Proposed:** Add a single "What needs your attention" panel at the top:

- Pending approvals (clickable → focus mode)
- Failed runs (clickable → RunDetail with error tab)
- Runs scheduled in the next 24h (clickable → Schedule)

Below that, the existing summary stays. Make the Overview a *triage dashboard*, not a vanity panel.

### 4.7 Remove or hide unused surfaces

- **Inbox** — engagement hub from Postiz. Postiz isn't connected yet. Either hide it from the sidebar until it has data, or place it under a "Coming soon" badge.
- **Postiz State tab** in RunDetail — raw JSON debug. Move behind a developer toggle in Settings.

### 4.8 Visual: explicit run cards on Runs/Composer

The Runs page is a table. Tables are fine for filtering, but new operators don't see the *content* — only metadata. Add a card grid view toggle (cards show platform, the actual draft text snippet, media thumb, status).

---

## 5. Visual hierarchy fixes

These are smaller polish items that compound into "feels professional."

| Issue | Fix |
|---|---|
| 13 equal-weight tabs in RunDetail | Group: Pipeline · Content (Brief, Research, Drafts…) · Quality (SEO/GEO, Compliance, Readability) · Output (Preview, Media) · Lifecycle (Approval, Postiz, Analytics) |
| Approve button color same as Schedule, Reject, Cancel | Reserve the brand gradient for *primary* actions (Approve, Schedule). Reject is destructive (red), regenerate is neutral. |
| No "where am I in the pipeline" cue while running | A persistent stage badge in the header: "Stage 4/7 · Humanizing" |
| No live status feed | Server-Sent Events from `/runs/:id/events` to push stage transitions instead of polling — already useful, becomes essential when Composer becomes live |
| Sidebar group "Configure" mixes BrandVoice (high-touch, set once) with Learnings (review weekly) | Split: "Brand" (voice, campaigns) and "Tuning" (learnings) |

---

## 6. Phased implementation plan

This is a meaningful refactor. Suggested sequencing (each phase ships independently and improves the flow):

**Phase A — Quick wins (1-2 hr):**
- Default RunDetail tab to Approval when `pending_approval` or `approved`
- Add approval count badge in sidebar
- "Next item" auto-advance in Approvals
- Reserve brand gradient for primary actions only
- Hide Inbox until Postiz is connected

**Phase B — Live Composer (3-4 hr):**
- Convert Composer's AI Generate from polling-with-toast to in-place pipeline view
- Reuse PipelineTimeline component
- Stream stage outputs as they complete

**Phase C — Pipeline-first RunDetail (2-3 hr):**
- Add new "Pipeline" tab as default for running/recent runs
- Move 13 detail tabs behind "Stages" sub-nav
- Group remaining top-level tabs by lifecycle phase

**Phase D — SSE event stream (3-4 hr):**
- Replace polling with `/runs/:id/events` SSE
- Powers live Composer, focus-mode auto-advance, and sidebar badge counts

**Phase E — Polish (2 hr):**
- Card-view toggle on Runs
- Overview "needs attention" panel
- Sidebar regrouping

**Total:** ~12-15 hr across five focused sessions. Phase A alone is ~80% of the perceived improvement.

---

## 7. What I would *not* change

- The 7-stage engine pipeline. It's the value — keep it visible, don't simplify it away.
- The brand voice + learnings architecture. They're load-bearing for content quality.
- The fabrication ban enforcement. Hardest rule.
- The schedule modal. Two modes is right; don't add a third.
- The token-based theme system being rolled out. Theming is orthogonal to flow.

---

## 8. The TL;DR

The flow feels odd because **Composer hands the operator off to nowhere**, **Approval is buried in a 13-tab inspector**, and **the same run lives in five differently-shaped views**. The fix is not to remove any feature — it's to let the operator follow the run's lifecycle in one continuous surface, with detail tabs available but not in the way.

Phase A (~2 hr) gets you most of the perceived improvement. Phase B (live Composer) is the structural change that makes the workflow feel professional rather than fragmented.

---

*End of audit.*
