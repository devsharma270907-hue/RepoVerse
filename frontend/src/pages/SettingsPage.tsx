import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  deleteAccount,
  exportAccount,
  removeGithubToken,
  revokeAllSessions,
  revokeSession,
  setGithubToken,
} from '@/api/endpoints';
import { useMe, useSessions } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Spinner,
  Toggle,
} from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate, formatRelative } from '@/lib/format';
import { fieldError, friendlyMessage, toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';
import { downloadBlob } from '@/lib/download';
import { useTheme } from '@/lib/theme';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user: authUser, logout, refreshUser } = useAuth();
  const { theme, toggle } = useTheme();

  const meQuery = useMe();
  const sessionsQuery = useSessions();
  const me = meQuery.data ?? authUser;

  const [pat, setPat] = useState('');
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState<AppError | null>(null);
  const [patNotice, setPatNotice] = useState<string | null>(null);

  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState<'export' | 'delete' | null>(null);
  const [privacyError, setPrivacyError] = useState<AppError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [signOutAllOpen, setSignOutAllOpen] = useState(false);

  const connectToken = async (): Promise<void> => {
    if (!pat.trim()) return;
    setPatBusy(true);
    setPatError(null);
    setPatNotice(null);
    try {
      const status = await setGithubToken(pat.trim());
      setPat('');
      setPatNotice(
        status.hint ? `Connected — token ${status.hint}` : 'GitHub token connected.'
      );
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await refreshUser();
    } catch (err) {
      setPatError(toAppError(err));
    } finally {
      setPatBusy(false);
    }
  };

  const disconnectToken = async (): Promise<void> => {
    setPatBusy(true);
    setPatError(null);
    setPatNotice(null);
    try {
      await removeGithubToken();
      setPatNotice('GitHub token disconnected.');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await refreshUser();
    } catch (err) {
      setPatError(toAppError(err));
    } finally {
      setPatBusy(false);
    }
  };

  const revokeOne = async (sessionId: string, current: boolean): Promise<void> => {
    setSessionBusy(sessionId);
    try {
      await revokeSession(sessionId);
      if (current) {
        await logout();
        navigate('/login', { replace: true });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      setPatError(toAppError(err));
    } finally {
      setSessionBusy(null);
    }
  };

  const revokeEverything = async (): Promise<void> => {
    setSessionBusy('all');
    try {
      await revokeAllSessions();
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setPatError(toAppError(err));
    } finally {
      setSessionBusy(null);
      setSignOutAllOpen(false);
    }
  };

  const exportData = async (): Promise<void> => {
    setPrivacyBusy('export');
    setPrivacyError(null);
    try {
      const blob = await exportAccount();
      downloadBlob(blob, 'repoverse-export.json');
    } catch (err) {
      setPrivacyError(toAppError(err));
    } finally {
      setPrivacyBusy(null);
    }
  };

  const removeAccount = async (): Promise<void> => {
    setPrivacyBusy('delete');
    setPrivacyError(null);
    try {
      await deleteAccount(deletePhrase.trim());
      await logout();
      queryClient.clear();
      navigate('/login', { replace: true });
    } catch (err) {
      setPrivacyError(toAppError(err));
    } finally {
      setPrivacyBusy(null);
      setDeleteOpen(false);
    }
  };

  const githubToken = me?.githubToken;
  const sessions = sessionsQuery.data ?? [];

  return (
    <div className="page settings-page">
      <header className="page__header">
        <div>
          <p className="page__eyebrow">Account</p>
          <h1>Settings</h1>
          <p className="page__lede">Profile, GitHub access, active sessions and data controls.</p>
        </div>
      </header>

      {patError ? (
        <ErrorNotice error={{ ...patError, message: friendlyMessage(patError) }} />
      ) : null}
      {patNotice ? (
        <div className="notice-bar" role="status">
          <Icon name="check" size={15} /> {patNotice}
        </div>
      ) : null}

      <div className="settings-grid">
        <Card title="Profile" subtitle="Who you are in RepoVerse.">
          {meQuery.isLoading && !me ? (
            <div className="loading-block loading-block--compact">
              <Spinner />
            </div>
          ) : me ? (
            <>
              <div className="profile">
                <span className="avatar avatar--lg" aria-hidden="true">
                  {me.name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase() ?? '')
                    .join('')}
                </span>
                <div>
                  <strong>{me.name}</strong>
                  <span>{me.email}</span>
                </div>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Member since</dt>
                  <dd>{formatDate(me.createdAt)}</dd>
                </div>
                <div>
                  <dt>User id</dt>
                  <dd>
                    <code>{me.id}</code>
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <EmptyState title="Profile unavailable" description="Reload the page to retry." />
          )}
        </Card>

        <Card
          title="GitHub access"
          subtitle="A read-only PAT unlocks private repositories and higher API limits."
        >
          <div className="token-status">
            {githubToken?.connected ? (
              <Badge tone="green" icon="check">
                connected {githubToken.hint ? `· ${githubToken.hint}` : ''}
              </Badge>
            ) : (
              <Badge tone="gray">not connected</Badge>
            )}
            {githubToken?.connected && githubToken.updatedAt ? (
              <span className="muted">updated {formatRelative(githubToken.updatedAt)}</span>
            ) : null}
          </div>

          {githubToken?.connected ? (
            <>
              {githubToken.scopes && githubToken.scopes.length > 0 ? (
                <p className="muted">
                  Scopes: {githubToken.scopes.join(', ')} — the token is encrypted at rest and never
                  returned to the browser.
                </p>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                loading={patBusy}
                onClick={() => void disconnectToken()}
              >
                Disconnect token
              </Button>
            </>
          ) : (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void connectToken();
              }}
            >
              <Field
                label="Personal access token"
                htmlFor="github-pat"
                hint="Needs public_repo (and repo for private repositories). Stored with AES-256-GCM."
                error={fieldError(patError, 'token')}
              >
                <Input
                  id="github-pat"
                  type="password"
                  placeholder="ghp_…"
                  autoComplete="off"
                  spellCheck={false}
                  value={pat}
                  onChange={(event) => setPat(event.target.value)}
                />
              </Field>
              <div className="inline-actions">
                <Button
                  type="submit"
                  variant="secondary"
                  icon="link"
                  loading={patBusy}
                  disabled={!pat.trim()}
                >
                  Connect token
                </Button>
                <a
                  className="link-button"
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Create a token <Icon name="external" size={12} />
                </a>
              </div>
            </form>
          )}
        </Card>

        <Card
          title="Appearance"
          subtitle="The map and dashboards support both themes."
          className="settings-card--wide"
        >
          <Toggle
            checked={theme === 'dark'}
            onChange={() => toggle()}
            label="Dark theme"
            description="Theme preference is stored locally; no repository data is persisted."
          />
        </Card>

        <Card
          title="Active sessions"
          subtitle="Refresh sessions are rotated on every use."
          className="settings-card--wide"
          actions={
            sessions.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                icon="logout"
                onClick={() => setSignOutAllOpen(true)}
              >
                Sign out everywhere
              </Button>
            ) : null
          }
        >
          {sessionsQuery.isLoading ? (
            <div className="loading-block loading-block--compact">
              <Spinner />
            </div>
          ) : sessionsQuery.error ? (
            <ErrorNotice
              error={{
                code: 'SESSIONS_UNAVAILABLE',
                message:
                  sessionsQuery.error instanceof Error
                    ? sessionsQuery.error.message
                    : 'Could not load sessions.',
              }}
              onRetry={() => void sessionsQuery.refetch()}
              compact
            />
          ) : sessions.length === 0 ? (
            <p className="muted">No active sessions.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="session-cell">
                          {session.current ? <Badge tone="green">current</Badge> : null}
                          <code>{session.id.slice(0, 8)}</code>
                          <span className="session-cell__ua">
                            {session.userAgent?.slice(0, 48) ?? 'unknown client'}
                          </span>
                        </div>
                      </td>
                      <td>{formatRelative(session.createdAt)}</td>
                      <td>{session.lastUsedAt ? formatRelative(session.lastUsedAt) : '—'}</td>
                      <td>{formatDate(session.expiresAt)}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={sessionBusy === session.id}
                          onClick={() => void revokeOne(session.id, session.current)}
                        >
                          {session.current ? 'Sign out' : 'Revoke'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Data & privacy"
          subtitle="Portability and erasure, on demand."
          className="settings-card--wide"
        >
          {privacyError ? <ErrorNotice error={privacyError} compact /> : null}
          <div className="privacy-row">
            <div>
              <strong>Export my data</strong>
              <p>
                Download a JSON archive of your profile, repositories, analyses, saved views and
                pins. Tokens, password hashes and refresh sessions are never included.
              </p>
            </div>
            <Button
              variant="secondary"
              icon="download"
              loading={privacyBusy === 'export'}
              onClick={() => void exportData()}
            >
              Export JSON
            </Button>
          </div>
          <div className="privacy-row privacy-row--danger">
            <div>
              <strong>Delete my account</strong>
              <p>
                Permanently deletes your account and every derived record — repositories, analyses,
                graph data, embeddings, AI cache, views and pins. This cannot be undone.
              </p>
            </div>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                setDeletePhrase('');
                setPrivacyError(null);
                setDeleteOpen(true);
              }}
            >
              Delete account
            </Button>
          </div>
        </Card>
      </div>

      <p className="settings-footnote">
        <Icon name="shield" size={14} /> Access tokens are held in memory only. Refresh tokens are
        HttpOnly, SameSite=Strict cookies scoped to the auth path. Ownership checks always return
        404, never 403.
      </p>

      <Modal
        open={signOutAllOpen}
        onClose={() => setSignOutAllOpen(false)}
        title="Sign out of every session?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSignOutAllOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="logout"
              loading={sessionBusy === 'all'}
              onClick={() => void revokeEverything()}
            >
              Sign out everywhere
            </Button>
          </>
        }
      >
        <p>
          Every refresh token for this account will be revoked, including this session. You will
          need to sign in again.
        </p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account permanently"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="trash"
              loading={privacyBusy === 'delete'}
              disabled={deletePhrase.trim() !== 'DELETE MY ACCOUNT'}
              onClick={() => void removeAccount()}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <p>
          This is irreversible. Type <code>DELETE MY ACCOUNT</code> to confirm.
        </p>
        <Input
          value={deletePhrase}
          autoFocus
          placeholder="DELETE MY ACCOUNT"
          onChange={(event) => setDeletePhrase(event.target.value)}
        />
        {privacyError ? <ErrorNotice error={privacyError} compact /> : null}
        <p className="muted">
          Current status: <StatusBadge status="failed" /> if the phrase is wrong, nothing is
          deleted.
        </p>
      </Modal>
    </div>
  );
}
