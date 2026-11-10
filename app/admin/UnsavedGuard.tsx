'use client';

import { useEffect } from 'react';

// "Kom ihåg att spara": varnar när man lämnar en admin-sida med osparade ändringar
// (klick på länk, byte av avsnitt/flik, omladdning eller stängd flik).
// Ett formulär räknas som ändrat när något fält skiljer sig från värdet sidan laddades med,
// så ändrar man tillbaka försvinner varningen. Formulär med data-ingen-varning ignoreras.

const MESSAGE = 'Du har osparade ändringar. Vill du lämna sidan ändå? Ändringarna försvinner.';

// Webbläsaren gör om radbrytningar (\r\n → \n) och färgkoder (#B08D57 → #b08d57),
// så jämför normaliserat för att undvika falsklarm.
const norm = (s: string) => s.replace(/\r\n?/g, '\n');

function fieldChanged(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return norm(el.value) !== norm(el.defaultValue);
  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options);
    if (el.multiple) return opts.some((o) => o.selected !== o.defaultSelected);
    // Utan förvalt alternativ visar en rullista det första.
    const def = opts.findIndex((o) => o.defaultSelected);
    return el.selectedIndex !== (def === -1 ? 0 : def);
  }
  if (el instanceof HTMLInputElement && el.type === 'color') {
    return el.value.toLowerCase() !== el.defaultValue.toLowerCase();
  }
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'hidden': case 'submit': case 'button': case 'reset': case 'image':
        return false;
      case 'checkbox': case 'radio':
        return el.checked !== el.defaultChecked;
      case 'file':
        return (el.files?.length ?? 0) > 0;
      default:
        return el.value !== el.defaultValue;
    }
  }
  return false;
}

function hasUnsavedChanges(root: ParentNode, submitting: WeakSet<HTMLFormElement>): boolean {
  return Array.from(root.querySelectorAll('form')).some(
    (form) => !submitting.has(form) && !form.hasAttribute('data-ingen-varning') && Array.from(form.elements).some(fieldChanged),
  );
}

export function UnsavedGuard() {
  useEffect(() => {
    const root = document.querySelector('.admin-main') ?? document;
    // Formulär som just skickas ska inte räknas som osparade medan servern sparar.
    let submitting = new WeakSet<HTMLFormElement>();
    let clearTimer: ReturnType<typeof setTimeout> | undefined;

    const onSubmit = (e: Event) => {
      if (e.target instanceof HTMLFormElement) submitting.add(e.target);
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { submitting = new WeakSet(); }, 5000);
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges(root, submitting)) return;
      e.preventDefault();
      e.returnValue = MESSAGE;
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
      if (!hasUnsavedChanges(root, submitting)) return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      clearTimeout(clearTimer);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  return null;
}
