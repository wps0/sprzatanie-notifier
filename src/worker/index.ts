/**
 * @fileoverview Cloudflare Worker entry point. It only wires the real clock
 * and `fetch` into the application code.
 */

import type {ScheduledEvent} from './app.ts';
import {handleRequest, handleScheduled} from './app.ts';
import type {Deps, Env} from './env.ts';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const deps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
};

// The Workers runtime requires the handlers on the default export; this is
// the one place that departs from the "named exports only" rule.
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, deps);
  },
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(handleScheduled(event, env, deps));
  },
};
