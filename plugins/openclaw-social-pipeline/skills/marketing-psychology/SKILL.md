---
name: Marketing Psychology
version: 1.0.0
description: Applies behavioral psychology and persuasion principles to content for maximum engagement
author: OpenClaw Social Pipeline
tags: [marketing, psychology, persuasion, engagement, content]
---

# Marketing Psychology Skill

## Purpose
Apply proven psychological principles to content to increase engagement, memorability, and conversion.

## Available Principles

### Attention & Hook
1. **Pattern Interrupt** -- Break expectations to grab attention
2. **Curiosity Gap** -- Open a question the reader must close
3. **Negativity Bias** -- "Mistakes to avoid" outperforms "tips to follow"
4. **Specificity** -- "37% increase" beats "significant improvement"
5. **Contrast Principle** -- Before/after, old way/new way

### Trust & Credibility
6. **Social Proof** -- Numbers, testimonials, "join 10,000+"
7. **Authority** -- Expert citations, credentials, data sources
8. **Consistency** -- Reference prior commitments or values
9. **Mere Exposure** -- Familiar references increase trust
10. **Halo Effect** -- Associate with admired brands/people

### Engagement & Action
11. **Loss Aversion** -- Frame as what they'll miss, not what they'll gain
12. **Scarcity** -- Limited time, limited seats, exclusive access
13. **Reciprocity** -- Give value first (free insight, template, tip)
14. **Zeigarnik Effect** -- Open loops that need closing
15. **IKEA Effect** -- Involve the reader in completing the idea

### Memory & Shareability
16. **Von Restorff Effect** -- Make one element stand out
17. **Rhyme-as-Reason** -- Rhyming phrases feel more true
18. **Story Arc** -- Situation -> Complication -> Resolution
19. **Peak-End Rule** -- Strong ending matters most
20. **Chunking** -- Break complex info into digestible groups

### Emotional Triggers
21. **Identity Appeal** -- "You're the kind of person who..."
22. **Aspiration Gap** -- Show the gap between current and desired state
23. **Belonging** -- "Join the community of..."
24. **Autonomy** -- "Choose your own path"
25. **Competence** -- "Master this in 5 minutes"

### Platform-Specific Applications
26. **LinkedIn: Professional Identity** -- Career growth, industry insight
27. **Twitter/X: Hot Takes** -- Contrarian views, thread hooks
28. **Instagram: Visual Metaphor** -- Image-text alignment
29. **TikTok: Pattern Interrupt** -- First 3 seconds critical
30. **YouTube: Curiosity Thumbnail** -- Visual curiosity gap

## Intensity Levels

- **1-3 (Subtle)**: 1-2 principles, woven in naturally
- **4-6 (Moderate)**: 3-4 principles, clearly structured hooks and CTAs
- **7-8 (Strong)**: 5+ principles, aggressive hooks, urgency, strong CTAs
- **9-10 (Maximum)**: Full persuasion architecture, every sentence serves a psychological purpose

## Instructions for LLM

When applying this skill:

1. Identify the content's goal (awareness, engagement, conversion, education)
2. Identify the target audience and their primary motivations
3. Select principles appropriate to the goal and platform
4. Apply principles at the configured intensity level
5. Ensure the content doesn't feel manipulative -- authentic persuasion only
6. Preserve all factual content and core message
7. Add or restructure hooks, CTAs, and framing
8. Return enhanced content with annotations

## Output Format

Return JSON:
```json
{
  "enhanced_content": "...",
  "principles_applied": [
    {"name": "Curiosity Gap", "location": "headline", "description": "Added open question"}
  ],
  "engagement_prediction": "low|medium|high|very_high",
  "recommended_cta": "...",
  "platform_notes": "..."
}
```
