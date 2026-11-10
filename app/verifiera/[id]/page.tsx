import { getCertificate } from '@/lib/certificate';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cert = await getCertificate(decodeURIComponent(id).toUpperCase());
  const expired = cert?.valid_until && new Date(cert.valid_until) < new Date();
  return (
    <main className="center-page">
      <div className="card stack" style={{ maxWidth: 480, width: '100%' }}>
        <h1>Verifiering av certifikat</h1>
        {!cert ? (
          <p className="error" role="alert">Det finns inget certifikat med ID {id}.</p>
        ) : (
          <>
            <p className={expired || cert.is_test ? 'error' : 'notice'} role="status">
              {cert.is_test
                ? 'Detta är ett testcertifikat från en förhandsvisning och är inte giltigt.'
                : expired ? 'Certifikatet är äkta men har gått ut.' : 'Certifikatet är äkta och giltigt.'}
            </p>
            <dl className="stack" style={{ gap: 8, margin: 0 }}>
              <div><dt className="small muted">Namn</dt><dd style={{ margin: 0 }}>{cert.learner_name ?? 'Uppgiften har gallrats enligt dataskyddsregler'}</dd></div>
              <div><dt className="small muted">Utbildning</dt><dd style={{ margin: 0 }}>{cert.data.courseTitle}</dd></div>
              <div><dt className="small muted">Utfärdat av</dt><dd style={{ margin: 0 }}>{cert.data.customerName}</dd></div>
              <div><dt className="small muted">Datum</dt><dd style={{ margin: 0 }}>{new Date(cert.issued_at).toLocaleDateString('sv-SE')}</dd></div>
              {cert.valid_until && <div><dt className="small muted">Giltigt till</dt><dd style={{ margin: 0 }}>{new Date(cert.valid_until).toLocaleDateString('sv-SE')}</dd></div>}
              <div><dt className="small muted">Certifikat-ID</dt><dd style={{ margin: 0 }}>{cert.id}</dd></div>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
