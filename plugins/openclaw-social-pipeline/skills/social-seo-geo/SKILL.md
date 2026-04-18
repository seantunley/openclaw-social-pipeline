---
name: Social SEO & GEO
version: 1.0.0
description: Optimize social media posts for AI search citation (GEO) and content authority (E-E-A-T). Adapted from claude-seo for social content.
author: OpenClaw Social Pipeline
tags: [seo, geo, eeat, ai-search, citation, social-media, optimization]
---

# Social SEO & GEO Optimization

Optimize social media posts so they get cited by AI search engines (ChatGPT, Perplexity, Google AI Overviews) and score high on content authority signals.

## Why This Matters for Social Posts

- **AI Overviews** reach 1.5 billion users/month across 200+ countries
- **Brand mentions correlate 3x more strongly** with AI visibility than backlinks (Ahrefs, Dec 2025)
- **YouTube mentions** have the strongest correlation (~0.737) with AI citations
- **Reddit mentions** are cited by Perplexity 46.7% of the time
- **LinkedIn presence** has moderate but growing correlation with AI citations
- **Only 11%** of domains are cited by both ChatGPT and Google AI Overviews for the same query

Social posts ARE the brand mentions that drive AI visibility. Every LinkedIn post, every Reddit comment, every tweet is a potential citation source.

## GEO Scoring Criteria for Social Posts

### 1. Citability (30%)

The post contains specific, extractable facts that an AI could quote.

**Strong signals:**
- Specific statistics with sources ("Revenue grew 37% after implementing X")
- Clear definitions ("X is the process of...")
- Concrete examples with outcomes ("We reduced churn by 12% by doing Y")
- Named methodologies, frameworks, or models
- First-party data or original observations

**Weak signals:**
- Vague claims ("this is a game-changer")
- Opinion without evidence
- Generic advice ("be authentic")
- No specific numbers or outcomes

**Scoring:**
- 0-2: No citable facts
- 3-5: 1-2 vague claims with some specificity
- 6-8: 2-3 specific, quotable statements
- 9-10: Multiple citable facts with sources

### 2. Authority Signals (25%)

The post demonstrates expertise and credibility.

**E-E-A-T for social posts:**

| Signal | How to Apply on Social |
|--------|----------------------|
| **Experience** | "I spent 3 years building X", "After running 200 campaigns...", "Here's what happened when we..." |
| **Expertise** | Demonstrate technical depth, use precise terminology, reference specific methodologies |
| **Authoritativeness** | Cite recognized sources, reference industry data, mention collaborations with known entities |
| **Trustworthiness** | Be transparent about limitations, show methodology, acknowledge counterpoints |

**Strong signals:**
- First-person experience statements
- Specific credentials or track record
- Citations to primary sources (studies, reports, official docs)
- Named experts, companies, or publications
- Original data or case study results

**Weak signals:**
- "Experts say..." (which experts?)
- "Studies show..." (which studies?)
- No personal experience or credentials
- Generic industry truisms

### 3. Structural Clarity (20%)

Content is organized for both human scanning and AI parsing.

**Strong signals:**
- Clear hook in first 1-2 sentences
- Logical flow (problem → insight → evidence → takeaway)
- Numbered lists or bullet points for multi-point content
- Short paragraphs (1-3 sentences per block on social)
- Line breaks between ideas (especially LinkedIn)
- Clear conclusion or CTA

**Weak signals:**
- Wall of text with no breaks
- Buried lead
- No clear structure or progression
- Multiple topics jumbled together

### 4. Entity & Topic Clarity (15%)

AI systems can clearly identify what the post is about and who wrote it.

**Strong signals:**
- Clear topic statement in first sentence
- Named entities (companies, products, people, places)
- Specific industry or domain context
- Hashtags that match topic entities (not generic)
- Author profile has complete bio with credentials

**Weak signals:**
- Ambiguous topic
- Generic language that could apply to any industry
- No named entities
- Off-topic hashtags

### 5. Cross-Platform Amplification (10%)

The post's potential to generate brand mentions across AI citation sources.

**Strong signals:**
- Content that would spark Reddit discussion
- Insights worth sharing on YouTube (video-derivable)
- Data that Wikipedia editors could reference
- Controversial or novel takes that drive reshares
- Content that answers a question people search for

**Weak signals:**
- Self-promotional without value
- Content that wouldn't be referenced outside the platform
- No search-intent alignment

## Platform-Specific GEO Guidance

### LinkedIn
- **AI citation source strength:** Moderate and growing
- **Optimal length:** 150-300 words for engagement, include a 134-167 word "answer block" within longer posts
- **GEO focus:** Professional expertise, first-party data, industry analysis
- **E-E-A-T priority:** Expertise + Experience
- **Best practice:** Open with a specific insight, not a question. AI systems extract opening statements.

### Twitter/X
- **AI citation source strength:** Moderate (via Grok/X search)
- **Optimal length:** Single tweet with linked thread
- **GEO focus:** Concise, quotable statements. One citable fact per tweet.
- **E-E-A-T priority:** Expertise + Authoritativeness
- **Best practice:** Lead with the data point. "37% of companies that did X saw Y."

### Reddit
- **AI citation source strength:** Very high (Perplexity 46.7%, ChatGPT 11.3%)
- **Optimal length:** Detailed answers (200-500 words)
- **GEO focus:** Helpful, detailed answers to specific questions
- **E-E-A-T priority:** Experience + Trustworthiness
- **Best practice:** Answer the question directly, then provide context. Reddit answers are heavily cited by Perplexity.

### YouTube (descriptions/comments)
- **AI citation source strength:** Highest (~0.737 correlation)
- **Optimal length:** First 200 words of description are indexed
- **GEO focus:** Clear topic statement, timestamps, key takeaways in description
- **E-E-A-T priority:** All four — video demonstrates experience, description provides citations
- **Best practice:** Include a text summary of key insights in the first paragraph of the description.

### Instagram / TikTok
- **AI citation source strength:** Low (not heavily indexed by AI search)
- **GEO focus:** Captions should contain searchable text for platform-internal search
- **E-E-A-T priority:** Experience (show, don't tell)
- **Best practice:** Use descriptive captions with keywords, not just emoji.

### VK
- **AI citation source strength:** Low globally, higher for Russian-language AI search
- **GEO focus:** Long-form posts with factual content
- **Best practice:** Treat like a mix of LinkedIn + Facebook.

## Instructions for LLM

When applying this skill to a social media draft:

1. **Score the draft** against all 5 GEO criteria (citability, authority, structure, entity clarity, amplification)
2. **Identify missing E-E-A-T signals** — which of Experience, Expertise, Authoritativeness, Trustworthiness are weak?
3. **Rewrite or enhance** the draft to:
   - Add at least one specific, quotable fact with a source
   - Include a first-person experience statement if possible
   - Ensure the first 40-60 words contain the key insight (not a question or preamble)
   - Structure for scannability (line breaks, lists if appropriate)
   - Use named entities instead of generic references
4. **Preserve the core message and tone** — don't make it sound like an article. It's still a social post.
5. **Tag which platform-specific optimizations were applied**

## Output Format

Return JSON:

```json
{
  "enhanced_content": "...",
  "geo_score": {
    "overall": 0-100,
    "citability": 0-10,
    "authority": 0-10,
    "structure": 0-10,
    "entity_clarity": 0-10,
    "amplification": 0-10
  },
  "eeat_signals": {
    "experience": ["signal found or added"],
    "expertise": ["signal found or added"],
    "authoritativeness": ["signal found or added"],
    "trustworthiness": ["signal found or added"]
  },
  "changes_made": [
    "Added specific statistic with source",
    "Restructured opening to lead with key insight",
    "Added first-person experience statement"
  ],
  "platform_optimizations": ["linkedin: shortened to 200 words", "added line breaks"],
  "ai_citation_readiness": "low|medium|high"
}
```
