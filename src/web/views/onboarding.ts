/** @fileoverview First run: flat code, name, notifications. */

import type {AppState} from '../../shared/types.ts';
import type {Model} from '../app.ts';
import {
  choosePerson,
  enableNotifications,
  finishOnboarding,
  installApp,
  loadState,
  submitCode,
} from '../app.ts';
import {
  avatar,
  button,
  CARD,
  MUTED,
  PAGE_TITLE,
  spinner,
} from '../components.ts';
import {cx, h, icon} from '../dom.ts';

function frame(
  title: string,
  subtitle: string,
  ...content: Array<HTMLElement | false | null>
): HTMLElement {
  return h(
    'div',
    {class: 'flex min-h-[80dvh] flex-col justify-center gap-8 py-6'},
    h(
      'header',
      {class: 'grid justify-items-center gap-4 text-center'},
      h(
        'span',
        {
          class: cx(
            'grid size-20 place-items-center rounded-[1.75rem] text-white',
            'bg-linear-to-br from-emerald-500 to-teal-700',
            'shadow-xl shadow-emerald-700/30',
          ),
        },
        icon('sparkle', 'size-10'),
      ),
      h(
        'div',
        {},
        h('h1', {class: PAGE_TITLE}, title),
        h('p', {class: cx('mt-1 text-lg text-balance', MUTED)}, subtitle),
      ),
    ),
    ...content,
  );
}

function codeStep(model: Model): HTMLElement {
  const input = h('input', {
    type: 'text',
    name: 'code',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    inputmode: 'text',
    placeholder: 'kod mieszkania',
    'aria-label': 'Kod mieszkania',
    class: cx(
      'w-full rounded-2xl bg-white px-4 py-4 text-center font-mono text-lg',
      'ring-1 ring-stone-300 placeholder:text-stone-400',
      'focus:outline-2 focus:outline-emerald-500',
      'dark:bg-stone-900 dark:ring-stone-700',
    ),
  });
  const submit = (event: Event) => {
    event.preventDefault();
    void submitCode(input.value);
  };
  return frame(
    'Sprzątanie',
    'Wpisz kod mieszkania albo wklej link z zaproszenia.',
    h(
      'form',
      {class: 'grid grid-cols-1 gap-3', onsubmit: submit},
      input,
      model.codeError &&
        h(
          'p',
          {
            class: 'text-center text-sm font-medium text-red-600',
            role: 'alert',
          },
          model.codeError,
        ),
      h(
        'button',
        {
          type: 'submit',
          class: cx(
            'inline-flex min-h-14 w-full items-center justify-center gap-2',
            'rounded-2xl bg-emerald-600 px-5 text-lg font-semibold text-white',
            'transition hover:bg-emerald-700 active:scale-[0.98]',
            'disabled:opacity-60',
          ),
          disabled: model.busy.has('code'),
        },
        model.busy.has('code') && spinner(),
        'Dalej',
      ),
    ),
  );
}

function loadingStep(model: Model): HTMLElement {
  if (model.loading || !model.offline) {
    return frame(
      'Sprzątanie',
      'Wczytuję grafik…',
      h('div', {class: cx('grid place-items-center', MUTED)}, spinner()),
    );
  }
  return frame(
    'Brak połączenia',
    'Nie udało się pobrać grafiku. Sprawdź internet i spróbuj ponownie.',
    button('Spróbuj ponownie', {onclick: () => void loadState()}),
  );
}

function personStep(state: AppState): HTMLElement {
  const {people} = state.schedule;
  if (people.length === 0) {
    return frame(
      'Grafik jest pusty',
      'Nie udało się odczytać arkusza. Spróbuj ponownie za chwilę.',
      button('Spróbuj ponownie', {onclick: () => void loadState()}),
    );
  }
  return frame(
    'Kim jesteś?',
    'Wybierz swoje imię z grafiku.',
    h(
      'ul',
      {class: 'grid grid-cols-1 gap-2.5'},
      ...people.map(person =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: cx(
                CARD,
                'flex w-full items-center gap-4 py-3.5 text-left text-lg',
                'font-semibold transition active:scale-[0.98]',
                'hover:ring-emerald-400',
              ),
              onclick: () => choosePerson(person),
            },
            avatar(person, people, 'size-11 text-base'),
            h('span', {class: 'flex-1'}, person),
            icon('chevron', cx('size-5', MUTED)),
          ),
        ),
      ),
    ),
  );
}

function notificationsStep(model: Model): HTMLElement {
  const later = button('Później', {
    variant: 'ghost',
    onclick: finishOnboarding,
  });
  const install =
    model.canInstall &&
    button('Zainstaluj aplikację', {
      variant: 'soft',
      onclick: () => void installApp(),
    });

  if (model.push.support === 'needs-install') {
    const steps = [
      'Stuknij przycisk Udostępnij na dole ekranu.',
      'Wybierz „Do ekranu początkowego".',
      'Otwórz Sprzątanie z ekranu początkowego. Jeśli poprosi o kod, wklej ' +
        'ponownie link z zaproszenia, a potem włącz powiadomienia.',
    ];
    return frame(
      'Jeszcze jeden krok',
      'Na iPhonie powiadomienia działają dopiero w zainstalowanej aplikacji.',
      h(
        'ol',
        {class: cx(CARD, 'grid grid-cols-1 gap-4')},
        ...steps.map((step, index) =>
          h(
            'li',
            {class: 'flex items-start gap-3'},
            h(
              'span',
              {
                class: cx(
                  'grid size-7 shrink-0 place-items-center rounded-full',
                  'bg-emerald-600 text-sm font-bold text-white',
                ),
              },
              index + 1,
            ),
            h('span', {class: 'pt-0.5'}, step),
          ),
        ),
      ),
      button('Rozumiem', {variant: 'soft', onclick: finishOnboarding}),
    );
  }
  if (model.push.support === 'unsupported') {
    return frame(
      'Bez powiadomień',
      'Ta przeglądarka ich nie obsługuje. Otwórz stronę w Chrome ' +
        '(Android) albo w Safari (iPhone).',
      button('Dalej', {onclick: finishOnboarding}),
    );
  }
  if (model.push.subscribed) {
    return frame(
      'Gotowe',
      'Powiadomienia są włączone. Przypomnimy Ci o Twoim zadaniu.',
      install,
      button('Zaczynamy', {onclick: finishOnboarding}),
    );
  }
  return frame(
    'Włącz przypomnienia',
    'Dostaniesz powiadomienie na początku tygodnia i przed terminem. ' +
      'Nic więcej.',
    button('Włącz powiadomienia', {
      large: true,
      icon: 'bell',
      busy: model.busy.has('notifications'),
      onclick: () => void enableNotifications(),
    }),
    install,
    later,
  );
}

export type OnboardingStep = 'code' | 'loading' | 'person' | 'notifications';

/** The onboarding step to show, or null when onboarding is over. */
export function onboardingStep(model: Model): OnboardingStep | null {
  if (!model.code) return 'code';
  if (!model.state) return 'loading';
  const {people} = model.state.schedule;
  if (!model.person || !people.includes(model.person)) return 'person';
  if (!model.onboardingDone) return 'notifications';
  return null;
}

/** Renders the current onboarding step, or null when onboarding is over. */
export function renderOnboarding(model: Model): HTMLElement | null {
  switch (onboardingStep(model)) {
    case 'code':
      return codeStep(model);
    case 'loading':
      return loadingStep(model);
    case 'person':
      return personStep(model.state!);
    case 'notifications':
      return notificationsStep(model);
    default:
      return null;
  }
}
