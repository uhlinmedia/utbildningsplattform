import Link from 'next/link';
import { can, type User } from '@/lib/access';

// Rubrik och flikar för en kund. Flikar visas efter behörighet.
export function CustomerHeader({ user, customer, active }: {
  user: User; customer: { id: string; name: string }; active: 'utbildningar' | 'personer' | 'anvandare' | 'logg' | 'profil';
}) {
  const base = `/admin/kunder/${customer.id}`;
  const tabs: { key: typeof active; href: string; label: string; show: boolean }[] = [
    { key: 'utbildningar', href: base, label: 'Utbildningar', show: true },
    { key: 'personer', href: `${base}/personer`, label: 'Personregister', show: true },
    { key: 'anvandare', href: `${base}/anvandare`, label: 'Användare', show: can(user, customer.id, 'admin') },
    { key: 'logg', href: `${base}/logg`, label: 'Ändringslogg', show: can(user, customer.id, 'admin') },
  ];
  return (
    <div className="stack" style={{ gap: 10 }}>
      {user.role === 'superadmin' && <Link href="/admin" className="small">← Kunder</Link>}
      <h1>{customer.name}</h1>
      <nav className="tabs" aria-label="Kund">
        {tabs.filter((t) => t.show).map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === active ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>
    </div>
  );
}
