import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

/**
 * Sign-in is a client page because it reads `?justRegistered` and `?next`. Reading search
 * params during prerendering requires a Suspense boundary, so the shell stays a server
 * component and only the form itself is dynamic.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="nx-shell nx-shell--narrow py-20" aria-busy="true" />}>
      <LoginForm />
    </Suspense>
  );
}