import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <Link to="/login" className="brand brand--auth">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="graph" size={22} />
          </span>
          <span className="brand__text">
            <strong>RepoVerse</strong>
            <em>codebase intelligence</em>
          </span>
        </Link>

        <div className="auth__pitch">
          <p className="auth__eyebrow">Understand any repository</p>
          <h1>
            See the codebase.
            <br />
            Not just the files.
          </h1>
          <p className="auth__lede">
            Turn a GitHub repository into an interactive dependency map — then ask what breaks, why
            it is slow, and where the risk actually lives.
          </p>
          <ul className="auth__features">
            <li>
              <Icon name="graph" size={18} />
              <div>
                <strong>Dependency map</strong>
                <span>Files, classes and calls rendered as a navigable graph.</span>
              </div>
            </li>
            <li>
              <Icon name="impact" size={18} />
              <div>
                <strong>Impact analysis</strong>
                <span>See the blast radius of a change before you make it.</span>
              </div>
            </li>
            <li>
              <Icon name="health" size={18} />
              <div>
                <strong>Explainable health</strong>
                <span>Every point deducted maps to a file, a line and a symbol.</span>
              </div>
            </li>
            <li>
              <Icon name="sparkles" size={18} />
              <div>
                <strong>Grounded AI</strong>
                <span>Answers cite the exact source excerpt they were built from.</span>
              </div>
            </li>
          </ul>
        </div>

        <p className="auth__security">
          <Icon name="shield" size={15} /> Analysis is read-only and server-side. Access tokens stay
          in memory; refresh tokens live in HttpOnly cookies.
        </p>
      </aside>

      <main className="auth__panel">
        <div className="auth__card">
          <header className="auth__header">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </header>
          {children}
          <footer className="auth__footer">{footer}</footer>
        </div>
        <p className="auth__legal">
          RepoVerse analyzes public repositories. AI explanations are guidance grounded in the graph,
          not authoritative documentation — always verify against the source.
        </p>
      </main>
    </div>
  );
}
