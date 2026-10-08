'use client';

/**
 * The app-wide provider stack: RootLayout → ThemeProvider → QueryClientProvider
 * → AuthProvider → app. One theme system, one query client, one auth module —
 * nothing here may be duplicated further down the tree.
 */

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/hooks/useTheme';
import { AuthProvider } from '@/hooks/useAuth';

export function Providers({ children }: { children: ReactNode }) {
  // Created once per app load, in the client, so no query cache is ever shared
  // between server requests.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
