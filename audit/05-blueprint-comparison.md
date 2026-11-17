# Comparison with the original blueprint

Source: screenshots of `OfferFlow_AI_blueprint.docx` covering sections 1 to 6, 8 to 11 and 13 to 16, plus part of section 7. Section 12 (build plan by week) and the pricing table's last rows were not visible. One screenshot was from a different document (DailyFlow AI, a wellbeing app) and was left out.

The blueprint is the starting point, not a contract. The product was deliberately repositioned since. The useful question is where the two differ **without a decision behind it**.

## Summary

| # | Finding | Severity |
|---|---|---|
| P1 | The blueprint's validation step was skipped, and the repositioned product has not been validated either | High (product) |
| P2 | Two products live in one app: the blueprint flow and the campaign flow | High (UX and maintenance) |
| P3 | Model instructions, tagline and a plan field still describe the blueprint product | Medium |
| P4 | The blueprint's retention feature has no equivalent in the current product | Medium (product) |
| P5 | Three visual systems across landing, sign-in and app | Medium (UX) |
| P6 | Free plan gives nothing; the blueprint's free plan gave a first result | Medium (conversion) |
| P7 | Security model differs from the blueprint's plan | Informational, see T5 |
| P8 | "Not in MVP" list has held | Good |

## P1. Validation was skipped twice (High)

Blueprint section 13 is titled "validate the output first, then build a complex SaaS". The steps: a waitlist page, a €19 offer, 10 to 20 kits made by hand, feedback on which part was useful and what people would pay monthly for, and a rule: **build the MVP only if at least 10 people pay or seriously ask for access.**

Nothing in the repo shows this happened. Then the product was repositioned from "I don't know what to sell" (solo founders) to "my campaign drifts across channels" (freelance marketers and agencies). That is a different pain for a different buyer, and it has not been tested either. Project notes from September record zero activated users.

**Recommendation:** run section 13 now, for the current audience, before any new feature. The product already exists, so it is cheaper than the blueprint assumed:

1. Find 10 to 20 freelance marketers or agency owners (the social plan and the Claude Design prompts in `docs/marketing/` are for this).
2. Run one real client brief through Scalvya for each of them yourself, or sit beside them while they do it.
3. Ask the blueprint's three questions: which part was most useful, what is missing, what would you pay monthly for.
4. Count how many pay or ask to keep access. Ten is the blueprint's bar.

Fix audit batch 1 first, because those defects sit in the sign-up, checkout and first-generation path these people will use.

## P2. Two products in one app (High)

The app still contains the whole blueprint flow next to the campaign flow.

| | Blueprint flow | Campaign flow (canonical per `CLAUDE.md`) |
|---|---|---|
| Entry | Quiz → positioning → 3 offers → launch kit | Brand Profile → Brief → Create → Review → Library → Export |
| Routes | `/flow`, `/kits/:id`, `/weekly-plan`, `/landing-page`, `/content-plan`, `/email-sequence`, `/ads` | `/brand`, `/campaigns`, `/create`, `/assets`, `/website`, `/email-studio`, `/social`, `/creative`, `/seo` |
| Backend | `routes/ai.js` (positioning, offers, launch kit, regenerate section, weekly plan) | `routes/assets.js`, `routes/campaigns.js`, `routes/library.js` |
| Tables | `onboarding_answers`, `positioning_outputs`, `offers`, `launch_kits`, `content_items`, `email_items`, `ad_ideas`, `seo_items`, `weekly_tasks` | `brand_profiles`, `campaigns`, the five `*_assets` tables |

That is 20 signed-in routes where the blueprint planned 17 for one product. The sidebar shows 11 items (6 main, 5 studios), and the blueprint routes are reachable but not in it. There are two email screens, two landing-page screens and two ads screens.

This is the most likely source of "the UI can be a bummer": a new user can land in either flow, and the two do not share data. It also doubles what has to be tested and metered.

**Decision for the owner:** retire the blueprint flow, or keep it as the solo-founder entry and connect it on purpose (its chosen offer becomes a campaign brief). Retiring it is the simpler product. Either way, it should not stay half-visible.

Note: the blueprint's key AI rule (section 8, "do not generate everything from one prompt; the user must approve positioning and offer first") did survive, as the approved brief. That part of the design is sound.

## P3. Leftovers that still describe the blueprint product (Medium)

- **System prompt** (`backend/lib/ai.js:22-36`): "takes solopreneurs, creators, freelancers, coaches, consultants and small service providers from idea to offer to launch". This is section 9's wording and it frames every generation, including an agency's client campaign.
- **Tagline** (`app-src/brand.js`, mirrored in `backend/lib/brand.js`): "From Idea to Offer to Launch", the blueprint's tagline 1. The landing headline is now "Turn one offer into a launch-ready campaign".
- **Mock samples** (`ai.js`): a yoga teacher's course with € prices; the market is now USD.
- **`content_plan_days: 7`** on the free plan (`plan-limits.js`): from the blueprint's free tier ("7-day content plan"). Free now has zero AI actions, so the field does nothing.
- **Lifetime grant on `payments`** (finding B7): the remnant of the one-time "€19 launch kit" offer.

Fix the system prompt first; it affects output quality for every customer. Route it through the prompt registry and the golden evals.

One more wording issue found on the way: the landing headline says "launch-ready campaign". `CLAUDE.md` forbids describing output as "send-ready", "production-ready" or "ready to paste". "Launch-ready" is not on that list, but it leans the same way. Worth an owner decision.

## P4. The retention feature was not carried over (Medium)

Blueprint section 5.8: the Weekly Action Plan "is the retention feature, because the user comes back every week". It still exists (`/weekly-plan`), but only inside the blueprint flow and outside the sidebar.

The campaign product has no equivalent reason to return. An agency user comes back when there is a new campaign, which may be monthly. On a monthly subscription that is a churn risk, and it is a product question, not an engineering one.

**To consider (no build yet):** ask the P1 interviewees what would bring them back weekly. Candidates that fit the honest boundaries: a per-campaign review checklist, or "what changed since the brief was approved".

## P5. Three visual systems (Medium)

| Surface | Background | Text | Accent | Headline font |
|---|---|---|---|---|
| Blueprint section 10 and `CLAUDE.md` | `#F8F7F4` | `#171717` / `#111827` | `#2563EB` | not set |
| Landing (`landing.css`) | white | `#111111` | `#2F6CEB`, navy `#0D1B3A` | Instrument Serif |
| Sign-in pages (`styles.css:985`) | blue, Wise-style | `#111827` | `#2F6CEB` | |
| App (`styles.css:2-13`) | `#FAF8F5` warm | `#2B2320` brown | `#2563EB` | |

A visitor sees white and cobalt on the landing page, a blue sign-in page, then a warm beige app with brown text and beige borders. Project notes record an owner rule of "no grey or brown" for status colours; the app's base text and borders are brown-toned.

The `CLAUDE.md` palette rule matches the blueprint and none of the live surfaces exactly.

**Recommendation:** pick the landing system as the brand (it is the most recent and owner-approved), and move the app's base tokens to it: white or near-white background, `#111111` text, neutral border, `#2F6CEB` accent. It is a token change in `styles.css`, not a redesign. Update the `CLAUDE.md` palette line afterwards. This needs owner sign-off because of the standing "build on top, never rework" rule.

## P6. The free plan shows nothing (Medium)

| Plan | Blueprint (section 11) | Today |
|---|---|---|
| Free | 1 workspace, 1 positioning output, 1 offer idea, 7-day content plan | 0 AI actions; card required to start the 3-day trial |
| Starter | €12/month: 3 offers, 1 full kit a month | $12.99: 30 AI actions, 3 kits |
| Pro | €29/month: 3 workspaces, 5 kits | $24.99: 3 workspaces, 120 actions, 10 kits |
| Business / Studio | €59/month: 10 workspaces | $59: 10 workspaces, 400 actions, 30 kits |

Paid tiers are close to the blueprint and more generous. The real difference is at the door: the blueprint let a free user see one real result before paying. Today a new user fills in a Brand Profile and a brief, then meets a card form before seeing any output.

With zero users, the card wall is the first thing to test. One free generation (for example the brief review, or a single asset) costs about a cent on the current model and is already bounded by the daily cap. This is a pricing decision for the owner, and it would touch plan limits, so it falls under "never rework existing limits unless asked".

Also absent: Google sign-in, which the blueprint listed next to email. For agency users it removes a sign-up step. Low priority.

## P7. Security model (informational)

The blueprint planned row-level security with `auth.uid() = user_id` policies, so the database enforces ownership. The build uses the service-role key for every query, so each route enforces ownership itself. That was a deliberate change with the ConversionForge architecture. Its cost is covered in T5, and finding D2 (five tables with RLS not enabled at all) is the part to fix.

## P8. What held (good)

- **"Not in MVP" (section 14):** no scheduler, no Canva, Klaviyo or Shopify integration, no native app, marketplace, affiliate system, custom domains or free-form chatbot. Team collaboration is also absent; with agencies as the audience they will share one login, so fix the per-IP rate limit (S1) before onboarding one.
- **Advanced analytics:** none for customers. A large internal layer exists (scorecards, cohort funnel, weekly decision) measuring a cohort of zero.
- **Structured flow over chat, approve-before-generate, regenerate one section, JSON outputs tied to the offer:** all present.
- **Roadmap items built early:** brand memory, multiple kits, PDF/DOCX/ZIP export, an agency-sized plan, templates. Absent: content repurposing, DM scripts, Google Docs and Notion export, competitor research. The "testimonial generator" should stay unbuilt; the system prompt forbids inventing testimonials.

## What this adds to the task list

In order:

1. **Owner decisions:** retire or connect the blueprint flow (P2); adopt the landing palette in the app (P5); allow one free result before the card (P6).
2. **Audit batch 1** (unchanged): the defects in the path a first customer uses.
3. **Run the validation in P1** with 10 to 20 people from the current audience.
4. **With task 21:** rewrite the system prompt and tagline for the current product (P3).
5. **With task 18:** remove the blueprint-era leftovers (P3) and, if retired, the blueprint flow's routes, screens and tests (P2).
6. **Before any agency onboarding:** task 15, rate limits keyed by user.
7. **After validation:** decide the retention hook from what interviewees say (P4).
