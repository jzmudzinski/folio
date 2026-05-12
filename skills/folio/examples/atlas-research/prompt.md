# Atlas (scientific) example

**User prompt:**

> Write a formal research note on emergent capabilities in LLMs — academic tone, with methodology

**Agent decision tree:**

- Topic = serious research, asks for "academic tone" → **theme: atlas** (Crimson Pro + small caps + dropcap)
- Type = research
- Structure: Abstract → Methodology → Findings → Discussion → References

**Action:**

1. `suggest_thread({ title: "Emergent capabilities LLM" })` → empty → use `emergent-capabilities-llm`
2. `list_themes()` (optional, if uncertain) — confirm atlas exists, read prompt_addendum for voice tuning
3. `create({ type: "research", title: "Emergent capabilities in large language models", theme: "atlas", thread_id: "emergent-capabilities-llm", tags: ["ai","llm","emergence","research","review"], body_html: <see output.html> })`
4. Respond with MEDIA + 4-line TL;DR + citation reminder
