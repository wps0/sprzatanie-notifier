/** @fileoverview Entry point: renders the current view on every change. */

import {getModel, onChange, start} from './app.ts';
import {MUTED} from './components.ts';
import type {IconName} from './dom.ts';
import {cx, h, icon} from './dom.ts';
import {renderOnboarding} from './views/onboarding.ts';
import {renderSchedule} from './views/schedule.ts';
import {renderSettings} from './views/settings.ts';
import {renderToday} from './views/today.ts';

type Route = 'today' | 'schedule' | 'settings';

const TABS: ReadonlyArray<{
  route: Route;
  href: string;
  label: string;
  icon: IconName;
}> = [
  {route: 'today', href: '#/', label: 'Ten tydzień', icon: 'today'},
  {route: 'schedule', href: '#/schedule', label: 'Grafik', icon: 'schedule'},
  {
    route: 'settings',
    href: '#/settings',
    label: 'Ustawienia',
    icon: 'settings',
  },
];

function currentRoute(): Route {
  const path = location.hash.replace(/^#/, '');
  return TABS.find(tab => tab.href === `#${path}`)?.route ?? 'today';
}

function tabBar(active: Route): HTMLElement {
  return h(
    'nav',
    {
      class: cx(
        'fixed inset-x-0 bottom-0 z-20 px-5',
        'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]',
      ),
      'aria-label': 'Główna nawigacja',
    },
    h(
      'ul',
      {
        class: cx(
          'mx-auto flex max-w-md gap-1 rounded-full bg-white/85 p-1.5',
          'shadow-xl shadow-stone-900/10 ring-1 ring-stone-200/80',
          'backdrop-blur-xl dark:bg-stone-900/85 dark:ring-stone-800',
        ),
      },
      ...TABS.map(tab => {
        const selected = tab.route === active;
        return h(
          'li',
          {class: 'flex-1'},
          h(
            'a',
            {
              href: tab.href,
              'aria-current': selected && 'page',
              class: cx(
                'flex min-h-12 flex-col items-center justify-center gap-0.5',
                'rounded-full text-xs font-semibold transition',
                selected
                  ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
                  : MUTED,
              ),
            },
            icon(tab.icon, 'size-5'),
            tab.label,
          ),
        );
      }),
    ),
  );
}

function toast(message: string): HTMLElement {
  return h(
    'p',
    {
      class: cx(
        'fixed inset-x-5 z-30 mx-auto w-fit max-w-sm rounded-2xl px-4 py-3',
        'bottom-[calc(env(safe-area-inset-bottom)+5.75rem)]',
        'bg-stone-900 text-center text-sm font-medium text-white shadow-xl',
        'dark:bg-white dark:text-stone-900',
      ),
      role: 'status',
    },
    message,
  );
}

const PAGE = cx(
  'mx-auto max-w-md px-5',
  'pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-32',
);

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  const model = getModel();
  const onboarding = renderOnboarding(model);
  const children: Array<HTMLElement | null> = [];
  if (onboarding || !model.state) {
    children.push(h('main', {class: PAGE}, onboarding));
  } else {
    const route = currentRoute();
    const view =
      route === 'schedule'
        ? renderSchedule(model, model.state, render)
        : route === 'settings'
          ? renderSettings(model, model.state)
          : renderToday(model, model.state);
    children.push(h('main', {class: PAGE}, view), tabBar(route));
  }
  if (model.toast) children.push(toast(model.toast));
  root.replaceChildren(...children.filter(child => child !== null));
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // A new version took over: reload once so the page matches its cache.
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  void navigator.serviceWorker.register('./sw.js');
}

onChange(render);
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
registerServiceWorker();
render();
void start();
