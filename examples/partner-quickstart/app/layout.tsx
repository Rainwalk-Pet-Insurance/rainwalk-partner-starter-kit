import type { ReactNode } from 'react';
import './style.css';
export const metadata = { title: 'Rainwalk · Partner quickstart', description: 'Create your first sandbox quote with Partner API v1.' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
