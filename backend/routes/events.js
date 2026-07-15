// ---------------------------------------------------------------------------
// Client-fired analytics events (audit Prompt 15). Auth is optional — the
// landing page and pre-auth onboarding steps fire these signed out. Only a
// small allowlisted set of event names is accepted; anything else is dropped
// silently so this endpoint can't become an arbitrary write.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const { resolveUser } = require('../lib/auth');
const { track, CLIENT_EVENTS } = require('../lib/analytics');

router.post('/api/events', express.json({ limit: '2kb' }), async (req, res) => {
  const event = String((req.body || {}).event || '');
  if (!CLIENT_EVENTS.has(event)) return res.status(204).end();

  const properties = (req.body || {}).properties;
  const safeProps = properties && typeof properties === 'object' && !Array.isArray(properties)
    ? Object.fromEntries(Object.entries(properties).slice(0, 10).filter(([, v]) => typeof v !== 'object'))
    : {};

  let userId = null;
  try {
    const user = await resolveUser(req, res);
    if (user) userId = user.id;
  } catch {
    /* unauthenticated events are fine */
  }

  await track(event, { userId, properties: safeProps });
  res.status(204).end();
});

module.exports = router;
