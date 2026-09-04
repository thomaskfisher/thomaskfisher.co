/**
 * Shared UI chrome: top bar, controls, sheets, and the settings panel.
 * Framework-free — these games are state machines with a handful of controls,
 * and direct DOM keeps animation timing under our control.
 */

export const icons = {
  settings:
    '<svg viewBox="0 0 24 24"><path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4 10h10a5 5 0 0 1 0 10H9"/><path d="M4 10l4.5-4.5M4 10l4.5 4.5"/></svg>',
  restart:
    '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5V9h-5.5"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><path d="M9.5 18.5h5M10.5 21.5h3"/><path d="M12 2.5a6.2 6.2 0 0 0-3.6 11.2c.6.5 1 1.2 1 2v.3h5.2v-.3c0-.8.4-1.5 1-2A6.2 6.2 0 0 0 12 2.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** Applies a theme choice. 'system' leaves it to prefers-color-scheme. */
export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ */
/* Modal sheets                                                        */
/* ------------------------------------------------------------------ */

export interface Sheet {
  content: HTMLDivElement;
  close: () => void;
}

export function openSheet(
  build: (sheet: Sheet) => void,
  options: { dismissible?: boolean; onClose?: () => void } = {},
): Sheet {
  const { dismissible = true } = options;

  const overlay = el('div', { class: 'overlay' });
  const content = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  overlay.append(content);

  // Guarded because every dismissal path routes through here — the Done button,
  // the backdrop and Escape — and `onClose` resumes the clock. Resuming twice
  // would be harmless; resuming a clock the caller already stopped would not.
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    options.onClose?.();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && dismissible) close();
  };

  if (dismissible) {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
  }
  document.addEventListener('keydown', onKey);

  const sheet: Sheet = { content, close };
  build(sheet);
  document.body.append(overlay);
  content.querySelector<HTMLElement>('button, [tabindex]')?.focus();

  return sheet;
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function toggleRow(
  label: string,
  description: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLDivElement {
  const row = el('div', { class: 'sheet-row' });
  row.append(
    el(
      'div',
      { class: 'sheet-row-label' },
      `${label}<small>${description}</small>`,
    ),
  );

  const button = el('button', {
    class: 'switch',
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
  });

  let value = checked;
  button.addEventListener('click', () => {
    value = !value;
    button.setAttribute('aria-checked', String(value));
    onChange(value);
  });

  row.append(button);
  return row;
}

export function segmentedRow<T extends string>(
  label: string,
  description: string,
  options: { value: T; label: string }[],
  current: T,
  onChange: (value: T) => void,
): HTMLDivElement {
  const row = el('div', { class: 'sheet-row' });
  row.append(el('div', { class: 'sheet-row-label' }, `${label}<small>${description}</small>`));

  const group = el('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const option of options) {
    const button = el('button', {
      type: 'button',
      'aria-pressed': String(option.value === current),
    });
    button.textContent = option.label;
    button.addEventListener('click', () => {
      for (const sibling of group.children) sibling.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      onChange(option.value);
    });
    group.append(button);
  }

  row.append(group);
  return row;
}
