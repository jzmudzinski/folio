# Journal example

**User prompt:**

> Zrób mi journal po dzisiejszych rozmowach z Martą — co ustaliliśmy, co zostaje na pokój

**Agent action sequence:**

1. `suggest_thread({ title: "Daily journal" })` → existing thread `daily-journal` probably matches; use it (or `daily` for short)
2. `create({ type: "journal", title: "Czwartek — Marta calls", thread_id: "daily", theme: "notebook", tags: ["daily","meeting","marta"], body_html: <see output.html> })`
3. Respond with `MEDIA:<local_url>` + 2-line recap.

**Why notebook theme:**
- Personal, exploratory voice
- Handwritten headings fit „what we talked about" register
- Hedging OK („wydaje mi się że…")

Skip notebook if user wants formal record-of-meeting — use `memo` instead.
