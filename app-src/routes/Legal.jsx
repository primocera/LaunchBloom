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
  const regNo = cfg?.registration_number ? ` Registration number: ${cfg.registration_number}.` : '';
  const vat = cfg?.vat_id ? ` VAT ID: ${cfg.vat_id}.` : '';
  const identity = `${address}${regNo}${vat}`;
  const law = cfg?.governing_law
    ? ` These Terms are governed by the laws of ${cfg.governing_law}. If you are a consumer, you also keep the protection of the mandatory laws of the country where you live.`
    : '';
  const privacyContact = cfg?.privacy_email || SUPPORT;
  const withdrawTo = `${entity}${cfg?.legal_address ? `, ${cfg.legal_address}` : ''}, ${SUPPORT}`;
  return {
  terms: {
    title: 'Terms of Service',
    body: [
      ['Agreement', `By using ${BRAND.name} you agree to these Terms. If you do not agree, do not use the service. ${BRAND.name} is operated by ${entity}.${identity} Contact: ${SUPPORT}.${law}`],
      ['The service', `${BRAND.name} is an AI marketing workspace that generates positioning, offers and marketing drafts from the information you provide. It does not publish, post, schedule or send anything for you. Output is AI-generated, can be inaccurate and must be reviewed by you before use - see the AI Disclaimer.`],
      ['Eligibility', `You must be at least 18 years old to use ${BRAND.name}, and you use it for business or professional purposes (for example as a freelancer, agency, consultant or business). ${BRAND.name} is not intended for children. If we learn that an account belongs to someone under 18, we will close it, delete its data and refund any charges.`],
      ['Your account', 'You are responsible for keeping your login secure and for activity under your account. You must provide a valid email and accept these Terms and the Privacy Policy at signup.'],
      ['Your content', `You keep all rights to the information you enter. To the extent any rights exist in the output generated for you, they belong to you. You give us a limited licence to store, process and transmit your content only to provide the service to you. You are responsible for having the right to use anything you enter, including material from your clients. We do not use your content to train AI models.`],
      ['Acceptable use', 'Do not use the service to generate unlawful, misleading, or harmful content, to infringe others’ rights, or to attempt to break, overload or reverse-engineer the service. Do not enter sensitive personal data (such as health information) about anyone.'],
      ['Plans & billing', 'Paid plans start with a 3-day free trial that requires a payment method; you are charged when the trial ends unless you cancel before then. After that, your subscription renews automatically at the end of each billing period (monthly or yearly, as you chose) and you are charged the plan price for each new period until you cancel. You can cancel at any time from Account → Billing; you keep access until the end of the period you already paid for. If we change a price, we will email you before it applies to your next renewal. See the Refund & Cancellation Policy.'],
      ['Right of withdrawal (EU/EEA and UK consumers)', `${BRAND.name} is offered for business use. If you nevertheless use it as a consumer in the EU/EEA or UK, you may withdraw from your subscription within 14 days of starting it, without giving a reason, by emailing ${SUPPORT} or by using the model withdrawal form in the Refund & Cancellation Policy. If you withdraw in time, we refund every payment you made for the subscription within 14 days, using the same payment method.`],
      ['Termination', 'You may cancel your subscription or delete your account at any time from Account → Billing and Account → Data. We may suspend or close an account that seriously or repeatedly breaks these Terms, normally after a warning. If we close your account for a reason other than your breach, we refund the unused part of any period you prepaid.'],
      ['Liability', `We provide the service with reasonable care, but AI output can be wrong and we do not promise any particular result. To the extent the law allows, ${entity} is not liable for indirect or consequential damages, lost profits, or business decisions made based on AI output, and our total liability for any claim is limited to the amounts you paid us in the 12 months before the claim. Nothing in these Terms limits liability for intent or gross negligence, for death or personal injury, or any other liability that cannot be limited by law, and nothing affects the statutory rights of consumers.`],
      ['Changes', `We may update these Terms. For a material change we will email you at least 30 days before it applies to your existing subscription; if you do not agree, you can cancel before then. Current version: ${LEGAL_VERSION}.`],
      ['Contact', `Questions: ${SUPPORT}.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      ['Who we are', `The controller of your personal data is ${entity}.${identity} Contact for privacy matters: ${privacyContact}.`],
      ['What we collect', 'Account data (email and password, held by our authentication provider), the business information you enter, generated drafts, feedback you send us, usage/metering events, billing status (via Stripe), a record of when you accepted these terms (version, time and IP address), and a log of the account and billing emails we send you. We do not sell your data.'],
      ['How we use it', 'To provide the service (generate and store your drafts), enforce plan limits, process payments, send account and billing email, prove that you accepted our terms, and keep the service secure and reliable.'],
      ['Legal basis', 'We process your account data, the information you enter, generated drafts and billing status because it is necessary to perform our contract with you (GDPR Art. 6(1)(b)). We process usage, security and reliability data, and the record of your acceptance, based on our legitimate interest in running a secure, working service, preventing abuse and being able to show what you agreed to (Art. 6(1)(f)). We keep payment and invoicing records where the law requires it (Art. 6(1)(c)). We send optional product emails only if you opted in, and you can withdraw that consent at any time (Art. 6(1)(a)).'],
      ['Data about your clients', `If you enter information about your clients or their customers, you are responsible for having a lawful basis to share it with us, and we process it on your behalf only to provide the service. If you need a data processing agreement for your clients, contact ${privacyContact}.`],
      ['AI processing', 'The information you enter is sent to our AI provider (Anthropic) to generate output. Under Anthropic’s commercial terms, data sent through its API is not used to train its models, and we do not use your content to train AI models either. Do not enter data you are not permitted to share.'],
      ['Subprocessors', 'We rely on: Vercel (hosting), Supabase (database & authentication), Anthropic (AI generation), Stripe (payments), and Resend (email delivery). Each processes data only to provide their part of the service. Our fonts are served from our own domain, so loading the site sends nothing to font providers.'],
      ['International transfers', 'Some of these providers are based in, or process data in, the United States. Where personal data leaves the EU/EEA, the transfer relies on safeguards such as the EU-US Data Privacy Framework or the EU Standard Contractual Clauses, as set out in each provider\'s data processing terms.'],
      ['Your rights', `You can export all of your data or delete your account and its data at any time from Account → Data. Depending on where you live (including under GDPR and the CCPA/CPRA), you also have rights to access, correct, delete, or receive a portable copy of your personal data, to object to or restrict certain processing, and to withdraw any consent you gave at any time (this does not affect processing that happened before). To exercise any of these rights, email ${privacyContact} - we respond within 30 days and never discriminate against you for exercising them. If you are in the EU/EEA, you also have the right to lodge a complaint with the data protection authority in the country where you live or work, or where an alleged infringement took place, or with our lead authority, the Information Commissioner of the Republic of Slovenia (Informacijski pooblaščenec, www.ip-rs.si).`],
      ['Children', `${BRAND.name} is for adults using it for work and is not intended for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has created an account, contact ${privacyContact} and we will delete it.`],
      ['Data retention', `We keep your data while your account is active. When you delete your account we immediately delete your workspaces, brand profiles, campaigns, drafts, feedback, workspace usage data and sign-in account. We keep: billing records (with Stripe and in our own billing records) for as long as tax and accounting law requires; the record that you accepted our terms, for as long as we may need it to establish or defend legal claims; the log of account and billing emails we sent you; and a few account-level events (such as sign-up and subscription changes) linked to an internal account ID, never to the content you created. You can ask us to delete the email log and those events at ${privacyContact}. If you unsubscribed from optional email, we keep your address on a do-not-email list so we never email you again.`],
      ['Contact', `Privacy questions: ${privacyContact}. Current version: ${LEGAL_VERSION}.`],
    ],
  },
  cookies: {
    title: 'Cookie Notice',
    body: [
      ['Essential cookies only', `${BRAND.name} uses only two strictly-necessary cookies, sb_access and sb_refresh, to keep you signed in. They are secure, HttpOnly session cookies, required for the app to work, and never used for advertising.`],
      ['Storage on your device', 'The app also saves a few values in your browser’s local and session storage so it works the way you asked: your light/dark theme (scalvya_theme), your active workspace (active_workspace_id), the plan and billing interval you picked before signing in (of-pending-plan, of-pending-interval), the use case you chose on the home page (of-use-case), and unsent form drafts so you don’t lose work across sign-in or checkout (lb-draft-*, campaign_form_draft, of-draft, of-website-brief). Saved drafts expire after 7 days, and session values clear when you close the tab. None of these are used for tracking, and you can clear them at any time in your browser settings.'],
      ['No tracking cookies', 'We do not set analytics, advertising or tracking cookies, and we do not load third-party trackers. If that changes, we will ask for consent first and update this notice.'],
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
      ['After the trial', 'When the trial ends your card is charged for the plan you chose. Your subscription then renews automatically at the end of each billing period (monthly or yearly) and you are charged the plan price for each new period until you cancel.'],
      ['Cancelling', 'Cancel any time from Account → Billing; your plan stays active until the end of the current billing period and is not charged again. You keep access to your data.'],
      ['Refunds', `Charges are generally non-refundable because the trial lets you evaluate the full product before paying. If something went wrong - you were charged after cancelling, or a billing error occurred - contact ${SUPPORT} within 14 days of the charge and we will make it right. If you are a consumer in the EU/EEA or UK, you also have a 14-day right of withdrawal with a full refund (see "Right of withdrawal" in the Terms). Statutory rights that cannot be waived in your jurisdiction are unaffected.`],
      ['Model withdrawal form (EU/EEA and UK consumers)', `Complete and return this form only if you wish to withdraw from the contract. To: ${withdrawTo}. I hereby give notice that I withdraw from my contract for the provision of the following service: ${BRAND.name} subscription (plan: ____). Ordered on: ____. Name: ____. Address: ____. Account email: ____. Signature (only if sent on paper): ____. Date: ____.`],
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
