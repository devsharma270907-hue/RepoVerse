import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { IconButton, Kbd } from '@/components/ui';
import { useAnalysisEvents } from '@/features/realtime/useAnalysisEvents';
import { usePalette } from '@/features/palette/PaletteProvider';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useTheme } from '@/lib/theme';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { openPalette } = usePalette();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useAnalysisEvents(Boolean(user));

  const inWorkspace = /^\/analyses\//.test(location.pathname);

  const closeMobile = (): void => setMobileNavOpen(false);

  return (
    <div className={['app-shell', mobileNavOpen ? 'app-shell--nav-open' : ''].filter(Boolean).join(' ')}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar__brand">
          <NavLink to="/" className="brand" onClick={closeMobile}>
            <span className="brand__mark" aria-hidden="true">
              <Icon name="graph" size={20} />
            </span>
            <span className="brand__text">
              <strong>RepoVerse</strong>
              <em>codebase intelligence</em>
            </span>
          </NavLink>
          <IconButton
            icon="close"
            label="Close navigation"
            className="sidebar__close"
            onClick={closeMobile}
          />
        </div>

        <button type="button" className="sidebar__search" onClick={() => openPalette()}>
          <Icon name="search" size={15} />
          <span>Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>

        <nav className="sidebar__nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`} onClick={closeMobile}>
            <Icon name="repo" size={17} />
            <span>Repositories</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
            onClick={closeMobile}
          >
            <Icon name="settings" size={17} />
            <span>Settings</span>
          </NavLink>
          {inWorkspace ? (
            <button
              type="button"
              className="nav-link nav-link--ghost"
              onClick={() => {
                closeMobile();
                navigate(-1);
              }}
            >
              <Icon name="arrow-left" size={17} />
              <span>Back</span>
            </button>
          ) : null}
        </nav>

        <div className="sidebar__spacer" />

        <div className="sidebar__tip">
          <Icon name="sparkles" size={16} />
          <p>
            Select any file on the map, then ask the AI to explain it. Every answer shows the
            source it was grounded in.
          </p>
        </div>

        <div className="sidebar__user">
          <span className="avatar" aria-hidden="true">
            {initials(user?.name ?? 'RV')}
          </span>
          <span className="sidebar__user-info">
            <strong>{user?.name}</strong>
            <em>{user?.email}</em>
          </span>
          <IconButton
            icon={theme === 'dark' ? 'sun' : 'moon'}
            label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggle}
          />
          <IconButton
            icon="logout"
            label="Log out"
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
          />
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-bar">
          <IconButton icon="menu" label="Open navigation" onClick={() => setMobileNavOpen(true)} />
          <span className="mobile-bar__brand">RepoVerse</span>
          <IconButton icon="search" label="Search" onClick={() => openPalette()} />
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>

      {mobileNavOpen ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={closeMobile}
        />
      ) : null}

      <CommandPalette />
    </div>
  );
}
