---
name: Content Learning
version: 1.0.0
description: Automatically learns from post edits, approval feedback, and analytics to improve future content generation
author: OpenClaw Social Pipeline
tags: [learning, content, feedback, tone, style, optimization]
---

# Content Learning Skill

Automatically extracts reusable content patterns from operator edits, approval feedback, rejection reasons, and post performance analytics — then applies those learnings to future content generation.

## Purpose

Every time an operator edits a draft, rejects content with notes, or a post performs exceptionally well (or poorly), there's a lesson. This skill captures those lessons as structured "learnings" and injects them into the drafting pipeline so the same mistakes aren't repeated and winning patterns are reinforced.

## What It Learns From

### 1. Draft Edits (Tone & Style Corrections)
When an operator modifies a generated draft before approval, the skill diffs the original vs edited version and extracts:
- **Tone shifts** — e.g., "made it less formal", "added humor", "removed jargon"
- **Structural changes** — e.g., "shortened paragraphs", "added bullet points", "moved CTA to top"
- **Word/phrase preferences** — e.g., "replaced 'utilize' with 'use'", "removed emoji"
- **Platform-specific adjustments** — e.g., "LinkedIn posts should open with a question"

### 2. Approval Feedback
When content is rejected or revision is requested, the reviewer's notes contain direct guidance:
- **Rejection reasons** — "too salesy", "doesn't match brand voice", "wrong audience"
- **Revision instructions** — "make it more conversational", "add data points", "shorten"
- **Recurring themes** — patterns across multiple rejections

### 3. Analytics Performance
When analytics are synced from Postiz, the skill identifies:
- **Top performers** — what hooks, CTAs, formats, and topics drive engagement
- **Underperformers** — what patterns correlate with low engagement
- **Platform-specific winners** — what works on LinkedIn vs Twitter vs Instagram

### 4. Psychology & Humanizer Effectiveness
After the marketing psychology and humanizer passes:
- Which psychology principles drove the most engagement
- Which humanizer corrections were kept vs reverted by operators

## Learning Categories

| Category | Description | Example |
|----------|-------------|---------|
| `tone` | Voice and style preferences | "Use conversational tone on LinkedIn, not academic" |
| `structure` | Content structure patterns | "Keep LinkedIn posts under 150 words" |
| `hook` | Opening line patterns | "Questions outperform statements as hooks" |
| `cta` | Call-to-action patterns | "Soft CTAs ('thoughts?') beat hard CTAs ('click here')" |
| `vocabulary` | Word/phrase preferences | "Never use 'synergy', 'leverage', 'paradigm'" |
| `platform` | Platform-specific rules | "Twitter threads should be 5-7 tweets max" |
| `topic` | Topic treatment patterns | "AI content should include specific use cases, not theory" |
| `media` | Image/video preferences | "Carousel posts outperform single images on Instagram" |
| `timing` | Scheduling patterns | "Tuesday 9am posts get 2x engagement on LinkedIn" |
| `audience` | Audience response patterns | "Technical audience prefers data over anecdotes" |
| `avoidance` | Things to never do | "Never use clickbait headlines on LinkedIn" |
| `psychology` | Which principles work | "Social proof + specificity is the best combo for B2B" |

## Confidence Scoring

Each learning has a confidence score (0.0 - 1.0):

- **0.3** — Single observation (one edit or one rejection)
- **0.5** — Confirmed by 2-3 instances
- **0.7** — Strong pattern (4+ instances or backed by analytics)
- **0.9** — Validated by both operator edits AND analytics data
- **1.0** — Explicitly set by operator as a rule

### Confidence Decay
- Learnings lose 0.05 confidence per month if not reinforced
- If an operator reverts a learning-influenced change, confidence drops by 0.2
- Below 0.2 confidence, learnings are archived (not deleted)

## How Learnings Are Applied

When the pipeline generates new content, applicable learnings are injected into the drafting prompt:

```
CONTENT LEARNINGS (apply these patterns):

[TONE] (confidence: 0.8) Use conversational first-person on LinkedIn. 
  Avoid academic language. Write like you're talking to a colleague.

[HOOK] (confidence: 0.7) Open LinkedIn posts with a specific question 
  or a surprising statistic, not a generic statement.

[VOCABULARY] (confidence: 0.9) Never use: synergy, leverage, paradigm, 
  game-changer, unlock, delve, navigate.

[CTA] (confidence: 0.6) End with an open question ("What's your experience?") 
  rather than a directive ("Follow for more").

[PLATFORM:linkedin] (confidence: 0.8) Keep posts under 150 words. 
  Use line breaks between every 1-2 sentences.

[AVOIDANCE] (confidence: 1.0) Never use clickbait headlines. 
  Set by operator as explicit rule.
```

Only learnings with confidence >= 0.3 are included. Higher confidence learnings appear first.

## Extraction Process

### From Draft Edits
1. Compare original draft text vs operator-edited version
2. Identify categories of changes (tone, structure, vocabulary, etc.)
3. Generate a concise learning statement
4. Check for existing similar learnings — reinforce if found, create if new
5. Set initial confidence based on change significance

### From Rejections
1. Parse reviewer notes for actionable feedback
2. Categorize the feedback
3. Create or reinforce learnings
4. Tag with platform and campaign context

### From Analytics
1. Rank posts by engagement rate
2. Compare top 20% vs bottom 20%
3. Extract differentiating patterns (hooks, CTAs, length, format, time)
4. Create learnings from statistically significant patterns
5. Cross-reference with existing learnings to boost confidence

## Output Format

When saving a learning:

```json
{
  "id": "learning-uuid",
  "category": "tone",
  "platform": "linkedin",
  "campaign_id": null,
  "content": "Use conversational first-person tone. Avoid academic language. Write like talking to a colleague over coffee.",
  "source_type": "draft_edit",
  "source_id": "run-uuid",
  "confidence": 0.5,
  "reinforcement_count": 2,
  "last_reinforced_at": "2026-04-18T...",
  "tags": ["voice", "formality", "linkedin"],
  "active": true
}
```

When applying learnings to a prompt:

```json
{
  "applicable_learnings": [
    {
      "category": "tone",
      "content": "...",
      "confidence": 0.8,
      "platform_match": true
    }
  ],
  "prompt_injection": "CONTENT LEARNINGS (apply these patterns):\n..."
}
```

## Instructions for LLM

When extracting learnings from a draft edit:

1. Receive the original draft and the edited version
2. Identify every meaningful change (ignore whitespace, punctuation-only edits)
3. Categorize each change into the learning categories above
4. For each category with changes, write a concise, actionable learning statement
5. The statement should be a directive ("Do X" or "Avoid Y"), not a description
6. Include context on why (if inferrable from the change)
7. Tag with platform and any relevant metadata

When applying learnings to content generation:

1. Filter learnings by: platform match, campaign match (if any), confidence >= 0.3
2. Sort by confidence descending
3. Group by category
4. Inject as a structured block into the system prompt
5. Instruct the drafting LLM to follow these patterns
6. After generation, note which learnings were applied
