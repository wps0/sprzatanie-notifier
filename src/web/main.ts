/** @fileoverview Entry point: renders the current view on every change. */

import type {Model} from './app.ts';
import {getModel, onChange, start} from './app.ts';
import {MUTED} from './components.ts';
import type {IconName} from './dom.ts';
import {cx, h, icon} from './dom.ts';
import {animate, prefersReducedMotion, TOAST_IN_MS} from './motion.ts';
import {onboardingStep, renderOnboarding} from './views/onboarding.ts';
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
        '[view-transition-name:tab-bar]',
      ),
      'aria-label': 'Główna nawigacja',
    },
    h(
      'ul',
      {
        class: cx(
          'mx-auto flex max-w-md gap-1 rounded-full bg-white/85 p-1.5 lg:max-w-lg',
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
                  ? cx(
                      'bg-stone-900 text-white dark:bg-white dark:text-stone-900',
                      '[view-transition-name:active-tab]',
                    )
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
  const element = h(
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
  animate(element, 'toast', 'motion-safe:animate-toast-in', TOAST_IN_MS);
  return element;
}

/** Fills a phone; grows with the screen on tablets and computers. */
const PAGE = cx(
  'mx-auto w-full max-w-md px-4 min-[400px]:px-5 sm:max-w-2xl sm:px-6',
  'lg:max-w-5xl lg:px-8',
  'pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-32 sm:pt-10',
);

/** Forms read best in a narrow column, whatever the screen. */
const NARROW = 'mx-auto w-full max-w-md';

/**
 * What the user would call "a different screen": the onboarding step or the
 * tab, plus the task statuses. A change of scene is animated as a view
 * transition; any other change (a spinner, a toast) is drawn instantly.
 */
function sceneOf(model: Model): Scene {
  const step = onboardingStep(model);
  const statuses = (model.state?.statuses ?? [])
    .map(entry => `${entry.weekStart}|${entry.taskKey}|${entry.status}`)
    .sort()
    .join(',');
  return {
    screen: step ? `onboarding:${step}` : `${currentRoute()}:${model.person}`,
    statuses,
  };
}

interface Scene {
  readonly screen: string;
  readonly statuses: string;
}

/**
 * `screen`: the whole page slides in. `status`: the page stays and the
 * task cards morph into their new state (see style.css).
 */
type TransitionKind = 'screen' | 'status';

function transitionKind(from: Scene | null, to: Scene): TransitionKind | null {
  if (!from) return null;
  if (from.screen !== to.screen) return 'screen';
  return from.statuses !== to.statuses ? 'status' : null;
}

let lastScene: Scene | null = null;
/** True between starting a view transition and its DOM update. */
let transitionPending = false;

/**
 * Draws the current model. Scene changes go through the View Transitions
 * API where available; the update callback always runs, even when the
 * browser skips the animation, and paints the latest model at that time.
 */
function render(): void {
  // A pending transition will paint the latest model when it runs.
  if (transitionPending) return;
  const scene = sceneOf(getModel());
  const kind = transitionKind(lastScene, scene);
  lastScene = scene;
  if (!kind || !document.startViewTransition || prefersReducedMotion()) {
    paint();
    return;
  }
  transitionPending = true;
  // Read by style.css while both snapshots are taken and animated.
  const root = document.documentElement;
  root.dataset['transition'] = kind;
  const done = () => {
    if (!transitionPending) return;
    transitionPending = false;
    lastScene = sceneOf(getModel());
    paint();
  };
  document.startViewTransition(done).finished.finally(() => {
    if (root.dataset['transition'] === kind) delete root.dataset['transition'];
  });
  // Belt and braces: never leave the screen stale if the callback is lost.
  window.setTimeout(done, 1000);
}

function paint(): void {
  const root = document.getElementById('app');
  if (!root) return;
  const model = getModel();
  const onboarding = renderOnboarding(model);
  const children: Array<HTMLElement | null> = [];
  if (onboarding || !model.state) {
    children.push(
      h('main', {class: PAGE}, h('div', {class: NARROW}, onboarding)),
    );
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
