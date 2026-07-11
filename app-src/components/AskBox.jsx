import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TypedPrompt from './TypedPrompt';

/**
 * The hero prompt box. Types example ideas on its own until you click in and
 * write yours; whatever you write lands in the onboarding form's skills
 * field, so the landing page is a real entry point rather than a picture of one.
 */
export default function AskBox({ prompts }) {
  const [value, setValue] = useState('');
  const navigate = useNavigate();

  function submit(e) {
    e?.preventDefault();
    const text = value.trim();
    if (text) {
      try {
        sessionStorage.setItem('of-draft', text);
      } catch {
        /* private mode: they retype it in onboarding */
      }
    }
    navigate('/app');
  }

  return (
    <form className="lp-ask-box" onSubmit={submit}>
      <div className="lp-ask-line">
        {value === '' && (
          <span className="lp-ask-ghost" aria-hidden="true">
            <TypedPrompt prompts={prompts} />
          </span>
        )}
        <input
          className="lp-ask-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Describe your idea or skill"
        />
      </div>

      <div className="lp-ask-foot">
        <span className="lp-ask-chip">Try it Free</span>
        <button className="lp-ask-btn" type="submit">
          Build my offer
        </button>
      </div>
    </form>
  );
}
