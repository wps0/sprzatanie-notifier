/** @fileoverview "Grafik": my upcoming weeks and the whole sheet as a table. */

import type {AppState, Week} from '../../shared/types.ts';
import type {Model} from '../app.ts';
import {refreshSheet} from '../app.ts';
import {
  avatar,
  button,
  MUTED,
  personColor,
  sectionTitle,
  SURFACE,
} from '../components.ts';
import {cx, h, icon} from '../dom.ts';
import {
  capitalize,
  formatTimestamp,
  formatWeekRange,
  formatWeekShort,
} from '../format.ts';

const UPCOMING_WEEKS = 6;

/** Whether weeks that are already over are listed in the table. */
let showPast = false;

function isCurrent(state: AppState, week: Week): boolean {
  return week.start <= state.today && state.today <= week.end;
}

function myTitle(state: AppState, week: Week, person: string): string {
  const titles = state.schedule.tasks
    .filter((_, index) => week.assignees[index] === person)
    .map(task => (task.free ? 'Wolne' : capitalize(task.title)));
  return titles.join(', ') || '—';
}

function upcoming(model: Model, state: AppState): HTMLElement | null {
  const {person} = model;
  if (!person) return null;
  const weeks = state.schedule.weeks
    .filter(week => week.end >= state.today)
    .slice(0, UPCOMING_WEEKS);
  if (weeks.length === 0) return null;
  const rows = weeks.map(week => {
    const current = isCurrent(state, week);
    return h(
      'li',
      {class: 'flex items-center gap-3 px-4 py-3'},
      h(
        'span',
        {
          class: cx(
            'w-24 shrink-0 text-sm font-medium tabular-nums',
            current ? 'text-emerald-600 dark:text-emerald-400' : MUTED,
          ),
        },
        current ? 'Teraz' : formatWeekShort(week.start, week.end),
      ),
      h(
        'span',
        {class: 'min-w-0 flex-1 truncate font-semibold'},
        myTitle(state, week, person),
      ),
    );
  });
  return h(
    'section',
    {class: 'grid grid-cols-1 gap-3'},
    sectionTitle('Twoje najbliższe tygodnie'),
    h(
      'ul',
      {
        class: cx(SURFACE, 'divide-y divide-stone-100 dark:divide-stone-800'),
      },
      ...rows,
    ),
  );
}

const CELL = 'border-b border-stone-100 px-2 py-2 dark:border-stone-800';
const STICKY_COLUMN = cx(
  'sticky left-0 z-10 bg-white pl-4 text-left dark:bg-stone-900',
);

function table(model: Model, state: AppState): HTMLElement {
  const {tasks, people, weeks} = state.schedule;
  const visible = weeks.filter(week => showPast || week.end >= state.today);

  const head = h(
    'tr',
    {},
    h('th', {class: cx(CELL, STICKY_COLUMN, 'py-3 font-semibold')}, 'Tydzień'),
    ...tasks.map(task =>
      h(
        'th',
        {
          class: cx(CELL, 'py-3 text-left font-semibold', MUTED),
          title: task.free ? 'Wolne' : capitalize(task.title),
        },
        h(
          'span',
          {class: 'block max-w-24 truncate'},
          task.free ? 'Wolne' : capitalize(task.title),
        ),
      ),
    ),
  );

  const rows = visible.map(week => {
    const current = isCurrent(state, week);
    const past = week.end < state.today;
    const highlight = current && 'bg-emerald-50 dark:bg-emerald-500/10';
    return h(
      'tr',
      {class: cx(past && 'opacity-50')},
      h(
        'th',
        {
          scope: 'row',
          class: cx(
            CELL,
            STICKY_COLUMN,
            highlight,
            'whitespace-nowrap font-medium tabular-nums',
            current && 'text-emerald-700 dark:text-emerald-300',
          ),
          title: formatWeekRange(week.start, week.end),
        },
        formatWeekShort(week.start, week.end),
      ),
      ...week.assignees.map(person =>
        h(
          'td',
          {class: cx(CELL, highlight)},
          person &&
            h(
              'span',
              {
                class: cx(
                  'inline-block max-w-24 truncate rounded-full px-2.5 py-1',
                  'align-middle text-xs font-semibold',
                  personColor(person, people),
                  person === model.person &&
                    'ring-2 ring-emerald-500 ring-offset-1 ring-offset-white ' +
                      'dark:ring-offset-stone-900',
                ),
              },
              person,
            ),
        ),
      ),
    );
  });

  return h(
    'div',
    {class: cx(SURFACE, 'overflow-x-auto')},
    h(
      'table',
      {class: 'w-full border-separate border-spacing-0 text-sm'},
      h('thead', {}, head),
      h('tbody', {}, ...rows),
    ),
  );
}

function legend(state: AppState): HTMLElement {
  const {people} = state.schedule;
  return h(
    'ul',
    {class: 'flex flex-wrap gap-x-4 gap-y-2 px-1'},
    ...people.map(person =>
      h(
        'li',
        {class: 'flex items-center gap-2 text-sm font-medium'},
        avatar(person, people, 'size-6 text-[0.65rem]'),
        person,
      ),
    ),
  );
}

export function renderSchedule(
  model: Model,
  state: AppState,
  rerender: () => void,
): HTMLElement {
  const hasPast = state.schedule.weeks.some(week => week.end < state.today);
  const synced = state.sheet.fetchedAt
    ? formatTimestamp(state.sheet.fetchedAt, Date.now())
    : 'nigdy';
  return h(
    'div',
    {class: 'grid grid-cols-1 gap-5'},
    h(
      'header',
      {},
      h(
        'p',
        {class: cx('font-medium', MUTED)},
        `Ostatnia synchronizacja: ${synced}`,
      ),
      h('h1', {class: 'text-3xl font-extrabold tracking-tight'}, 'Grafik'),
    ),
    upcoming(model, state),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-3'},
      sectionTitle('Cały grafik'),
      legend(state),
      table(model, state),
      hasPast &&
        button(showPast ? 'Ukryj minione tygodnie' : 'Pokaż minione tygodnie', {
          variant: 'ghost',
          onclick: () => {
            showPast = !showPast;
            rerender();
          },
        }),
    ),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-2.5'},
      button('Odśwież z arkusza', {
        variant: 'soft',
        icon: 'refresh',
        busy: model.busy.has('refresh'),
        onclick: () => void refreshSheet(),
      }),
      h(
        'a',
        {
          href: state.sheet.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: cx(
            'inline-flex min-h-12 items-center justify-center gap-2',
            'rounded-2xl px-5 py-3 font-semibold text-stone-600 transition',
            'hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
          ),
        },
        icon('external', 'size-5'),
        'Otwórz arkusz w Excelu',
      ),
    ),
  );
}
