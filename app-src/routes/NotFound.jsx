import { Link } from 'react-router-dom';

/** 404 page (audit Prompt 17) instead of a silent redirect. */
export default function NotFound() {
  return (
    <div style={{ maxWidth: 480, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Page not found</h1>
      <p style={{ color: '#6B7280', marginBottom: 16 }}>
        That page doesn&apos;t exist or has moved.
      </p>
      <Link className="btn btn-primary" to="/">Go to the homepage</Link>
    </div>
  );
}
