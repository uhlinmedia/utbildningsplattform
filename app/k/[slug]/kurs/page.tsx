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
import { isTooDark } from '@/lib/color';
import { imageSizes, isTall, type ImageSize } from '@/lib/image-size';
import type { Block } from '@/lib/types';
import { ImageZoom } from './ImageZoom';

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
  const sizes = await imageSizes(current.blocks.flatMap((b) => (b.type === 'image' && b.content.media_id ? [b.content.media_id] : [])));
  const groups = layoutBlocks(current.blocks, sizes);

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

  const renderBlock = (b: Block) => {
    switch (b.type) {
      case 'text':
        return <div key={b.id} className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.content.markdown) }} />;
      case 'tip':
        return <p key={b.id} className="tip" style={{ margin: 0 }}>{b.content.text}</p>;
      case 'image':
        return b.content.media_id ? <ImageFigure key={b.id} block={b} size={sizes.get(b.content.media_id) ?? null} sized /> : null;
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
            cues={current.audio && audioUrl(current.audio.path) ? slides.map((x) => (typeof x.at === 'number' ? x.at : null)) : undefined}
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
  };

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
                lightButton={isTooDark(customer?.color)}
              />
            )}

            {groups.map((g) => {
              if (g.kind === 'block') return renderBlock(g.block);
              // Bild bredvid texten (B50/B51). Smal innehållsyta (mobil, surfplatta på höjden): under varandra.
              const size = g.size;
              const chosen = g.image.content.size ?? 'auto';
              return (
                <div
                  key={g.image.id}
                  className={`media-split size-${chosen}${g.side === 'right' ? ' is-right' : ''}`}
                  style={size ? { ['--ar' as string]: (size.width / size.height).toFixed(4), ['--w' as string]: `${size.width}px` } : undefined}
                >
                  <ImageFigure block={g.image} size={size} />
                  <div className="media-split-text">{g.text.map(renderBlock)}</div>
                </div>
              );
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

type ImageBlock = Extract<Block, { type: 'image' }>;
type Group =
  | { kind: 'block'; block: Block }
  | { kind: 'split'; image: ImageBlock; size: ImageSize | null; side: 'left' | 'right'; text: Block[] };

// Bildblock: figur med bild som kan förstoras och ev. bildtext. sized = storleksklass för bild ovanför texten
// (bredvid texten styrs bredden av kolumnen i .media-split).
function ImageFigure({ block, size, sized = false }: { block: ImageBlock; size: ImageSize | null; sized?: boolean }) {
  const c = block.content;
  return (
    <figure className={`img-figure${sized ? ` size-${c.size ?? 'auto'}` : ''}`}>
      <ImageZoom src={`/media/${c.media_id}`} alt={c.alt ?? ''} width={size?.width} height={size?.height} />
      {c.caption && <figcaption className="small muted">{c.caption}</figcaption>}
    </figure>
  );
}

// Delar upp avsnittets block för visning. En bild placeras bredvid texten när redaktören valt vänster/höger, eller
// automatiskt när bilden är stående (B50). Texten är textblocken och tipsen direkt efter bilden, eller – om inga
// följer – de direkt före. Utan text i närheten, eller med "Ovanför texten", visas bilden som förut.
function layoutBlocks(blocks: Block[], sizes: Map<string, ImageSize | null>): Group[] {
  const isText = (b: Block | undefined) => !!b && (b.type === 'text' || b.type === 'tip');
  const out: Group[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'image' || !b.content.media_id) { out.push({ kind: 'block', block: b }); continue; }
    const size = sizes.get(b.content.media_id) ?? null;
    const layout = b.content.layout ?? 'auto';
    const side = layout === 'left' || layout === 'right' ? layout : layout === 'auto' && isTall(size) ? 'left' : null;
    if (!side) { out.push({ kind: 'block', block: b }); continue; }
    const text: Block[] = [];
    while (isText(blocks[i + 1])) text.push(blocks[++i]);
    if (text.length === 0) {
      // Texten före bilden: plocka tillbaka de närmast föregående text-/tipsblocken (inte sådana som redan står bredvid en bild).
      while (out.length && out[out.length - 1].kind === 'block' && isText((out[out.length - 1] as { block: Block }).block)) {
        text.unshift((out.pop() as { block: Block }).block);
      }
    }
    if (text.length === 0) out.push({ kind: 'block', block: b });
    else out.push({ kind: 'split', image: b, size, side, text });
  }
  return out;
}
