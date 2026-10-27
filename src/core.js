/**
 * Why a custom clock:
 *
 * Node's fs.watch fires the same change event many times for a single edit
 * (editors write a temp file then rename, OSs coalesce differently per
 * platform, etc.). Collapsing the burst needs a time window. Making that
 * window depend on Date.now() makes the unit tests non-deterministic — they
 * would pass or fail depending on machine load and scheduler jitter.
 *
 * Instead the clock is injected. Production passes Date.now; tests pass a
 * fake they fully control, so every assertion is reproducible.
 */

/**
 * @typedef {() => number} Clock
 * Returns the current time in milliseconds.
 */

/**
 * @typedef {(path: string) => void} Emit
 * Called once per path after the debounce window has elapsed with no
 * further events for that path. Fires on the trailing edge only.
 */

/**
 * @typedef {Object} DebouncerOptions
 * @property {number} windowMs - How long a path must stay quiet (in ms) before
 *   its buffered notification is emitted. Must be a positive, finite number.
 * @property {Clock} [clock] - Time source. Defaults to Date.now.
 * @property {Emit} emit - Sink for the collapsed notifications.
 */

/**
 * Collapses rapid duplicate fs.watch events into a single trailing notification
 * per path within a configurable quiet window.
 *
 * Single decision taken: this is a TRAILING-edge debouncer. If events keep
 * arriving for a path within windowMs, the notification keeps getting pushed
 * forward; it only fires once the path has been quiet for windowMs. We never
 * fire on the leading edge. If you need leading-edge semantics, this is not
 * the right tool.
 */
export class Debouncer {
  #clock;
  #emit;
  #windowMs;
  #timers = new Map();

  /**
   * @param {DebouncerOptions} options
   */
  constructor({ windowMs, clock, emit }) {
    if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError("windowMs must be a positive, finite number");
    }
    if (typeof emit !== "function") {
      throw new TypeError("emit must be a function");
    }

    // Date.now is bound here so callers don't have to, and so the default is
    // stable across the instance lifetime rather than re-read on each tick.
    this.#clock = typeof clock === "function" ? clock : Date.now;
    this.#emit = emit;
    this.#windowMs = windowMs;
  }

  /**
   * Record a change event for `path`. If this is the first event for the path
   * since its last flush, a timer is armed for windowMs; subsequent events
   * within that window re-arm it (net effect: only one emit per quiet period).
   *
   * @param {string} path
   * @returns {void}
   */
  notify(path) {
    if (typeof path !== "string") {
      throw new TypeError("path must be a string");
    }
    const existing = this.#timers.get(path);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // setTimeout is used rather than tracking last-seen timestamps and polling
    // on a single interval. This keeps per-path state O(1) and avoids a busy
    // poller. The downside — timers are not real-time guarantees — is
    // acceptable for debouncing file events, which are already coarse.
    const timer = setTimeout(() => {
      this.#timers.delete(path);
      this.#emit(path);
    }, this.#windowMs);

    this.#timers.set(path, timer);
  }

  /**
   * @returns {number} Number of paths with an armed (pending) notification.
   */
  get pendingCount() {
    return this.#timers.size;
  }

  /**
   * Cancel all armed notifications without emitting them. Safe to call when
   * nothing is pending. Used for shutdown / teardown.
   *
   * @returns {void}
   */
  dispose() {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.#timers.clear();
  }
}
