import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RedirectIfAuthed } from '@/components/RequireAuth';
import { AppShell } from '@/components/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { OAuthCallbackPage } from '@/pages/OAuthCallbackPage';
import { ReposPage } from '@/pages/ReposPage';
import { RepoPage } from '@/pages/RepoPage';
import { AnalysisWorkspacePage } from '@/pages/AnalysisWorkspacePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthed>
            <RegisterPage />
          </RedirectIfAuthed>
        }
      />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<ReposPage />} />
          <Route path="repos/:repoId" element={<RepoPage />} />
          <Route path="analyses/:analysisId" element={<AnalysisWorkspacePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
