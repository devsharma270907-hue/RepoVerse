import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, ErrorNotice, Field, Input } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { env } from '@/lib/env';
import { fieldError } from '@/lib/errors';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { loginSchema } from '@/features/auth/schemas';
import type { LoginValues } from '@/features/auth/schemas';

export function LoginPage() {
  const { login, busy, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    clearError();
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch {
      // The provider exposes the normalized error below the form.
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to open your repository maps."
      footer={
        <p>
          New to RepoVerse? <Link to="/register">Create an account</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error ? <ErrorNotice error={error} compact /> : null}

        <Field
          label="Email"
          htmlFor="email"
          error={errors.email?.message ?? fieldError(error, 'email')}
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            autoFocus
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message ?? fieldError(error, 'password')}
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            {...register('password')}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="auth-form__submit">
          Sign in
        </Button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <a className="btn btn--secondary btn--lg auth-oauth" href={`${env.apiBaseUrl}/api/v1/auth/google`}>
          <Icon name="google" size={17} />
          Continue with Google
        </a>
        <p className="auth-hint">
          Google sign-in is available when the server has OAuth credentials configured.
        </p>
      </form>
    </AuthLayout>
  );
}
