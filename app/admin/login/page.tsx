import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { ADMIN_COOKIE, signAdminSession } from '@/lib/session';

// Används när kontot inte finns, så att inloggningen tar lika lång tid oavsett.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const [user] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from admin_user where email = ${email}`;
  // Jämför alltid mot en hash så att svarstiden inte avslöjar om kontot finns.
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) redirect('/admin/login?fel=1');
  const store = await cookies();
  store.set(ADMIN_COOKIE, await signAdminSession(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  redirect('/admin');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fel?: string }> }) {
  const { fel } = await searchParams;
  return (
    <main className="center-page">
      <form action={login} className="card stack" style={{ width: '100%', maxWidth: 400 }}>
        <h1>Logga in</h1>
        {fel && <p className="error" role="alert">Fel e-post eller lösenord.</p>}
        <label className="field">E-post<input type="email" name="email" autoComplete="username" required /></label>
        <label className="field">Lösenord<input type="password" name="password" autoComplete="current-password" required /></label>
        <button className="btn btn-primary" type="submit">Logga in</button>
      </form>
    </main>
  );
}
