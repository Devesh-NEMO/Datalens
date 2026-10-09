'use client';

import dynamic from 'next/dynamic';

/**
 * The 3D backdrop is code-split and never server-rendered (`ssr: false`), so
 * it cannot delay first paint or run during SSR. While its chunk loads, the
 * layout behind it already shows the CSS-only gradient + grid.
 *
 * `next/dynamic` with `ssr: false` must live in a Client Component, which is
 * why this wrapper exists (the `(auth)` layout stays a Server Component).
 */
const AuthBackground3D = dynamic(() => import('./AuthBackground3D'), {
  ssr: false,
  loading: () => null,
});

export default function AuthBackground() {
  return <AuthBackground3D />;
}