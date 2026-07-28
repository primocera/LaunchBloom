import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// ---------------------------------------------------------------------------
// v11 SC-07 — the capped-beta feedback moment.
//
// Shown once per workspace per moment: after the first handoff export, and
// after a cancel or refund. Dismissible, never blocking, and it never appears
// again once answered — a prompt that returns after every export is nagging,
// not research.
//
// The questions come from the server so the wording lives in one place, and
// the optional note is labelled as read by a person and excluded from
// analytics, because that is exactly what happens to it.
// ---------------------------------------------------------------------------

export default function FeedbackMoment({ moment, title }) {
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState('');
  const [state, setState] = useState('idle'); // idle | open | sending | done | hidden
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.feedbackStatus()
      .then((r) => {
        if (cancelled) return;
        if ((r.answered || []).includes(moment)) { setState('hidden'); return; }
        return api.feedbackQuestions().then((q) => {
          if (!cancelled) { setQuestions(q); setState('open'); }
        });
      })
      // Feedback is never allowed to break the screen it sits on.
      .catch(() => { if (!cancelled) setState('hidden'); });
    return () => { cancelled = true; };
  }, [moment]);

  if (state === 'hidden' || state === 'idle') return null;

  if (state === 'done') {
    return (
      <div className="feedback-moment is-done" role="status">
        Thank you — that goes straight to the person building this.
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (state === 'sending') return;
    if (!Object.keys(answers).length) {
      setError('Answer at least one question, or dismiss this.');
      return;
    }
    setState('sending');
    setError(null);
    try {
      await api.submitFeedback({ moment, ...answers, notes: notes.trim() || undefined });
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('open');
    }
  }

  return (
    <form className="feedback-moment" onSubmit={submit} aria-labelledby="feedback-title">
      <div className="feedback-head">
        <h3 id="feedback-title">{title}</h3>
        <button type="button" className="feedback-dismiss" onClick={() => setState('hidden')}>
          Not now
        </button>
      </div>

      {(questions?.questions || []).map((q) => (
        <fieldset key={q.key} className="feedback-q">
          <legend>{q.prompt}</legend>
          {q.options.map((o) => (
            <label key={o.value} className="feedback-option">
              <input
                type="radio"
                name={q.key}
                value={o.value}
                checked={answers[q.key] === o.value}
                onChange={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <label className="feedback-notes">
        <span>{questions?.notes?.prompt || 'Anything else? (optional)'}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={questions?.notes?.max_length || 2000}
          rows={3}
        />
        <small>{questions?.notes?.note}</small>
      </label>

      {error && <p className="feedback-err" role="alert">{error}</p>}

      <button className="btn-primary" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending...' : 'Send feedback'}
      </button>
    </form>
  );
}
