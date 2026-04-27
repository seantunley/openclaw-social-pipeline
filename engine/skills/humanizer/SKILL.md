---
name: Humanizer
version: 1.0.0
description: Detects and rewrites AI writing patterns to produce natural, human-sounding content
author: OpenClaw Social Pipeline
tags: [writing, humanizer, content, natural-language]
---

# Humanizer Skill

## Purpose
Detect and rewrite common AI writing patterns to produce content that reads as naturally human-written.

## AI Patterns Detected and Corrected

1. **Overuse of "delve"** -- Replace with specific verbs (explore, examine, investigate)
2. **"In today's [noun] landscape"** -- Remove or replace with concrete context
3. **"It's important to note that"** -- Delete; state the point directly
4. **"This is a game-changer"** -- Replace with specific impact statement
5. **Excessive hedging** -- "It might be possible that perhaps" -> direct statement
6. **"Leverage" as a verb** -- Use "use", "apply", "build on"
7. **"Unlock the power of"** -- State what the thing does directly
8. **"In conclusion" / "To summarize"** -- Remove; the conclusion should be self-evident
9. **"Robust and scalable"** -- Replace with specific capabilities
10. **Tricolon abuse** -- "fast, efficient, and reliable" -> pick the most relevant one
11. **"Harness the potential"** -- State the benefit directly
12. **"Navigate the complexities"** -- Name the specific challenge
13. **"Paradigm shift"** -- Describe the actual change
14. **"Seamless integration"** -- Describe what connects to what and how
15. **"Cutting-edge"** -- Name what makes it new
16. **"Empower"** -- Say what the person can now do
17. **"Revolutionize"** -- Describe the specific improvement
18. **"Best-in-class"** -- Cite the specific advantage
19. **"Comprehensive solution"** -- List what it actually covers
20. **"Foster collaboration"** -- Describe how people work together
21. **"Drive innovation"** -- Name what's being built or changed
22. **"Elevate your [noun]"** -- Say how it improves
23. **"Streamline operations"** -- Say what gets faster or simpler
24. **"Thought leadership"** -- Name the specific expertise
25. **"Ecosystem"** -- Name the specific components
26. **"Synergy"** -- Describe the combined effect
27. **"Holistic approach"** -- List the parts of the approach
28. **"At the end of the day"** -- Remove or rephrase
29. **Em-dash overuse** -- Reduce to max 1 per paragraph

## Aggressiveness Levels

- **1-3 (Light)**: Only fix the most egregious patterns (delve, landscape, game-changer)
- **4-6 (Medium)**: Fix all listed patterns, preserve sentence structure
- **7-9 (Heavy)**: Rewrite sentences to sound conversational, vary sentence length, add colloquial touches
- **10 (Maximum)**: Full rewrite prioritizing natural voice over polish

## Instructions for LLM

When applying this skill:

1. Read the input content carefully
2. Identify all AI writing patterns present
3. For each pattern found, apply the correction at the configured aggressiveness level
4. Preserve the core meaning and all factual content
5. Maintain the target platform's tone expectations
6. Vary sentence length (mix short punchy sentences with longer ones)
7. Add occasional sentence fragments for rhythm
8. Use contractions naturally
9. Preserve any metadata blocks (wrapped in --- or similar markers)
10. Return the rewritten content with a brief list of changes made

## Output Format

Return JSON:
```json
{
  "rewritten_content": "...",
  "patterns_found": ["pattern_name", ...],
  "changes_made": ["description of change", ...],
  "confidence": 0.0-1.0
}
```
