import { Component } from 'react';

/** Top-level error boundary (audit Prompt 17): a crash in any route renders
 *  a recoverable screen instead of a blank page. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ maxWidth: 480, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: '#6B7280', marginBottom: 16 }}>
          Your work is saved on the server. Reload the page to continue.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
