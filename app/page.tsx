import Link from 'next/link';

export default function Home() {
  return (
    <main className="center-page">
      <div className="card stack" style={{ maxWidth: 480 }}>
        <h1>Utbildningsplattform</h1>
        <p className="muted">Har du fått en länk till en utbildning? Öppna den länken för att starta.</p>
        <Link href="/admin" className="small">Administratörsinloggning</Link>
      </div>
    </main>
  );
}
