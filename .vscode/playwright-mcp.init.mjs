// @ts-check

/**
 * @typedef {object} EvalProtection
 * @property {(code: string) => any} __eval - Original eval function preserved before any page scripts can disable it
 */

// Protect eval function before any page scripts can disable it
const w = /** @type {Window & EvalProtection} */ (/** @type {unknown} */ (window));
w.__eval = eval;

// After page loads, restore eval from the preserved __eval function
window.addEventListener('load', () => {
    setTimeout(() => {
        window.eval = w.__eval ?? window.eval;
    }, 1000);
});
