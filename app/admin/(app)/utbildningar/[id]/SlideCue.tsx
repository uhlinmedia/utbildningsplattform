'use client';

import { useRef } from 'react';

// Tidsmarkering för en bild i ett bildspel: när speakerrösten når tiden visas bilden för eleven.
// "Sätt nu" hämtar tiden från avsnittets ljudspelare i editorn (spela upp och tryck när bilden ska bytas).

export function formatCue(s: number | undefined | null) {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '';
  const tenths = Math.round(s * 10);
  const m = Math.floor(tenths / 600);
  const sec = Math.floor((tenths % 600) / 10);
  const dec = tenths % 10;
  return `${m}:${String(sec).padStart(2, '0')}${dec ? `,${dec}` : ''}`;
}

function parse(v: string): number | null {
  const t = v.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

function editorAudio() {
  return document.querySelector<HTMLAudioElement>('audio[data-avsnittsljud]');
}

export function SlideCue({ index, at }: { index: number; at?: number }) {
  const input = useRef<HTMLInputElement>(null);

  function setNow() {
    const a = editorAudio();
    if (!a || !input.current) return;
    input.current.value = formatCue(Math.round(a.currentTime * 10) / 10);
    // Så att "Kom ihåg att spara" märker ändringen.
    input.current.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function listen() {
    const a = editorAudio();
    const t = parse(input.current?.value ?? '');
    if (!a || t === null) return;
    a.currentTime = Math.max(0, t - 1);
    a.play().catch(() => {});
  }

  return (
    <div className="slide-cue">
      <label className="small" htmlFor={`at_${index}`}>Visa vid</label>
      <input
        ref={input}
        id={`at_${index}`}
        type="text"
        name={`at_${index}`}
        inputMode="decimal"
        defaultValue={formatCue(at)}
        placeholder={index === 0 ? "0:00" : "m:ss"}
        aria-label={`Tid i speakerrösten då bild ${index + 1} visas`}
      />
      <button type="button" className="btn btn-sm" onClick={setNow} title="Hämta tiden där ljudet är just nu">Sätt nu</button>
      <button type="button" className="btn btn-sm" onClick={listen} aria-label={`Lyssna från bild ${index + 1}`} title="Spela upp från strax före markeringen">▶</button>
    </div>
  );
}
