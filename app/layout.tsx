import type { Metadata } from 'next';
import '@fontsource-variable/outfit';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Briondo', template: '%s · Briondo' },
  description: 'Briondo – utbildningar som blir till handling.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
