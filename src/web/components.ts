/** @fileoverview Visual building blocks shared by the views. */

import type {TaskStatus} from '../shared/types.ts';
import type {IconName} from './dom.ts';
import {cx, h, icon} from './dom.ts';
import {initials} from './format.ts';

/** A white surface with a hairline border, without padding. */
export const SURFACE = cx(
  'rounded-3xl bg-white shadow-sm ring-1 ring-stone-200/80',
  'dark:bg-stone-900 dark:ring-stone-800',
);

/** A padded surface. */
export const CARD = cx(SURFACE, 'p-5');

export const MUTED = 'text-stone-500 dark:text-stone-400';

/** Page heading, scaling with the screen. */
export const PAGE_TITLE =
  'text-[clamp(1.75rem,7vw,2.25rem)] font-extrabold tracking-tight';

const BUTTON_BASE = cx(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5',
  'font-semibold transition active:scale-[0.98]',
  'disabled:pointer-events-none disabled:opacity-60',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-emerald-500',
);

const BUTTON_VARIANTS = {
  /** The main action on a neutral surface. */
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
  /** The main action on the coloured hero card. */
  inverse: 'bg-white text-emerald-700 shadow-sm hover:bg-emerald-50',
  /** A secondary action on the coloured hero card. */
  glass: 'bg-white/15 text-white hover:bg-white/25',
  soft: cx(
    'bg-stone-100 text-stone-800 hover:bg-stone-200',
    'dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
  ),
  ghost: cx(
    'text-stone-600 hover:bg-stone-100',
    'dark:text-stone-300 dark:hover:bg-stone-800',
  ),
  danger: cx(
    'bg-red-50 text-red-700 hover:bg-red-100',
    'dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
  ),
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export interface ButtonOptions {
  readonly variant?: ButtonVariant;
  readonly onclick: () => void;
  readonly busy?: boolean;
  readonly icon?: IconName;
  /** Stretches to the full width of the container. Defaults to true. */
  readonly block?: boolean;
  readonly large?: boolean;
}

export function spinner(): HTMLElement {
  return h('span', {
    class: cx(
      'size-5 animate-spin rounded-full border-2 border-current',
      'border-t-transparent',
    ),
    'aria-hidden': 'true',
  });
}

export function button(label: string, options: ButtonOptions): HTMLElement {
  return h(
    'button',
    {
      type: 'button',
      class: cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[options.variant ?? 'primary'],
        options.block !== false && 'w-full',
        options.large ? 'py-4 text-lg' : 'py-3',
      ),
      disabled: options.busy,
      onclick: options.onclick,
    },
    options.busy ? spinner() : options.icon && icon(options.icon, 'size-5'),
    label,
  );
}

/** One colour per person, so the rotation is readable at a glance. */
const PERSON_COLORS = [
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
  'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
  'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-200',
];

export function personColor(person: string, people: readonly string[]): string {
  const index = Math.max(0, people.indexOf(person));
  return PERSON_COLORS[index % PERSON_COLORS.length];
}

export function avatar(
  person: string,
  people: readonly string[],
  size = 'size-10 text-sm',
): HTMLElement {
  return h(
    'span',
    {
      class: cx(
        'grid shrink-0 place-items-center rounded-full font-bold',
        size,
        personColor(person, people),
      ),
      'aria-hidden': 'true',
    },
    initials(person),
  );
}

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  pending: 'Do zrobienia',
  acknowledged: 'Przyjęte',
  done: 'Zrobione',
};

const STATUS_STYLES: Readonly<Record<TaskStatus, string>> = {
  pending: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
  acknowledged: cx(
    'bg-amber-100 text-amber-900',
    'dark:bg-amber-500/20 dark:text-amber-200',
  ),
  done: cx(
    'bg-emerald-100 text-emerald-800',
    'dark:bg-emerald-500/20 dark:text-emerald-200',
  ),
};

/** The status as text; colour only supports it. */
export function statusPill(status: TaskStatus): HTMLElement {
  return h(
    'span',
    {
      class: cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1',
        'text-xs font-semibold',
        STATUS_STYLES[status],
      ),
    },
    status === 'done' && icon('check', 'size-3.5'),
    STATUS_LABELS[status],
  );
}

export type BannerTone = 'warning' | 'info';

const BANNER_TONES: Readonly<Record<BannerTone, string>> = {
  warning: cx(
    'bg-amber-50 text-amber-900 ring-amber-200',
    'dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30',
  ),
  info: cx(
    'bg-white text-stone-700 ring-stone-200',
    'dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-800',
  ),
};

export function banner(
  tone: BannerTone,
  text: string,
  action?: HTMLElement,
): HTMLElement {
  return h(
    'div',
    {
      class: cx(
        'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1',
        BANNER_TONES[tone],
      ),
      role: 'status',
    },
    h('p', {class: 'flex-1'}, text),
    action,
  );
}

export function sectionTitle(text: string): HTMLElement {
  return h(
    'h2',
    {
      class: cx('px-1 text-sm font-semibold uppercase tracking-wide', MUTED),
    },
    text,
  );
}

export interface ConfirmOptions {
  readonly title: string;
  readonly text: string;
  readonly confirmLabel: string;
}

/** Asks a yes/no question in a native modal dialog. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = h('dialog', {
      class: cx(
        'm-auto w-[min(92vw,24rem)] rounded-3xl bg-white p-6 text-stone-900',
        'shadow-2xl dark:bg-stone-900 dark:text-stone-100',
      ),
    });
    const close = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    dialog.append(
      h('h2', {class: 'text-xl font-bold tracking-tight'}, options.title),
      h('p', {class: cx('mt-2', MUTED)}, options.text),
      h(
        'div',
        {class: 'mt-6 grid grid-cols-2 gap-3'},
        button('Anuluj', {variant: 'soft', onclick: () => close(false)}),
        button(options.confirmLabel, {onclick: () => close(true)}),
      ),
    );
    dialog.addEventListener('cancel', () => close(false));
    document.body.append(dialog);
    dialog.showModal();
  });
}
