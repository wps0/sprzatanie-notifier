/** @fileoverview "Ten tydzień": my task, everyone's progress, next week. */

import type {
  AppState,
  Task,
  TaskStatus,
  TaskStatusEntry,
  Week,
} from '../../shared/types.ts';
import type {Model} from '../app.ts';
import {enableNotifications, refreshSheet, setTaskStatus} from '../app.ts';
import {
  avatar,
  banner,
  button,
  CARD,
  confirmDialog,
  MUTED,
  PAGE_TITLE,
  sectionTitle,
  statusPill,
  SURFACE,
} from '../components.ts';
import {cx, h, icon} from '../dom.ts';
import {
  animate,
  doneKey,
  GROW_MS,
  POP_MS,
  progressOf,
  trigger,
} from '../motion.ts';
import {
  capitalize,
  formatDeadline,
  formatTimestamp,
  formatWeekRange,
} from '../format.ts';

function currentWeek(state: AppState): Week | undefined {
  return state.schedule.weeks.find(
    week => week.start <= state.today && state.today <= week.end,
  );
}

function entryFor(
  state: AppState,
  week: Week,
  task: Task,
): TaskStatusEntry | undefined {
  return state.statuses.find(
    entry => entry.weekStart === week.start && entry.taskKey === task.key,
  );
}

function tasksOf(state: AppState, week: Week, person: string): Task[] {
  return state.schedule.tasks.filter(
    (task, index) => !task.free && week.assignees[index] === person,
  );
}

const HERO_BASE = cx(
  'relative overflow-hidden rounded-[2rem] p-5 shadow-lg',
  'min-[400px]:p-6 lg:p-8',
);

const HERO_TONES: Readonly<Record<TaskStatus, string>> = {
  pending: cx(
    'bg-linear-to-br from-emerald-500 to-teal-700 text-white',
    'shadow-emerald-700/25',
  ),
  acknowledged: cx(
    'bg-linear-to-br from-stone-700 to-stone-900 text-white',
    'shadow-stone-900/25',
  ),
  done: cx(
    'bg-white text-stone-900 shadow-stone-900/5 ring-1 ring-stone-200/80',
    'dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-800',
  ),
};

/** A soft decorative glow in the corner of the hero card. */
function glow(): HTMLElement {
  return h('span', {
    class: cx(
      'pointer-events-none absolute -right-10 -top-14 size-48 rounded-full',
      'bg-white/15 blur-2xl',
    ),
    'aria-hidden': 'true',
  });
}

/**
 * Lets a card morph into its new state when a task status changes. The name
 * takes effect only during status transitions (see style.css), so on screen
 * changes the card moves with the rest of the page.
 */
function morphs(element: HTMLElement, name: string): void {
  element.dataset['morph'] = '';
  element.style.setProperty('--morph-name', name);
}

/** What the progress bar shows and where it is heading. */
let progressBar = {from: 0, to: 0};

/** Approximates the `grow` timing curve, to know where the bar is now. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Sizes the bar; a new value animates from wherever the bar is. */
function growTo(fill: HTMLElement, percent: number): void {
  if (percent !== progressBar.to) {
    const running = progressOf('progress', GROW_MS);
    const current =
      running === null
        ? progressBar.to
        : progressBar.from +
          (progressBar.to - progressBar.from) * easeOut(running);
    progressBar = {from: current, to: percent};
    trigger('progress');
  }
  fill.style.width = `${percent}%`;
  fill.style.setProperty('--from', `${progressBar.from}%`);
  fill.style.setProperty('--to', `${percent}%`);
  animate(fill, 'progress', 'motion-safe:animate-grow', GROW_MS);
}

function heroCard(model: Model, state: AppState, week: Week, task: Task) {
  const status: TaskStatus = entryFor(state, week, task)?.status ?? 'pending';
  const busy = model.busy.has(`status:${task.key}`);
  const set = (next: TaskStatus) =>
    void setTaskStatus(week.start, task.key, next);
  const onColor = status !== 'done';

  const actions: HTMLElement[] = [];
  if (status === 'done') {
    actions.push(
      button('Cofnij', {variant: 'soft', busy, onclick: () => set('pending')}),
    );
  } else {
    actions.push(
      button('Zrobione', {
        variant: 'inverse',
        large: true,
        icon: 'check',
        busy,
        onclick: () => set('done'),
      }),
    );
    actions.push(
      status === 'pending'
        ? button('Pamiętam', {
            variant: 'glass',
            icon: 'bellOff',
            onclick: () => set('acknowledged'),
          })
        : button('Przypominaj dalej', {
            variant: 'glass',
            icon: 'bell',
            onclick: () => set('pending'),
          }),
    );
  }

  const overline =
    status === 'done'
      ? 'Zrobione w tym tygodniu'
      : status === 'acknowledged'
        ? 'Przyjęte — przypomnienia wyciszone'
        : 'Twoje zadanie w tym tygodniu';

  const check = status === 'done' && icon('check', 'size-5');
  if (check) {
    animate(
      check,
      doneKey(week.start, task.key),
      'motion-safe:animate-pop',
      POP_MS,
    );
  }
  const card = h(
    'section',
    {class: cx(HERO_BASE, HERO_TONES[status])},
    onColor && glow(),
    h(
      'div',
      {class: 'relative'},
      h(
        'p',
        {
          class: cx(
            'flex items-center gap-2 text-sm font-semibold',
            onColor ? 'text-white/80' : 'text-emerald-600',
          ),
        },
        check,
        overline,
      ),
      h(
        'h2',
        {
          class: cx(
            'mt-2 text-[clamp(2rem,9vw,3rem)] leading-tight font-extrabold',
            'tracking-tight text-balance',
          ),
        },
        capitalize(task.title),
      ),
      task.details &&
        h(
          'p',
          {
            class: cx(
              'mt-2 text-lg leading-snug text-pretty',
              onColor ? 'text-white/90' : MUTED,
            ),
          },
          capitalize(task.details),
        ),
      h(
        'p',
        {
          class: cx(
            'mt-4 inline-flex rounded-full px-3 py-1 text-sm font-medium',
            onColor ? 'bg-white/15' : 'bg-stone-100 dark:bg-stone-800',
          ),
        },
        capitalize(formatDeadline(week.end, state.today)),
      ),
      h('div', {class: 'mt-6 grid gap-2.5'}, ...actions),
      status === 'pending' &&
        h(
          'p',
          {class: 'mt-3 text-center text-sm text-white/75'},
          '„Pamiętam” wycisza przypomnienia do końca tygodnia.',
        ),
    ),
  );
  morphs(card, `hero-${task.key}`);
  return card;
}

function freeCard(): HTMLElement {
  const card = h(
    'section',
    {
      class: cx(
        HERO_BASE,
        'bg-linear-to-br from-sky-500 to-indigo-600 text-white',
        'shadow-indigo-700/25',
      ),
    },
    glow(),
    h(
      'div',
      {class: 'relative'},
      icon('sparkle', 'size-9'),
      h(
        'h2',
        {
          class: cx(
            'mt-3 text-[clamp(2rem,9vw,3rem)] leading-tight font-extrabold',
            'tracking-tight',
          ),
        },
        'Masz wolne',
      ),
      h(
        'p',
        {class: 'mt-2 text-lg text-white/90'},
        'W tym tygodniu nic na Ciebie nie przypada.',
      ),
    ),
  );
  morphs(card, 'hero-free');
  return card;
}

function progress(state: AppState, week: Week): HTMLElement {
  const tasks = state.schedule.tasks.filter(task => !task.free);
  const done = tasks.filter(
    task => entryFor(state, week, task)?.status === 'done',
  ).length;
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const fill = h('div', {class: 'h-full rounded-full bg-emerald-500'});
  growTo(fill, percent);
  return h(
    'div',
    {class: 'flex items-center gap-3 px-1'},
    h(
      'div',
      {
        class: cx(
          'h-2 flex-1 overflow-hidden rounded-full bg-stone-200',
          'dark:bg-stone-800',
        ),
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': String(tasks.length),
        'aria-valuenow': String(done),
        'aria-label': 'Zrobione zadania',
      },
      fill,
    ),
    h(
      'span',
      {class: cx('text-sm font-medium tabular-nums', MUTED)},
      `${done} z ${tasks.length}`,
    ),
  );
}

function everyoneList(model: Model, state: AppState, week: Week) {
  const {people} = state.schedule;
  const rows = state.schedule.tasks.map((task, index) => {
    const person = week.assignees[index];
    const mine = person === model.person;
    const entry = entryFor(state, week, task);
    const status: TaskStatus = entry?.status ?? 'pending';
    const markedByOther =
      entry && person && entry.updatedBy !== person
        ? ` · oznaczone przez: ${entry.updatedBy}`
        : '';
    const content = [
      person ? avatar(person, people) : h('span', {class: 'size-10 shrink-0'}),
      h(
        'span',
        {class: 'min-w-0 flex-1 text-left'},
        h(
          'span',
          {class: 'block truncate font-semibold'},
          task.free ? 'Wolne' : capitalize(task.title),
        ),
        h(
          'span',
          {class: cx('block truncate text-sm', MUTED)},
          (mine ? 'Ty' : (person ?? 'Nikt')) + markedByOther,
        ),
      ),
      !task.free && statusPill(status, doneKey(week.start, task.key)),
    ];
    const rowClass = cx(
      'flex w-full items-center gap-3 px-4 py-3',
      task.free && 'opacity-60',
    );
    // Someone else's unfinished task can be ticked off on their behalf.
    if (task.free || mine || !person || status === 'done') {
      return h('li', {class: rowClass}, ...content);
    }
    const markDone = async () => {
      const confirmed = await confirmDialog({
        title: 'Oznaczyć jako zrobione?',
        text: `${capitalize(task.title)} — za: ${person}.`,
        confirmLabel: 'Zrobione',
      });
      if (confirmed) void setTaskStatus(week.start, task.key, 'done');
    };
    return h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: cx(
            rowClass,
            'transition hover:bg-stone-50 active:bg-stone-100',
            'dark:hover:bg-stone-800/60 dark:active:bg-stone-800',
          ),
          onclick: () => void markDone(),
        },
        ...content,
      ),
    );
  });
  return h(
    'ul',
    {
      class: cx(
        SURFACE,
        'divide-y divide-stone-100 overflow-hidden',
        'dark:divide-stone-800',
      ),
    },
    ...rows,
  );
}

function nextWeekTeaser(model: Model, state: AppState, week: Week) {
  const next = state.schedule.weeks.find(
    candidate => candidate.start > week.end,
  );
  if (!next || !model.person) return null;
  const tasks = tasksOf(state, next, model.person);
  const text = tasks.length
    ? tasks.map(task => capitalize(task.title)).join(', ')
    : 'Wolne';
  return h(
    'a',
    {
      href: '#/schedule',
      class: cx(
        CARD,
        'flex items-center gap-3 py-4 transition active:scale-[0.99]',
      ),
    },
    h(
      'span',
      {class: 'min-w-0 flex-1'},
      h('span', {class: cx('block text-sm', MUTED)}, 'Za tydzień'),
      h('span', {class: 'block truncate font-semibold'}, text),
    ),
    icon('chevron', cx('size-5', MUTED)),
  );
}

function banners(model: Model, state: AppState): HTMLElement[] {
  const result: HTMLElement[] = [];
  if (model.offline) {
    const since = state.sheet.fetchedAt
      ? ` Dane z: ${formatTimestamp(state.now, Date.now())}.`
      : '';
    result.push(banner('warning', `Brak połączenia.${since}`));
  }
  if (state.sheet.error) {
    result.push(
      banner(
        'warning',
        'Nie udało się odczytać arkusza. Widzisz ostatnią poprawną wersję.',
      ),
    );
  }
  if (model.push.support === 'supported' && !model.push.subscribed) {
    result.push(
      banner(
        'info',
        'Powiadomienia są wyłączone na tym urządzeniu.',
        button('Włącz', {
          block: false,
          busy: model.busy.has('notifications'),
          onclick: () => void enableNotifications(),
        }),
      ),
    );
  } else if (model.push.support === 'needs-install') {
    result.push(
      banner(
        'info',
        'Dodaj aplikację do ekranu początkowego, żeby dostawać powiadomienia.',
      ),
    );
  }
  return result;
}

export function renderToday(model: Model, state: AppState): HTMLElement {
  const week = currentWeek(state);
  const header = h(
    'header',
    {},
    h('p', {class: cx('font-medium', MUTED)}, `Cześć, ${model.person}`),
    h(
      'h1',
      {class: PAGE_TITLE},
      week ? formatWeekRange(week.start, week.end) : 'Ten tydzień',
    ),
  );
  if (!week) {
    return h(
      'div',
      {class: 'grid grid-cols-1 gap-5'},
      header,
      ...banners(model, state),
      h(
        'section',
        {class: CARD},
        h('h2', {class: 'text-xl font-bold'}, 'Brak grafiku na ten tydzień'),
        h(
          'p',
          {class: cx('mt-1 mb-4', MUTED)},
          'W arkuszu nie ma wiersza obejmującego dzisiejszą datę.',
        ),
        button('Odśwież z arkusza', {
          variant: 'soft',
          icon: 'refresh',
          busy: model.busy.has('refresh'),
          onclick: () => void refreshSheet(),
        }),
      ),
    );
  }
  const mine = model.person ? tasksOf(state, week, model.person) : [];
  return h(
    'div',
    {class: 'grid grid-cols-1 gap-5'},
    header,
    ...banners(model, state),
    h(
      'div',
      {class: 'grid grid-cols-1 items-start gap-5 md:grid-cols-2 md:gap-6'},
      h(
        'div',
        {class: 'grid grid-cols-1 gap-5'},
        ...(mine.length
          ? mine.map(task => heroCard(model, state, week, task))
          : [freeCard()]),
        nextWeekTeaser(model, state, week),
      ),
      h(
        'section',
        {class: 'grid grid-cols-1 gap-3'},
        sectionTitle('Wszyscy w tym tygodniu'),
        progress(state, week),
        everyoneList(model, state, week),
      ),
    ),
  );
}
