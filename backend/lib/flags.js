// ---------------------------------------------------------------------------
// Feature flags (audit Prompt 18). Env-driven, no external service:
// FEATURE_FLAGS="beta_feedback,demo_workspace" enables those flags.
// Default-on flags listed here ship enabled unless explicitly disabled
// with a "-" prefix (e.g. FEATURE_FLAGS="-beta_feedback").
// ---------------------------------------------------------------------------

// `first_value_event` (v18 S06): fires the named first_value_reached milestone
// when a workspace exports its first handoff. Default-on so the metric works,
// but a "-first_value_event" in FEATURE_FLAGS rolls the emission back without a
// deploy if it ever needs to be silenced.
const DEFAULT_ON = ['beta_feedback', 'first_value_event'];

function enabled(flag) {
  const raw = (process.env.FEATURE_FLAGS || '').split(',').map((f) => f.trim()).filter(Boolean);
  if (raw.includes(`-${flag}`)) return false;
  if (raw.includes(flag)) return true;
  return DEFAULT_ON.includes(flag);
}

module.exports = { enabled };
