import { LoginForm } from '@/components/login-form';

/**
 * Sign-in.
 *
 * `?justRegistered` and `?next` are read here, on the server, and passed down as ordinary props.
 *
 * They used to be read inside the client component via `useSearchParams()`, wrapped in a
 * Suspense boundary. Because the route is statically prerendered, that combination caused Next
 * to bail the whole form out to client-side rendering: the shipped HTML contained only an empty
 * `<div aria-busy="true">`, so the primary sign-in screen was blank until hydration finished and
 * was completely blank with JavaScript disabled. Reading the params on the server renders the
 * complete form in the initial HTML.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = typeof query['next'] === 'string' ? query['next'] : null;
  const justRegistered = query['justRegistered'] === '1';

  return <LoginForm next={next} justRegistered={justRegistered} />;
}