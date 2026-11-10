'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// "Kom ihåg att spara" i admin.
//
// - Ett formulär räknas som ändrat när något fält skiljer sig från värdet sidan laddades med,
//   så ändrar man tillbaka försvinner markeringen. Formulär med data-ingen-varning ignoreras.
// - Ändrade fält markeras (data-andrad), formuläret får data-osparad och sparaknappen byter färg.
//   Efter sparning visar knappen "Sparat" en stund (data-status="sparat").
// - En list längst ned visar vad som inte är sparat; klick tar dig dit.
// - Lämnar man sidan via en länk med osparade ändringar visas en ruta som listar vad som går förlorat.
//   Vid omladdning eller stängd flik visas webbläsarens egen ruta. Bakåtknappen täcks inte.
// - Formulär namnges med data-namn, annars med sparaknappens text.

type Item = { id: number; label: string };

const norm = (s: string) => s.replace(/\r\n?/g, '\n');

function isEditable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type);
  return false;
}

function fieldChanged(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (el.disabled || ('readOnly' in el && el.readOnly)) return false;
  if (el instanceof HTMLTextAreaElement) return norm(el.value) !== norm(el.defaultValue);
  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options);
    if (el.multiple) return opts.some((o) => o.selected !== o.defaultSelected);
    const def = opts.findIndex((o) => o.defaultSelected);
    return el.selectedIndex !== (def === -1 ? 0 : def);
  }
  switch (el.type) {
    case 'checkbox': case 'radio': return el.checked !== el.defaultChecked;
    case 'file': return (el.files?.length ?? 0) > 0;
    case 'color': return el.value.toLowerCase() !== el.defaultValue.toLowerCase();
    default: return el.value !== el.defaultValue;
  }
}

// Återställ ett fält till värdet sidan laddades med.
function resetField(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (el instanceof HTMLSelectElement) {
    for (const o of Array.from(el.options)) o.selected = o.defaultSelected;
    if (!el.multiple && !Array.from(el.options).some((o) => o.defaultSelected)) el.selectedIndex = 0;
  } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    el.checked = el.defaultChecked;
  } else if (el instanceof HTMLInputElement && el.type === 'file') {
    el.value = '';
  } else {
    el.value = el.defaultValue;
  }
}

function formLabel(form: HTMLFormElement): string {
  if (form.dataset.namn) return form.dataset.namn;
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])');
  return btn?.textContent?.trim() || 'Formulär';
}

const pathOf = () => location.pathname + location.search;

export function UnsavedGuard() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const forms = useRef(new Map<number, HTMLFormElement>());
  const scanRef = useRef<() => HTMLFormElement[]>(() => []);
  const bypass = useRef(false);

  const goTo = useCallback((id: number) => {
    const form = forms.current.get(id);
    if (!form?.isConnected) return;
    let d = form.closest('details');
    while (d) { d.open = true; d = d.parentElement?.closest('details') ?? null; }
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const field = form.querySelector<HTMLElement>('[data-andrad]');
    field?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const root = document.querySelector('.admin-main') ?? document.body;
    const ids = new WeakMap<HTMLFormElement, number>();
    let nextId = 1;
    const saving = new Map<HTMLFormElement, ReturnType<typeof setTimeout>>();
    let lastPath = pathOf();
    let lastKey = '';

    const idOf = (f: HTMLFormElement) => {
      let id = ids.get(f);
      if (!id) { id = nextId++; ids.set(f, id); }
      return id;
    };

    // Går igenom alla formulär, markerar ändrade fält och returnerar formulär med osparade ändringar.
    const scan = (): HTMLFormElement[] => {
      // Efter byte av sida/avsnitt kan React återanvända ett fält som fortfarande visar förra sidans värde.
      // Användaren har inte hunnit skriva något på den nya sidan, så sådana fält återställs.
      const path = pathOf();
      const navigated = path !== lastPath;
      lastPath = path;

      const dirty: HTMLFormElement[] = [];
      for (const form of Array.from(root.querySelectorAll('form'))) {
        if (form.hasAttribute('data-ingen-varning')) continue;
        const fields = Array.from(form.elements).filter(isEditable);
        form.toggleAttribute('data-bevakad', fields.length > 0);
        let changed = false;
        for (const el of fields) {
          let c = fieldChanged(el);
          if (c && navigated && !saving.has(form)) { resetField(el); c = false; }
          el.toggleAttribute('data-andrad', c);
          changed ||= c;
        }
        const isDirty = changed && !saving.has(form);
        form.toggleAttribute('data-osparad', isDirty);
        if (isDirty) dirty.push(form);
      }
      for (const f of saving.keys()) if (!f.isConnected) { clearTimeout(saving.get(f)); saving.delete(f); }

      const next = dirty.map((f) => ({ id: idOf(f), label: formLabel(f) }));
      const key = next.map((i) => `${i.id}:${i.label}`).join('|');
      if (key !== lastKey) {
        lastKey = key;
        forms.current = new Map(dirty.map((f) => [idOf(f), f]));
        setItems(next);
      }
      return dirty;
    };
    scanRef.current = scan;

    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => scan()); };

    const markSaved = (form: HTMLFormElement) => {
      clearTimeout(saving.get(form));
      saving.delete(form);
      form.dataset.status = 'sparat';
      setAnnounce(`Sparat: ${formLabel(form)}`);
      setTimeout(() => { if (form.dataset.status === 'sparat') delete form.dataset.status; }, 2500);
      schedule();
    };

    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-bevakad')) return;
      form.dataset.status = 'sparar';
      clearTimeout(saving.get(form));
      // Om servern aldrig svarar: släpp efter 20 s så att varningen fungerar igen.
      saving.set(form, setTimeout(() => {
        saving.delete(form);
        if (form.dataset.status === 'sparar') delete form.dataset.status;
        schedule();
      }, 20000));
      schedule();
    };

    // React nollställer formuläret när servern har sparat.
    const onReset = (e: Event) => {
      const form = e.target;
      if (form instanceof HTMLFormElement && saving.has(form)) markSaved(form);
      else schedule();
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current || scan().length === 0) return;
      e.preventDefault();
      e.returnValue = 'Du har osparade ändringar.';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      // Länkar som öppnas i en annan flik (t.ex. förhandsvisning) lämnar inte sidan.
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      if (scan().length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setLeaveTo(url.href);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'checked', 'selected'] });
    // Next.js byter adress efter att den nya sidan ritats; fånga bytet även om inget mer ändras i sidan.
    const pathTimer = setInterval(() => { if (pathOf() !== lastPath) schedule(); }, 250);
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('reset', onReset, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    scan();
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(pathTimer);
      observer.disconnect();
      saving.forEach((t) => clearTimeout(t));
      document.removeEventListener('input', schedule, true);
      document.removeEventListener('change', schedule, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('reset', onReset, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (leaveTo && !d.open) d.showModal();
    if (!leaveTo && d.open) d.close();
  }, [leaveTo]);

  const stay = () => {
    setLeaveTo(null);
    if (items[0]) setTimeout(() => goTo(items[0].id), 50);
  };

  const leave = () => {
    const href = leaveTo;
    setLeaveTo(null);
    if (!href) return;
    // Ändringarna ska inte följa med till nästa sida.
    for (const f of forms.current.values()) {
      for (const el of Array.from(f.elements)) if (isEditable(el)) resetField(el);
    }
    scanRef.current();
    const url = new URL(href);
    if (url.origin === location.origin) {
      router.push(url.pathname + url.search + url.hash);
    } else {
      bypass.current = true;
      location.href = href;
    }
  };

  return (
    <>
      {items.length > 0 && (
        <div className="unsaved-bar" role="region" aria-label="Osparade ändringar">
          <span className="unsaved-bar-title"><span className="unsaved-dot" aria-hidden="true" />Inte sparat:</span>
          {items.map((i) => (
            <button key={i.id} type="button" className="unsaved-chip" onClick={() => goTo(i.id)}>{i.label}</button>
          ))}
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <dialog
        ref={dialogRef}
        className="unsaved-dialog"
        aria-labelledby="unsaved-title"
        onCancel={(e) => { e.preventDefault(); stay(); }}
      >
        <h2 id="unsaved-title">Du har osparade ändringar</h2>
        <p>Det här har du ändrat men inte sparat. Lämnar du sidan försvinner ändringarna.</p>
        <ul>
          {items.map((i) => <li key={i.id}>{i.label}</li>)}
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-danger" onClick={leave}>Lämna utan att spara</button>
          <button type="button" className="btn btn-primary" onClick={stay} autoFocus>Stanna kvar</button>
        </div>
      </dialog>
    </>
  );
}
