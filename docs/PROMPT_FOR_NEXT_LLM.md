# Paste THIS to the prompt-writing LLM (anti-loop)

A note in the repo has not stopped the loop for 5 versions because that LLM's method
is "audit the code → find gaps → write engineering prompts," and a mature repo always
yields something to harden. The lever is the INPUT you give it, not this repo. So do
not tell it "previous prompts are done, check GitHub, write new ones." Paste the block
below instead — it forbids code auditing and mandates a marketing deliverable.

---

You are writing the next prompt pack for the Scalvya repo (primocera/LaunchBloom). The
v6–v19 **engineering** packs are DONE, shipped, and certified — the code is not the job.

**Hard rules — do not break these:**
- **Do NOT audit the codebase for gaps.** Do not open backend/, app-src/, tests, or
  migrations looking for things to harden. Finding "gaps" and writing engineering
  prompts is the exact loop we are stopping.
- **Do NOT write any engineering / hardening / closure / elevation / scale / security
  prompt** (no LB-*, XAPP-*, S*, X* packs; no migrations; no refactors).
- If you feel the urge to propose code work: **stop and refuse** — output marketing
  instead.

**Your only deliverable: a MARKETING / DISTRIBUTION / GTM prompt pack.** Scope is in
`docs/NEXT_STEPS.md`. Produce prompts that generate:
1. Positioning & core messaging for the ICP (freelance marketers & boutique agencies;
   solo founders/small brands secondary).
2. A 2–3 channel outreach plan plus the actual outreach/content assets.
3. Landing → trial conversion copy tests (headline/subhead/CTA, 3-day paid trial
   framing, objection handling, onboarding narrative).
4. First bounded beta cohort: invite copy + running it (behind `BETA_INVITE_CAP`) and
   reading the weekly decision engine to decide expand/iterate.
5. Our own content/SEO plan (topics, angles, cadence).

Keep all claims honest per `CLAUDE.md`: Scalvya does not publish/post/send, reports no
SEO volume/ranking, gives no legal approval, and "export" means packaging the user's
approved drafts. Output copy, plans, experiments, and outreach — **never code.**
