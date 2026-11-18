/** @fileoverview Tiny DOM helpers. Text always goes in as text nodes. */

type Child = Node | string | number | null | undefined | false;
type PropValue = string | boolean | EventListener | null | undefined;

/** Joins class name fragments, skipping falsy ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Creates an element. `on…` props become event listeners, `class` sets the
 * class name, `true` sets an empty attribute and falsy values are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Readonly<Record<string, PropValue>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      element.addEventListener(name.replace(/^on/, ''), value);
    } else if (name === 'class') {
      element.className = String(value);
    } else {
      element.setAttribute(name, value === true ? '' : value);
    }
  }
  append(element, children);
  return element;
}

function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

const ICON_PATHS = {
  today: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 12.5l2.5 2.5 4.5-5'],
  schedule: [
    'M6.5 5h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z',
    'M3.5 10h17M8 3v4M16 3v4',
  ],
  settings: [
    'M4 7h8M18 7h2M4 17h2M12 17h8',
    'M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M9 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  bell: ['M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  bellOff: [
    'M6 16v-5c0-1 .2-1.9.6-2.7M9 5.8A6 6 0 0 1 18 11v5l1.5 2H9',
    'M10 20.5a2 2 0 0 0 4 0M4 4l16 16',
  ],
  sparkle: [
    'M12 3c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z',
  ],
  refresh: [
    'M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4',
    'M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4',
  ],
  external: [
    'M14 5h5v5M19 5l-8 8',
    'M11 7H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4',
  ],
  plus: ['M12 5v14M5 12h14'],
  close: ['M6 6l12 12M18 6L6 18'],
  chevron: ['M9 6l6 6-6 6'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 24×24 stroked icon. Decorative: hidden from assistive technology. */
export function icon(name: IconName, className = 'size-6'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `${className} shrink-0`);
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
