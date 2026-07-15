import { useState } from 'react';
import { api } from '../lib/api';

/** Beta feedback prompt (audit Prompt 18): small always-available button in
 *  the app shell; sends a short message as an allowlisted analytics event. */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const send = () => {
    const message = text.trim().slice(0, 500);
    if (message) api.trackEvent('feedback_submitted', { message });
    setSent(true);
    setTimeout(() => { setOpen(false); setSent(false); setText(''); }, 1500);
  };

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50 }}>
      {open ? (
        <div className="card" style={{ width: 280, padding: 12, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {sent ? (
            <p style={{ margin: 0 }}>Thanks — got it! 🌱</p>
          ) : (
            <>
              <label htmlFor="beta-feedback" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                What&apos;s working? What&apos;s not?
              </label>
              <textarea
                id="beta-feedback"
                rows={3}
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setOpen(false)}>Close</button>
                <button className="btn btn-primary" onClick={send} disabled={!text.trim()}>Send</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button className="btn" onClick={() => setOpen(true)} aria-label="Send beta feedback">
          Feedback
        </button>
      )}
    </div>
  );
}
