// Interactive explorations in quantitative genetics, for marcelomollinari.com.
//
// Three standalone illustrations of general principles. Everything they show is simulated
// in this file and computed in the browser: the mixed models are fitted by REML, the
// relationships are computed from simulated pedigrees and marker genotypes, and the
// reaction norms are straight lines with simulated intercepts and slopes. Nothing here
// comes from a real breeding program.
//
// The page shows each figure at two levels: the picture with one sentence that reads it,
// and an analysis that opens in place. The assumptions behind each figure are written
// above its code.

const root = document.documentElement;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const canHover = matchMedia("(hover: hover)");
const coarsePointer = matchMedia("(pointer: coarse)");
const SVG_NS = "http://www.w3.org/2000/svg";

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

const svgEl = (name, attributes = {}, parent = null) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent?.append(node);
    return node;
};

const el = (tag, attributes = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
};

const MINUS = "−";
const signed = (value, digits = 2) => `${value < 0 ? MINUS : "+"}${Math.abs(value).toFixed(digits)}`;
const fixed = (value, digits = 2) => `${value < 0 ? MINUS : ""}${Math.abs(value).toFixed(digits)}`;
const ordinal = (n) => {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${n}th`;
    return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const correlation = (a, b) => {
    const ma = mean(a);
    const mb = mean(b);
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < a.length; i++) {
        sab += (a[i] - ma) * (b[i] - mb);
        saa += (a[i] - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
    }
    return sab / Math.sqrt(saa * sbb);
};

// Rank of every entry (1 = largest value).
const ranksOf = (values) => {
    const order = [...values.keys()].sort((i, j) => values[j] - values[i]);
    const ranks = new Array(values.length);
    order.forEach((index, position) => (ranks[index] = position + 1));
    return ranks;
};

// Seeded random numbers, so that every visitor sees the same simulated data.
const makeRng = (seed) => {
    let state = seed >>> 0;
    const uniform = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const normal = () => {
        if (spare !== null) {
            const value = spare;
            spare = null;
            return value;
        }
        let u = 0;
        while (u === 0) u = uniform();
        const radius = Math.sqrt(-2 * Math.log(u));
        const angle = 2 * Math.PI * uniform();
        spare = radius * Math.sin(angle);
        return radius * Math.cos(angle);
    };
    const shuffle = (items) => {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(uniform() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    };
    return { uniform, normal, shuffle };
};

// Run a piece of work the first time an element comes near the viewport.
const whenNear = (node, work) => {
    if (!("IntersectionObserver" in window)) {
        work();
        return;
    }
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            work();
        },
        { rootMargin: "900px 0px" },
    );
    observer.observe(node);
};

// Run a piece of work when the browser is idle, so it does not delay the first paint.
const whenIdle = (work) => {
    if ("requestIdleCallback" in window) requestIdleCallback(work, { timeout: 1500 });
    else setTimeout(work, 150);
};

// Run an entry sequence once, the first time the figure is well inside the viewport.
// Returns a function that cancels the sequence if the visitor acts first.
const playOnceVisible = (node, play) => {
    if (reduceMotion.matches || !("IntersectionObserver" in window)) return () => {};
    let cancelled = false;
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            if (!cancelled) play(() => cancelled);
        },
        { threshold: 0.45 },
    );
    observer.observe(node);
    return () => {
        cancelled = true;
        observer.disconnect();
    };
};

// Keep room for the longest of a node's possible texts at its current width, so that a change
// of wording never moves the controls near it. `texts` returns the candidates.
const holdRoom = (node, texts) => {
    let width = 0;
    const measure = () => {
        const now = node.clientWidth;
        if (!now || now === width) return;
        width = now;
        const probe = node.cloneNode(false);
        probe.removeAttribute("aria-live");
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = `position:absolute;visibility:hidden;min-height:0;width:${now}px`;
        node.parentNode.append(probe);
        let tallest = 0;
        for (const text of texts()) {
            probe.textContent = text;
            tallest = Math.max(tallest, probe.offsetHeight);
        }
        probe.remove();
        node.style.minHeight = `${tallest}px`;
    };
    new ResizeObserver(measure).observe(node);
    document.fonts?.ready.then(() => {
        width = 0;
        measure();
    });
};

// Each figure has three levels. The concept is always on the page: the picture, and one
// sentence that reads it. The analysis (controls, comparisons, numbers) opens in place with
// the button made here. The methods sit in their own disclosure in the page's HTML and can be
// read at any time. Analysis panels are hidden, never rebuilt, so whatever the visitor has
// set up in a figure is still there when the panel is opened again.
let explorers = 0;
const makeExplorer = (figure, panels, topic, onToggle = () => {}) => {
    explorers += 1;
    panels.forEach((panel, k) => {
        panel.id = `viz-analysis-${explorers}-${k + 1}`;
        panel.hidden = true;
        panel.classList.add("viz-panel");
    });
    const label = el("span");
    const button = el("button", { type: "button", class: "viz-explore", "aria-controls": panels.map((panel) => panel.id).join(" ") }, [
        el("span", { class: "viz-explore-mark", "aria-hidden": "true" }),
        label,
    ]);
    const isOpen = () => button.getAttribute("aria-expanded") === "true";
    const setOpen = (open, animate = true) => {
        const text = open ? "Hide the analysis" : "Explore the analysis";
        figure.dataset.level = open ? "analysis" : "concept";
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", `${text}: ${topic}`);
        label.textContent = text;
        for (const panel of panels) panel.hidden = !open;
        if (animate) onToggle(open);
        if (open && animate && !reduceMotion.matches) {
            for (const panel of panels) {
                panel.animate?.([{ opacity: 0, transform: "translateY(-0.4rem)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "ease-out" });
            }
        }
    };
    button.addEventListener("click", () => setOpen(!isOpen()));
    setOpen(false, false);
    return { button, setOpen, isOpen };
};

// Reorder the children of a list to match `entries`, moving rows that stay,
// fading in rows that arrive. `key` identifies a row; `render` fills it in.
const updateRanking = (list, entries, key, render) => {
    const animate = !reduceMotion.matches && list.isConnected && list.animate;
    const existing = new Map([...list.children].map((node) => [node.dataset.key, node]));
    const before = new Map();
    if (animate) for (const [id, node] of existing) before.set(id, node.getBoundingClientRect().top);

    const kept = new Set();
    entries.forEach((entry, position) => {
        const id = String(key(entry));
        let row = existing.get(id);
        if (!row) {
            row = el("li");
            row.dataset.key = id;
        }
        kept.add(id);
        render(row, entry, position);
        if (list.children[position] !== row) list.insertBefore(row, list.children[position] ?? null);
    });
    for (const [id, node] of existing) if (!kept.has(id)) node.remove();

    if (!animate) return;
    for (const row of list.children) {
        const previous = before.get(row.dataset.key);
        if (previous === undefined) {
            row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
            continue;
        }
        const shift = previous - row.getBoundingClientRect().top;
        if (Math.abs(shift) > 0.5) {
            row.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], {
                duration: 420,
                easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
            });
        }
    }
};

/* --------------------------------------------------------------------------
   Numerical tools. The systems here are small (at most 153 equations), so dense
   algebra is enough.
   -------------------------------------------------------------------------- */

// In-place Cholesky factor (lower triangle) of a symmetric positive-definite matrix
// stored row by row. Returns the log determinant, or NaN if the matrix is not positive definite.
const cholesky = (a, n) => {
    let logDet = 0;
    for (let j = 0; j < n; j++) {
        let diagonal = a[j * n + j];
        for (let k = 0; k < j; k++) diagonal -= a[j * n + k] ** 2;
        if (!(diagonal > 0)) return NaN;
        diagonal = Math.sqrt(diagonal);
        a[j * n + j] = diagonal;
        logDet += 2 * Math.log(diagonal);
        for (let i = j + 1; i < n; i++) {
            let sum = a[i * n + j];
            for (let k = 0; k < j; k++) sum -= a[i * n + k] * a[j * n + k];
            a[i * n + j] = sum / diagonal;
        }
    }
    return logDet;
};

// Solve (L L') x = b given the Cholesky factor L.
const choleskySolve = (l, n, b) => {
    const x = Float64Array.from(b);
    for (let i = 0; i < n; i++) {
        let sum = x[i];
        for (let k = 0; k < i; k++) sum -= l[i * n + k] * x[k];
        x[i] = sum / l[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
        let sum = x[i];
        for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
        x[i] = sum / l[i * n + i];
    }
    return x;
};

// (L L')^-1 given the Cholesky factor L: the whole matrix, or only its diagonal.
const choleskyInverse = (l, n, diagonalOnly = false) => {
    const lower = new Float64Array(n * n); // L^-1
    for (let j = 0; j < n; j++) {
        lower[j * n + j] = 1 / l[j * n + j];
        for (let i = j + 1; i < n; i++) {
            let sum = 0;
            for (let k = j; k < i; k++) sum -= l[i * n + k] * lower[k * n + j];
            lower[i * n + j] = sum / l[i * n + i];
        }
    }
    if (diagonalOnly) {
        const diagonal = new Float64Array(n);
        for (let j = 0; j < n; j++) for (let i = j; i < n; i++) diagonal[j] += lower[i * n + j] ** 2;
        return diagonal;
    }
    const inverse = new Float64Array(n * n);
    for (let a = 0; a < n; a++) {
        for (let b = a; b < n; b++) {
            let sum = 0;
            for (let k = b; k < n; k++) sum += lower[k * n + a] * lower[k * n + b];
            inverse[a * n + b] = sum;
            inverse[b * n + a] = sum;
        }
    }
    return inverse;
};

// Solve a small dense system A x = b by Gaussian elimination with partial pivoting.
// Returns null if A is singular.
const solveSmall = (matrix, rhs) => {
    const n = rhs.length;
    const a = matrix.map((row) => [...row]);
    const x = [...rhs];
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        if (Math.abs(a[pivot][col]) < 1e-14) return null;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        [x[col], x[pivot]] = [x[pivot], x[col]];
        for (let row = col + 1; row < n; row++) {
            const factor = a[row][col] / a[col][col];
            for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
            x[row] -= factor * x[col];
        }
    }
    for (let row = n - 1; row >= 0; row--) {
        for (let k = row + 1; k < n; k++) x[row] -= a[row][k] * x[k];
        x[row] /= a[row][row];
    }
    return x;
};

/* --------------------------------------------------------------------------
   REML for a linear mixed model with one fixed factor and independent random terms:

       y = X b + Z1 u1 + ... + Zk uk + e,   ui ~ N(0, s2_i I),   e ~ N(0, s2_e I)

   `fixed` and each term are given as the level of every observation. The fit works on
   Henderson's mixed model equations, C = W'W / s2_e + blockdiag(0, I / s2_i), W = [X Z]:

       -2 logL_R = (n - p) log(2 pi) + log|C| + n log(s2_e) + sum_i q_i log(s2_i) + y'Py

   Variance components are found by average-information REML: Newton steps that use the
   average of the observed and expected information, started from two EM steps. A step is
   halved until the likelihood does not decrease, components are kept above a small floor,
   and a component sitting on the floor with a negative score is left there. If no Newton
   step is acceptable, an EM step is taken instead.

   Returned with the estimates: the solutions (BLUEs and BLUPs), and C^-1, which holds the
   prediction error (co)variances of the random effects.
   -------------------------------------------------------------------------- */
const fitMixedModel = (y, fixed, terms) => {
    const n = y.length;
    const p = fixed.size;
    const k = terms.length;
    const offsets = [];
    let dim = p;
    for (const term of terms) {
        offsets.push(dim);
        dim += term.size;
    }
    const q = dim - p;

    // The columns of W = [X Z] that each observation touches, then W'W and W'y
    const width = k + 1;
    const hit = new Int32Array(n * width);
    for (let obs = 0; obs < n; obs++) {
        hit[obs * width] = fixed.levels[obs];
        terms.forEach((term, t) => (hit[obs * width + t + 1] = offsets[t] + term.levels[obs]));
    }
    const wtw = new Float64Array(dim * dim);
    const wty = new Float64Array(dim);
    let yty = 0;
    for (let obs = 0; obs < n; obs++) {
        for (let a = 0; a < width; a++) {
            const col = hit[obs * width + a];
            wty[col] += y[obs];
            for (let b = 0; b < width; b++) wtw[col * dim + hit[obs * width + b]] += 1;
        }
        yty += y[obs] ** 2;
    }
    const transposeTimes = (v) => {
        const out = new Float64Array(dim);
        for (let obs = 0; obs < n; obs++) for (let a = 0; a < width; a++) out[hit[obs * width + a]] += v[obs];
        return out;
    };
    const times = (solution) => {
        const out = new Float64Array(n);
        for (let obs = 0; obs < n; obs++) for (let a = 0; a < width; a++) out[obs] += solution[hit[obs * width + a]];
        return out;
    };

    // Likelihood at given variances. Leaves the Cholesky factor of C in `factor`.
    const factor = new Float64Array(dim * dim);
    const evaluate = (theta) => {
        const residualVariance = theta[k];
        for (let i = 0; i < dim * dim; i++) factor[i] = wtw[i] / residualVariance;
        terms.forEach((term, t) => {
            for (let i = 0; i < term.size; i++) factor[(offsets[t] + i) * (dim + 1)] += 1 / theta[t];
        });
        const logDet = cholesky(factor, dim);
        if (Number.isNaN(logDet)) return null;
        const solution = choleskySolve(factor, dim, wty.map((value) => value / residualVariance));
        let quadratic = yty;
        for (let i = 0; i < dim; i++) quadratic -= solution[i] * wty[i];
        quadratic /= residualVariance; // y'Py
        let logLik = -0.5 * (logDet + n * Math.log(residualVariance) + quadratic);
        terms.forEach((term, t) => (logLik -= 0.5 * term.size * Math.log(theta[t])));
        return Number.isFinite(logLik) ? { theta, logLik, solution } : null;
    };

    // Starting values: the variance left after the fixed means, shared out equally
    const counts = new Float64Array(p);
    const sums = new Float64Array(p);
    for (let obs = 0; obs < n; obs++) {
        counts[fixed.levels[obs]] += 1;
        sums[fixed.levels[obs]] += y[obs];
    }
    let spread = 0;
    for (let obs = 0; obs < n; obs++) spread += (y[obs] - sums[fixed.levels[obs]] / counts[fixed.levels[obs]]) ** 2;
    spread /= n - p;
    let state = evaluate([...terms.map(() => spread / (2 * k)), spread / 2]);

    let converged = false;
    let iterations = 0;
    for (; iterations < 80 && !converged; iterations++) {
        const theta = state.theta;
        const residualVariance = theta[k];
        // A variance that the data put at zero is held at this floor. It is small enough that the
        // likelihood there equals the likelihood at zero to about 1e-8, so a model with such a term
        // has the same likelihood as the model without it.
        const floor = 1e-10 * residualVariance;

        // Pieces of the score and of the EM update, from the current factor
        const inverseDiagonal = choleskyInverse(factor, dim, true);
        const fitted = times(state.solution);
        const residual = Float64Array.from(y, (value, obs) => value - fitted[obs]);
        let residualSs = 0;
        for (let obs = 0; obs < n; obs++) residualSs += residual[obs] ** 2;
        const trace = terms.map((term, t) => {
            let sum = 0;
            for (let i = 0; i < term.size; i++) sum += inverseDiagonal[offsets[t] + i];
            return sum;
        });
        const effectSs = terms.map((term, t) => {
            let sum = 0;
            for (let i = 0; i < term.size; i++) sum += state.solution[offsets[t] + i] ** 2;
            return sum;
        });
        const shrunk = trace.reduce((sum, value, t) => sum + value / theta[t], 0);

        const emStep = () => [
            ...terms.map((term, t) => Math.max(floor, (effectSs[t] + trace[t]) / term.size)),
            (residualSs + residualVariance * (p + q - shrunk)) / n,
        ];

        let next = null;
        if (iterations >= 2) {
            const score = [
                ...terms.map((term, t) => -0.5 * (term.size / theta[t] - (trace[t] + effectSs[t]) / theta[t] ** 2)),
                -0.5 * ((n - p - q + shrunk) / residualVariance - residualSs / residualVariance ** 2),
            ];
            // Working variates dV/dtheta_a P y, and P times each of them
            const variates = [
                ...terms.map((term, t) => Float64Array.from({ length: n }, (_, obs) => state.solution[offsets[t] + term.levels[obs]] / theta[t])),
                residual.map((value) => value / residualVariance),
            ];
            const projected = variates.map((w) => {
                const solved = choleskySolve(factor, dim, transposeTimes(w).map((value) => value / residualVariance));
                const back = times(solved);
                return w.map((value, obs) => (value - back[obs]) / residualVariance);
            });
            const information = variates.map((wa) =>
                projected.map((pb) => {
                    let sum = 0;
                    for (let obs = 0; obs < n; obs++) sum += wa[obs] * pb[obs];
                    return 0.5 * sum;
                }),
            );
            // Components on the floor that the score would push lower stay where they are
            const free = score.map((value, a) => !(a < k && theta[a] <= floor * 1.0001 && value <= 0));
            const index = free.flatMap((isFree, a) => (isFree ? [a] : []));
            const step = solveSmall(index.map((a) => index.map((b) => information[a][b])), index.map((a) => score[a]));
            if (step) {
                for (let scale = 1; scale > 1e-3 && !next; scale /= 2) {
                    const trial = [...theta];
                    index.forEach((a, i) => (trial[a] = Math.max(a < k ? floor : 1e-12, theta[a] + scale * step[i])));
                    const candidate = evaluate(trial);
                    if (candidate && candidate.logLik >= state.logLik - 1e-10) next = candidate;
                }
            }
        }
        next ??= evaluate(emStep());
        if (!next) break;

        const change = Math.max(...next.theta.map((value, a) => Math.abs(value - theta[a]) / (theta[a] + 1e-8 * residualVariance)));
        converged = iterations >= 2 && Math.abs(next.logLik - state.logLik) < 1e-10 * (1 + Math.abs(state.logLik)) && change < 1e-6;
        state = next;
    }

    // `factor` belongs to the last accepted evaluation
    const check = evaluate(state.theta);
    const inverse = choleskyInverse(factor, dim);
    const minus2LogLik = -2 * check.logLik + (n - p) * Math.log(2 * Math.PI);
    return {
        fixedEffects: state.solution.slice(0, p),
        effects: terms.map((term, t) => state.solution.slice(offsets[t], offsets[t] + term.size)),
        variances: state.theta.slice(0, k),
        residualVariance: state.theta[k],
        // Prediction error covariance between level i of term a and level j of term b
        errorCovariance: (a, i, b, j) => inverse[(offsets[a] + i) * dim + offsets[b] + j],
        minus2LogLik,
        aic: minus2LogLik + 2 * (k + 1),
        iterations,
        converged,
    };
};

/* --------------------------------------------------------------------------
   Exploration 1. Multi-environment trials

   Twenty-four genotypes grown in three trials (environments), three replicates each, on
   fields of 6 rows by 12 columns (a replicate is a band of two rows). A measurement is

       y = trial mean + row + column + genotype + genotype x trial + residual

   with rows and columns nested in trials. The trial means are fixed effects; everything
   else is random, with one variance per term shared by the three trials (a simplification:
   in practice each trial often gets its own). Four candidate models differ only in their
   random terms, with or without the field (rows and columns) and with or without the
   genotype x trial term. They share the same fixed effects, so their REML likelihoods are
   comparable and the model with the lowest AIC is selected.

   With one genetic variance and one interaction variance, the model implies the same
   genetic correlation between every pair of trials: s2_g / (s2_g + s2_ge). The three
   simulated cases differ in that correlation.
   -------------------------------------------------------------------------- */

const MET = {
    genotypes: 24,
    trials: 3,
    reps: 3,
    rows: 6,
    cols: 12,
    geneticVariance: 0.64, // genotype + genotype x trial
    residualSd: 0.8,
    trialMeans: [1.1, -0.2, -0.9],
    // What the field adds in each trial: [trend across columns, trend along rows], from one edge
    // to the other, on top of row and column effects with standard deviation `fieldSd`
    fields: [
        [2.2, 0.3],
        [0.3, 1.7],
        [0.5, 0.4],
    ],
    fieldSd: 0.3,
    scenarios: [
        // One seed for the three cases, so they share fields, layouts and trial means and differ
        // only in how much of the genetic variance is interaction. It is a seed whose outcome
        // is close to the average over 120 seeds in each case.
        { name: "None", detail: "Genotypes differ by the same amounts in every trial.", correlation: 1, seed: 20 },
        { name: "Moderate", detail: "Differences between genotypes shift from trial to trial.", correlation: 0.65, seed: 20 },
        { name: "Strong", detail: "Each trial ranks the genotypes quite differently.", correlation: 0.35, seed: 20 },
    ],
    models: [
        { name: "Genotype", detail: "One genetic value per genotype, the same in every trial.", field: false, gxe: false },
        { name: "Genotype + field", detail: "Adds the rows and columns of each trial.", field: true, gxe: false },
        { name: "Genotype + G×E", detail: "Lets a genotype’s value differ between trials.", field: false, gxe: true },
        { name: "Genotype + G×E + field", detail: "Both additions together.", field: true, gxe: true },
    ],
};

const simulateTrials = (scenario) => {
    const { genotypes, trials, reps, rows, cols, geneticVariance, residualSd, trialMeans, fields, fieldSd } = MET;
    const rng = makeRng(scenario.seed);
    const rowsPerRep = rows / reps;
    const plots = trials * rows * cols;

    const main = Array.from({ length: genotypes }, () => rng.normal() * Math.sqrt(geneticVariance * scenario.correlation));
    const interaction = Array.from({ length: trials }, () =>
        Array.from({ length: genotypes }, () => rng.normal() * Math.sqrt(geneticVariance * (1 - scenario.correlation))),
    );
    const means = rng.shuffle([...trialMeans]);
    const characters = rng.shuffle(fields.map((field) => [...field]));

    const plot = {
        trial: new Int32Array(plots),
        genotype: new Int32Array(plots),
        cell: new Int32Array(plots), // genotype within trial
        row: new Int32Array(plots), // row within trial
        col: new Int32Array(plots), // column within trial
    };
    const y = new Float64Array(plots);
    // What the field and the residual contributed to each plot, kept for checking the simulation
    const fieldEffect = new Float64Array(plots);
    const residual = new Float64Array(plots);
    for (let trial = 0; trial < trials; trial++) {
        const gradient = (count, trend) => {
            const direction = rng.uniform() < 0.5 ? -1 : 1;
            return Array.from({ length: count }, (_, i) => direction * trend * (i / (count - 1) - 0.5) + rng.normal() * fieldSd);
        };
        const colEffect = gradient(cols, characters[trial][0]);
        const rowEffect = gradient(rows, characters[trial][1]);
        for (let rep = 0; rep < reps; rep++) {
            // Complete randomisation of the genotypes within each replicate
            const order = rng.shuffle([...Array(genotypes).keys()]);
            order.forEach((genotype, position) => {
                const row = rep * rowsPerRep + Math.floor(position / cols);
                const col = position % cols;
                const index = (trial * rows + row) * cols + col;
                plot.trial[index] = trial;
                plot.genotype[index] = genotype;
                plot.cell[index] = trial * genotypes + genotype;
                plot.row[index] = trial * rows + row;
                plot.col[index] = trial * cols + col;
                const error = rng.normal() * residualSd;
                fieldEffect[index] = rowEffect[row] + colEffect[col];
                residual[index] = error;
                y[index] = 10 + means[trial] + rowEffect[row] + colEffect[col] + main[genotype] + interaction[trial][genotype] + error;
            });
        }
    }
    return { plot, y, truth: { main, interaction, means, field: fieldEffect, residual } };
};

// Fit one candidate model, and express every plot's measurement as the sum of its parts.
const fitTrialModel = (data, model) => {
    const { genotypes, trials, rows, cols } = MET;
    const { plot, y, truth } = data;
    const terms = [{ name: "genotype", size: genotypes, levels: plot.genotype }];
    if (model.gxe) terms.push({ name: "gxe", size: trials * genotypes, levels: plot.cell });
    if (model.field) {
        terms.push({ name: "row", size: trials * rows, levels: plot.row });
        terms.push({ name: "col", size: trials * cols, levels: plot.col });
    }
    const fit = fitMixedModel(y, { size: trials, levels: plot.trial }, terms);
    const at = (name) => terms.findIndex((term) => term.name === name);
    const effect = (name, level) => (at(name) < 0 ? 0 : fit.effects[at(name)][level]);
    const variance = (name) => (at(name) < 0 ? 0 : fit.variances[at(name)]);

    // Parts of each measurement, relative to the mean of the trial means
    const centre = mean(Array.from(fit.fixedEffects));
    const parts = Object.fromEntries(["measured", "environment", "field", "genotype", "gxe", "residual"].map((key) => [key, new Float64Array(y.length)]));
    for (let i = 0; i < y.length; i++) {
        parts.measured[i] = y[i] - centre;
        parts.environment[i] = fit.fixedEffects[plot.trial[i]] - centre;
        parts.field[i] = effect("row", plot.row[i]) + effect("col", plot.col[i]);
        parts.genotype[i] = effect("genotype", plot.genotype[i]);
        parts.gxe[i] = effect("gxe", plot.cell[i]);
        parts.residual[i] = parts.measured[i] - parts.environment[i] - parts.field[i] - parts.genotype[i] - parts.gxe[i];
    }

    // Predicted genetic merit: across trials (the main effect), and in each trial (main effect
    // plus interaction), each with its standard error of prediction
    const g = at("genotype");
    const x = at("gxe");
    const across = {
        value: Array.from(fit.effects[g]),
        se: Array.from({ length: genotypes }, (_, i) => Math.sqrt(fit.errorCovariance(g, i, g, i))),
    };
    const within = Array.from({ length: trials }, (_, trial) => {
        if (x < 0) return across;
        const cell = (i) => trial * genotypes + i;
        return {
            value: across.value.map((value, i) => value + fit.effects[x][cell(i)]),
            se: across.value.map((_, i) =>
                Math.sqrt(fit.errorCovariance(g, i, g, i) + fit.errorCovariance(x, cell(i), x, cell(i)) + 2 * fit.errorCovariance(g, i, x, cell(i))),
            ),
        };
    });

    const share = { field: variance("row") + variance("col"), genotype: variance("genotype"), gxe: variance("gxe"), residual: fit.residualVariance };
    const total = share.field + share.genotype + share.gxe + share.residual;
    for (const key of Object.keys(share)) share[key] /= total;

    return {
        ...model,
        aic: fit.aic,
        minus2LogLik: fit.minus2LogLik,
        converged: fit.converged,
        iterations: fit.iterations,
        trialMeans: Array.from(fit.fixedEffects, (value) => value - centre),
        variances: { genotype: variance("genotype"), gxe: variance("gxe"), row: variance("row"), col: variance("col"), residual: fit.residualVariance },
        share,
        // Implied by one genetic and one interaction variance: the same for every pair of trials
        geneticCorrelation: model.gxe ? variance("genotype") / (variance("genotype") + variance("gxe")) : null,
        parts,
        across,
        within,
        accuracy: {
            across: correlation(across.value, truth.main),
            within: within.map((prediction, trial) => correlation(prediction.value, truth.main.map((value, i) => value + truth.interaction[trial][i]))),
        },
    };
};

// What plain averages would say, for comparison: a genotype's mean over all its plots, and
// over its plots in one trial (as deviations from that trial's mean, which changes no ranking).
const plainAverages = (data) => {
    const { genotypes, trials, reps } = MET;
    const { plot, y, truth } = data;
    const within = Array.from({ length: trials }, () => new Array(genotypes).fill(0));
    y.forEach((value, i) => (within[plot.trial[i]][plot.genotype[i]] += value / reps));
    const across = Array.from({ length: genotypes }, (_, i) => mean(within.map((values) => values[i])));
    return {
        across: { rank: ranksOf(across), accuracy: correlation(across, truth.main) },
        within: within.map((values, trial) => ({
            rank: ranksOf(values),
            accuracy: correlation(values, truth.main.map((value, i) => value + truth.interaction[trial][i])),
        })),
    };
};

// Three genetic correlations between trials are in play, and they are not the same number:
//   specified  scenario.correlation, the parameter of the simulation (the share of the genetic
//              variance that is main effect);
//   realized   the correlation between two trials of the genetic values actually drawn for
//              these genotypes (main effect plus interaction), averaged over the pairs of trials;
//   estimated  s2_g / (s2_g + s2_ge) from a fitted model with a genotype x trial term.
const realizedCorrelations = (truth) => {
    const values = truth.interaction.map((effects) => effects.map((value, i) => truth.main[i] + value));
    const pairs = [];
    for (let j = 0; j < values.length; j++) for (let k = j + 1; k < values.length; k++) pairs.push(correlation(values[j], values[k]));
    return pairs;
};

const summariseTrials = (scenario, data, fits) => ({
    scenario,
    ...data,
    fits,
    realizedCorrelation: mean(realizedCorrelations(data.truth)),
    best: fits.reduce((choice, fit, m) => (fit.aic < fits[choice].aic - 1e-6 ? m : choice), 0),
    plain: plainAverages(data),
});

const analyseTrials = (scenario) => {
    const data = simulateTrials(scenario);
    return summariseTrials(scenario, data, MET.models.map((model) => fitTrialModel(data, model)));
};

// The same analysis, giving the browser a turn between models so the page stays responsive.
const analyseTrialsInSteps = async (scenario) => {
    const data = simulateTrials(scenario);
    const fits = [];
    for (const model of MET.models) {
        await new Promise((resolve) => setTimeout(resolve));
        fits.push(fitTrialModel(data, model));
    }
    return summariseTrials(scenario, data, fits);
};

const buildTrialsFigure = (figure) => {
    const stage = figure.querySelector(".viz-stage");
    const { genotypes, trials, reps, rows, cols, scenarios, models } = MET;
    const rowsPerRep = rows / reps;
    const perTrial = rows * cols;
    const CELL = 10;
    const REP_GAP = 2;
    // One colour scale for every map, so their strengths can be compared. Small deviations are
    // lifted a little (GAMMA below 1), or the genetic maps would be too faint to read.
    const SCALE = 3.2; // deviation drawn at full colour
    const GAMMA = 0.62;
    const TOP = 8;
    const yOf = (row) => row * CELL + Math.floor(row / rowsPerRep) * REP_GAP;
    const mapHeight = yOf(rows - 1) + CELL;
    const nameOf = (genotype) => `G${String(genotype + 1).padStart(2, "0")}`;
    const PARTS = [
        { key: "measured", label: "Measured", sign: "" },
        { key: "environment", label: "Environment", sign: "=" },
        { key: "field", label: "Field", sign: "+", share: "field" },
        { key: "genotype", label: "Genotype", sign: "+", share: "genotype" },
        { key: "gxe", label: "Genotype × environment", sign: "+", share: "gxe" },
        { key: "residual", label: "Unexplained", sign: "+", share: "residual" },
    ];

    // The layout is built straight away; the models are fitted a moment later (see the end)
    const state = { scenario: 1, model: 0, target: -1, plot: null, analysis: null };
    const cache = new Map();

    /* --- The matrix: one trial per line, one source of variation per column
           (turned on its side on a phone, by the stylesheet) --- */
    const matrix = el("div", { class: "met-matrix" });
    const shareCaption = (text) => [el("b", { text }), el("span", { class: "met-of", text: " of estimated variance" })];
    for (const [p, part] of PARTS.entries()) {
        part.caption = el("span", { class: "field-share" });
        if (part.share) {
            part.caption.append(...shareCaption("00%"));
            part.caption.style.visibility = "hidden";
        }
        else part.caption.textContent = part.key === "environment" ? "the mean of each trial" : `${genotypes} genotypes, ${reps} replicates`;
        const head = el("p", { class: "met-head" }, [
            el("span", { class: "met-sign", "aria-hidden": "true", text: part.sign }),
            el("strong", { text: part.label }),
            part.caption,
        ]);
        head.style.setProperty("--part", p);
        matrix.append(head);
    }
    const trialLabels = Array.from({ length: trials }, (_, t) => {
        // Captions hold their place until the models are fitted, so nothing below moves then
        const value = el("span", { class: "field-share", text: "mean +0.00" });
        value.style.visibility = "hidden";
        const label = el("p", { class: "met-trial" }, [el("strong", { text: `Trial ${t + 1}` }), value]);
        label.style.setProperty("--trial", t);
        matrix.append(label);
        return value;
    });
    const maps = []; // maps[t][p] = { svg, cells, marks }
    for (let t = 0; t < trials; t++) {
        maps.push(
            PARTS.map((part, p) => {
                const svg = svgEl("svg", { viewBox: `-1 -1 ${cols * CELL + 2} ${mapHeight + 2}`, class: "field-svg met-map", "aria-hidden": "true" });
                svg.style.setProperty("--trial", t);
                svg.style.setProperty("--part", p);
                const cells = [];
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        cells.push(svgEl("rect", { class: "viz-cell", x: col * CELL + 0.5, y: yOf(row) + 0.5, width: CELL - 1, height: CELL - 1, rx: 1.2 }, svg));
                    }
                }
                const marks = Array.from({ length: reps }, () => svgEl("rect", { class: "plot-mark", width: CELL, height: CELL, rx: 1.6 }, svg));
                if (p === 0) {
                    svg.removeAttribute("aria-hidden");
                    svg.setAttribute("role", "group");
                    svg.setAttribute("tabindex", "0");
                    svg.setAttribute("aria-label", `Field map of simulated trial ${t + 1}. Use the arrow keys to move from plot to plot.`);
                }
                matrix.append(svg);
                return { svg, cells, marks };
            }),
        );
    }

    const legend = el("p", { class: "viz-legend", "aria-hidden": "true" }, [
        el("span", { text: "Below the overall mean" }),
        el("span", { class: "viz-ramp" }),
        el("span", { text: "Above" }),
    ]);
    const hint = canHover.matches ? "Point at a plot to see how its measurement is split." : "Tap a plot to see how its measurement is split.";
    const status = el("p", { class: "viz-status is-hint", "aria-live": "polite", text: hint });

    /* --- Analysis: the data, the candidate models, the variance they find, the predictions --- */
    const radioList = (legendText, name, entries, onChoose) => {
        const list = el("fieldset", { class: "model-list" }, [el("legend", { text: legendText })]);
        const rows_ = entries.map((entry, k) => {
            const input = el("input", { type: "radio", name, value: String(k) });
            const aside = el("span", { class: "model-delta" });
            const row = el("label", { class: "model-row" }, [
                input,
                el("span", { class: "model-text" }, [el("strong", { text: entry.name }), el("span", { text: entry.detail })]),
                aside,
            ]);
            input.addEventListener("change", () => {
                if (!state.analysis) {
                    render(); // not fitted yet: put the choice back
                    return;
                }
                stopIntro();
                onChoose(k);
            });
            list.append(row);
            return { row, input, aside };
        });
        return { list, rows: rows_ };
    };
    const scenarioList = radioList("Genotype-by-environment interaction in the simulated data", "met-scenario", scenarios, (k) => {
        state.scenario = k;
        state.analysis = analysisOf(k);
        state.model = state.analysis.best;
        state.plot = null;
        render();
    });
    // The correlation named here is the parameter of the simulation, and is labelled as such
    scenarioList.rows.forEach(({ row }, k) => {
        row.querySelector(".model-text span").textContent = `${scenarios[k].detail} Specified genetic correlation between trials: ${fixed(scenarios[k].correlation)}.`;
    });
    const modelList = radioList("Candidate models, compared by AIC", "met-model", models, (k) => {
        state.model = k;
        render();
    });
    const MODEL_NOTE =
        "All four models have the same fixed effects, one mean per trial, and are fitted by REML, so their restricted likelihoods and their AIC can be compared. " +
        "A variance estimated at zero still counts as a parameter.";
    const modelNote = el("p", { class: "met-note", text: MODEL_NOTE });

    // Where the variance within trials goes, according to the model shown
    const SHARES = [
        ["field", "Field"],
        ["genotype", "Genotype"],
        ["gxe", "Genotype × environment"],
        ["residual", "Unexplained"],
    ];
    const barSegments = SHARES.map(([key]) => el("i", { class: `met-bar-part met-bar-${key}` }));
    const barLabels = SHARES.map(([key, label]) => {
        const value = el("b");
        return { value, item: el("li", {}, [el("i", { class: `met-bar-part met-bar-${key}`, "aria-hidden": "true" }), `${label} `, value]) };
    });
    const bar = el("div", { class: "met-bar" }, [
        el("p", { class: "rank-title", text: "Estimated variance within trials" }),
        el("div", { class: "met-bar-track", "aria-hidden": "true" }, barSegments),
        el("ul", { class: "met-bar-key" }, barLabels.map((entry) => entry.item)),
    ]);

    // Predictions: across trials, or in one trial
    const targets = [{ value: -1, label: "Across trials" }, ...Array.from({ length: trials }, (_, t) => ({ value: t, label: `Trial ${t + 1}` }))];
    const targetList = el("fieldset", { class: "seg" }, [el("legend", { text: "Predicted genetic merit" })]);
    const targetInputs = targets.map((target) => {
        const input = el("input", { type: "radio", name: "met-target", value: String(target.value) });
        targetList.append(el("label", {}, [input, el("span", { text: target.label })]));
        input.addEventListener("change", () => {
            if (state.analysis) {
                stopIntro();
                state.target = target.value;
            }
            render();
        });
        return input;
    });
    const ranking = el("ol", { class: "rank-list is-loading" });
    const rankSummary = el("p", { class: "rank-summary" });
    const blupNote = el("p", {
        class: "met-note",
        // The standard errors are those of the model shown: square roots of its prediction error variances
        // at the REML estimates. They leave out the uncertainty of the variance estimates themselves, and
        // they are too small when the model omits a term the data contain.
        text: "Predictions are BLUPs: estimates of genetic merit, shrunk toward the average in proportion to their uncertainty. Whiskers show one standard error under the model shown, with its estimated variances taken as known.",
    });

    /* --- Concept: the matrix and one sentence. Analysis: everything above. --- */
    const takeaway = el("p", { class: "viz-takeaway", "aria-live": "polite", text: "Fitting the models to these simulated trials…" });
    const analysisPanel = el("div", { class: "met-panel" }, [
        bar,
        el("div", { class: "field-lower" }, [
            el("div", { class: "field-controls" }, [scenarioList.list, modelList.list, modelNote]),
            el("div", { class: "rank-panel" }, [targetList, ranking, rankSummary, blupNote]),
        ]),
    ]);
    const explorer = makeExplorer(figure, [analysisPanel], "multi-environment trials");
    stage.append(matrix, el("div", { class: "field-readout" }, [legend, status]), el("div", { class: "viz-brief field-brief" }, [takeaway, explorer.button]), analysisPanel);

    /* --- Drawing --- */
    const analysisOf = (k) => {
        if (!cache.has(k)) cache.set(k, analyseTrials(scenarios[k]));
        return cache.get(k);
    };
    const paint = (cell, value) => {
        cell.classList.toggle("is-low", value < 0);
        cell.style.setProperty("--t", `${(Math.min(1, Math.abs(value) / SCALE) ** GAMMA * 100).toFixed(1)}%`);
    };
    const percent = (value) => `${Math.round(value * 100)}%`;

    const describePlot = () => {
        const { plot, fits } = state.analysis;
        const { parts } = fits[state.model];
        const i = state.plot;
        return (
            `${nameOf(plot.genotype[i])} in trial ${plot.trial[i] + 1}: measured ${signed(parts.measured[i])} = environment ${signed(parts.environment[i])}, ` +
            `field ${signed(parts.field[i])}, genotype ${signed(parts.genotype[i])}, genotype × environment ${signed(parts.gxe[i])}, unexplained ${signed(parts.residual[i])}.`
        );
    };

    const renderMarks = () => {
        if (!state.analysis) return;
        const { plot } = state.analysis;
        const selected = state.plot;
        const genotype = selected === null ? null : plot.genotype[selected];
        for (let t = 0; t < trials; t++) {
            const same = [];
            if (genotype !== null) for (let i = t * perTrial; i < (t + 1) * perTrial; i++) if (plot.genotype[i] === genotype) same.push(i);
            for (const map of maps[t]) {
                map.marks.forEach((mark, k) => {
                    const index = same[k];
                    mark.classList.toggle("is-on", index !== undefined);
                    mark.classList.toggle("is-current", index === selected);
                    if (index === undefined) return;
                    const local = index - t * perTrial;
                    mark.setAttribute("x", (local % cols) * CELL);
                    mark.setAttribute("y", yOf(Math.floor(local / cols)));
                });
            }
        }
        for (const row of ranking.children) row.classList.toggle("is-on", genotype !== null && row.dataset.key === String(genotype));
        status.classList.toggle("is-hint", selected === null);
        status.textContent = selected === null ? hint : describePlot();
    };

    const render = () => {
        scenarioList.rows.forEach(({ row, input }, k) => {
            input.checked = k === state.scenario;
            row.classList.toggle("is-shown", k === state.scenario);
        });
        targetInputs.forEach((input, k) => (input.checked = targets[k].value === state.target));
        modelList.rows.forEach(({ input }, m) => (input.checked = m === state.model));
        const { analysis } = state;
        if (!analysis) return;
        const fit = analysis.fits[state.model];
        const scenario = scenarios[state.scenario];
        ranking.classList.remove("is-loading");

        // Maps and their captions
        for (let t = 0; t < trials; t++) {
            PARTS.forEach((part, p) => {
                const values = fit.parts[part.key];
                maps[t][p].cells.forEach((cell, i) => paint(cell, values[t * perTrial + i]));
            });
            trialLabels[t].textContent = `mean ${signed(fit.trialMeans[t])}`;
            trialLabels[t].style.visibility = "";
        }
        for (const part of PARTS) {
            if (!part.share) continue;
            part.caption.replaceChildren(...shareCaption(percent(fit.share[part.share])));
            part.caption.style.visibility = "";
        }

        // Candidate models
        const bestAic = analysis.fits[analysis.best].aic;
        modelList.rows.forEach(({ row, input, aside }, m) => {
            input.checked = m === state.model;
            row.classList.toggle("is-shown", m === state.model);
            row.classList.toggle("is-best", m === analysis.best);
            aside.textContent = m === analysis.best ? "Lowest AIC, selected" : `AIC ${(analysis.fits[m].aic - bestAic).toFixed(1)} higher`;
        });

        // The largest model is not always the one selected, and the note says so when it is not
        modelNote.textContent =
            analysis.best === models.length - 1
                ? MODEL_NOTE
                : `${MODEL_NOTE} Here the largest model is not selected: its extra term does not improve the fit enough to pay for another parameter.`;

        // Variance partition
        SHARES.forEach(([key], k) => {
            barSegments[k].style.setProperty("--w", (fit.share[key] * 100).toFixed(2));
            barLabels[k].value.textContent = key === "gxe" && !fit.gxe ? "not in this model" : key === "field" && !fit.field ? "not in this model" : percent(fit.share[key]);
        });

        // Predictions for the chosen target
        const across = state.target < 0;
        const prediction = across ? fit.across : fit.within[state.target];
        const plain = across ? analysis.plain.across : analysis.plain.within[state.target];
        const acrossRank = ranksOf(fit.across.value);
        const order = [...prediction.value.keys()].sort((a, b) => prediction.value[b] - prediction.value[a]).slice(0, TOP);
        const maxBar = Math.max(
            ...analysis.fits.flatMap((candidate) => [candidate.across, ...candidate.within].flatMap((set) => set.value.map((value, g) => value + set.se[g]))),
        );
        const share = (value) => `${((Math.min(maxBar, Math.max(0, value)) / maxBar) * 100).toFixed(1)}%`;
        updateRanking(
            ranking,
            order,
            (genotype) => genotype,
            (row, genotype, position) => {
                if (!row.firstChild) {
                    row.append(
                        el("span", { class: "rank-place" }),
                        el("span", { class: "rank-name", text: nameOf(genotype) }),
                        el("span", { class: "rank-bar", "aria-hidden": "true" }, [el("b"), el("i")]),
                        el("span", { class: "rank-value" }),
                        el("span", { class: "rank-plain" }, [el("span", { class: "when-wide" }), el("span", { class: "when-narrow" })]),
                    );
                }
                const [place, , barCell, value, note] = row.children;
                const merit = prediction.value[genotype];
                const se = prediction.se[genotype];
                place.textContent = String(position + 1);
                barCell.style.setProperty("--v", share(merit));
                barCell.style.setProperty("--lo", share(merit - se));
                barCell.style.setProperty("--hi", share(merit + se));
                value.textContent = signed(merit);
                if (across) {
                    // Against plain averages: highlight genotypes the model moved by three places or more
                    const rank = plain.rank[genotype];
                    note.firstChild.textContent = `${ordinal(rank)} by plain average`;
                    note.lastChild.textContent = `avg. ${ordinal(rank)}`;
                    note.classList.toggle("is-moved", Math.abs(rank - (position + 1)) >= 3);
                } else {
                    // Against the across-trial ranking: highlight genotypes it would have left out
                    const rank = acrossRank[genotype];
                    note.firstChild.textContent = `${ordinal(rank)} across trials`;
                    note.lastChild.textContent = `${ordinal(rank)} overall`;
                    note.classList.toggle("is-moved", rank > TOP);
                }
            },
        );

        const sameOrder = ranksOf(prediction.value).every((rank, g) => rank === plain.rank[g]);
        const known = "known here because the data are simulated";
        let summary;
        if (across) {
            summary =
                `Correlation with the true main effects of the genotypes, ${known}: ` +
                (sameOrder
                    ? `${fixed(fit.accuracy.across)}, the same as for plain averages. Every genotype appears once in each replicate, so without field terms the model cannot change their order.`
                    : `${fixed(fit.accuracy.across)} for these predictions, ${fixed(plain.accuracy)} for plain averages.`);
        } else {
            const trial = state.target + 1;
            summary =
                (fit.gxe ? "" : "This model has no genotype-by-environment term, so it predicts the same merit in every trial. ") +
                `Correlation with the true genetic merit in trial ${trial} (main effect plus interaction), ${known}: ${fixed(fit.accuracy.within[state.target])} for these predictions, ` +
                `${fixed(plain.accuracy)} for the plain averages of trial ${trial} alone.`;
        }
        if (fit.gxe) {
            summary +=
                ` Genetic correlation between trials: ${fixed(fit.geneticCorrelation)} estimated by this model, ${fixed(scenario.correlation)} specified in the simulation, ` +
                `${fixed(analysis.realizedCorrelation)} realized among these ${genotypes} genotypes.`;
        }
        rankSummary.textContent = summary;

        // The sentence under the matrix
        const attributed = [
            `${percent(fit.share.genotype)} to genotypes`,
            fit.field ? `${percent(fit.share.field)} to the field` : null,
            fit.gxe ? `${percent(fit.share.gxe)} to genotype-by-environment interaction` : null,
        ].filter(Boolean);
        const list = attributed.length > 2 ? `${attributed.slice(0, -1).join(", ")} and ${attributed.at(-1)}` : attributed.join(" and ");
        const missing =
            !fit.field && !fit.gxe
                ? " It has no terms for the field or for genotype-by-environment interaction."
                : !fit.field
                  ? " It has no terms for the field."
                  : !fit.gxe
                    ? " It has no genotype-by-environment term."
                    : "";
        takeaway.textContent =
            `Of the estimated variance within these trials, ${state.model === analysis.best ? "the selected model" : "this model"} attributes ${list}.${missing} ` +
            "The differences between trial means are an environmental main effect, not interaction.";

        renderMarks();
    };

    /* --- Pointing at plots --- */
    const select = (index) => {
        if (index === state.plot || !state.analysis) return;
        state.plot = index;
        renderMarks();
    };
    const plotAt = (svg, trial, event) => {
        const transform = svg.getScreenCTM();
        if (!transform) return null;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
        const col = Math.floor(point.x / CELL);
        let row = -1;
        for (let r = 0; r < rows; r++) if (point.y >= yOf(r) && point.y < yOf(r) + CELL) row = r;
        return row >= 0 && col >= 0 && col < cols ? trial * perTrial + row * cols + col : null;
    };
    maps.forEach((trialMaps, t) => {
        for (const { svg } of trialMaps) {
            svg.addEventListener("pointerdown", (event) => {
                stopIntro();
                const index = plotAt(svg, t, event);
                // On touch screens a second tap on the same plot clears the selection
                select(event.pointerType !== "mouse" && index === state.plot ? null : index);
            });
            svg.addEventListener("pointermove", (event) => {
                if (event.pointerType === "mouse") select(plotAt(svg, t, event));
            });
            svg.addEventListener("pointerleave", (event) => {
                if (event.pointerType === "mouse") select(null);
            });
        }
        trialMaps[0].svg.addEventListener("keydown", (event) => {
            const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
            if (event.key === "Escape") {
                select(null);
                return;
            }
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            stopIntro();
            const inTrial = state.plot !== null && Math.floor(state.plot / perTrial) === t;
            const local = inTrial ? state.plot - t * perTrial : 0;
            const row = Math.min(rows - 1, Math.max(0, Math.floor(local / cols) + (inTrial ? move[0] : 0)));
            const col = Math.min(cols - 1, Math.max(0, (local % cols) + (inTrial ? move[1] : 0)));
            select(t * perTrial + row * cols + col);
        });
    });

    /* --- Fit the models once the figure is near the viewport, then build up the selected
           model one term at a time --- */
    let stopIntro = () => {};
    render();
    const begin = async () => {
        try {
            const scenario = scenarios[state.scenario];
            cache.set(state.scenario, await analyseTrialsInSteps(scenario));
            state.analysis = cache.get(state.scenario);
        } catch (error) {
            figure.hidden = true;
            console.error(error);
            return;
        }
        whenIdle(async () => {
            for (const k of scenarios.keys()) {
                if (!cache.has(k)) cache.set(k, await analyseTrialsInSteps(scenarios[k]));
            }
        });
        const final = state.analysis.best;
        // Genotype alone, then with the field, then with the interaction
        const path = [0, ...(models[final].field && final !== 1 ? [1] : []), ...(final === 0 ? [] : [final])];
        state.model = reduceMotion.matches ? final : 0;
        render();
        if (state.model === final) return;
        let timer = null;
        let step = 0;
        const cancel = playOnceVisible(matrix, (isCancelled) => {
            const advance = () => {
                if (isCancelled() || step >= path.length - 1) return;
                step += 1;
                state.model = path[step];
                render();
                timer = setTimeout(advance, 1700);
            };
            timer = setTimeout(advance, 1200);
        });
        stopIntro = () => {
            cancel();
            clearTimeout(timer);
            stopIntro = () => {};
        };
    };
    whenNear(matrix, () => whenIdle(begin));
};

/* --------------------------------------------------------------------------
   Exploration 2. Expected and estimated relationships

   A generic simulated population: five unrelated, non-inbred parents, four full-sib
   families of eight that share parents (A = P1 x P2, B = P2 x P3, C = P3 x P4, D = P4 x P5
   as recorded), and three samples genotyped twice. 40 samples, 780 pairs.

   Expected relationships are the additive relationship matrix A of the recorded pedigree,
   by the tabular method. Estimated relationships are VanRaden's first method,
   G = WW' / (2 sum p(1 - p)), on 1,200 unlinked biallelic markers with 0.5% of calls wrong.
   W is centred with the allele frequencies of the base population (known here because it
   is simulated), which puts G on the same scale as A. With frequencies estimated from the
   samples themselves, G would be centred on the current population and the two could not
   be compared directly.

   Estimates scatter around their expected values (standard deviation near 0.03 here) for
   two reasons: relatives do not share exactly the expected fraction of their genomes, and
   a finite set of markers measures that fraction with error. They are not confined to 0-1.

   The recorded pedigree differs from the simulated truth in three places (one offspring in
   the wrong family, one repeat that is another individual, one family whose recorded second
   parent is not its parent). The "hypothetical revisions" are that truth, which is why
   every pair agrees once they are applied.
   -------------------------------------------------------------------------- */

// A pair is marked when its two relationships differ by more than `threshold`. Relationship
// classes are 0.25 apart and the estimates here have a standard deviation near 0.03, so this
// value separates the two in this simulation. It is not a general rule: real data need a
// threshold chosen for their own marker density, population and error rate.
const KIN = { markers: 1200, perFamily: 8, errorRate: 0.005, threshold: 0.15, seed: 404 };

// Additive relationship matrix by the tabular method. `parents[i]` is [sire, dam] with
// both listed before i, or null for a founder. Founders are unrelated and not inbred.
const additiveRelationships = (parents) => {
    const n = parents.length;
    const a = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        const pair = parents[i];
        a[i][i] = pair ? 1 + 0.5 * a[pair[0]][pair[1]] : 1;
        for (let j = 0; j < i; j++) {
            const value = pair ? 0.5 * (a[j][pair[0]] + a[j][pair[1]]) : 0;
            a[i][j] = value;
            a[j][i] = value;
        }
    }
    return a;
};

const simulateKinship = (withMarkers = false) => {
    const { markers, perFamily, errorRate, seed } = KIN;
    const rng = makeRng(seed);
    const FAMILIES = ["A", "B", "C", "D"];

    // Individuals 0-4 are the parents P1-P5; 5 is the true, ungenotyped second parent of family D.
    const UNKNOWN = 5;
    const trueParents = Array.from({ length: 6 }, () => null);
    const recordedParents = Array.from({ length: 6 }, () => null);
    const offspring = {}; // "C7" -> individual index
    FAMILIES.forEach((family, f) => {
        for (let k = 1; k <= perFamily; k++) {
            offspring[`${family}${k}`] = trueParents.length;
            const recorded = [f, f + 1];
            let actual = f === 3 ? [3, UNKNOWN] : recorded; // difference 3: P5 is not a parent of family D
            if (family === "C" && k === 7) actual = [0, 1]; // difference 1: C7 belongs to family A
            trueParents.push(actual);
            recordedParents.push(recorded);
        }
    });

    // Samples, in the order of the recorded pedigree. `recorded` and `actual` are individuals.
    const samples = [];
    const add = (label, group, recorded, actual = recorded, repeat = false) => samples.push({ label, group, recorded, actual, repeat });
    for (let k = 0; k < 5; k++) {
        add(`P${k + 1}`, "P", k);
        if (k === 1) add("P2 repeat", "P", k, k, true);
    }
    FAMILIES.forEach((family) => {
        for (let k = 1; k <= perFamily; k++) {
            const individual = offspring[`${family}${k}`];
            add(`${family}${k}`, family, individual);
            if (family === "A" && k === 3) add("A3 repeat", "A", individual, individual, true);
            // difference 2: the sample labelled as a repeat of C5 is D2
            if (family === "C" && k === 5) add("C5 repeat", "C", individual, offspring.D2, true);
        }
    });
    const indexOf = Object.fromEntries(samples.map((sample, i) => [sample.label, i]));

    // Genotypes (0, 1 or 2 copies of one allele) for every individual, from the true pedigree
    const frequency = Float64Array.from({ length: markers }, () => 0.1 + 0.8 * rng.uniform());
    const genotypes = trueParents.map(() => new Int8Array(markers));
    const gamete = (genotype) => (genotype === 1 ? (rng.uniform() < 0.5 ? 1 : 0) : genotype / 2);
    trueParents.forEach((pair, i) => {
        for (let m = 0; m < markers; m++) {
            genotypes[i][m] = pair
                ? gamete(genotypes[pair[0]][m]) + gamete(genotypes[pair[1]][m])
                : (rng.uniform() < frequency[m] ? 1 : 0) + (rng.uniform() < frequency[m] ? 1 : 0);
        }
    });

    // Each sample is genotyped separately, with a small rate of wrong calls
    let scale = 0;
    for (let m = 0; m < markers; m++) scale += 2 * frequency[m] * (1 - frequency[m]);
    const centred = samples.map((sample) => {
        const row = new Float64Array(markers);
        for (let m = 0; m < markers; m++) {
            let call = genotypes[sample.actual][m];
            if (rng.uniform() < errorRate) call = call === 1 ? (rng.uniform() < 0.5 ? 0 : 2) : 1;
            row[m] = call - 2 * frequency[m];
        }
        return row;
    });
    const n = samples.length;
    const genomic = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = 0;
            for (let m = 0; m < markers; m++) sum += centred[i][m] * centred[j][m];
            genomic[i][j] = sum / scale;
            genomic[j][i] = sum / scale;
        }
    }

    const expand = (relationships, key) =>
        samples.map((a) => Float64Array.from(samples, (b) => relationships[a[key]][b[key]]));
    const recorded = expand(additiveRelationships(recordedParents), "recorded");
    const corrected = expand(additiveRelationships(trueParents), "actual");

    // Row order and family of every sample, before and after the corrections
    const correctedGroup = samples.map((sample) => sample.group);
    correctedGroup[indexOf.C7] = "A";
    correctedGroup[indexOf["C5 repeat"]] = "D";
    const recordedOrder = [...samples.keys()];
    const correctedOrder = recordedOrder.filter((i) => i !== indexOf.C7 && i !== indexOf["C5 repeat"]);
    correctedOrder.splice(correctedOrder.indexOf(indexOf.A8) + 1, 0, indexOf.C7);
    correctedOrder.splice(correctedOrder.indexOf(indexOf.D2) + 1, 0, indexOf["C5 repeat"]);

    const result = { samples, indexOf, genomic, recorded, corrected, recordedOrder, correctedOrder, correctedGroup, n };
    // For checking the simulation: base allele frequencies and each sample's calls, centred
    return withMarkers ? { ...result, frequency, centred } : result;
};

const buildKinFigure = (figure) => {
    const stage = figure.querySelector(".viz-stage");
    const data = simulateKinship();
    const { samples, indexOf, genomic, n } = data;
    const { threshold } = KIN;
    const GROUPS = ["P", "A", "B", "C", "D"];

    const members = (group) => samples.map((sample, i) => (sample.group === group && !sample.repeat ? i : -1)).filter((i) => i >= 0);
    const meanWith = (focal, others) => mean(others.filter((i) => i !== focal).map((i) => genomic[focal][i]));
    const discordant = (pedigree) => {
        let count = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (Math.abs(genomic[i][j] - pedigree[i][j]) > threshold) count++;
        return count;
    };
    const pairs = (n * (n - 1)) / 2;

    const c7 = indexOf.C7;
    const c5r = indexOf["C5 repeat"];
    const p5 = indexOf.P5;
    // Each case is worded as what the estimates show and one explanation consistent with them.
    // A substantial discrepancy warrants further investigation. By itself it neither establishes
    // an error nor identifies its cause, so nothing here is presented as a diagnosis.
    const siblingMean = mean(members("D").flatMap((i) => members("D").filter((j) => j < i).map((j) => genomic[i][j])));
    const findings = [
        {
            focal: c7,
            title: "An offspring that resembles another family",
            brief: "recorded in family C but resembles family A",
            evidence:
                `C7 is recorded in family C, but its estimated relationship with its recorded siblings averages ` +
                `${fixed(meanWith(c7, members("C")))}. With the offspring of family A it averages ${fixed(meanWith(c7, members("A")))}, ` +
                `the value expected between full siblings.`,
            resolved: "C7 belongs to family A.",
        },
        {
            focal: c5r,
            title: "A repeated sample unlike its original",
            brief: "labelled as a repeat of C5 but matches D2",
            evidence:
                `Two samples of the same individual should be almost identical, yet the estimated relationship between C5 and its repeat is ` +
                `${fixed(genomic[c5r][indexOf.C5])}. Between that repeat and D2 it is ${fixed(genomic[c5r][indexOf.D2])}.`,
            resolved: "the sample comes from D2, not from C5.",
        },
        {
            focal: p5,
            title: "A parent unrelated to its recorded offspring",
            brief: "a recorded parent of family D but unrelated to its offspring",
            evidence:
                `P5 is recorded as a parent of family D, but its estimated relationship with the eight offspring averages ` +
                `${fixed(meanWith(p5, members("D")))} where 0.50 is expected. The offspring are still related to one another ` +
                `as full siblings (${fixed(siblingMean)} on average), so they appear to share two parents.`,
            resolved: "the second parent of family D is an individual that was not genotyped.",
        },
    ];

    const state = { finding: 0, corrected: false, mix: 0, reveal: 1, cursor: null, size: 0 };

    /* --- Matrix --- */
    const canvas = el("canvas", {
        class: "kin-canvas",
        tabindex: "0",
        role: "img",
        "aria-label":
            "Relationship matrix for 40 simulated samples: five parents, four families of eight offspring and three repeated samples. " +
            "Above the diagonal, relationships expected from the pedigree; below it, relationships estimated from markers. " +
            "Use the arrow keys to move between pairs.",
    });
    const context = canvas.getContext("2d");
    const hint = canHover.matches ? "Point at a cell to compare the two values for that pair." : "Tap a cell to compare the two values for that pair.";
    const status = el("p", { class: "viz-status is-hint", "aria-live": "polite", text: hint });
    const key = el("p", { class: "kin-key", "aria-hidden": "true" }, [
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-tri kin-tri-upper" }), "Expected from the pedigree"]),
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-tri kin-tri-lower" }), "Estimated from markers"]),
    ]);
    // The shading scale, with the relationships a reader will meet marked on it. Its ends say
    // "or below" and "or above" because estimated relationships are not confined to 0-1.
    const scale = el("div", { class: "kin-scale", "aria-hidden": "true" }, [
        el("i", { class: "kin-scale-ramp" }),
        ...[
            [0, "0 or below", "unrelated"],
            [0.25, "0.25", "half siblings"],
            [0.5, "0.5", "full siblings, parent and offspring"],
            [1, "1 or above", "same individual"],
        ].map(([at, value, meaning]) => {
            const text =
                at === 0.5
                    ? [el("span", { class: "when-wide", text: meaning }), el("span", { class: "when-narrow", text: "full siblings, parents" })]
                    : [meaning];
            const mark = el("span", { class: at === 1 ? "kin-scale-mark is-last" : "kin-scale-mark" }, [el("b", { text: value }), ...text]);
            mark.style.setProperty("--at", `${at * 100}%`);
            return mark;
        }),
    ]);
    const matrixPanel = el("div", { class: "kin-matrix" }, [canvas, key, scale, status]);

    /* --- Every pair: the relationship the pedigree implies against the one estimated --- */
    const pairsSvg = svgEl("svg", { class: "kin-evidence kin-pairs", "aria-hidden": "true" });
    const pairsNote = el("p", { class: "met-note", "aria-live": "polite" });
    const chartKey = el("p", { class: "kin-key", "aria-hidden": "true" }, [
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-dash" }), "Expected from the pedigree"]),
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-dot" }), "Estimated from markers"]),
    ]);

    /* --- The three samples whose estimates do not fit --- */
    const findingList = el("fieldset", { class: "model-list kin-findings" }, [el("legend", { text: "Three samples that do not fit the pedigree" })]);
    const findingInputs = findings.map((finding, k) => {
        const input = el("input", { type: "radio", name: "kin-finding", value: String(k) });
        findingList.append(el("label", { class: "model-row" }, [input, el("span", { class: "model-text" }, [el("strong", { text: finding.title })])]));
        input.addEventListener("change", () => {
            stopIntro();
            state.finding = k;
            render();
        });
        return input;
    });
    const detail = el("p", { class: "kin-detail", "aria-live": "polite" });
    const evidenceTitle = el("p", { class: "kin-evidence-title" });
    const evidence = svgEl("svg", { class: "kin-evidence", "aria-hidden": "true" });
    const tally = el("span", { class: "trial-note" });
    const correctButton = el("button", { type: "button", class: "viz-button", "aria-pressed": "false", text: "Apply the three hypothetical revisions" });
    const caveat = el("p", {
        class: "kin-caveat",
        text:
            "A substantial discrepancy between pedigree expectations and genomic relationships warrants further investigation. It does not, by itself, establish an error or identify its cause. " +
            "The revisions are one explanation consistent with these simulated data, not a diagnosis.",
    });

    /* --- Concept: the matrix and one sentence. Analysis: every pair, the three samples, the revisions. --- */
    const takeaway = el("p", { class: "viz-takeaway", "aria-live": "polite" });
    const analysisPanel = el("div", { class: "kin-side" }, [
        el("p", { class: "rank-title", text: `All ${pairs} pairs of samples` }),
        chartKey,
        pairsSvg,
        pairsNote,
        findingList,
        detail,
        evidenceTitle,
        evidence,
        el("p", { class: "viz-actions kin-actions" }, [correctButton, tally]),
        caveat,
    ]);
    const explorer = makeExplorer(figure, [analysisPanel], "expected and estimated relationships", () => {
        renderPairs();
        renderEvidence();
    });
    stage.append(
        el("div", { class: "kin-layout" }, [matrixPanel, el("div", { class: "viz-aside" }, [el("div", { class: "viz-brief" }, [takeaway, explorer.button]), analysisPanel])]),
    );

    /* --- State helpers --- */
    const positionIn = (order) => {
        const position = new Float64Array(n);
        order.forEach((sample, k) => (position[sample] = k));
        return position;
    };
    const recordedPosition = positionIn(data.recordedOrder);
    const correctedPosition = positionIn(data.correctedOrder);
    const positionOf = (i) => recordedPosition[i] + state.mix * (correctedPosition[i] - recordedPosition[i]);
    const pedigreeOf = (i, j) => data.recorded[i][j] + state.mix * (data.corrected[i][j] - data.recorded[i][j]);
    const settled = () => (state.corrected ? { order: data.correctedOrder, pedigree: data.corrected } : { order: data.recordedOrder, pedigree: data.recorded });
    const groupOf = (i) => (state.corrected ? data.correctedGroup[i] : samples[i].group);

    /* --- Drawing the matrix --- */
    const colours = {};
    const readColours = () => {
        const style = getComputedStyle(figure);
        for (const [name, token] of Object.entries({ hi: "--viz-hi", zero: "--viz-zero", ink: "--ink", muted: "--muted", accent: "--accent", surface: "--surface" })) {
            colours[name] = style.getPropertyValue(token).trim();
        }
        colours.font = style.fontFamily;
    };

    const draw = () => {
        const size = state.size;
        if (!size) return;
        const margin = size < 360 ? 20 : 26;
        const cell = (size - margin - 1) / n;
        const at = (position) => margin + position * cell;
        const pad = Math.min(0.6, cell * 0.07);
        context.clearRect(0, 0, size, size);

        // Cells: pedigree where the row is above the column, genotypes where it is below
        const position = Float64Array.from({ length: n }, (_, i) => positionOf(i));
        const moving = [];
        const paint = (i, j) => {
            const upper = position[i] < position[j];
            if (!upper && Math.abs(position[i] - position[j]) > state.reveal * n) return;
            const value = upper ? pedigreeOf(i, j) : genomic[i][j];
            const x = at(position[j]) + pad;
            const y = at(position[i]) + pad;
            const side = cell - 2 * pad;
            context.globalAlpha = 1;
            context.fillStyle = colours.zero;
            context.fillRect(x, y, side, side);
            context.globalAlpha = Math.min(1, Math.max(0, value)) ** 0.85;
            context.fillStyle = colours.hi;
            context.fillRect(x, y, side, side);
        };
        for (let i = 0; i < n; i++) {
            if (state.mix > 0 && state.mix < 1 && recordedPosition[i] !== correctedPosition[i] && Math.abs(recordedPosition[i] - correctedPosition[i]) > 1) {
                moving.push(i);
                continue;
            }
            for (let j = 0; j < n; j++) if (i !== j && !moving.includes(j)) paint(i, j);
        }
        // Samples that are travelling to their new place are drawn last, on top
        for (const i of moving) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                paint(i, j);
                paint(j, i);
            }
        }
        context.globalAlpha = 1;

        // Family brackets and letters along the top and left edges
        const { order } = settled();
        context.font = `600 ${size < 360 ? 10 : 11.5}px ${colours.font}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineWidth = 1;
        for (const group of GROUPS) {
            const places = order.map((sample, k) => (groupOf(sample) === group ? k : -1)).filter((k) => k >= 0);
            const from = at(places[0]) + 1.5;
            const to = at(places[places.length - 1] + 1) - 1.5;
            const middle = (from + to) / 2;
            context.strokeStyle = colours.muted;
            context.fillStyle = colours.muted;
            context.globalAlpha = state.mix > 0 && state.mix < 1 ? 0.25 : 1;
            context.beginPath();
            context.moveTo(from, margin - 5.5);
            context.lineTo(to, margin - 5.5);
            context.moveTo(margin - 5.5, from);
            context.lineTo(margin - 5.5, to);
            context.stroke();
            context.fillText(group, middle, margin - 14);
            context.fillText(group, margin - 14, middle);
        }
        context.globalAlpha = 1;

        // The selected finding: its row and column, and the cells that disagree
        const focal = findings[state.finding].focal;
        const focalAt = at(position[focal]);
        context.strokeStyle = colours.accent;
        context.fillStyle = colours.accent;
        context.lineWidth = 1.25;
        context.strokeRect(margin + 0.5, focalAt - 0.5, n * cell, cell + 1);
        context.strokeRect(focalAt - 0.5, margin + 0.5, cell + 1, n * cell);
        // Pointers in the margins mark the three samples under investigation; the selected one is filled
        findings.forEach((finding, k) => {
            const centre = at(position[finding.focal]) + cell / 2;
            const tip = margin - 1;
            for (const edge of [0, 1]) {
                context.beginPath();
                if (edge === 0) {
                    context.moveTo(tip, centre);
                    context.lineTo(tip - 5, centre - 3.5);
                    context.lineTo(tip - 5, centre + 3.5);
                } else {
                    context.moveTo(centre, tip);
                    context.lineTo(centre - 3.5, tip - 5);
                    context.lineTo(centre + 3.5, tip - 5);
                }
                context.closePath();
                if (k === state.finding) context.fill();
                else {
                    context.lineWidth = 1;
                    context.stroke();
                }
            }
        });
        if (state.reveal >= 1) {
            context.lineWidth = Math.max(1.25, cell * 0.16);
            for (let j = 0; j < n; j++) {
                if (j === focal || Math.abs(genomic[focal][j] - pedigreeOf(focal, j)) <= threshold) continue;
                const [row, col] = position[focal] > position[j] ? [focal, j] : [j, focal];
                context.strokeRect(at(position[col]) + 0.5, at(position[row]) + 0.5, cell - 1, cell - 1);
            }
        }

        // The pair under the pointer, outlined in both halves
        if (state.cursor) {
            const [i, j] = state.cursor;
            context.strokeStyle = colours.ink;
            context.lineWidth = 1.5;
            context.strokeRect(at(position[j]), at(position[i]), cell, cell);
            context.strokeRect(at(position[i]), at(position[j]), cell, cell);
        }
    };

    const resize = () => {
        const size = Math.round(canvas.clientWidth);
        if (!size) return;
        const ratio = window.devicePixelRatio || 1;
        if (size !== state.size || canvas.width !== Math.round(size * ratio)) {
            state.size = size;
            canvas.width = Math.round(size * ratio);
            canvas.height = Math.round(size * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        draw();
        renderEvidence();
    };

    // Estimated relationships are not confined to 0-1: both charts run a little past the two ends
    const LOW = -0.2;
    const HIGH = 1.2;
    const CLASSES = [0, 0.25, 0.5, 1];

    // What the chart of all pairs shows, in words: the pairs that are not marked, by expected value
    const noteFor = (pedigree) => {
        const unrelated = [];
        const same = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < i; j++) {
                if (Math.abs(genomic[i][j] - pedigree[i][j]) > threshold) continue;
                if (pedigree[i][j] === 0) unrelated.push(genomic[i][j]);
                if (pedigree[i][j] === 1) same.push(genomic[i][j]);
            }
        }
        const highest = Math.max(...same);
        return (
            `Estimated relationships are not proportions. Pairs expected at 0 range from ${fixed(Math.min(...unrelated))} to ${fixed(Math.max(...unrelated))}, ` +
            `with ${unrelated.filter((value) => value < 0).length} of ${unrelated.length} below zero` +
            (same.length && highest > 1 ? `, and two samples of the same individual reach ${fixed(highest)}.` : ".") +
            ` Pairs marked in red are more than ${threshold} from their expected value.`
        );
    };

    /* --- Every pair, in the column of its expected relationship --- */
    const pairDots = new Map();
    const pairKey = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
    const markPair = () => {
        for (const dot of pairsSvg.querySelectorAll(".is-current")) dot.classList.remove("is-current");
        if (!state.cursor) return;
        const dot = pairDots.get(pairKey(...state.cursor));
        if (!dot) return;
        dot.classList.add("is-current");
        dot.parentNode.append(dot);
    };
    const renderPairs = () => {
        const { pedigree } = settled();
        const width = Math.max(200, Math.round(pairsSvg.clientWidth || 420));
        const height = 232;
        const left = 30;
        const right = width - 4;
        const top = 8;
        const bottom = 186;
        const yOf = (value) => bottom - ((Math.min(HIGH, Math.max(LOW, value)) - LOW) / (HIGH - LOW)) * (bottom - top);
        const slot = (right - left) / CLASSES.length;
        pairsSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        pairsSvg.replaceChildren();
        pairDots.clear();

        for (const tick of CLASSES) {
            svgEl("line", { class: "kin-grid", x1: left, x2: right, y1: yOf(tick), y2: yOf(tick) }, pairsSvg);
            svgEl("text", { class: "kin-tick", x: left - 6, y: yOf(tick) + 3.5, "text-anchor": "end" }, pairsSvg).textContent = String(tick);
        }
        const near = svgEl("g", {}, pairsSvg);
        const marks = svgEl("g", {}, pairsSvg);
        const far = svgEl("g", {}, pairsSvg);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < i; j++) {
                const expected = pedigree[i][j];
                const column = CLASSES.reduce((best, value, k) => (Math.abs(value - expected) < Math.abs(CLASSES[best] - expected) ? k : best), 0);
                const estimated = genomic[i][j];
                const differs = Math.abs(estimated - expected) > threshold;
                // The same sideways offset every time, so a pair keeps its place between redraws
                const offset = ((Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) >>> 0) / 4294967296 - 0.5;
                const dot = svgEl(
                    "circle",
                    { class: differs ? "kin-pair is-off" : "kin-pair", cx: left + (column + 0.5 + offset * 0.78) * slot, cy: yOf(estimated), r: differs ? 2.3 : 1.7 },
                    differs ? far : near,
                );
                pairDots.set(pairKey(i, j), dot);
            }
        }
        CLASSES.forEach((value, k) => {
            const centre = left + (k + 0.5) * slot;
            svgEl("line", { class: "kin-expected", x1: centre - slot * 0.46, x2: centre + slot * 0.46, y1: yOf(value), y2: yOf(value) }, marks);
            svgEl("text", { class: "kin-group", x: centre, y: bottom + 20, "text-anchor": "middle" }, pairsSvg).textContent = String(value);
        });
        svgEl("text", { class: "kin-tick", x: (left + right) / 2, y: bottom + 38, "text-anchor": "middle" }, pairsSvg).textContent = "Relationship expected from the pedigree";

        pairsNote.textContent = noteFor(pedigree);
        markPair();
    };

    /* --- One sample against every other sample --- */
    const renderEvidence = () => {
        const { order, pedigree } = settled();
        const focal = findings[state.finding].focal;
        const width = Math.max(200, Math.round(evidence.clientWidth || 420));
        const height = 176;
        const left = 30;
        const right = width - 4;
        const top = 10;
        const bottom = 132;
        const yOf = (value) => bottom - ((Math.min(HIGH, Math.max(LOW, value)) - LOW) / (HIGH - LOW)) * (bottom - top);
        const others = order.filter((i) => i !== focal);
        const step = (right - left) / others.length;
        evidence.setAttribute("viewBox", `0 0 ${width} ${height}`);
        evidence.replaceChildren();

        for (const tick of [0, 0.25, 0.5, 1]) {
            svgEl("line", { class: "kin-grid", x1: left, x2: right, y1: yOf(tick), y2: yOf(tick) }, evidence);
            svgEl("text", { class: "kin-tick", x: left - 6, y: yOf(tick) + 3.5, "text-anchor": "end" }, evidence).textContent = String(tick);
        }
        let start = 0;
        for (const group of GROUPS) {
            const count = others.filter((i) => groupOf(i) === group).length;
            if (!count) continue;
            const from = left + start * step;
            const to = left + (start + count) * step;
            svgEl("line", { class: "kin-bracket", x1: from + 2, x2: to - 2, y1: bottom + 14, y2: bottom + 14 }, evidence);
            svgEl("text", { class: "kin-group", x: (from + to) / 2, y: bottom + 30, "text-anchor": "middle" }, evidence).textContent = group;
            start += count;
        }
        others.forEach((sample, k) => {
            const x = left + (k + 0.5) * step;
            const expected = pedigree[focal][sample];
            const observed = genomic[focal][sample];
            const differs = Math.abs(observed - expected) > threshold;
            if (differs) svgEl("line", { class: "kin-gap", x1: x, x2: x, y1: yOf(expected), y2: yOf(observed) }, evidence);
            svgEl("line", { class: "kin-expected", x1: x - step * 0.38, x2: x + step * 0.38, y1: yOf(expected), y2: yOf(expected) }, evidence);
            svgEl("circle", { class: differs ? "kin-observed is-off" : "kin-observed", cx: x, cy: yOf(observed), r: Math.min(3, step * 0.3) }, evidence);
        });
    };

    // The sentence beside the matrix, for either pedigree and any of the three samples
    const sentence = (corrected, k) => {
        const pedigree = corrected ? data.corrected : data.recorded;
        const flagged = discordant(pedigree);
        // How far ordinary estimates stray, shown on the most familiar class
        const halves = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < i; j++) {
                if (pedigree[i][j] === 0.5 && Math.abs(genomic[i][j] - 0.5) <= threshold) halves.push(genomic[i][j]);
            }
        }
        const spread = `pairs expected at 0.50 range from ${fixed(Math.min(...halves))} to ${fixed(Math.max(...halves))}`;
        if (!corrected) {
            return (
                `Most estimates fall close to what the pedigree implies: ${spread}. But ${flagged} of ${pairs} pairs are far from it, and they trace back to three samples. ` +
                `${samples[findings[k].focal].label}, outlined, is ${findings[k].brief}.`
            );
        }
        return flagged === 0
            ? `With three hypothetical revisions to the pedigree, all ${pairs} pairs fall close to their expected values (${spread}). What remains is the ordinary scatter of estimates around expectation.`
            : `With three hypothetical revisions to the pedigree, ${flagged} of ${pairs} pairs remain far from their expected values.`;
    };
    const detailFor = (k, corrected) => `${findings[k].evidence} One explanation${corrected ? ", assumed in the revised pedigree" : ""}: ${findings[k].resolved}`;
    // Room is kept for the longest wording of each text, so that choosing a sample or applying
    // the revisions never moves the controls under the reader's hand.
    const SENTENCES = [...findings.map((_, k) => sentence(false, k)), sentence(true, 0)];

    const render = () => {
        const finding = findings[state.finding];
        const { pedigree } = settled();
        findingInputs.forEach((input, k) => {
            input.checked = k === state.finding;
            input.closest(".model-row").classList.toggle("is-shown", k === state.finding);
        });
        detail.textContent = detailFor(state.finding, state.corrected);
        evidenceTitle.textContent = `${samples[finding.focal].label} against every other sample`;
        correctButton.setAttribute("aria-pressed", String(state.corrected));
        correctButton.textContent = state.corrected ? "Return to the original pedigree" : "Apply the three hypothetical revisions";
        tally.textContent = `Pairs more than ${threshold} from their expected value: ${discordant(pedigree)} of ${pairs}.`;
        takeaway.textContent = sentence(state.corrected, state.finding);
        // The chart of all pairs belongs to the analysis: it is drawn when that is open
        if (explorer.isOpen()) renderPairs();
        renderEvidence();
        draw();
    };

    /* --- Animation of the revisions --- */
    let frame = null;
    const tween = (property, target, duration) => {
        cancelAnimationFrame(frame);
        if (reduceMotion.matches) {
            state[property] = target;
            draw();
            return;
        }
        const from = state[property];
        const began = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - began) / duration);
            const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            state[property] = from + (target - from) * eased;
            draw();
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
    };
    correctButton.addEventListener("click", () => {
        stopIntro();
        state.corrected = !state.corrected;
        state.cursor = null;
        state.reveal = 1;
        render();
        tween("mix", state.corrected ? 1 : 0, 1100);
    });

    /* --- Pointing at pairs --- */
    const describe = () => {
        if (!state.cursor) return hint;
        const [i, j] = state.cursor;
        const { pedigree } = settled();
        const differs = Math.abs(genomic[i][j] - pedigree[i][j]) > threshold;
        return `${samples[i].label} and ${samples[j].label}: expected ${fixed(pedigree[i][j])}, estimated ${fixed(genomic[i][j])}.${differs ? ` More than ${threshold} apart.` : ""}`;
    };
    const point = (cursor) => {
        const same = cursor === state.cursor || (cursor && state.cursor && cursor[0] === state.cursor[0] && cursor[1] === state.cursor[1]);
        if (same) return;
        state.cursor = cursor;
        status.classList.toggle("is-hint", !cursor);
        status.textContent = describe();
        markPair();
        draw();
    };
    const pairAt = (event) => {
        const box = canvas.getBoundingClientRect();
        const margin = state.size < 360 ? 20 : 26;
        const cell = (state.size - margin - 1) / n;
        const col = Math.floor((event.clientX - box.left - margin) / cell);
        const row = Math.floor((event.clientY - box.top - margin) / cell);
        if (row < 0 || col < 0 || row >= n || col >= n || row === col) return null;
        const { order } = settled();
        return [order[row], order[col]];
    };
    canvas.addEventListener("pointerdown", (event) => {
        stopIntro();
        point(pairAt(event));
    });
    canvas.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") point(pairAt(event));
    });
    canvas.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") point(null);
    });
    canvas.addEventListener("keydown", (event) => {
        const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
        if (event.key === "Escape") {
            point(null);
            return;
        }
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        stopIntro();
        const { order } = settled();
        let row;
        let col;
        if (state.cursor) {
            row = order.indexOf(state.cursor[0]) + move[0];
            col = order.indexOf(state.cursor[1]) + move[1];
            if (row === col) {
                row += move[0];
                col += move[1];
            }
        } else {
            // Start on the selected sample's row, in the half that shows the estimates
            row = order.indexOf(findings[state.finding].focal);
            col = row > 0 ? row - 1 : 1;
        }
        if (row < 0 || col < 0 || row >= n || col >= n) return;
        point([order[row], order[col]]);
    });

    /* --- Keep the drawing in step with its size, the theme and the web font --- */
    readColours();
    new ResizeObserver(resize).observe(canvas);
    new ResizeObserver(() => renderEvidence()).observe(evidence);
    holdRoom(takeaway, () => SENTENCES);
    holdRoom(detail, () => findings.flatMap((_, k) => [detailFor(k, false), detailFor(k, true)]));
    holdRoom(pairsNote, () => [noteFor(data.recorded), noteFor(data.corrected)]);
    new ResizeObserver(() => {
        if (explorer.isOpen()) renderPairs();
    }).observe(pairsSvg);
    new MutationObserver(() => {
        readColours();
        draw();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    document.fonts?.ready.then(() => {
        readColours();
        draw();
    });

    /* --- Entry: the estimated half develops outward from the diagonal --- */
    let stopIntro = () => {};
    render();
    if (!reduceMotion.matches) {
        state.reveal = 0;
        const cancel = playOnceVisible(canvas, (isCancelled) => {
            if (!isCancelled()) tween("reveal", 1, 1400);
        });
        stopIntro = () => {
            cancel();
            if (state.reveal < 1) {
                cancelAnimationFrame(frame);
                state.reveal = 1;
                draw();
            }
            stopIntro = () => {};
        };
    }
};

/* --------------------------------------------------------------------------
   Exploration 3. The best genotypes depend on the environment

   Twenty genotypes with linear reaction norms along a standardised environmental gradient
   x, shown from -2 to +2 with the average environment at 0:

       u_i(x) = a_i + b_i x

   Three cases are shown: no interaction (b_i = 0), a scale effect (b_i = 0.3 a_i: the
   genetic variance changes as (1 + 0.3x)^2, the order does not, and the genetic correlation
   between any two environments in the range is 1), and re-ranking (b_i independent of a_i
   with standard deviation 0.6). In the last case the genetic correlation between
   environments x1 and x2 is

       (1 + 0.36 x1 x2) / sqrt((1 + 0.36 x1^2)(1 + 0.36 x2^2))

   which is the population value: the twenty genotypes drawn vary around it.

   The figure compares selecting the best five at a target environment with selecting on
   average performance over the gradient. The gradient is symmetric about 0 and the lines
   are straight, so average performance is a_i. True simulated values are used throughout:
   uncertainty in estimating genetic merit is not represented.

   The genetic correlations shown are the parameters specified above. The correlation realized
   among the twenty genotypes drawn is shown beside the specified one for the target.
   -------------------------------------------------------------------------- */

// The seed is one for which the share of gain captured by an overall ranking stays close to
// the value the model predicts (the genetic correlation) along the gradient, so the example
// is a typical one.
const GXE = {
    genotypes: 20,
    selected: 5,
    range: 2, // the gradient is shown from -range to +range
    seed: 119,
    scenarios: [
        { name: "No interaction", detail: "Every genotype responds to the environment in the same way.", slope: () => 0, correlation: () => 1 },
        { name: "Scale only", detail: "Differences widen along the gradient; the order never changes.", slope: (a) => 0.3 * a, correlation: () => 1 },
        {
            name: "Re-ranking (crossover)",
            detail: "Genotypes respond differently, so the order changes.",
            slope: (a, b) => 0.6 * b,
            // Genetic correlation between environments x1 and x2
            correlation: (x1, x2) => (1 + 0.36 * x1 * x2) / Math.sqrt((1 + 0.36 * x1 * x1) * (1 + 0.36 * x2 * x2)),
        },
    ],
};

const simulateGxe = (seed = GXE.seed) => {
    const rng = makeRng(seed);
    // Genotype effects are centred on their own mean, so that zero on the merit axis is exactly
    // the average of the genotypes shown, in every environment. Centring subtracts the same
    // straight line from every genotype, so it changes no ranking and no selection comparison.
    const centred = (values) => values.map((value) => value - mean(values));
    const intercept = centred(Array.from({ length: GXE.genotypes }, () => rng.normal()));
    const deviation = centred(Array.from({ length: GXE.genotypes }, () => rng.normal()));
    return { intercept, deviation };
};

const buildGxeFigure = (figure) => {
    const stage = figure.querySelector(".viz-stage");
    const data = simulateGxe();
    const { genotypes, selected, scenarios, range } = GXE;
    const nameOf = (genotype) => `G${String(genotype + 1).padStart(2, "0")}`;
    const lowest = -range;
    const highest = range;
    const TICKS = [-2, -1, 0, 1, 2];
    const STRIP = 40; // cells in the correlation strip
    const REST = 0.72; // where the target rests, as a share of the way to the upper end

    const state = {
        scenario: 2,
        target: highest * REST,
        slopes: data.intercept.map((a, i) => scenarios[2].slope(a, data.deviation[i])),
        dragging: false,
    };
    const meritAt = (genotype, x) => data.intercept[genotype] + state.slopes[genotype] * x;
    // Average performance over the gradient, which is the merit at its centre
    const overallRank = ranksOf(data.intercept);
    const overallBest = [...data.intercept.keys()].sort((a, b) => data.intercept[b] - data.intercept[a]).slice(0, selected);

    /* --- Plot --- */
    const svg = svgEl("svg", { class: "rn-svg", "aria-hidden": "true" });
    const slider = el("input", {
        type: "range",
        class: "rn-range",
        min: lowest.toFixed(2),
        max: highest.toFixed(2),
        step: "0.01",
        "aria-label": "Target environment, as a position on the standardized environmental gradient",
    });
    // Under the plot, as part of the analysis: how closely genetic merit in every other
    // environment follows merit at the target
    const stripSvg = svgEl("svg", { class: "rn-strip", "aria-hidden": "true" });
    const stripTitle = el("p", { class: "rn-strip-title", text: "Specified genetic correlation with the target environment" });
    const stripPanel = el("div", { class: "rn-strip-panel" }, [stripTitle, stripSvg]);
    stripPanel.hidden = true;
    const axisTitle = el("p", { class: "rn-axis-title-line", "aria-hidden": "true", text: "Environmental gradient, standardized. Zero is the average environment." });
    const plotPanel = el("div", { class: "rn-plot" }, [
        el("p", { class: "field-label" }, [el("strong", { text: "Genetic merit along an environmental gradient" }), "Relative to the average genotype in each environment"]),
        el("div", { class: "rn-canvas" }, [svg, slider]),
        axisTitle,
        el("p", { class: "kin-key", "aria-hidden": "true" }, [
            el("span", { class: "kin-key-item" }, [el("i", { class: "rn-swatch rn-swatch-top" }), "Best five at the target"]),
            el("span", { class: "kin-key-item" }, [el("i", { class: "rn-swatch rn-swatch-overall" }), "Chosen on average performance, but not among the best here"]),
        ]),
        stripPanel,
    ]);

    /* --- Controls and what the target implies --- */
    const scenarioList = el("fieldset", { class: "model-list rn-scenarios" }, [el("legend", { text: "Kind of genotype-by-environment interaction" })]);
    const scenarioInputs = scenarios.map((scenario, k) => {
        const input = el("input", { type: "radio", name: "rn-scenario", value: String(k) });
        scenarioList.append(
            el("label", { class: "model-row" }, [input, el("span", { class: "model-text" }, [el("strong", { text: scenario.name }), el("span", { text: scenario.detail })])]),
        );
        input.addEventListener("change", () => {
            stopIntro();
            setScenario(k);
        });
        return input;
    });
    const ranking = el("ol", { class: "rank-list rn-rank" });
    const summary = el("p", { class: "rank-summary", "aria-live": "polite" });
    const results = el("div", { class: "rn-results" }, [
        el("p", { class: "rank-title", text: "Best five at the target environment" }),
        ranking,
        summary,
    ]);

    /* --- Concept: the lines, the target and one sentence. Analysis: the ranking, the kinds of
           interaction, and the genetic correlations between environments. --- */
    const takeaway = el("p", { class: "viz-takeaway" });
    const analysisPanel = el("div", { class: "rn-panel" }, [results, scenarioList]);
    const explorer = makeExplorer(figure, [analysisPanel], "genotype by environment", (open) => {
        stripPanel.hidden = !open;
        if (open && !reduceMotion.matches) stripPanel.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
    });
    stage.append(
        el("div", { class: "rn-layout" }, [plotPanel, el("div", { class: "viz-aside" }, [el("div", { class: "viz-brief" }, [takeaway, explorer.button]), analysisPanel])]),
    );

    /* --- Geometry, redone whenever the figure changes size --- */
    let geometry = null;
    let lines = [];
    let dots = [];
    let targetLine = null;
    let stripCells = [];
    let stripValues = [];
    let stripMark = null;

    const layout = () => {
        // One unit of the drawing is one pixel, which keeps the text sharp and lets the slider line up
        const width = Math.max(200, Math.round(svg.clientWidth || 520));
        const compact = width < 430;
        const left = compact ? 34 : 44;
        const right = width - 12;
        const top = 8;
        const plotHeight = compact ? 220 : 300;
        const bottom = top + plotHeight;
        const thumb = coarsePointer.matches ? 26 : 20;
        const track = coarsePointer.matches ? 44 : 30;
        const height = bottom + thumb / 2 + 20;
        const pad = 0.06 * (highest - lowest);
        // One vertical scale for the three cases: the largest merit any of them reaches at either end
        const extreme = Math.max(
            ...scenarios.flatMap((scenario) =>
                data.intercept.flatMap((a, i) => [lowest, highest].map((x) => Math.abs(a + scenario.slope(a, data.deviation[i]) * x))),
            ),
        );
        const limit = Math.ceil(extreme * 2 + 0.2) / 2;
        const xOf = (x) => left + ((x - (lowest - pad)) / (highest - lowest + 2 * pad)) * (right - left);
        const yOf = (merit) => top + ((limit - merit) / (2 * limit)) * plotHeight;
        const xFrom = (pixel) => lowest - pad + ((pixel - left) / (right - left)) * (highest - lowest + 2 * pad);
        geometry = { width, height, compact, left, right, top, bottom, xOf, yOf, xFrom };

        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.replaceChildren();
        // The slider lies on the axis: its thumb is the handle of the target line
        // (the thumb and its track are larger on touch screens; see the stylesheet)
        slider.style.left = `${xOf(lowest) - thumb / 2}px`;
        slider.style.width = `${xOf(highest) - xOf(lowest) + thumb}px`;
        slider.style.top = `${bottom - track / 2}px`;

        // Horizontal guides; zero is the average genotype
        for (const tick of [-2, 0, 2]) {
            svgEl("line", { class: tick === 0 ? "rn-zero" : "kin-grid", x1: left, x2: right, y1: yOf(tick), y2: yOf(tick) }, svg);
            svgEl("text", { class: "rn-tick", x: left - 8, y: yOf(tick) + 3.5, "text-anchor": "end" }, svg).textContent = tick === 0 ? "0" : signed(tick, 0);
        }

        // Reaction norms across the range shown
        const lineLayer = svgEl("g", {}, svg);
        lines = data.intercept.map(() => svgEl("line", { class: "rn-line", x1: xOf(lowest), x2: xOf(highest) }, lineLayer));

        // The gradient
        svgEl("line", { class: "rn-axis", x1: left, x2: right, y1: bottom, y2: bottom }, svg);
        for (const tick of TICKS) {
            const x = xOf(tick);
            svgEl("line", { class: "rn-axis", x1: x, x2: x, y1: bottom - 4, y2: bottom + 4 }, svg);
            svgEl("text", { class: "rn-tick", x, y: bottom + thumb / 2 + 15, "text-anchor": "middle" }, svg).textContent = tick === 0 ? "0" : signed(tick, 0);
        }
        axisTitle.style.paddingLeft = `${left}px`;
        axisTitle.style.paddingRight = `${width - right}px`;

        // The correlation strip: one cell per step of the gradient, and the value at each tick
        const stripHeight = 12;
        stripSvg.setAttribute("viewBox", `0 0 ${width} ${stripHeight + 22}`);
        stripSvg.replaceChildren();
        const step = (xOf(highest) - xOf(lowest)) / STRIP;
        stripCells = Array.from({ length: STRIP }, (_, k) =>
            svgEl("rect", { class: "viz-cell", x: xOf(lowest) + k * step, y: 0, width: step + 0.5, height: stripHeight }, stripSvg),
        );
        stripValues = TICKS.map((tick) => svgEl("text", { class: "rn-tick", x: xOf(tick), y: stripHeight + 15, "text-anchor": "middle" }, stripSvg));
        stripMark = svgEl("line", { class: "rn-target", y1: -1, y2: stripHeight + 1 }, stripSvg);
        stripTitle.style.paddingLeft = `${xOf(lowest)}px`;

        // Target environment
        const targetLayer = svgEl("g", {}, svg);
        targetLine = svgEl("line", { class: "rn-target", y1: top - 2, y2: bottom }, targetLayer);
        dots = Array.from({ length: selected }, () => svgEl("circle", { class: "rn-dot", r: 3.6 }, targetLayer));
        drawLines();
        drawTarget();
    };

    const drawLines = () => {
        if (!geometry) return;
        lines.forEach((line, genotype) => {
            line.setAttribute("y1", geometry.yOf(meritAt(genotype, lowest)));
            line.setAttribute("y2", geometry.yOf(meritAt(genotype, highest)));
        });
    };

    /* --- Everything that follows from the target --- */
    const sentenceFor = (missed) =>
        missed === 0
            ? "At this environment, a single ranking on average performance would select the same five genotypes."
            : `At this environment, a single ranking on average performance would miss ${missed} of the ${selected} best genotypes.`;
    const summaryFor = (captured, specified, realized) =>
        `Selecting on average performance instead would capture ${captured}% of the genetic gain available here. ` +
        `Genetic correlation between this environment and the average one: ${fixed(specified)} specified in the simulation, ` +
        `${fixed(realized)} realized among these ${genotypes} genotypes.`;
    // Their longest wordings keep their room, so the lists below never shift while the target moves
    holdRoom(takeaway, () => [sentenceFor(0), sentenceFor(selected)]);
    holdRoom(summary, () => [summaryFor(100, 1, 1), summaryFor(88, 0.88, -0.88)]);
    let shownOrder = "";
    const drawTarget = () => {
        const x = state.target;
        const merit = data.intercept.map((_, genotype) => meritAt(genotype, x));
        const best = [...merit.keys()].sort((a, b) => merit[b] - merit[a]).slice(0, selected);
        const correlationWith = (other) => scenarios[state.scenario].correlation(x, other);

        if (geometry) {
            const px = geometry.xOf(x);
            targetLine.setAttribute("x1", px);
            targetLine.setAttribute("x2", px);
            lines.forEach((line, genotype) => {
                const top = best.includes(genotype);
                line.classList.toggle("is-top", top);
                line.classList.toggle("is-overall", !top && overallBest.includes(genotype));
            });
            // Selected lines are drawn last so they sit on top
            for (const genotype of [...overallBest.filter((g) => !best.includes(g)), ...best]) lines[genotype].parentNode.append(lines[genotype]);
            dots.forEach((dot, k) => {
                dot.setAttribute("cx", px);
                dot.setAttribute("cy", geometry.yOf(merit[best[k]]));
            });
            stripCells.forEach((cell, k) => {
                const value = correlationWith(lowest + ((k + 0.5) / STRIP) * (highest - lowest));
                cell.classList.toggle("is-low", value < 0);
                cell.style.setProperty("--t", `${(Math.abs(value) * 100).toFixed(1)}%`);
            });
            stripValues.forEach((text, k) => (text.textContent = fixed(correlationWith(TICKS[k]))));
            stripMark.setAttribute("x1", px);
            stripMark.setAttribute("x2", px);
        }

        const average = mean(merit);
        const gainHere = mean(best.map((g) => merit[g])) - average;
        const gainOverall = mean(overallBest.map((g) => merit[g])) - average;
        const kept = best.filter((g) => overallBest.includes(g)).length;
        const captured = Math.round(Math.max(0, gainOverall / gainHere) * 100);

        const order = best.join(",");
        const top = Math.max(...merit);
        const render = (row, genotype, position) => {
            if (!row.firstChild) {
                row.append(
                    el("span", { class: "rank-place" }),
                    el("span", { class: "rank-name", text: nameOf(genotype) }),
                    el("span", { class: "rank-bar", "aria-hidden": "true" }, [el("i")]),
                    el("span", { class: "rank-value" }),
                    el("span", { class: "rank-plain" }),
                );
            }
            const [place, , bar, value, note] = row.children;
            place.textContent = String(position + 1);
            bar.style.setProperty("--v", `${((Math.max(0, merit[genotype]) / Math.max(top, 0.01)) * 100).toFixed(1)}%`);
            value.textContent = signed(merit[genotype]);
            note.textContent = `${ordinal(overallRank[genotype])} on average`;
            note.classList.toggle("is-moved", overallRank[genotype] > selected);
        };
        if (order !== shownOrder && !state.dragging) {
            updateRanking(ranking, best, (g) => g, render);
        } else {
            // While the target is being dragged, rows change in place without the moving animation
            best.forEach((genotype, position) => {
                let row = [...ranking.children].find((node) => node.dataset.key === String(genotype));
                if (!row) {
                    row = el("li");
                    row.dataset.key = String(genotype);
                }
                if (ranking.children[position] !== row) ranking.insertBefore(row, ranking.children[position] ?? null);
                render(row, genotype, position);
            });
            while (ranking.children.length > selected) ranking.lastChild.remove();
        }
        shownOrder = order;

        takeaway.textContent = sentenceFor(selected - kept);
        summary.textContent = summaryFor(captured, correlationWith(0), correlation(merit, data.intercept));

        slider.value = x.toFixed(2);
        // Screen readers hear the reading of the figure as the slider's value
        slider.setAttribute("aria-valuetext", `${signed(x, 1)} on the standardized gradient. ${takeaway.textContent}`);
    };

    const setTarget = (x) => {
        state.target = Math.min(highest, Math.max(lowest, x));
        drawTarget();
    };

    /* --- Changing the kind of interaction: slopes move to their new values --- */
    let frame = null;
    const setScenario = (k) => {
        state.scenario = k;
        scenarioInputs.forEach((input, j) => {
            input.checked = j === k;
            input.closest(".model-row").classList.toggle("is-shown", j === k);
        });
        const from = [...state.slopes];
        const to = data.intercept.map((a, i) => scenarios[k].slope(a, data.deviation[i]));
        cancelAnimationFrame(frame);
        if (reduceMotion.matches || !geometry) {
            state.slopes = to;
            drawLines();
            drawTarget();
            return;
        }
        const began = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - began) / 700);
            const eased = 1 - (1 - t) ** 3;
            state.slopes = from.map((value, i) => value + (to[i] - value) * eased);
            state.dragging = t < 1; // no row animations while the lines are still moving
            drawLines();
            drawTarget();
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
    };

    /* --- Moving the target --- */
    slider.addEventListener("input", () => {
        stopIntro();
        setTarget(Number(slider.value));
    });
    const pointerTarget = (event) => {
        const matrix = svg.getScreenCTM();
        if (!matrix || !geometry) return;
        setTarget(geometry.xFrom(new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x));
    };
    svg.addEventListener("pointerdown", (event) => {
        stopIntro();
        state.dragging = true;
        try {
            svg.setPointerCapture?.(event.pointerId);
        } catch {
            // The pointer cannot be captured (it has already gone): the drag still works inside the plot
        }
        pointerTarget(event);
    });
    svg.addEventListener("pointermove", (event) => {
        if (state.dragging) pointerTarget(event);
    });
    const release = () => {
        if (!state.dragging) return;
        state.dragging = false;
        shownOrder = "";
        drawTarget();
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);

    new ResizeObserver(layout).observe(svg);
    scenarioInputs[state.scenario].checked = true;
    scenarioInputs[state.scenario].closest(".model-row").classList.add("is-shown");
    layout();

    /* --- Entry: the target travels from the average environment towards one end --- */
    let stopIntro = () => {};
    if (!reduceMotion.matches) {
        const rest = state.target;
        let introFrame = null;
        setTarget(0);
        const cancel = playOnceVisible(svg, (isCancelled) => {
            const began = performance.now();
            const tick = (now) => {
                if (isCancelled()) return;
                const t = Math.min(1, (now - began) / 2600);
                const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
                setTarget(rest * eased);
                if (t < 1) introFrame = requestAnimationFrame(tick);
            };
            introFrame = requestAnimationFrame(tick);
        });
        stopIntro = () => {
            cancel();
            cancelAnimationFrame(introFrame);
            stopIntro = () => {};
        };
    }
};

/* --------------------------------------------------------------------------
   Start
   -------------------------------------------------------------------------- */
const builders = { trials: buildTrialsFigure, kinship: buildKinFigure, gxe: buildGxeFigure };

// The figures are laid out as soon as this file runs, so the page below them does not move
// afterwards (links to later sections land where they should).
for (const figure of document.querySelectorAll(".viz[data-viz]")) {
    const build = builders[figure.dataset.viz];
    if (!build) continue;
    try {
        figure.hidden = false;
        build(figure);
    } catch (error) {
        // A figure that cannot be built is left out; the text beside it stands on its own.
        figure.hidden = true;
        console.error(error);
    }
}

export { makeRng, fitMixedModel, MET, simulateTrials, fitTrialModel, analyseTrials, realizedCorrelations, simulateKinship, additiveRelationships, KIN, simulateGxe, GXE };
