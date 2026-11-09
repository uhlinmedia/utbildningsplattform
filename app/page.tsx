import Link from 'next/link';
import { Wordmark } from './Wordmark';

export default function Home() {
  return (
    <main className="center-page">
      <div className="card stack" style={{ maxWidth: 480, alignItems: 'flex-start' }}>
        <h1 style={{ margin: 0 }}><Wordmark size={44} /></h1>
        <p className="muted" style={{ margin: 0 }}>Har du fått en länk till en utbildning? Öppna den länken för att starta.</p>
        <Link href="/admin" className="small">Administratörsinloggning</Link>
      </div>
    </main>
  );
}
