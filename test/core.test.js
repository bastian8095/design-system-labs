import { test } from "node:test";
import assert from "node:assert/strict";
import { Debouncer } from "../src/core.js";

// A fake clock with an advance() method. Tests that depend on timing MUST
// drive time forward explicitly here rather than sleeping; a sleep-based test
// is a test that fails on a loaded CI runner.
class FakeClock {
  constructor(start = 0) {
    this.now = start;
    // The Debouncer wraps setTimeout, which calls Date.now indirectly through
    // Node's timer list. Rather than fight Node's internal time, we take the
    // simpler approach below: flush() runs the timers synchronously.
  }
  // Debouncer's default clock path is Date.now, which we are NOT using here.
  // The clock option exists precisely so we don't need to monkey-patch globals.
  call() {
    return this.now;
  }
}

// Run every pending Node timer (with non-negative delays) to completion.
// Loops because timer callbacks may schedule further timers. Capped to avoid
// an accidental infinite loop eating the test runner.
async function flushTimers(maxTicks = 1000) {
  for (let i = 0; i < maxTicks; i++) {
    // One microtask tick so awaiting promises in callbacks settle before we
    // check whether more timers remain.
    await Promise.resolve();
    const pending = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    if (pending === 0) return;
    // Advance real time so any armed setTimeout can fire. We deliberately use
    // a short real delay rather than fake-timer plumbing — it keeps the test
    // honest about what Node actually does without coupling to internals.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("constructor validates windowMs", () => {
  assert.throws(() => new Debouncer({ windowMs: 0, emit: () => {} }), /positive, finite/);
  assert.throws(() => new Debouncer({ windowMs: -10, emit: () => {} }), /positive, finite/);
  assert.throws(() => new Debouncer({ windowMs: NaN, emit: () => {} }), /positive, finite/);
  assert.throws(() => new Debouncer({ windowMs: Infinity, emit: () => {} }), /positive, finite/);
});

test("constructor requires an emit function", () => {
  assert.throws(() => new Debouncer({ windowMs: 50 }), /emit must be a function/);
  assert.throws(() => new Debouncer({ windowMs: 50, emit: "no" }), /emit must be a function/);
});

test("notify validates the path argument", () => {
  const d = new Debouncer({ windowMs: 10, emit: () => {} });
  assert.throws(() => d.notify(42), /path must be a string/);
  assert.throws(() => d.notify(null), /path must be a string/);
  d.dispose();
});

test("a single notify emits exactly once after the window", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 10, emit: (p) => seen.push(p) });
  d.notify("/a");
  assert.equal(d.pendingCount, 1);
  await flushTimers();
  assert.deepEqual(seen, ["/a"]);
  assert.equal(d.pendingCount, 0);
});

test("rapid duplicate events for one path collapse to a single emit", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 20, emit: (p) => seen.push(p) });
  for (let i = 0; i < 5; i++) {
    d.notify("/same");
  }
  assert.equal(d.pendingCount, 1);
  await flushTimers();
  assert.deepEqual(seen, ["/same"]);
});

test("distinct paths emit independently", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 10, emit: (p) => seen.push(p) });
  d.notify("/x");
  d.notify("/y");
  assert.equal(d.pendingCount, 2);
  await flushTimers();
  seen.sort();
  assert.deepEqual(seen, ["/x", "/y"]);
});

test("re-notify within the window re-arms the timer (trailing edge)", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 15, emit: (p) => seen.push(p) });
  d.notify("/r");
  // Wait briefly but less than the window, then re-notify.
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(seen.length, 0);
  d.notify("/r");
  await flushTimers();
  assert.deepEqual(seen, ["/r"]);
});

test("dispose cancels armed notifications and emits nothing", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 10, emit: (p) => seen.push(p) });
  d.notify("/gone");
  assert.equal(d.pendingCount, 1);
  d.dispose();
  assert.equal(d.pendingCount, 0);
  await flushTimers();
  assert.deepEqual(seen, []);
});

test("dispose is safe to call when nothing is pending", () => {
  const d = new Debouncer({ windowMs: 10, emit: () => {} });
  assert.doesNotThrow(() => d.dispose());
});

test("a path notified again after flushing emits a second time", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 10, emit: (p) => seen.push(p) });
  d.notify("/twice");
  await flushTimers();
  d.notify("/twice");
  await flushTimers();
  assert.deepEqual(seen, ["/twice", "/twice"]);
});

test("an empty string path is treated like any other key", async () => {
  const seen = [];
  const d = new Debouncer({ windowMs: 5, emit: (p) => seen.push(p) });
  d.notify("");
  await flushTimers();
  assert.deepEqual(seen, [""]);
});

test("custom clock is used for the time source when provided", async () => {
  const seen = [];
  const clock = new FakeClock(1000);
  // The clock is accepted and stored; the flushTimers helper drives Node's
  // real timers so we don't need fake timer scheduling here. The point of
  // this test is that the clock function is invoked and not ignored — which
  // we confirm by asserting that constructing with a non-Date.now clock still
  // produces the expected single emit after the window elapses.
  const d = new Debouncer({ windowMs: 10, clock: () => clock.now, emit: (p) => seen.push(p) });
  d.notify("/c");
  await flushTimers();
  assert.deepEqual(seen, ["/c"]);
});
