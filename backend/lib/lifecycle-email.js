// ---------------------------------------------------------------------------
// v5 Prompt 14: transactional lifecycle emails (Resend), idempotent by design.
//
// Every send claims a unique dedupe_key row in email_events FIRST — webhook
// redeliveries can never double-send. Send failures mark the row 'failed'
// (a retryable delivery queue) but NEVER fail the caller: billing processing
// stays durable whether or not the email went out. Without RESEND_API_KEY the
// row is recorded as 'skipped' (free-tier/dev safety — nothing is sent).
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const { BRAND, emailFrom } = require('./brand');

let resend = null;
if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}

/** Branded HTML wrapper with a plain-text alternative. */
function template(title, bodyHtml) {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#F8F7F4;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <h1 style="font-size:20px;color:#111827;margin:0 0 12px">${title}</h1>
    <div style="font-size:14px;color:#111827;line-height:1.6">${bodyHtml}</div>
    <p style="font-size:12px;color:#6B7280;margin-top:24px">${BRAND.name} · <a href="${BRAND.siteUrl}" style="color:#2563EB">${BRAND.siteUrl}</a><br>
    This is a transactional message about your account.</p>
  </div></body></html>`;
}

function fmtDate(iso) {
  if (!iso) return 'your next billing date';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return 'your next billing date';
  }
}

const billingLink = () => `${(process.env.PUBLIC_URL || BRAND.siteUrl || '').replace(/\/$/, '')}/app/account`;

/** type → ({...params}) => { subject, html, text } */
const TEMPLATES = {
  welcome: () => ({
    subject: `Welcome to ${BRAND.name}`,
    html: template(`Welcome to ${BRAND.name}`, `<p>Your account is verified. Start with your Brand Profile — everything you generate is grounded in it.</p><p><a href="${billingLink().replace('/account', '/brand')}">Set up your brand</a></p>`),
    text: `Your account is verified. Start with your Brand Profile at ${billingLink().replace('/account', '/brand')}`,
  }),
  trial_started: ({ chargeAt }) => ({
    subject: 'Your 3-day free trial has started',
    html: template('Your 3-day free trial has started', `<p>You have 20 AI actions and 1 full launch kit to try the whole workspace.</p><p>You'll be charged on <strong>${fmtDate(chargeAt)}</strong> unless you cancel before then. Manage or cancel anytime: <a href="${billingLink()}">Account &amp; billing</a>.</p>`),
    text: `Your 3-day trial started. You'll be charged on ${fmtDate(chargeAt)} unless you cancel before then. Manage: ${billingLink()}`,
  }),
  trial_ending: ({ chargeAt }) => ({
    subject: 'Your trial ends soon',
    html: template('Your trial ends soon', `<p>Your free trial ends and your subscription starts on <strong>${fmtDate(chargeAt)}</strong>.</p><p>Want to keep going? Do nothing. Want to cancel? <a href="${billingLink()}">Manage billing</a> before that date and you won't be charged.</p>`),
    text: `Your trial ends on ${fmtDate(chargeAt)}. Cancel before then at ${billingLink()} and you won't be charged.`,
  }),
  payment_succeeded: ({ periodEnd }) => ({
    subject: `Payment received — ${BRAND.name}`,
    html: template('Payment received', `<p>Thanks — your payment went through and your plan is active until <strong>${fmtDate(periodEnd)}</strong>.</p><p><a href="${billingLink()}">View billing</a></p>`),
    text: `Payment received. Your plan is active until ${fmtDate(periodEnd)}. Billing: ${billingLink()}`,
  }),
  payment_failed: () => ({
    subject: `Payment failed — action needed`,
    html: template('Your payment failed', `<p>We couldn't process your payment. Your account stays accessible while we retry.</p><p>Please update your payment method: <a href="${billingLink()}">Account &amp; billing → Manage billing</a>.</p>`),
    text: `Your payment failed. Update your payment method at ${billingLink()}`,
  }),
  cancellation_scheduled: ({ periodEnd }) => ({
    subject: 'Your cancellation is scheduled',
    html: template('Cancellation scheduled', `<p>Your subscription will end on <strong>${fmtDate(periodEnd)}</strong>. You keep full access until then, and your generated work stays available read-only afterwards.</p><p>Changed your mind? <a href="${billingLink()}">Resume from billing</a>.</p>`),
    text: `Your subscription ends on ${fmtDate(periodEnd)}. Resume anytime before then: ${billingLink()}`,
  }),
  cancellation_completed: () => ({
    subject: 'Your subscription has ended',
    html: template('Your subscription has ended', `<p>Your subscription is now canceled — you have not been charged further. Your account and generated work remain accessible read-only.</p><p>Come back anytime: <a href="${billingLink()}">restart from Account &amp; billing</a>.</p>`),
    text: `Your subscription is canceled. Your work stays accessible read-only. Restart: ${billingLink()}`,
  }),
  deletion_completed: ({ completed, failedSteps = [] }) => ({
    subject: `Your ${BRAND.name} account deletion record`,
    html: template('Your account deletion record', completed
      ? `<p>Your account deletion request completed. Your workspaces, campaigns, assets and sign-in account were deleted.</p><p>Billing and invoice records are retained by our payment provider for legal reasons.</p>`
      : `<p>Your account deletion request ran, but these steps did not complete: <strong>${failedSteps.join(', ')}</strong>.</p><p>Please contact support so we can finish them. Records already deleted are gone; billing records are retained for legal reasons.</p>`),
    text: completed
      ? 'Your account deletion completed. Workspaces, campaigns, assets and your sign-in account were deleted. Billing records are retained for legal reasons.'
      : `Your account deletion did not fully complete. Failed steps: ${failedSteps.join(', ')}. Contact support to finish them.`,
  }),
  plan_changed: ({ planLabel }) => ({
    subject: `Your plan changed${planLabel ? ` to ${planLabel}` : ''}`,
    html: template('Your plan changed', `<p>Your subscription ${planLabel ? `is now on the <strong>${planLabel}</strong> plan` : 'plan has changed'}. New limits apply from this billing period.</p><p><a href="${billingLink()}">View plan &amp; usage</a></p>`),
    text: `Your plan changed${planLabel ? ` to ${planLabel}` : ''}. Details: ${billingLink()}`,
  }),
};

/**
 * Idempotently send one lifecycle email.
 *   sendLifecycleEmail('trial_started', 'sub_123', 'a@b.com', { chargeAt })
 * Returns 'sent' | 'duplicate' | 'skipped' | 'failed'. Never throws.
 */
async function sendLifecycleEmail(type, dedupeId, to, params = {}) {
  const make = TEMPLATES[type];
  if (!make || !to) return 'skipped';
  const dedupeKey = `${type}:${dedupeId}`;

  try {
    // Claim first — the unique constraint makes retries no-ops. Template
    // params (dates, plan labels — never generated content) are stored so the
    // outbox worker can rebuild the exact email on retry.
    const { error: insErr } = await supabase
      .from('email_events')
      .insert({ dedupe_key: dedupeKey, email_type: type, recipient: to, status: 'pending', payload: params });
    if (insErr) {
      // Unique violation (or any insert failure): treat as already handled —
      // err toward not sending twice.
      return 'duplicate';
    }

    if (!resend) {
      await supabase.from('email_events').update({ status: 'skipped' }).eq('dedupe_key', dedupeKey);
      return 'skipped';
    }

    const { subject, html, text } = make(params);
    const { data, error } = await resend.emails.send({ from: emailFrom(), to, subject, html, text });
    if (error) throw new Error(error.message || 'send failed');

    await supabase
      .from('email_events')
      .update({ status: 'sent', provider_id: data?.id || null, sent_at: new Date().toISOString() })
      .eq('dedupe_key', dedupeKey);
    return 'sent';
  } catch (err) {
    // The outbox worker (processEmailOutbox) retries this row with backoff;
    // billing processing is never blocked by email delivery.
    console.error(`[lifecycle-email] ${type} to ${to} failed:`, err.message);
    await supabase
      .from('email_events')
      .update({
        status: 'failed',
        attempts: 1,
        next_attempt_at: new Date(Date.now() + RETRY_BASE_MS).toISOString(),
        last_error: String(err.message || '').slice(0, 500),
      })
      .eq('dedupe_key', dedupeKey)
      .then(() => {}, () => {});
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Outbox worker (playbook v6, Prompt 6). Claims due pending/failed rows via
// the atomic claim_email_outbox() SQL function (FOR UPDATE SKIP LOCKED +
// lease), retries with exponential backoff and dead-letters after
// MAX_ATTEMPTS. Safe to run from a cron endpoint and an admin route at the
// same time — two workers can never claim the same row.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS || 5);
const RETRY_BASE_MS = Number(process.env.EMAIL_RETRY_BASE_MS || 5 * 60 * 1000); // 5 min
const LEASE_SECONDS = 120;

function backoffMs(attempts) {
  return RETRY_BASE_MS * Math.pow(3, Math.max(0, attempts - 1)); // 5m, 15m, 45m, ...
}

async function processEmailOutbox({ limit = 20 } = {}) {
  const summary = { claimed: 0, sent: 0, failed: 0, dead_letter: 0, skipped: 0 };

  const { data: rows, error } = await supabase.rpc('claim_email_outbox', {
    p_limit: limit,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    // Migration 025 not applied yet — nothing to process, report honestly.
    console.error('[lifecycle-email] outbox claim failed:', error.message || error);
    return { ...summary, error: 'claim_failed' };
  }

  for (const row of rows || []) {
    summary.claimed++;
    const make = TEMPLATES[row.email_type];

    if (!make || !resend) {
      // Can't ever send this row (unknown type, or no provider configured):
      // mark skipped rather than looping forever.
      await supabase.from('email_events')
        .update({ status: 'skipped', locked_until: null })
        .eq('id', row.id);
      summary.skipped++;
      continue;
    }

    try {
      const { subject, html, text } = make(row.payload || {});
      const { data, error: sendErr } = await resend.emails.send({
        from: emailFrom(), to: row.recipient, subject, html, text,
      });
      if (sendErr) throw new Error(sendErr.message || 'send failed');

      await supabase.from('email_events')
        .update({
          status: 'sent',
          provider_id: data?.id || null,
          sent_at: new Date().toISOString(),
          attempts: (row.attempts || 0) + 1,
          locked_until: null,
        })
        .eq('id', row.id);
      summary.sent++;
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await supabase.from('email_events')
        .update({
          status: dead ? 'dead_letter' : 'failed',
          attempts,
          next_attempt_at: dead ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
          last_error: String(err.message || '').slice(0, 500),
          locked_until: null,
        })
        .eq('id', row.id)
        .then(() => {}, () => {});
      if (dead) {
        summary.dead_letter++;
        console.error('[lifecycle-email]', JSON.stringify({
          event: 'email_dead_letter', id: row.id, type: row.email_type, attempts,
        }));
      } else {
        summary.failed++;
      }
    }
  }
  return summary;
}

/** Operator replay: put a dead-letter row back in the queue. */
async function replayDeadLetter(id) {
  const { error } = await supabase.from('email_events')
    .update({ status: 'failed', attempts: 0, next_attempt_at: new Date().toISOString(), locked_until: null })
    .eq('id', id)
    .eq('status', 'dead_letter');
  return !error;
}

module.exports = { sendLifecycleEmail, processEmailOutbox, replayDeadLetter, TEMPLATES, MAX_ATTEMPTS };
