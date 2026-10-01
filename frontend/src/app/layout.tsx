import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/hooks/useTheme';
import { TAGLINE, THEME_STORAGE_KEY } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Datalens — Data Analysis',
  description: TAGLINE,
};

/**
 * Runs before first paint so the correct theme class is on <html> and there is
 * no flash. Kept tiny and dependency-free on purpose.
 */
const themeScript = `(function(){try{
var s=localStorage.getItem('${THEME_STORAGE_KEY}');
var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var c=document.documentElement.classList;c.remove('light','dark');c.add(t);
document.documentElement.style.colorScheme=t;
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // No className here on purpose: the pre-paint script owns it. A literal
    // class would be re-applied by React on hydration and undo the user's
    // stored preference. Dark is the :root default, so nothing is lost.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-[var(--color-page)] text-[var(--color-text)] antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
