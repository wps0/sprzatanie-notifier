/** @fileoverview "Ustawienia": who I am, reminders, notifications. */

import type {AppState, ReminderRule} from '../../shared/types.ts';
import type {Model} from '../app.ts';
import {
  changePerson,
  disableNotifications,
  enableNotifications,
  installApp,
  loadPrefs,
  savePrefs,
  sendTestNotification,
  signOut,
} from '../app.ts';
import {
  avatar,
  button,
  CARD,
  confirmDialog,
  MUTED,
  sectionTitle,
  spinner,
  SURFACE,
} from '../components.ts';
import {cx, h, icon} from '../dom.ts';
import {capitalize, WEEKDAYS} from '../format.ts';

const FIRST_HOUR = 6;
const NEW_RULE: ReminderRule = {weekday: 3, time: '18:00'};

const SELECT = cx(
  'min-h-11 min-w-0 rounded-xl bg-stone-100 px-3 font-medium',
  'text-stone-900',
  'dark:bg-stone-800 dark:text-stone-100',
  'focus-visible:outline-2 focus-visible:outline-emerald-500',
);

function timeOptions(): string[] {
  const times: string[] = [];
  for (let hour = FIRST_HOUR; hour < 24; hour++) {
    for (const minute of ['00', '15', '30', '45']) {
      times.push(`${String(hour).padStart(2, '0')}:${minute}`);
    }
  }
  return times;
}

function select(
  label: string,
  options: ReadonlyArray<readonly [value: string, text: string]>,
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const element = h(
    'select',
    {
      class: SELECT,
      'aria-label': label,
      onchange: event => onChange((event.target as HTMLSelectElement).value),
    },
    ...options.map(([value, text]) =>
      h('option', {value, selected: value === selected}, text),
    ),
  );
  // An unusual stored time (before FIRST_HOUR) must stay selectable.
  if (!options.some(([value]) => value === selected)) {
    element.prepend(h('option', {value: selected, selected: true}, selected));
  }
  return element;
}

function ruleRow(rules: readonly ReminderRule[], index: number): HTMLElement {
  const rule = rules[index];
  const replace = (patch: Partial<ReminderRule>) =>
    void savePrefs(
      rules.map((item, i) => (i === index ? {...item, ...patch} : item)),
    );
  return h(
    'li',
    {class: 'flex items-center gap-2 px-4 py-2.5'},
    select(
      'Dzień tygodnia',
      WEEKDAYS.map((name, i) => [String(i + 1), capitalize(name)] as const),
      String(rule.weekday),
      value => replace({weekday: Number(value)}),
    ),
    select(
      'Godzina',
      timeOptions().map(time => [time, time] as const),
      rule.time,
      value => replace({time: value}),
    ),
    h('span', {class: 'flex-1'}),
    h(
      'button',
      {
        type: 'button',
        class: cx(
          'grid size-11 place-items-center rounded-xl transition',
          'hover:bg-stone-100 dark:hover:bg-stone-800',
          MUTED,
        ),
        'aria-label': 'Usuń przypomnienie',
        onclick: () => void savePrefs(rules.filter((_, i) => i !== index)),
      },
      icon('close', 'size-5'),
    ),
  );
}

function reminders(model: Model): HTMLElement {
  const {prefs} = model;
  if (!prefs) {
    if (!model.busy.has('prefs')) void loadPrefs();
    return h(
      'div',
      {class: cx(CARD, 'grid place-items-center py-8', MUTED)},
      spinner(),
    );
  }
  const {rules} = prefs;
  return h(
    'div',
    {class: SURFACE},
    rules.length
      ? h(
          'ul',
          {class: 'divide-y divide-stone-100 dark:divide-stone-800'},
          ...rules.map((_, index) => ruleRow(rules, index)),
        )
      : h(
          'p',
          {class: cx('px-5 py-4', MUTED)},
          'Brak przypomnień. Nie dostaniesz żadnych powiadomień.',
        ),
    h(
      'div',
      {
        class: cx(
          'grid grid-cols-2 gap-2 border-t border-stone-100 p-3',
          'dark:border-stone-800',
        ),
      },
      button('Dodaj', {
        variant: 'soft',
        icon: 'plus',
        onclick: () => void savePrefs([...rules, NEW_RULE]),
      }),
      button('Domyślne', {
        variant: 'ghost',
        onclick: () => void savePrefs(null),
      }),
    ),
  );
}

function notifications(model: Model): HTMLElement {
  const {push} = model;
  const busy = model.busy.has('notifications');
  let status: string;
  let actions: HTMLElement[] = [];
  if (push.support === 'needs-install') {
    status =
      'Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu ' +
      'początkowego: Udostępnij → „Do ekranu początkowego".';
  } else if (push.support === 'unsupported') {
    status = 'Ta przeglądarka nie obsługuje powiadomień.';
  } else if (push.permission === 'denied') {
    status =
      'Powiadomienia są zablokowane. Odblokuj je w ustawieniach ' +
      'przeglądarki dla tej strony.';
  } else if (push.subscribed) {
    status = 'Włączone na tym urządzeniu.';
    actions = [
      button('Wyślij testowe', {
        variant: 'soft',
        icon: 'bell',
        busy: model.busy.has('test'),
        onclick: () => void sendTestNotification(),
      }),
      button('Wyłącz', {
        variant: 'ghost',
        busy,
        onclick: () => void disableNotifications(),
      }),
    ];
  } else {
    status = 'Wyłączone na tym urządzeniu.';
    actions = [
      button('Włącz powiadomienia', {
        icon: 'bell',
        busy,
        onclick: () => void enableNotifications(),
      }),
    ];
  }
  return h(
    'div',
    {class: cx(CARD, 'grid grid-cols-1 gap-4')},
    h('p', {}, status),
    actions.length > 0 &&
      h(
        'div',
        {
          class: cx(
            'grid grid-cols-1 gap-2',
            actions.length > 1 && 'grid-cols-2',
          ),
        },
        ...actions,
      ),
  );
}

export function renderSettings(model: Model, state: AppState): HTMLElement {
  const person = model.person ?? '';
  const leave = async () => {
    const confirmed = await confirmDialog({
      title: 'Wylogować to urządzenie?',
      text: 'Aby wrócić, trzeba będzie ponownie wpisać kod mieszkania.',
      confirmLabel: 'Wyloguj',
    });
    if (confirmed) void signOut();
  };
  return h(
    'div',
    {class: 'grid grid-cols-1 gap-6'},
    h('h1', {class: 'text-3xl font-extrabold tracking-tight'}, 'Ustawienia'),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-3'},
      sectionTitle('Ty'),
      h(
        'div',
        {class: cx(CARD, 'flex items-center gap-4')},
        avatar(person, state.schedule.people, 'size-12 text-base'),
        h('p', {class: 'min-w-0 flex-1 truncate text-lg font-bold'}, person),
        button('Zmień', {
          variant: 'soft',
          block: false,
          onclick: changePerson,
        }),
      ),
    ),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-3'},
      sectionTitle('Kiedy przypominać'),
      reminders(model),
      h(
        'p',
        {class: cx('px-1 text-sm', MUTED)},
        'Przypomnienia milkną, gdy oznaczysz zadanie jako przyjęte ' +
          'albo zrobione.',
      ),
    ),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-3'},
      sectionTitle('Powiadomienia'),
      notifications(model),
    ),
    h(
      'section',
      {class: 'grid grid-cols-1 gap-2.5'},
      model.canInstall &&
        button('Zainstaluj aplikację', {
          variant: 'soft',
          onclick: () => void installApp(),
        }),
      button('Wyloguj to urządzenie', {
        variant: 'danger',
        onclick: () => void leave(),
      }),
    ),
  );
}
