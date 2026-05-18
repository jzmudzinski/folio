# Iteration notes (v0.18.0+)

## Contents
- When to use vs not
- Tool surface (propose_round / wait_for_pick / pick_variant / iteration_state)
- Workflow (the load-bearing pattern)
- Variant content_html (inline SVG for logos/icons)
- Labels, race windows, cloud rendering

---

A different shape from live notes: agent generates N design candidates, user clicks one in a gallery, agent generates N variants of the pick, repeat. Tree-shaped (every variant has a `parent_variant_id` pointing at the round-winner that spawned it), append-only on the live-entries JSONL substrate.

## When to use `type: "iteration"` — look for these patterns

| The user said / asked for | Why it's iteration |
|---|---|
| "Show me 3 versions of the landing hero" / "Pokaż mi 3 wersje hero" | N candidates, will pick |
| "Generate 6 logo variants" / "Przygotuj 6 wariantów logotypu" | Design exploration |
| "Iterate on the email template — pick after each round" | Multi-round selection loop |
| "Mockups to choose from" / "kierunki", "propozycje", "warianty" | Multiple directions, pick one |
| "I'll pick one and you'll iterate on it" / "Ja wybiorę któryś, ty rozwiniesz" | Explicit pick-then-refine |
| "Explore some directions for X" + numeric count | Open-ended creative |

**Common ones that ARE iteration even if not phrased that way:** logo design, hero section, email template, onboarding flow, color palette, brand identity, poster, app icon — anywhere the deliverable is visual/creative AND the user wants to choose between agent-generated candidates.

## When NOT to use

- ❌ Single deliverable, no comparison ("write the email") → `snippet`
- ❌ Side-by-side comparison of OPTIONS the user already has (Postgres vs MySQL) → `comparison`
- ❌ User is happy with one direction after you describe it in chat — only escalate to iteration when there are multiple to choose between

**Critical anti-pattern:** ❌ NEVER list 3+ design candidates / variants / mockups inline in chat as "Option 1: …, Option 2: …, Option 3: …". The user can't click to pick, can't fork from a pick, loses lineage across rounds. If it would be ≥3 candidates, it's an iteration note — full stop.

## Tool surface (v0.19.1)

```
create({ type: "iteration", title, body_html, thread_id, theme })
  → body_html is chrome only (h1 + intro); variants live in entries.

propose_round({ note_id, variants[], parent_variant_id? })
  → variants: [{ content_html, label? }, ...]  — usually 2-4 per round
  → parent_variant_id: REQUIRED from round 2+; equals the winner of the previous round
  → returns { round, variant_ids[] }

wait_for_pick({ note_id, for_round, timeout_s = 60 })   ← v0.19.1+
  → blocks until the user picks a variant in the viewer's gallery
  → race-safe: returns immediately if for_round is already picked
  → returns { picked: true, variant_id, round } | { picked: false, timeout: true, current_round }

pick_variant({ note_id, variant_id })
  → usually the viewer fires this when the user clicks
  → agents only call directly for headless / auto-advance flows

iteration_state({ note_id })
  → snapshot: rounds[], lineage[], current_round, is_finalized
```

## Workflow (the load-bearing pattern)

```
1. create({ type: "iteration", title, body_html, thread_id })
2. propose_round({ note_id, variants })  → { round: 1, variant_ids: [...] }
3. wait_for_pick({ note_id, for_round: 1, timeout_s: 60 })
   ↳ blocks until user clicks; resolves with { variant_id, round }
4. propose_round({ note_id, parent_variant_id: <winner>, variants: [...refined...] })
5. wait_for_pick({ note_id, for_round: 2 })
6. Repeat until satisfied; finalize({ id }) compiles the picked lineage into body_html.
```

## Variant content_html — make it standalone

Each variant renders in its own sandboxed sub-iframe with a minimal system-font scaffold. CSS doesn't leak between cards. For a strong identity per variant, include `<style>` blocks inline at the top.

## For logos, icons, vector graphics: use inline `<svg>`

Since v0.19.3 the sanitizer fully supports SVG with `viewBox`, `<defs>` / `<marker>` for arrows, gradients, all typography + paint attrs. Inline SVG is the right answer for logo/icon iteration: vector (scales to any size), themable, no external image dependency, no `attach_asset` round-trip.

```html
<!-- variant content_html for a "logo proposal" -->
<style>
  body { display: flex; align-items: center; justify-content: center; padding: 20px; background: #fff; }
  .logo { display: flex; align-items: center; gap: 10px; font-family: 'Familjen Grotesk', system-ui, sans-serif; }
  .logo__mark { width: 48px; height: 48px; }
  .logo__name { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: #1a1a1a; }
  .logo__name span { color: #ff5a1f; }
</style>
<div class="logo">
  <svg class="logo__mark" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <circle cx="24" cy="24" r="22" fill="none" stroke="#ff5a1f" stroke-width="2"/>
    <text x="24" y="32" text-anchor="middle" font-family="Familjen Grotesk" font-size="22" font-weight="700" fill="#1a1a1a">R</text>
  </svg>
  <span class="logo__name">rep<span>coach</span></span>
</div>
```

Each variant is a self-contained little canvas. Six of these in one `propose_round` call = six logo directions the user can compare and click.

## Labels matter

Set a short kebab-case `label` on each variant — the viewer shows it in the gallery card and the lineage breadcrumb after picking. Without it, the viewer falls back to first 4 chars of the variant id. For logos use directional labels (`circuit-R`, `dumbbell-pulse`, `pixel-trainer`, `monogram-RC`) so the user remembers what they picked after round 1.

## On `wait_for_pick` timeout

The agent should call `iteration_state` to check whether the round was picked between the call and the timeout (rare race window), then either continue with the picked variant or stop the iteration.

## Cloud rendering

Shared / capability-URL iteration notes render the same gallery but READ-ONLY — picks happen on the device that owns the note. The agent's `wait_for_pick` won't fire on cloud-side clicks since they don't exist; only the owner clicks.
