import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BRAND, LEGAL_VERSION } from '../brand';

// v5 Prompt 15: legal pages. Entity values come from GET /api/legal
// (env-backed on the server) so nothing legal is hardcoded in the bundle.
// Final wording should still be reviewed by qualified counsel before launch.
const SUPPORT = BRAND.supportEmail;

// v9 SC-00: docs whose text legally names the operating entity. When the
// entity isn't configured these fail closed instead of showing a placeholder.
const ENTITY_DEPENDENT = new Set(['terms']);

const buildDocs = (cfg) => {
  const entity = cfg?.legal_name || 'the operator of ' + BRAND.name;
  const address = cfg?.legal_address ? ` Registered address: ${cfg.legal_address}.` : '';
  const law = cfg?.governing_law ? ` These Terms are governed by the laws of ${cfg.governing_law}.` : '';
  const privacyContact = cfg?.privacy_email || SUPPORT;
  return {
  terms: {
    title: 'Terms of Service',
    body: [
      ['Agreement', `By using ${BRAND.name} you agree to these Terms. If you do not agree, do not use the service. ${BRAND.name} is operated by ${entity}.${address}${law}`],
      ['The service', `${BRAND.name} is an AI marketing workspace that generates positioning, offers and marketing assets from the information you provide. Output is AI-generated and provided "as is" - see the AI Disclaimer.`],
      ['Eligibility', `You must be at least 18 years old to use ${BRAND.name}, and you use it for business or professional purposes (for example as a freelancer, agency, consultant or business). ${BRAND.name} is not intended for children. If we learn that an account belongs to someone under 18, we will close it, delete its data and refund any charges.`],
      ['Your account', 'You are responsible for keeping your login secure and for activity under your account. You must provide a valid email and accept these Terms and the Privacy Policy at signup.'],
      ['Acceptable use', 'Do not use the service to generate unlawful, misleading, or harmful content, to infringe others’ rights, or to attempt to break, overload or reverse-engineer the service.'],
      ['Plans & billing', 'Paid plans start with a 3-day free trial that requires a payment method; you are charged when the trial ends unless you cancel. See the Refund & Cancellation Policy.'],
      ['Right of withdrawal (EU/EEA and UK consumers)', `${BRAND.name} is offered for business use. If you nevertheless use it as a consumer in the EU/EEA or UK, you may withdraw from your subscription within 14 days of starting it, without giving a reason, by emailing ${SUPPORT}. By starting your subscription you ask us to begin providing the service immediately, during the withdrawal period. If you withdraw after your trial has ended and you have been charged, we refund that charge minus a proportionate amount for the paid days you used before withdrawing.`],
      ['Termination', 'You may delete your account at any time from Account → Data. We may suspend accounts that violate these Terms.'],
      ['Liability', `The service is provided "as is" and "as available", without warranties of any kind, express or implied. To the maximum extent permitted by law, ${entity} is not liable for indirect, incidental, special or consequential damages, lost profits, or business decisions made based on AI output, and our total liability for any claim is limited to the amounts you paid us in the 12 months before the claim.`],
      ['Changes', `We may update these Terms; material changes will be posted here with a new version date. Current version: ${LEGAL_VERSION}.`],
      ['Contact', `Questions: ${SUPPORT}.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      ['Who we are', `The controller of your personal data is ${entity}.${address} Contact for privacy matters: ${privacyContact}.`],
      ['What we collect', 'Account data (email), the business information you enter, generated assets, usage/metering events, and billing status (via Stripe). We do not sell your data.'],
      ['How we use it', 'To provide the service (generate and store your assets), enforce plan limits, process payments, send transactional email, and improve reliability.'],
      ['Legal basis', 'We process your account data, the information you enter, generated assets and billing status because it is necessary to perform our contract with you (GDPR Art. 6(1)(b)). We process usage, security and reliability data based on our legitimate interest in running a secure, working service and preventing abuse (Art. 6(1)(f)). We keep payment and invoicing records where the law requires it (Art. 6(1)(c)). We send optional product emails only if you opted in, and you can withdraw that consent at any time (Art. 6(1)(a)).'],
      ['AI processing', `The information you enter is sent to our AI provider (Anthropic) to generate output. Do not enter data you are not permitted to share.`],
      ['Subprocessors', 'We rely on: Vercel (hosting), Supabase (database & authentication), Anthropic (AI generation), Stripe (payments), and Resend (transactional email). Each processes data only to provide their part of the service.'],
      ['International transfers', 'Some of these providers are based in, or process data in, the United States. Where personal data leaves the EU/EEA, the transfer relies on safeguards such as the EU-US Data Privacy Framework or the EU Standard Contractual Clauses, as set out in each provider\'s data processing terms.'],
      ['Your rights', `You can export all of your data or delete your account and its data at any time from Account → Data. Depending on where you live (including under GDPR and the CCPA/CPRA), you may also have rights to access, correct, delete, or receive a copy of your personal data, and to object to or restrict certain processing. To exercise any of these rights, email ${privacyContact} - we respond within 30 days and never discriminate against you for exercising them. If you are in the EU/EEA, you also have the right to lodge a complaint with the data protection authority in the country where you live or work, or where an alleged infringement took place.`],
      ['Children', `${BRAND.name} is for adults using it for work and is not intended for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has created an account, contact ${privacyContact} and we will delete it.`],
      ['Data retention', 'We keep your data while your account is active. On deletion we remove your workspace data and authentication record; we retain only records legally required (e.g. payment records held by Stripe).'],
      ['Contact', `Privacy questions: ${privacyContact}. Current version: ${LEGAL_VERSION}.`],
    ],
  },
  cookies: {
    title: 'Cookie Notice',
    body: [
      ['Essential cookies only', `${BRAND.name} uses only strictly-necessary cookies to keep you signed in (secure, HttpOnly session cookies). These are required for the app to work and are not used for advertising.`],
      ['No tracking cookies', 'We do not currently set analytics or marketing cookies. If that changes, we will ask for consent first and update this notice.'],
      ['Contact', `Questions: ${SUPPORT}.`],
    ],
  },
  'ai-disclaimer': {
    title: 'AI Output Disclaimer',
    body: [
      ['AI-generated content', `Assets produced by ${BRAND.name} are generated by AI from the information you provide. They are a starting point, not professional advice.`],
      ['Review before use', 'Always review and edit output before publishing. AI can be inaccurate, omit facts, or produce claims that need verification. You are responsible for what you publish.'],
      ['No guarantees', 'We make no promise of specific revenue, results, or outcomes. Nothing generated is legal, financial, medical, or tax advice.'],
      ['Contact', `Questions: ${SUPPORT}.`],
    ],
  },
  refund: {
    title: 'Refund & Cancellation Policy',
    body: [
      ['Free trial', 'Paid plans begin with a 3-day free trial. You can cancel any time during the trial from Account → Billing and you will not be charged.'],
      ['After the trial', 'When the trial ends your card is charged for the plan you chose. Subscriptions renew automatically until cancelled.'],
      ['Cancelling', 'Cancel any time; your plan stays active until the end of the current billing period. You keep access to your data.'],
      ['Refunds', `Charges are generally non-refundable because the trial lets you evaluate the full product before paying. If something went wrong - you were charged after cancelling, or a billing error occurred - contact ${SUPPORT} within 14 days of the charge and we will make it right. If you are a consumer in the EU/EEA or UK, you also have a 14-day right of withdrawal (see "Right of withdrawal" in the Terms). Statutory rights that cannot be waived in your jurisdiction are unaffected.`],
      ['Contact', `Billing questions: ${SUPPORT}.`],
    ],
  },
  };
};

export default function Legal() {
  const { slug } = useParams();
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    fetch('/api/legal')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('legal config unavailable'))))
      .then((data) => { if (!cancelled) { setCfg(data); setStatus('ok'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  const doc = buildDocs(cfg)[slug];

  // v9 SC-00: fail closed. If this document legally names the operating entity
  // but the entity isn't configured (or the config request failed), show an
  // explicit unavailable state rather than a fabricated placeholder entity.
  const entityConfigured = !!(cfg && cfg.configured && cfg.legal_name);
  if (doc && ENTITY_DEPENDENT.has(slug) && status !== 'loading' && !entityConfigured) {
    return (
      <div className="legal">
        <div className="legal-card">
          <p className="legal-back"><Link to="/">&larr; {BRAND.name}</Link></p>
          <h1>{doc.title}</h1>
          <p role="alert">
            Our {doc.title} is being finalized with our current operating entity and isn’t available
            right now. For the operating entity, registered address and governing law, please
            contact <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> before relying on these Terms.
          </p>
          <hr />
          <p className="legal-links">
            <Link to="/legal/privacy">Privacy</Link> &middot;{' '}
            <Link to="/legal/cookies">Cookies</Link> &middot;{' '}
            <Link to="/legal/ai-disclaimer">AI Disclaimer</Link> &middot;{' '}
            <Link to="/legal/refund">Refunds</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="legal">
        <div className="legal-card">
          <h1>Not found</h1>
          <p>That document doesn&apos;t exist.</p>
          <p><Link to="/">Back home</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="legal">
      <div className="legal-card">
        <p className="legal-back"><Link to="/">&larr; {BRAND.name}</Link></p>
        <h1>{doc.title}</h1>
        <p className="legal-meta">Version {cfg?.version || LEGAL_VERSION}</p>
        {doc.body.map(([heading, text]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{text}</p>
          </section>
        ))}
        <hr />
        <p className="legal-links">
          <Link to="/legal/terms">Terms</Link> &middot;{' '}
          <Link to="/legal/privacy">Privacy</Link> &middot;{' '}
          <Link to="/legal/cookies">Cookies</Link> &middot;{' '}
          <Link to="/legal/ai-disclaimer">AI Disclaimer</Link> &middot;{' '}
          <Link to="/legal/refund">Refunds</Link>
        </p>
      </div>
    </div>
  );
}
