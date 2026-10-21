/**
 * Shared in-memory store for the repository doubles.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────────────
 * This module refuses to load when `NODE_ENV=production`. A production build can therefore
 * never resolve the in-memory data layer, no matter how it is aliased or imported.
 */

export type Row = Record<string, unknown>;

const REFUSAL =
  'The in-memory database double refuses to run with NODE_ENV=production. ' +
  'It exists only to make the product verifiable before the hosted PostgreSQL integration is activated.';

/**
 * Checked at module load *and* on every store access. A load-time check alone is not enough: a
 * module graph can be evaluated once and cached, so a process that started in development and
 * later flipped to production would keep serving empty rows from a silently live test double.
 */
export function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') throw new Error(REFUSAL);
}

assertNotProduction();

/**
 * Rows live on `globalThis`, not in a module-level variable.
 *
 * Next compiles every route into its own bundle, so each route gets its own instance of this
 * module. A module-level `Map` would give every route a private copy: signup would write a user
 * into one store and the readiness route would read an empty one from another. Pinning the state
 * to a single global key makes all bundles in the process observe the same rows, which is what
 * lets the whole product be exercised end to end before PostgreSQL is activated.
 */
const GLOBAL_KEY = '__nexoraMemoryStore__';

type Store = { tables: Map<string, Row[]>; seq: number };

const globalScope = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Store };

function store(): Store {
  let s = globalScope[GLOBAL_KEY];
  if (!s) {
    s = { tables: new Map<string, Row[]>(), seq: 0 };
    globalScope[GLOBAL_KEY] = s;
  }
  return s;
}

const tables = new Proxy(new Map<string, Row[]>(), {
  // Methods must be bound to the real Map: a function retrieved through a proxy would otherwise
  // be invoked with the proxy as `this`, which has no Map internal slots, and iteration or
  // `entries()` would throw.
  get: (_t, prop) => {
    const value = Reflect.get(store().tables as object, prop);
    return typeof value === 'function' ? value.bind(store().tables) : value;
  },
  set: (_t, prop, value) => Reflect.set(store().tables as object, prop, value),
  has: (_t, prop) => Reflect.has(store().tables as object, prop),
  deleteProperty: (_t, prop) => Reflect.deleteProperty(store().tables as object, prop),
  ownKeys: () => Reflect.ownKeys(store().tables as object),
  getOwnPropertyDescriptor: (_t, prop) => Reflect.getOwnPropertyDescriptor(store().tables as object, prop),
}) as Map<string, Row[]>;

const sequence = {
  get value(): number {
    return store().seq;
  },
  set value(next: number) {
    store().seq = next;
  },
};

export const mem = {
  table(name: string): Row[] {
    assertNotProduction();
    let t = tables.get(name);
    if (!t) {
      t = [];
      tables.set(name, t);
    }
    return t;
  },

  uid(): string {
    assertNotProduction();
    sequence.value += 1;
    return `00000000-0000-4000-8000-${String(sequence.value).padStart(12, '0')}`;
  },

  /** Drop every row. Call between tests so data never leaks between them. */
  reset(): void {
    assertNotProduction();
    tables.clear();
    sequence.value = 0;
  },

  sizes(): Record<string, number> {
    assertNotProduction();
    const out: Record<string, number> = {};
    for (const [name, rows] of tables) out[name] = rows.length;
    return out;
  },
};

export const clone = <T,>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
export const now = () => new Date();
export const num = (v: unknown): number =>
  typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10) || 0;
export const json = <T,>(v: unknown, dflt: T): T => {
  if (v === null || v === undefined) return dflt;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return dflt;
  }
};
export const dateOrNull = (v: unknown): Date | null => (v ? new Date(String(v)) : null);