import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCourseById, getCustomer, getStructure } from '@/lib/course';
import type { Block } from '@/lib/types';
import {
  addBlock, addChapter, addSection, deleteCourse, deleteItem, moveItem, renameItem, setCourseStatus, updateBlock,
  updateCourseSettings,
} from '../../../actions';

export const dynamic = 'force-dynamic';

function MoveDelete({ table, id, label }: { table: 'chapter' | 'section' | 'block'; id: string; label: string }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <form action={moveItem} className="inline-form">
        <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="up" />
        <button className="btn btn-sm" type="submit" aria-label={`Flytta ${label} uppåt`}>↑</button>
      </form>
      <form action={moveItem} className="inline-form">
        <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="down" />
        <button className="btn btn-sm" type="submit" aria-label={`Flytta ${label} nedåt`}>↓</button>
      </form>
      <form action={deleteItem} className="inline-form">
        <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
        <button className="btn btn-sm btn-danger" type="submit" aria-label={`Ta bort ${label}`}>Ta bort</button>
      </form>
    </div>
  );
}

const typeLabel: Record<Block['type'], string> = {
  text: 'Text', tip: 'Tips-ruta', image: 'Bild', video: 'Video (Vimeo)', quiz: 'Kontrollfråga',
};

function BlockEditor({ block }: { block: Block }) {
  return (
    <div className="block-card">
      <div className="block-head">
        <span className="badge">{typeLabel[block.type]}</span>
        <MoveDelete table="block" id={block.id} label="blocket" />
      </div>
      <form action={updateBlock} className="block-body stack">
        <input type="hidden" name="id" value={block.id} />
        {block.type === 'text' && (
          <label className="field">Text
            <span className="hint"># Rubrik, **fet**, *kursiv*, - punktlista, [länktext](https://…)</span>
            <textarea name="markdown" defaultValue={block.content.markdown} rows={8} />
          </label>
        )}
        {block.type === 'tip' && (
          <label className="field">Tips-text<textarea name="text" defaultValue={block.content.text} rows={3} /></label>
        )}
        {block.type === 'image' && (
          <>
            {block.content.media_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/media/${block.content.media_id}`} alt="" style={{ maxHeight: 200, borderRadius: 8, alignSelf: 'flex-start' }} />
            )}
            <label className="field">{block.content.media_id ? 'Byt bild' : 'Välj bild'}
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" />
            </label>
            <label className="field">Alt-text (beskrivning för skärmläsare)<input type="text" name="alt" defaultValue={block.content.alt ?? ''} /></label>
            <label className="field">Bildtext (valfri)<input type="text" name="caption" defaultValue={block.content.caption ?? ''} /></label>
          </>
        )}
        {block.type === 'video' && (
          <>
            <label className="field">Vimeo-länk
              <span className="hint">Klistra in länken till videon, t.ex. https://vimeo.com/123456789</span>
              <input type="url" name="vimeo" defaultValue={block.content.vimeo_id ? `https://vimeo.com/${block.content.vimeo_id}${block.content.vimeo_hash ? '/' + block.content.vimeo_hash : ''}` : ''} />
            </label>
            <label className="field">Rubrik för skärmläsare<input type="text" name="title" defaultValue={block.content.title ?? ''} /></label>
            <label className="field">Måste ses till (%) innan eleven går vidare
              <span className="hint">0 = inget krav</span>
              <input type="number" name="required_percent" min={0} max={100} defaultValue={block.content.required_percent ?? 0} style={{ maxWidth: 120 }} />
            </label>
          </>
        )}
        {block.type === 'quiz' && (
          <>
            <label className="field">Fråga<input type="text" name="question" defaultValue={block.content.question} /></label>
            <label className="field">Typ
              <select name="kind" defaultValue={block.content.kind} style={{ maxWidth: 280 }}>
                <option value="single">Ett rätt svar (även sant/falskt)</option>
                <option value="multi">Flera rätta svar</option>
              </select>
            </label>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
              <legend className="small" style={{ fontWeight: 500, paddingBottom: 6 }}>Svarsalternativ – bocka i rätt svar, tomma rader ignoreras</legend>
              {Array.from({ length: 6 }, (_, i) => {
                const o = block.content.options[i];
                return (
                  <div key={i} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <label className="check" title="Rätt svar">
                      <input type="checkbox" name={`opt_correct_${i}`} defaultChecked={o?.correct} aria-label={`Alternativ ${i + 1} är rätt`} />
                    </label>
                    <input type="text" name={`opt_text_${i}`} defaultValue={o?.text ?? ''} aria-label={`Alternativ ${i + 1}`} placeholder={`Alternativ ${i + 1}`} />
                  </div>
                );
              })}
            </fieldset>
            <label className="field">Förklaring (visas efter svar, valfri)<input type="text" name="explanation" defaultValue={block.content.explanation ?? ''} /></label>
          </>
        )}
        <div><button className="btn btn-primary btn-sm" type="submit">Spara block</button></div>
      </form>
    </div>
  );
}

export default async function EditorPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string; flik?: string }> }) {
  const { id } = await params;
  const { s, flik } = await searchParams;
  const course = await getCourseById(id);
  if (!course) notFound();
  const customer = await getCustomer(course.customer_id);
  const chapters = await getStructure(id);
  const allSections = chapters.flatMap((c) => c.sections.map((x) => ({ ...x, chapter: c })));
  const current = allSections.find((x) => x.id === s) ?? allSections[0];
  const settingsTab = flik === 'installningar';

  return (
    <>
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <Link href={`/admin/kunder/${course.customer_id}`} className="small">← {customer?.name}</Link>
          <h1>{course.title} <span className={`badge ${course.status === 'published' ? 'badge-ok' : ''}`}>{course.status === 'published' ? 'Publicerad' : 'Utkast'}</span></h1>
        </div>
        <div className="row">
          <Link className="btn" href={`/k/${course.slug}?forhandsvisning=1`} target="_blank">Förhandsvisa som elev</Link>
          <Link className="btn" href={`/admin/utbildningar/${id}/statistik`}>Statistik &amp; dela</Link>
          <form action={setCourseStatus}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={course.status === 'published' ? 'draft' : 'published'} />
            <button className={`btn ${course.status === 'published' ? '' : 'btn-primary'}`} type="submit">
              {course.status === 'published' ? 'Avpublicera' : 'Publicera'}
            </button>
          </form>
        </div>
      </div>

      <nav className="row" aria-label="Flikar">
        <Link className={`btn btn-sm ${!settingsTab ? 'btn-dark' : ''}`} href={`/admin/utbildningar/${id}${current ? `?s=${current.id}` : ''}`}>Innehåll</Link>
        <Link className={`btn btn-sm ${settingsTab ? 'btn-dark' : ''}`} href={`/admin/utbildningar/${id}?flik=installningar`}>Inställningar</Link>
      </nav>

      {settingsTab ? (
        <section className="card">
          <form action={updateCourseSettings} className="stack" style={{ maxWidth: 620 }}>
            <input type="hidden" name="id" value={id} />
            <label className="field">Utbildningens namn<input type="text" name="title" defaultValue={course.title} required /></label>
            <label className="field">Introduktionstext på startsidan<textarea name="description" defaultValue={course.description} rows={3} /></label>
            <label className="field">Åtkomst för elev
              <select name="access_mode" defaultValue={course.access_mode}>
                <option value="name">Öppen länk + namn</option>
                <option value="name_email">Länk + namn + e-post</option>
              </select>
            </label>
            <label className="field">Navigering
              <select name="nav_mode" defaultValue={course.nav_mode}>
                <option value="free">Fritt – eleven väljer ordning</option>
                <option value="linear">Linjärt – avsnitt låses upp i tur och ordning</option>
                <option value="sweep">Ett svep – hela utbildningen i följd med Nästa</option>
              </select>
            </label>
            <div className="row">
              <label className="field">Godkäntgräns (% rätt)<input type="number" name="pass_percent" min={0} max={100} defaultValue={course.pass_percent} style={{ width: 140 }} /></label>
              <label className="field">Försök per fråga<input type="number" name="max_attempts" min={1} max={10} defaultValue={course.max_attempts} style={{ width: 140 }} /></label>
              <label className="field">Öppen till och med<input type="date" name="closes_at" defaultValue={course.closes_at ? String(course.closes_at).slice(0, 10) : ''} /></label>
            </div>
            <label className="check"><input type="checkbox" name="show_answers" defaultChecked={course.show_answers} />Visa rätt svar och förklaring när försöken är slut</label>
            <label className="check"><input type="checkbox" name="certificate_enabled" defaultChecked={course.certificate_enabled} />Utfärda certifikat vid godkänd utbildning</label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>Undertecknare på certifikat<input type="text" name="cert_signer" defaultValue={course.cert_signer} placeholder="Namn, titel" /></label>
              <label className="field">Giltighet (månader)<input type="number" name="cert_valid_months" min={0} defaultValue={course.cert_valid_months ?? ''} placeholder="Ingen" style={{ width: 140 }} /></label>
            </div>
            <div><button className="btn btn-primary" type="submit">Spara inställningar</button></div>
          </form>
          <details style={{ marginTop: 28 }}>
            <summary className="btn-danger">Radera utbildningen</summary>
            <form action={deleteCourse} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={id} />
              <label className="field">Skriv RADERA för att bekräfta – all elevdata för utbildningen tas också bort
                <input type="text" name="confirm" style={{ maxWidth: 200 }} />
              </label>
              <button className="btn btn-danger" type="submit">Radera</button>
            </form>
          </details>
        </section>
      ) : (
        <div className="editor">
          <aside className="editor-tree card stack" aria-label="Struktur" style={{ gap: 10 }}>
            {chapters.map((ch, ci) => (
              <div key={ch.id} className="stack" style={{ gap: 4 }}>
                <details>
                  <summary className="tree-ch">{ci + 1}. {ch.title}</summary>
                  <div className="stack" style={{ gap: 8, padding: '8px 0' }}>
                    <form action={renameItem} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <input type="hidden" name="table" value="chapter" /><input type="hidden" name="id" value={ch.id} />
                      <input type="text" name="title" defaultValue={ch.title} aria-label="Kapitlets namn" />
                      <button className="btn btn-sm" type="submit">Spara</button>
                    </form>
                    <MoveDelete table="chapter" id={ch.id} label="kapitlet" />
                  </div>
                </details>
                {ch.sections.map((se, si) => (
                  <Link key={se.id} href={`/admin/utbildningar/${id}?s=${se.id}`} className={`tree-sec ${current?.id === se.id ? 'active' : ''}`}>
                    {ci + 1}.{si + 1} {se.title}
                  </Link>
                ))}
                <form action={addSection}>
                  <input type="hidden" name="chapter_id" value={ch.id} />
                  <button className="btn-link small" type="submit" style={{ marginLeft: 24 }}>+ Avsnitt</button>
                </form>
              </div>
            ))}
            <form action={addChapter}>
              <input type="hidden" name="course_id" value={id} />
              <button className="btn btn-sm" type="submit" style={{ width: '100%' }}>+ Kapitel</button>
            </form>
          </aside>

          <section className="editor-main stack">
            {current ? (
              <>
                <div className="card stack" style={{ gap: 10 }}>
                  <span className="small muted">Kapitel: {current.chapter.title}</span>
                  <form action={renameItem} className="row" style={{ flexWrap: 'nowrap' }}>
                    <input type="hidden" name="table" value="section" /><input type="hidden" name="id" value={current.id} />
                    <input type="text" name="title" defaultValue={current.title} aria-label="Avsnittets rubrik" style={{ fontSize: 20, fontWeight: 600 }} />
                    <button className="btn btn-sm" type="submit">Spara rubrik</button>
                  </form>
                  <MoveDelete table="section" id={current.id} label="avsnittet" />
                </div>
                {current.blocks.map((b) => <BlockEditor key={b.id} block={b} />)}
                <div className="card stack" style={{ borderStyle: 'dashed', gap: 10 }}>
                  <span className="small muted">Lägg till block</span>
                  <div className="row" style={{ gap: 8 }}>
                    {(['text', 'image', 'video', 'tip', 'quiz'] as const).map((t) => (
                      <form key={t} action={addBlock}>
                        <input type="hidden" name="section_id" value={current.id} /><input type="hidden" name="type" value={t} />
                        <button className="btn btn-sm" type="submit">{typeLabel[t]}</button>
                      </form>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="card muted">Lägg till ett kapitel för att börja.</div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
