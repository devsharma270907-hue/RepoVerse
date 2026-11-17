import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, ErrorNotice, Field, Input } from '@/components/ui';
import { fieldError } from '@/lib/errors';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { registerSchema } from '@/features/auth/schemas';
import type { RegisterValues } from '@/features/auth/schemas';

export function RegisterPage() {
  const { register: registerUser, busy, error, clearError } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    clearError();
    try {
      await registerUser(values.name, values.email, values.password);
      navigate('/', { replace: true });
    } catch {
      // Provider error is rendered below.
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Analyze repositories, map dependencies and explore with AI."
      footer={
        <p>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error ? <ErrorNotice error={error} compact /> : null}

        <Field label="Name" htmlFor="name" error={errors.name?.message ?? fieldError(error, 'name')}>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            autoFocus
            {...register('name')}
          />
        </Field>

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
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters."
          error={errors.password?.message ?? fieldError(error, 'password')}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            {...register('password')}
          />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            {...register('confirmPassword')}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="auth-form__submit">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
