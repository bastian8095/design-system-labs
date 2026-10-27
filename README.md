# design-system-labs

Collapses rapid duplicate file change events from `fs.watch` into a single trailing notification per path, within a configurable quiet window.

## Usage

```js
import fs from "node:fs";
import { Debouncer } from "design-system-labs";

const debouncer = new Debouncer({
  windowMs: 100,
  emit: (path) => {
    // called once per path after it has been quiet for windowMs
    console.log("changed:", path);
  },
});

const watcher = fs.watch("./src", (eventType, filename) => {
  if (filename) debouncer.notify(filename);
});

// on shutdown
watcher.close();
debouncer.dispose();
```

## Why this exists

`fs.watch` is noisy. A single save from many editors produces several events (write, close, rename) within a few milliseconds, and the exact count varies by platform and filesystem. Acting on every event runs linters, bundlers, and sync logic redundantly.

This library collapses those bursts with a trailing-edge debounce: each path must stay quiet for `windowMs` before its notification fires. If events keep arriving, the notification keeps being pushed forward. The trade-off is latency — you never get the *first* event immediately, you get the *last* one after a pause. For build pipelines and file syncers that is the right trade; for logging every individual touch it is the wrong one.

## The awkward edge

`windowMs` must be a positive finite number; anything else throws at construction. This is deliberate — a debounce window of `0` or `Infinity` is almost always a bug, and failing loudly at setup is cheaper than debugging silence later. A notify with a non-string path also throws, because `fs.watch` can hand you `null` for the filename on some platforms and silently dropping those would hide real configuration problems.

## Exports

- `Debouncer` (class)
  - `constructor({ windowMs: number, emit: (path: string) => void, clock?: () => number })`
  - `notify(path: string): void`
  - `get pendingCount: number`
  - `dispose(): void`

The optional `clock` argument exists so tests can be deterministic; in production omit it and the debouncer uses `Date.now`.
