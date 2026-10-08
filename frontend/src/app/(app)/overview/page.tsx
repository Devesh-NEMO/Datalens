import { redirect } from 'next/navigation';

/**
 * `/overview` is the URL the auth flow lands on by default (spec), while the
 * dashboard itself lives at `/` — its original, unchanged URL. This route makes
 * the landing target resolve without duplicating the dashboard (and without two
 * copies that remount — and lose state — every time one links to the other).
 */
export default function OverviewPage() {
  redirect('/');
}
