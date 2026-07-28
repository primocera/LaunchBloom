// ---------------------------------------------------------------------------
// v11 SC-07 — the capped-beta feedback moment.
//
// Asked twice in a beta account's life: once after the first handoff export,
// once after a cancel or refund. Three bounded questions and an optional note.
//
// The privacy rule that shapes this whole file: the CATEGORIES are analytics,
// the NOTE is not. Free text is where someone writes a client's name, a price
// they charge, or a complaint about a named person. It is stored so the owner
// can read it during an interview, and it never enters an event property, an
// aggregate, or a log line.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { resolveWorkspace } = require('./workspaces');
const { track } = require('../lib/analytics');

const json = express.json({ limit: '8kb' });

const MOMENTS = ['handoff', 'cancel'];

// Neutral wording on purpose: the owner needs to know whether the price is
// justified, not to hear that it is. "would_not_pay" is offered as plainly as
// "worth_more", and no option is presented as the expected answer.
const ALLOWED = {
  job_done: ['full_campaign', 'part_of_campaign', 'single_asset', 'nothing_usable'],
  manual_work: ['almost_none', 'light_editing', 'heavy_editing', 'rewrote_most'],
  price_view: ['worth_more', 'about_right', 'too_high', 'would_not_pay'],
};

const MAX_NOTES = 2000;

/** The questions, served to the client so wording lives in one place. */
router.get('/api/feedback/questions', requireAuth, (_req, res) => {
  res.json({
    moments: MOMENTS,
    questions: [
      {
        key: 'job_done',
        prompt: 'What did you actually finish with Scalvya this time?',
        options: [
          { value: 'full_campaign', label: 'A full campaign I could hand over' },
          { value: 'part_of_campaign', label: 'Part of a campaign' },
          { value: 'single_asset', label: 'A single asset' },
          { value: 'nothing_usable', label: 'Nothing I could use' },
        ],
      },
      {
        key: 'manual_work',
        prompt: 'How much manual work did it still take?',
        options: [
          { value: 'almost_none', label: 'Almost none' },
          { value: 'light_editing', label: 'Light editing' },
          { value: 'heavy_editing', label: 'Heavy editing' },
          { value: 'rewrote_most', label: 'I rewrote most of it' },
        ],
      },
      {
        key: 'price_view',
        prompt: 'For what you got, how does the current price look?',
        options: [
          { value: 'worth_more', label: 'Worth more than it costs' },
          { value: 'about_right', label: 'About right' },
          { value: 'too_high', label: 'Higher than it is worth to me' },
          { value: 'would_not_pay', label: 'I would not pay for this' },
        ],
      },
    ],
    notes: {
      prompt: 'Anything else? (optional)',
      note: 'Free text is read by a person and is never included in analytics.',
      max_length: MAX_NOTES,
    },
  });
});

router.post('/api/feedback', requireAuth, json, async (req, res, next) => {
  try {
    const body = req.body || {};
    const moment = String(body.moment || '');
    if (!MOMENTS.includes(moment)) {
      return res.status(400).json({ error: 'Unknown feedback moment.', code: 'BAD_MOMENT' });
    }

    // Every category is validated against the allowlist. An unrecognised value
    // is rejected rather than stored, so an aggregate can never contain a
    // category nobody defined.
    const answers = {};
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      const value = body[key];
      if (value === undefined || value === null || value === '') continue;
      if (!allowed.includes(value)) {
        return res.status(400).json({ error: `Unknown value for ${key}.`, code: 'BAD_CATEGORY' });
      }
      answers[key] = value;
    }
    if (!Object.keys(answers).length) {
      return res.status(400).json({ error: 'Answer at least one question.', code: 'EMPTY' });
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_NOTES) : null;

    const workspace = await resolveWorkspace(req);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

    // Upsert on (workspace_id, moment): re-answering replaces, never duplicates.
    const { error } = await supabase.from('beta_feedback')
      .upsert({
        workspace_id: workspace.id,
        user_email: req.userEmail,
        moment,
        ...answers,
        notes: notes || null,
      }, { onConflict: 'workspace_id,moment' });
    if (error) throw error;

    // Categories only. `notes` is deliberately absent from this payload — and
    // sanitizeProperties would drop it anyway, which is the belt to this brace.
    track('feedback_submitted', {
      userId: req.userId,
      workspaceId: workspace.id,
      properties: { moment, ...answers, has_notes: Boolean(notes) },
      dedupeKey: `feedback:${workspace.id}:${moment}`,
    });

    res.json({ ok: true, moment });
  } catch (err) {
    next(err);
  }
});

// Has this workspace already been asked? The client uses it to ask once and
// then stay quiet — a prompt that reappears after every export is nagging.
router.get('/api/feedback/status', requireAuth, async (req, res, next) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace) return res.json({ answered: [] });
    const { data } = await supabase.from('beta_feedback')
      .select('moment').eq('workspace_id', workspace.id);
    res.json({ answered: (data || []).map((r) => r.moment) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.ALLOWED = ALLOWED;
module.exports.MOMENTS = MOMENTS;
module.exports.MAX_NOTES = MAX_NOTES;
