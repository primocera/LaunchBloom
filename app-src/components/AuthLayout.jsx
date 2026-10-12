import { Link } from 'react-router-dom';
import { BRAND } from '../brand';
import BloomMark from './BloomMark';

// Shared frame for the auth pages (login, signup, forgot/reset password):
// a plain white page with the logo top-left and one centered column, so the
// form - not a decorated card - is the whole screen.
export default function AuthLayout({ children }) {
  return (
    <div className="login">
      <header className="auth-top">
        <Link to="/" className="auth-logo" aria-label={`${BRAND.name} home`}>
          <span className="auth-logo-mark"><BloomMark /></span>
          {BRAND.name}
        </Link>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
