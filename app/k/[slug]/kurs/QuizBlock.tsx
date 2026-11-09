'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { answerQuiz, type QuizResult } from '../../actions';

type Option = { id: string; text: string };

export function QuizBlock(props: {
  slug: string;
  blockId: string;
  index: number;
  total: number;
  question: string;
  multi: boolean;
  options: Option[];
  initial: { done: boolean; correct: boolean; selected: string[]; attemptsLeft: number; reveal: QuizResult['reveal'] };
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(props.initial.selected);
  const [result, setResult] = useState<QuizResult | null>(
    props.initial.done ? { correct: props.initial.correct, attemptsLeft: 0, reveal: props.initial.reveal } : null,
  );
  const [pending, start] = useTransition();
  const locked = !!result && (result.correct || result.attemptsLeft <= 0);

  const toggle = (id: string) => {
    if (locked) return;
    setResult((r) => (r && !r.correct && r.attemptsLeft > 0 ? null : r));
    setSelected((cur) => (props.multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  };

  const submit = () =>
    start(async () => {
      const r = await answerQuiz(props.slug, props.blockId, selected);
      setResult(r);
      router.refresh();
    });

  const name = `q-${props.blockId}`;
  return (
    <section className="quiz" aria-labelledby={`${name}-h`}>
      <div className="eyebrow">Kontrollfråga {props.index} av {props.total}</div>
      <h2 id={`${name}-h`} style={{ fontSize: 19 }}>{props.question}</h2>
      {props.multi && <p className="small muted" style={{ margin: 0 }}>Flera svar kan vara rätt.</p>}
      <div className="stack" style={{ gap: 10 }} role={props.multi ? 'group' : 'radiogroup'} aria-labelledby={`${name}-h`}>
        {props.options.map((o) => {
          const isSel = selected.includes(o.id);
          const isRight = result?.reveal?.correctIds.includes(o.id);
          const cls = result?.reveal ? (isRight ? 'right' : isSel ? 'wrong' : '') : result && isSel ? (result.correct ? 'right' : 'wrong') : '';
          return (
            <label key={o.id} className={`opt ${cls}`}>
              <input
                type={props.multi ? 'checkbox' : 'radio'}
                name={name}
                checked={isSel}
                disabled={locked}
                onChange={() => toggle(o.id)}
              />
              <span>{o.text}</span>
            </label>
          );
        })}
      </div>
      <div role="status" aria-live="polite">
        {result?.correct && <p className="notice" style={{ margin: 0 }}>Rätt svar!</p>}
        {result && !result.correct && result.attemptsLeft > 0 && (
          <p className="error" style={{ margin: 0 }}>
            Inte rätt. Du har {result.attemptsLeft} {result.attemptsLeft === 1 ? 'försök' : 'försök'} kvar.
          </p>
        )}
        {result && !result.correct && result.attemptsLeft <= 0 && (
          <p className="error" style={{ margin: 0 }}>Inte rätt, och inga försök kvar. Du kan gå vidare.</p>
        )}
        {result?.reveal?.explanation && <p className="tip" style={{ margin: '10px 0 0' }}>{result.reveal.explanation}</p>}
      </div>
      {!locked && (
        <div>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={pending || selected.length === 0}>
            {pending ? 'Kontrollerar…' : 'Svara'}
          </button>
        </div>
      )}
    </section>
  );
}
