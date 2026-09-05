import { describe, expect, it } from 'vitest';

import gameWorkerSource from '../../public/game-sw.js?raw';
import launcherHtml from '../../index.html?raw';
import viteConfigSource from '../../vite.config.ts?raw';

/** Every game's worker stub, keyed by path — `public/sw.js` is the launcher's. */
const workerStubs = import.meta.glob('../../public/*/sw.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * The offline caches, driven against a mock Cache Storage.
 *
 * `public/game-sw.js` is plain JS run in a worker, so it is loaded here as text
 * and evaluated with `self`, `caches` and `fetch` supplied. That is worth the
 * awkwardness: the two things it does that nothing else covers — evicting only
 * its own caches, and finding the level generator chunk that no tag names — are
 * both invisible until someone is offline on a plane.
 */

const ORIGIN = 'https://games.example';
const SW_URL = `${ORIGIN}/colorsort/sw.js`;

const absolute = (url: string) => new URL(url, SW_URL).href;

interface FakeResponse {
  ok: boolean;
  type: string;
  body: string;
  /** Set when the host varied the response, as `vite preview` does with Origin. */
  vary: boolean;
  clone(): FakeResponse;
  text(): Promise<string>;
}

function response(body: string, ok = true, vary = false): FakeResponse {
  return {
    ok,
    type: 'basic',
    body,
    vary,
    clone() {
      return response(body, ok, vary);
    },
    text() {
      return Promise.resolve(body);
    },
  };
}

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();

  constructor(private readonly fetcher: (url: string) => Promise<FakeResponse>) {}

  /**
   * A stored response that declares `Vary` is unreachable unless the lookup
   * opts out of it — which is exactly how a full, correct-looking cache still
   * failed to serve a single asset offline.
   */
  async match(url: string | { url: string }, options?: { ignoreVary?: boolean }) {
    const found = this.entries.get(absolute(typeof url === 'string' ? url : url.url));
    if (found?.vary && !options?.ignoreVary) return undefined;
    return found;
  }

  async put(url: string, value: FakeResponse) {
    this.entries.set(absolute(url), value);
  }

  async add(url: string) {
    const result = await this.fetcher(absolute(url));
    if (!result.ok) throw new Error(`add failed: ${url}`);
    await this.put(url, result);
  }

  async addAll(urls: string[]) {
    for (const url of urls) await this.add(url);
  }
}

/** Records every URL requested, so a test can assert what was not re-fetched. */
function harness(files: Record<string, string>, vary = false) {
  const requested: string[] = [];
  const options: Record<string, unknown>[] = [];
  let offline = false;

  const fetcher = async (url: string | { url: string }, init?: Record<string, unknown>) => {
    const target = typeof url === 'string' ? url : url.url;
    const path = new URL(target, SW_URL).pathname;
    if (offline) throw new Error('offline');
    requested.push(path);
    options.push(init ?? {});
    const body = files[path];
    if (body === undefined) throw new Error(`no such file: ${path}`);
    return response(body, true, vary);
  };

  const store = new Map<string, FakeCache>();
  const caches = {
    async open(key: string) {
      const existing = store.get(key);
      if (existing) return existing;
      const cache = new FakeCache(fetcher);
      store.set(key, cache);
      return cache;
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(key: string) {
      return store.delete(key);
    },
  };

  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const self = {
    location: { href: SW_URL, origin: ORIGIN },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    addEventListener(type: string, handler: (event: unknown) => void) {
      const existing = listeners.get(type) ?? [];
      existing.push(handler);
      listeners.set(type, existing);
    },
  };

  const factory = new Function(
    'self',
    'caches',
    'fetch',
    `${gameWorkerSource}\nreturn initGameWorker;`,
  );
  factory(self, caches, fetcher)('colorsort', 'v3');

  async function dispatch(type: string, data?: unknown) {
    const pending: Promise<unknown>[] = [];
    const event = { data, waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    for (const handler of listeners.get(type) ?? []) handler(event);
    await Promise.all(pending);
  }

  /** Runs the fetch handler the way the browser does, and returns its answer. */
  async function dispatchFetch(path: string, mode = 'cors') {
    const request = { method: 'GET', url: `${ORIGIN}${path}`, mode };
    let answer: Promise<FakeResponse> | undefined;
    const event = { request, respondWith: (value: Promise<FakeResponse>) => (answer = value) };
    for (const handler of listeners.get('fetch') ?? []) handler(event);
    return answer;
  }

  return {
    caches,
    store,
    dispatch,
    dispatchFetch,
    requested,
    options,
    goOffline: () => (offline = true),
  };
}

/**
 * The shape the build actually emits: `index.html` names the entry chunk and
 * the stylesheets, and only the entry chunk names the generator worker — Vite
 * writes it as a bare string, so no amount of parsing the markup finds it.
 */
const FILES: Record<string, string> = {
  '/colorsort/': '<!doctype html><p>grid</p>',
  '/colorsort/index.html': `<!doctype html>
    <link rel="apple-touch-icon" href="../icons/colorsort-180.png" />
    <script type="module" crossorigin src="/assets/colorsort-Du51.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/pwa-C7ij.css">`,
  '/colorsort/manifest.webmanifest': '{"name":"Color Sort"}',
  '/warm.js': '// warm',
  '/assets/colorsort-Du51.js': 'new Worker(new URL("/assets/generate.worker-BdNa.js",n))',
  '/assets/generate.worker-BdNa.js': 'self.onmessage=()=>{}',
  '/assets/pwa-C7ij.css': 'body{}',
  '/icons/colorsort-180.png': 'png',
};

describe('warming a game that has never been opened', () => {
  it('caches the generator chunk that only the entry chunk names', async () => {
    const { store, dispatch } = harness(FILES);

    await dispatch('install');
    await dispatch('message', { type: 'warm' });

    const cached = [...(store.get('colorsort-v3')?.entries.keys() ?? [])];
    for (const path of Object.keys(FILES)) {
      expect(cached, `${path} was not cached`).toContain(`${ORIGIN}${path}`);
    }
  });

  it('revalidates index.html so a warmed game still tracks deploys', async () => {
    const { dispatch, requested, options } = harness(FILES);

    await dispatch('install');
    await dispatch('message', { type: 'warm' });
    const first = requested.length;
    await dispatch('message', { type: 'warm' });

    // The second pass costs one conditional request: everything index.html
    // names is hashed, so the rest is already in the cache under the same URL.
    expect(requested.slice(first)).toEqual(['/colorsort/index.html']);
    expect(options.at(-1)).toEqual({ cache: 'no-cache' });
  });

  it('leaves the page to fail honestly when the network is gone', async () => {
    const { store, dispatch } = harness({});

    await dispatch('install');
    await expect(dispatch('message', { type: 'warm' })).resolves.toBeUndefined();
    expect(store.get('colorsort-v3')?.entries.size).toBe(0);
  });
});

describe('serving a warmed game with no network', () => {
  it('reaches assets the host varied its responses on', async () => {
    // `vite preview` sends `Vary: Origin`, and Vite tags its module and
    // stylesheet links `crossorigin`, so the requests that need these responses
    // are not the ones that stored them. Honouring Vary here left a cache that
    // was complete, matched by URL, and served nothing: every asset failed and
    // the game rendered an empty shell. Only offline, only on a cold start.
    const { dispatch, dispatchFetch, goOffline } = harness(FILES, true);

    await dispatch('install');
    await dispatch('message', { type: 'warm' });
    goOffline();

    const asset = await dispatchFetch('/assets/colorsort-Du51.js');
    expect(await asset).toMatchObject({ body: FILES['/assets/colorsort-Du51.js'] });

    const navigation = await dispatchFetch('/colorsort/', 'navigate');
    expect(await navigation).toBeTruthy();
  });
});

describe('activating a worker', () => {
  it('evicts only its own older caches', async () => {
    const { caches, store, dispatch } = harness(FILES);

    for (const key of ['colorsort-v2', 'colorsort-v3', 'screwland-v3', 'launcher-v2']) {
      await caches.open(key);
    }

    await dispatch('activate');

    // Cache Storage is per-origin, so an unfiltered sweep here took the other
    // games down the first time a second game was opened.
    expect([...store.keys()].sort()).toEqual(['colorsort-v3', 'launcher-v2', 'screwland-v3']);
  });
});

/**
 * `warm.js` finds the games by reading the launcher's cards, and each one needs
 * a worker of its own to warm into. A new game that is built but not carded is
 * reachable only by typing its URL, and one carded without a worker never
 * caches — both silent until someone is offline.
 */
describe('every built game', () => {
  const inputs = [...viteConfigSource.matchAll(/^\s{8}(\w+): '/gm)].map((match) => match[1]);
  const slugs = inputs.filter((name) => name !== 'launcher');

  it('is discovered from vite.config.ts', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  for (const slug of slugs) {
    it(`${slug} has a launcher card and a service worker`, () => {
      // `a.card` is the selector in warm.js, not decoration: restyling the
      // launcher's links under another class name stops every game warming,
      // and nothing else would notice.
      expect(launcherHtml).toContain(`class="card" href="./${slug}/"`);
      expect(workerStubs[`../../public/${slug}/sw.js`]).toContain(`initGameWorker('${slug}'`);
    });
  }
});
