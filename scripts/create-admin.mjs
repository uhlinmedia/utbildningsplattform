// Skapar eller uppdaterar superadmin: node scripts/create-admin.mjs epost@exempel.se "lösenord"
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error('Användning: node scripts/create-admin.mjs <e-post> <lösenord, minst 12 tecken>');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL);
const hash = await bcrypt.hash(password, 12);
await sql`insert into admin_user (email, password_hash) values (${email.toLowerCase()}, ${hash})
  on conflict (email) do update set password_hash = excluded.password_hash`;
await sql.end();
console.log('Superadmin klar:', email);
