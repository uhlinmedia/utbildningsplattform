'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
import { audit, authorize, authorizeRole, roleLabel, sessionUser, type Role, type User } from '@/lib/access';
import { createUserToken } from '@/lib/users';
import { appUrl, mailConfigured, mailTemplate, sendMail } from '@/lib/mail';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const CUSTOMER_ROLES: Role[] = ['kundadmin', 'utbildare', 'granskare'];
const back = (customerId: string | null, q = '') => (customerId ? `/admin/kunder/${customerId}/anvandare` : '/admin/anvandare') + q;

// Utan e-postinställningar (eller om utskicket misslyckas) visas länken i stället, så att den kan skickas manuellt.
// Länken läggs i en kortlivad kaka – inte i adressen, där den skulle hamna i loggar.
async function showLink(url: string) {
  (await cookies()).set('flash_link', url, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/admin', maxAge: 300 });
}

async function sendInvite(actor: User, target: { id: string; email: string; role: Role; customer_id: string | null }): Promise<boolean> {
  const token = await createUserToken(target.id, 'invite');
  const url = appUrl(`/admin/inbjudan/${token}`);
  if (!mailConfigured()) { await showLink(url); return false; }
  const [c] = target.customer_id ? await sql<{ name: string; color: string }[]>`select name, color from customer where id = ${target.customer_id}` : [];
  try { await sendMail(mailTemplate({
    to: target.email,
    subject: c ? `Inbjudan till ${c.name} i Briondo` : 'Inbjudan till Briondo',
    heading: c ? `Du är inbjuden till ${c.name} i Briondo` : 'Du är inbjuden till Briondo',
    paragraphs: [
      `${actor.name || actor.email} har bjudit in dig som ${roleLabel[target.role].toLowerCase()}. I Briondo skapar och följer ni upp webbutbildningar.`,
      'Klicka på knappen för att välja lösenord. Därefter aktiverar du tvåstegsverifiering med en app i telefonen (t.ex. Microsoft Authenticator). Länken gäller i 7 dagar.',
    ],
    button: { label: 'Skapa ditt konto', url },
    footer: 'Väntade du dig inte den här inbjudan kan du strunta i mejlet.',
    brand: c?.color,
  })); } catch (e) {
    console.error('inbjudan', e);
    await showLink(url);
    return false;
  }
  return true;
}

// Kundanvändare bjuds in till en kund; superadmin (Briondo) bjuds in utan kund.
export async function inviteUser(fd: FormData) {
  const customerId = s(fd, 'customer_id') || null;
  const actor = customerId ? (await authorize('customer', customerId, 'admin')).user : await authorizeRole('super');
  const email = s(fd, 'email').toLowerCase();
  const name = s(fd, 'name').slice(0, 120);
  const role = (customerId ? (CUSTOMER_ROLES.includes(s(fd, 'role') as Role) ? s(fd, 'role') : 'utbildare') : 'superadmin') as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(back(customerId, '?fel=epost'));
  const [exists] = await sql`select 1 from admin_user where lower(email) = ${email}`;
  if (exists) redirect(back(customerId, '?fel=finns'));
  const [u] = await sql<{ id: string }[]>`
    insert into admin_user (email, name, role, customer_id, password_hash, invited_by)
    values (${email}, ${name}, ${role}, ${customerId}, null, ${actor.id}) returning id`;
  const sent = await sendInvite(actor, { id: u.id, email, role, customer_id: customerId });
  await audit(actor, customerId, 'anvandare_inbjuden', { email, role });
  revalidatePath('/admin', 'layout');
  redirect(back(customerId, `?${sent ? 'inbjuden' : 'lank'}=${encodeURIComponent(email)}`));
}

async function target(fd: FormData) {
  const id = s(fd, 'user_id');
  const me = await sessionUser();
  if (!me) redirect('/admin/login');
  const [t] = await sql<{ id: string; email: string; role: Role; customer_id: string | null; password_hash: string | null }[]>`
    select id, email, role, customer_id, password_hash from admin_user where id = ${id}`;
  if (!t) throw new Error('Användaren finns inte');
  const actor = t.customer_id ? (await authorize('customer', t.customer_id, 'admin')).user : await authorizeRole('super');
  return { actor, t, self: t.id === actor.id };
}

export async function resendInvite(fd: FormData) {
  const { actor, t } = await target(fd);
  if (t.password_hash) redirect(back(t.customer_id));
  const sent = await sendInvite(actor, t);
  await audit(actor, t.customer_id, 'inbjudan_skickad_igen', { email: t.email });
  redirect(back(t.customer_id, `?${sent ? 'inbjuden' : 'lank'}=${encodeURIComponent(t.email)}`));
}

export async function changeRole(fd: FormData) {
  const { actor, t, self } = await target(fd);
  const role = s(fd, 'role') as Role;
  if (self || !t.customer_id || !CUSTOMER_ROLES.includes(role) || role === t.role) redirect(back(t.customer_id));
  await sql`update admin_user set role = ${role} where id = ${t.id}`;
  await audit(actor, t.customer_id, 'anvandare_roll', { email: t.email, from: t.role, to: role });
  revalidatePath('/admin', 'layout');
  redirect(back(t.customer_id));
}

// Avstängd: kan inte logga in, alla sessioner upphör direkt.
export async function setDisabled(fd: FormData) {
  const { actor, t, self } = await target(fd);
  if (self) redirect(back(t.customer_id));
  const disabled = s(fd, 'disabled') === '1';
  await sql`update admin_user set disabled = ${disabled}, session_version = session_version + 1 where id = ${t.id}`;
  await audit(actor, t.customer_id, disabled ? 'anvandare_avstangd' : 'anvandare_aktiverad', { email: t.email });
  revalidatePath('/admin', 'layout');
  redirect(back(t.customer_id));
}

// Ny telefon eller förlorade reservkoder: användaren aktiverar tvåstegsverifiering igen vid nästa inloggning.
export async function resetTotp(fd: FormData) {
  const { actor, t, self } = await target(fd);
  if (self) redirect(back(t.customer_id));
  await sql`update admin_user set totp_enabled = false, totp_secret = null, recovery_codes = '{}',
    session_version = session_version + 1 where id = ${t.id}`;
  await audit(actor, t.customer_id, 'tvasteg_nollstalld', { email: t.email });
  redirect(back(t.customer_id, `?nollstalld=${encodeURIComponent(t.email)}`));
}

export async function deleteUser(fd: FormData) {
  const { actor, t, self } = await target(fd);
  if (self) redirect(back(t.customer_id));
  if (s(fd, 'confirm') !== 'TA BORT') redirect(back(t.customer_id));
  await sql`delete from admin_user where id = ${t.id}`;
  await audit(actor, t.customer_id, 'anvandare_borttagen', { email: t.email });
  revalidatePath('/admin', 'layout');
  redirect(back(t.customer_id));
}
