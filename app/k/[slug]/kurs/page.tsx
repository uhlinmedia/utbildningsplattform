import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { flatSections, getCourseBySlug, getCustomer, getStructure } from '@/lib/course';
import { getEnrollment } from '@/lib/learner';
import { loadProgress } from '@/lib/progress';
import { renderMarkdown } from '@/lib/markdown';
import { vimeoEmbedUrl } from '@/lib/vimeo';
import { youtubeEmbedUrl } from '@/lib/youtube';
import { completeSection, restartPreview } from '../../actions';
import { QuizBlock } from './QuizBlock';
import { VideoBlock } from './VideoBlock';
import { SlidesBlock } from './SlidesBlock';
import { AudioUnlock, SectionAudio } from './SectionAudio';
import { audioUrl } from '@/lib/audio';

export const dynamic = 'force-dynamic';

function Icon({ kind }: { kind: 'done' | 'current' | 'locked' | 'open' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'done') return <svg {...common} stroke="#1F7A3D"><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.8 2.8L16 10" /></svg>;
  if (kind === 'locked') return <svg {...common} stroke="#7A8491" strokeWidth={2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
  if (kind === 'current') return <svg {...common} stroke="currentColor"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>;
  return <svg {...common} stroke="#9AA3AE" strokeWidth={2}><circle cx="12" cy="12" r="10" /></svg>;
}

export default async function CoursePage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string; krav?: string }> }) {
  const { slug } = await params;
  const { s, krav } = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  const enrollment = await getEnrollment(course.id);
  if (!enrollment) redirect(`/k/${slug}`);
  const [customer, chapters] = await Promise.all([getCustomer(course.customer_id), getStructure(course.id)]);
  const progress = await loadProgress(course, chapters, enrollment.id);
  const flat = flatSections(chapters);
  if (flat.length === 0) {
    return <main className="center-page"><div className="card">Utbildningen har inget innehåll än.</div></main>;
  }

  const firstOpen = flat.find((x) => !progress.sections.get(x.id)?.completed && progress.sections.get(x.id)?.unlocked);
  let current = flat.find((x) => x.id === s);
  if (!current || !progress.sections.get(current.id)?.unlocked) {
    if (!firstOpen) redirect(`/k/${slug}/klar`);
    current = firstOpen;
  }
  const idx = flat.findIndex((x) => x.id === current!.id);
  const prev = flat[idx - 1];
  const state = progress.sections.get(current.id)!;
  const isLast = idx === flat.length - 1;
  const quizBlocks = current.blocks.filter((b) => b.type === 'quiz');
  const sweep = course.nav_mode === 'sweep';

  const menu = (
  <ol>
    {chapters.map((ch, ci) => (
      <li key={ch.id}>
        <div className="ch">{ci + 1}. {ch.title}</div>
        <ol>
          {ch.sections.map((se, si) => {
            const st = progress.sections.get(se.id)!;
            const active = se.id === current!.id;
            const kind = st.completed ? 'done' : active ? 'current' : st.unlocked ? 'open' : 'locked';
            const label = `${ci + 1}.${si + 1} ${se.title}`;
            const clickable = st.unlocked && !sweep && !active;
            return (
              <li key={se.id}>
                {clickable ? (
                  <Link href={`/k/${slug}/kurs?s=${se.id}`} className="sec"><Icon kind={kind} />{label}</Link>
                ) : (
                  <span className={`sec ${active ? 'active' : ''} ${kind === 'locked' ? 'locked' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon kind={kind} />{label}
                    {kind === 'locked' && <span className="sr-only"> (låst)</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </li>
    ))}
  </ol>
  );

  return (
    <div style={{ ['--brand' as string]: customer?.color }}>
      <header className="learn-top">
        {customer?.logo_media_id && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/media/${customer.logo_media_id}`} alt={customer.name} style={{ maxHeight: 36, width: 'auto' }} />
        )}
        <div className="title">{course.title}</div>
        <div className="progressbar" aria-label={`${progress.percentComplete} procent klart`}>
          <div className="track"><div className="fill" style={{ width: `${progress.percentComplete}%` }} /></div>
          <span>{progress.percentComplete} %</span>
        </div>
        <span className="small">{enrollment.name}{enrollment.is_preview && ' (förhandsvisning)'}</span>
        {enrollment.is_preview && (
          <form action={restartPreview}>
            <input type="hidden" name="slug" value={slug} />
            <button className="btn btn-sm" type="submit">Börja om</button>
          </form>
        )}
      </header>

      <div className="learn">
        <nav className="learn-nav" aria-label="Kapitel">
          <details className="nav-mobile">
            <summary>Kapitel och avsnitt · {progress.percentComplete} % klart</summary>
            {menu}
          </details>
          <div className="nav-desktop">{menu}</div>
          {course.nav_mode === 'linear' && (
            <p className="small muted" style={{ marginTop: 16 }}>Avsnitten låses upp i tur och ordning.</p>
          )}
        </nav>

        <main className="learn-main">
          <article className="learn-content">
            <div className="small muted">{current.chapterTitle} · Avsnitt {current.label}</div>
            <h1>{current.title}</h1>
            {course.audio_autoplay && <AudioUnlock />}

            {current.audio && audioUrl(current.audio.path) && (
              <SectionAudio
                key={current.id}
                sectionId={current.id}
                src={audioUrl(current.audio.path)!}
                durationS={current.audio.duration_s}
                autoplay={course.audio_autoplay}
              />
            )}

            {current.blocks.map((b) => {
              switch (b.type) {
                case 'text':
                  return <div key={b.id} className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.content.markdown) }} />;
                case 'tip':
                  return <p key={b.id} className="tip" style={{ margin: 0 }}>{b.content.text}</p>;
                case 'image':
                  return b.content.media_id ? (
                    <figure key={b.id} style={{ margin: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/media/${b.content.media_id}`} alt={b.content.alt ?? ''} style={{ borderRadius: 12 }} />
                      {b.content.caption && <figcaption className="small muted" style={{ marginTop: 6 }}>{b.content.caption}</figcaption>}
                    </figure>
                  ) : null;
                case 'video': {
                  const c = b.content;
                  const provider = c.vimeo_id ? 'vimeo' : c.youtube_id ? 'youtube' : null;
                  if (!provider) return null;
                  return (
                    <VideoBlock
                      key={b.id}
                      slug={slug}
                      blockId={b.id}
                      provider={provider}
                      src={provider === 'vimeo' ? vimeoEmbedUrl(c.vimeo_id!, c.vimeo_hash) : youtubeEmbedUrl(c.youtube_id!, process.env.APP_URL)}
                      title={c.title ?? ''}
                      required={c.required_percent ?? 0}
                      initialPercent={progress.videos.get(b.id) ?? 0}
                    />
                  );
                }
                case 'slides': {
                  const slides = b.content.slides ?? [];
                  if (slides.length === 0) return null;
                  return (
                    <SlidesBlock
                      key={b.id}
                      slug={slug}
                      blockId={b.id}
                      slides={slides.map((x) => ({ src: `/media/${x.media_id}`, alt: x.alt ?? '' }))}
                      title={b.content.title ?? ''}
                      caption={b.content.caption ?? ''}
                      requireAll={!!b.content.require_all}
                      initialPercent={progress.videos.get(b.id) ?? 0}
                    />
                  );
                }
                case 'quiz': {
                  const q = progress.quizzes.get(b.id);
                  const doneQ = !!q && (q.correct || q.exhausted);
                  return (
                    <QuizBlock
                      key={b.id}
                      slug={slug}
                      blockId={b.id}
                      index={quizBlocks.indexOf(b) + 1}
                      total={quizBlocks.length}
                      question={b.content.question}
                      multi={b.content.kind === 'multi'}
                      options={b.content.options.map((o) => ({ id: o.id, text: o.text }))}
                      initial={{
                        done: doneQ,
                        correct: !!q?.correct,
                        selected: q?.lastSelected ?? [],
                        attemptsLeft: q ? course.max_attempts - q.attempts : course.max_attempts,
                        reveal: doneQ && course.show_answers
                          ? { correctIds: b.content.options.filter((o) => o.correct).map((o) => o.id), explanation: b.content.explanation }
                          : null,
                      }}
                    />
                  );
                }
              }
            })}

            {krav && !state.requirementsMet && (
              <p className="error" role="alert">Svara på kontrollfrågorna, se videon och bläddra igenom bildspelet innan du går vidare.</p>
            )}

            <div className="pager">
              {prev && !sweep ? (
                <Link className="btn" href={`/k/${slug}/kurs?s=${prev.id}`}>← Föregående</Link>
              ) : <span />}
              <form action={completeSection}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="section_id" value={current.id} />
                <button className="btn btn-dark" type="submit" disabled={!state.requirementsMet}>
                  {isLast ? 'Avsluta utbildningen →' : 'Nästa →'}
                </button>
              </form>
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}
