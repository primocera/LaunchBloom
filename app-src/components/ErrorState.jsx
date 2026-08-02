import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RECOVERY_ACTIONS } from '../lib/error-states';

// ---------------------------------------------------------------------------
// v13 SC-P1-10: one accessible renderer for a typed error/guidance state (see
// lib/error-states.js). It always shows what happened, the reassurance line
// (did I lose work / was I charged), and exactly one recovery action — plus a
// support fallback and, for the empty-workspace guide, the ordered start steps.
//
// Accessibility: the container is role="alert" (or "status" for guidance) and
// receives focus when it appears, so keyboard/AT users are taken straight to
// the recovery path. The action is a real <button>/<Link>, keyboard-operable.
// ---------------------------------------------------------------------------

export default function ErrorState({ state, onRetry, onUpgrade, supportHref, className }) {
  const ref = useRef(null);

  useEffect(() => {
    // Move focus to the state so the recovery path is reachable immediately.
    // Errors interrupt; guidance is not stolen focus (role="status").
    if (state?.role === 'alert' && ref.current) ref.current.focus();
  }, [state]);

  if (!state) return null;

  const { role = 'alert', title, message, reassurance, action, secondaryAction, steps, reqId } = state;

  function runAction(a) {
    if (!a) return null;
    if (a.kind === RECOVERY_ACTIONS.LINK && a.to) {
      return <Link className="flow-btn is-ghost" to={a.to}>{a.label}</Link>;
    }
    if (a.kind === RECOVERY_ACTIONS.UPGRADE) {
      return <button type="button" className="account-link" onClick={onUpgrade}>{a.label}</button>;
    }
    if (a.kind === RECOVERY_ACTIONS.SUPPORT) {
      return <a className="account-link" href={supportHref || 'mailto:support@scalvya.com'}>{a.label}</a>;
    }
    // retry (default)
    return <button type="button" className="account-link" onClick={onRetry}>{a.label}</button>;
  }

  return (
    <div
      ref={ref}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      tabIndex={-1}
      className={`sc-error-state${role === 'alert' ? ' is-error' : ''}${className ? ` ${className}` : ''}`}
    >
      {title && <strong className="sc-error-title">{title}</strong>}
      {message && <p className="sc-error-msg">{message}</p>}
      {reassurance && <p className="flow-muted sc-error-reassure">{reassurance}</p>}

      {Array.isArray(steps) && steps.length > 0 && (
        <ol className="sc-error-steps">
          {steps.map((s) => (
            <li key={s.key}>
              <Link to={s.to}>{s.label}</Link>
              {s.hint ? <span className="flow-muted"> — {s.hint}</span> : null}
            </li>
          ))}
        </ol>
      )}

      <p className="sc-error-actions">
        {runAction(action)}
        {secondaryAction ? <>{' · '}{runAction(secondaryAction)}</> : null}
      </p>

      {reqId && (
        <p className="flow-muted sc-error-reqid">
          If it keeps happening, share request {reqId} with support.
        </p>
      )}
    </div>
  );
}
