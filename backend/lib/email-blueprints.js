// ---------------------------------------------------------------------------
// Deterministic email-flow blueprints (audit Prompt 11).
//
// The flow TYPE decides the email count and each email's objective/timing —
// deterministically, before the AI is called — so "welcome" always produces
// the right number of emails with the right purpose. The AI only fills copy
// into a fixed structure; it never decides how many emails to write.
// ---------------------------------------------------------------------------

// Each step: objective, send_timing, segment. email_order is the 1-based index.
const FLOW_BLUEPRINTS = {
  welcome: {
    label: 'Welcome',
    steps: [
      { objective: 'Welcome + deliver the promised value / lead magnet', send_timing: 'Immediately', segment: 'New subscribers' },
      { objective: 'Brand story — why you exist, what you stand for', send_timing: 'Day 2', segment: 'New subscribers' },
      { objective: 'Product / service education — how it helps them', send_timing: 'Day 4', segment: 'New subscribers' },
      { objective: 'Handle the top objection, build trust', send_timing: 'Day 6', segment: 'New subscribers (not yet purchased)' },
      { objective: 'Present the offer with a clear reason to act', send_timing: 'Day 8', segment: 'New subscribers (not yet purchased)' },
    ],
  },
  abandon_cart: {
    label: 'Abandoned cart',
    steps: [
      { objective: 'Friendly reminder — the items are still waiting', send_timing: '1 hour after abandonment', segment: 'Cart abandoners' },
      { objective: 'Address objections + reassurance (shipping, returns, trust)', send_timing: '24 hours after', segment: 'Cart abandoners (not purchased)' },
      { objective: 'Final honest reminder (no fake urgency)', send_timing: '48 hours after', segment: 'Cart abandoners (not purchased)' },
    ],
  },
  browse_abandon: {
    label: 'Browse abandonment',
    steps: [
      { objective: 'Reminder of the product they viewed', send_timing: '2 hours after browsing', segment: 'Browse abandoners' },
      { objective: 'Helpful education / social proof for that product', send_timing: '24 hours after', segment: 'Browse abandoners' },
      { objective: 'Gentle nudge with a clear next step', send_timing: '48 hours after', segment: 'Browse abandoners (not purchased)' },
    ],
  },
  post_purchase: {
    label: 'Post-purchase',
    steps: [
      { objective: 'Order confirmation + set expectations', send_timing: 'Immediately after purchase', segment: 'Recent buyers' },
      { objective: 'How to use / get the most from the product', send_timing: 'Day 2 (or on delivery)', segment: 'Recent buyers' },
      { objective: 'Relevant cross-sell / complementary product', send_timing: 'Day 7', segment: 'Recent buyers' },
      { objective: 'Ask for a review / feedback', send_timing: 'Day 14', segment: 'Recent buyers' },
    ],
  },
  review_request: {
    label: 'Review request',
    steps: [
      { objective: 'Ask for an honest review', send_timing: 'Day 10 after delivery', segment: 'Delivered buyers' },
      { objective: 'Gentle reminder to leave a review', send_timing: 'Day 17', segment: 'Delivered buyers (no review yet)' },
    ],
  },
  winback: {
    label: 'Winback',
    steps: [
      { objective: 'We miss you — reconnect, no pressure', send_timing: 'Day 0 of winback', segment: 'Lapsed customers (60-90 days inactive)' },
      { objective: 'Offer an incentive to return', send_timing: 'Day 5', segment: 'Lapsed customers (still inactive)' },
      { objective: 'Last honest chance before reducing email frequency', send_timing: 'Day 12', segment: 'Lapsed customers (still inactive)' },
    ],
  },
  back_in_stock: {
    label: 'Back-in-stock',
    steps: [
      { objective: 'The product they wanted is available again — clear next step', send_timing: 'Immediately on restock', segment: 'Back-in-stock waitlist' },
      { objective: 'Honest reminder while stock lasts (only real scarcity)', send_timing: '24 hours after restock', segment: 'Back-in-stock waitlist (not purchased)' },
    ],
  },
  sunset: {
    label: 'Sunset / re-engagement',
    steps: [
      { objective: 'Ask if they still want to hear from you — easy opt-in to stay', send_timing: 'Day 0 of sunset', segment: 'Unengaged (90+ days no opens/clicks)' },
      { objective: 'Final email before removing them from the active list', send_timing: 'Day 7', segment: 'Unengaged (still no response)' },
    ],
  },
};

const FLOW_TYPES = Object.keys(FLOW_BLUEPRINTS);

/**
 * Build the exact email sequence for the selected flow types. `campaign` is
 * handled specially: a configurable N-email strategy sequence.
 *
 * @returns { emails: [{flow_type, email_order, objective, send_timing, segment}],
 *            structureText, total }
 */
function buildSequence(flowTypes, { campaignCount = 4 } = {}) {
  const emails = [];

  for (const flow of flowTypes || []) {
    if (flow === 'campaign') {
      const n = Math.min(Math.max(Number(campaignCount) || 4, 2), 8);
      for (let i = 1; i <= n; i++) {
        emails.push({
          flow_type: 'campaign',
          email_order: i,
          objective:
            i === 1 ? 'Open with value / problem awareness (no hard sell)' :
            i === n ? 'Final honest reminder / last call' :
            `Build desire and handle objections (email ${i} of ${n})`,
          send_timing: `Day ${(i - 1) * 2}`,
          segment: 'Campaign audience',
        });
      }
      continue;
    }
    const bp = FLOW_BLUEPRINTS[flow];
    if (!bp) continue;
    bp.steps.forEach((step, idx) => {
      emails.push({ flow_type: flow, email_order: idx + 1, ...step });
    });
  }

  const byFlow = {};
  for (const e of emails) (byFlow[e.flow_type] = byFlow[e.flow_type] || []).push(e);
  const structureText = Object.entries(byFlow)
    .map(([flow, list]) => {
      const label = (FLOW_BLUEPRINTS[flow] && FLOW_BLUEPRINTS[flow].label) || 'Campaign';
      const lines = list.map((e) => `  ${e.email_order}. ${e.objective} — send: ${e.send_timing} — segment: ${e.segment}`).join('\n');
      return `${label} flow (${list.length} emails):\n${lines}`;
    })
    .join('\n\n');

  return { emails, structureText, total: emails.length };
}

module.exports = { FLOW_BLUEPRINTS, FLOW_TYPES, buildSequence };
