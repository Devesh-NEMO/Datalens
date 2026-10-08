import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/AuthGate';
import { AppShell } from '@/components/shell/AppShell';

/**
 * Dashboard shell: `AuthGate` outside, chrome inside. The gate wraps the whole
 * shell (not just the page) so neither the sidebar nor the topbar flashes for a
 * visitor who is about to be redirected to /login.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
