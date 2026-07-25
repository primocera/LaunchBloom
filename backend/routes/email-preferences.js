// ---------------------------------------------------------------------------
// v10 SC-06 — one-click unsubscribe.
//
// Deliberately PUBLIC and unauthenticated: an unsubscribe link is clicked from
// a mail client, often on a device that has never been signed in. Requiring a
// login to stop receiving email is a dark pattern and, for bulk senders, a
// compliance problem.
//
// Safety comes from the signed token instead: it names the address it applies
// to and is HMAC-verified, so it cannot be guessed or pointed at somebody
// else's address. Nothing here reveals whether an address has an account —
// the response is identical either way.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const { verifyUnsubscribeToken, suppress, unsuppress } = require('../lib/email-consent');
const { BRAND } = require('../lib/brand');

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — ${BRAND.name}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#F8F7F4;padding:24px">
<div style="max-width:560px;margin:48px auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
<h1 style="font-size:20px;color:#111827;margin:0 0 12px">${title}</h1>
<div style="font-size:14px;color:#111827;line-height:1.6">${body}</div>
</div></body></html>`;
}

// GET /api/email/unsubscribe?token=… — one click, no login, no confirmation
// step. Mail clients pre-fetch links, but the worst case of an accidental
// unsubscribe is a missed optional nudge, and re-subscribing is one click back.
router.get('/api/email/unsubscribe', async (req, res) => {
  const email = verifyUnsubscribeToken(req.query.token);
  if (!email) {
    return res.status(400).type('html').send(page('This link is not valid', `
      <p>This unsubscribe link is invalid or has been altered.</p>
      <p>You can manage email preferences in <a href="${BRAND.siteUrl}/app/account">Account &amp; billing</a>.</p>`));
  }

  const ok = await suppress(email, { reason: 'unsubscribed', sourceTemplate: String(req.query.t || '').slice(0, 40) || null });
  if (!ok) {
    return res.status(500).type('html').send(page('We could not save that', `
      <p>Something went wrong recording your preference, so nothing changed.</p>
      <p>Please try the link again, or reply to any ${BRAND.name} email and we'll do it manually.</p>`));
  }

  // The address is echoed back because the person already knows it — it is the
  // inbox they are reading this in — and seeing it confirms the right one was
  // unsubscribed when several addresses forward to one mailbox.
  return res.type('html').send(page('You have been unsubscribed', `
    <p><strong>${email}</strong> will no longer receive optional email from ${BRAND.name}.</p>
    <p>You will still receive billing and account messages about your subscription — receipts,
    charge notices and cancellation records. Those are not optional and cannot be turned off
    while you have an active account.</p>
    <p><a href="${BRAND.siteUrl}/api/email/resubscribe?token=${encodeURIComponent(req.query.token)}">Changed your mind? Re-subscribe</a></p>`));
});

// GET /api/email/resubscribe?token=… — the same signed token, reversed.
router.get('/api/email/resubscribe', async (req, res) => {
  const email = verifyUnsubscribeToken(req.query.token);
  if (!email) {
    return res.status(400).type('html').send(page('This link is not valid', '<p>This link is invalid or has been altered.</p>'));
  }
  await unsuppress(email);
  return res.type('html').send(page('You are subscribed again', `
    <p><strong>${email}</strong> will receive optional ${BRAND.name} email again.</p>
    <p>You can unsubscribe at any time from the footer of any optional message.</p>`));
});

module.exports = router;
