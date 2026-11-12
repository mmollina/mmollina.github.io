// Interactive figures for the Applied section of marcelomollinari.com.
//
// Everything these figures show is simulated in this file and computed in the browser:
// the mixed models are fitted by REML, the genomic relationships are computed from
// simulated marker genotypes, and the reaction norms come from a random-regression model.
// Nothing here comes from a real breeding program.

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
   Numerical tools: Cholesky factorisation and a derivative-free minimiser.
   The systems here are small (at most 61 equations), so dense algebra is enough.
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

// Diagonal of (L L')^-1 given the Cholesky factor L.
const choleskyInverseDiagonal = (l, n) => {
    const inverse = new Float64Array(n * n); // L^-1, lower triangular
    for (let j = 0; j < n; j++) {
        inverse[j * n + j] = 1 / l[j * n + j];
        for (let i = j + 1; i < n; i++) {
            let sum = 0;
            for (let k = j; k < i; k++) sum -= l[i * n + k] * inverse[k * n + j];
            inverse[i * n + j] = sum / l[i * n + i];
        }
    }
    const diagonal = new Float64Array(n);
    for (let j = 0; j < n; j++) {
        for (let i = j; i < n; i++) diagonal[j] += inverse[i * n + j] ** 2;
    }
    return diagonal;
};

// Nelder-Mead simplex search inside a box, restarted from its own optimum to avoid stalling.
const minimise = (objective, start, lower, upper) => {
    const dim = start.length;
    const clamp = (x) => x.map((value) => Math.min(upper, Math.max(lower, value)));
    const point = (x) => ({ x, value: objective(x) });
    const byValue = (a, b) => a.value - b.value;
    let best = clamp(start);

    for (let restart = 0; restart < 3; restart++) {
        const step = restart === 0 ? 1.5 : 0.4;
        let simplex = [point(best)];
        for (let i = 0; i < dim; i++) simplex.push(point(clamp(best.map((value, j) => (i === j ? value + step : value)))));

        for (let iteration = 0; iteration < 250 * dim; iteration++) {
            simplex.sort(byValue);
            const worst = simplex[dim];
            if (Math.abs(worst.value - simplex[0].value) < 1e-11) break;
            const centroid = best.map((_, j) => {
                let sum = 0;
                for (let i = 0; i < dim; i++) sum += simplex[i].x[j];
                return sum / dim;
            });
            const along = (t) => point(clamp(centroid.map((c, j) => c + t * (worst.x[j] - c))));
            const reflected = along(-1);
            if (reflected.value < simplex[0].value) {
                const expanded = along(-2);
                simplex[dim] = expanded.value < reflected.value ? expanded : reflected;
            } else if (dim > 1 && reflected.value < simplex[dim - 1].value) {
                simplex[dim] = reflected;
            } else {
                const contracted = along(reflected.value < worst.value ? -0.5 : 0.5);
                if (contracted.value < Math.min(worst.value, reflected.value)) {
                    simplex[dim] = contracted;
                } else {
                    const anchor = simplex[0].x;
                    simplex = simplex.map((p, i) => (i === 0 ? p : point(p.x.map((value, j) => anchor[j] + 0.5 * (value - anchor[j])))));
                }
            }
        }
        simplex.sort(byValue);
        best = simplex[0].x;
    }
    return best;
};

/* --------------------------------------------------------------------------
   REML for a linear mixed model with an overall mean and independent random terms:

       y = mu + Z1 u1 + ... + Zk uk + e,   ui ~ N(0, s2_i I),   e ~ N(0, s2_e I)

   Each term is given as the level of every observation. The fit works on Henderson's
   mixed model equations, with the variance ratios lambda_i = s2_e / s2_i as parameters
   and the residual variance profiled out:

       -2 logL_R = (n - 1) log(s2_e) - sum_i q_i log(lambda_i) + log|C| + (n - 1) + (n - 1) log(2 pi)

   where C is the coefficient matrix of the mixed model equations.
   -------------------------------------------------------------------------- */
const fitReml = (y, terms) => {
    const n = y.length;
    const offsets = [];
    let dim = 1;
    for (const term of terms) {
        offsets.push(dim);
        dim += term.size;
    }

    // W'W and W'y for W = [1 Z1 ... Zk]
    const wtw = new Float64Array(dim * dim);
    const wty = new Float64Array(dim);
    const columns = new Int32Array(terms.length + 1);
    let yty = 0;
    for (let obs = 0; obs < n; obs++) {
        terms.forEach((term, k) => (columns[k + 1] = offsets[k] + term.levels[obs]));
        for (const a of columns) {
            wty[a] += y[obs];
            for (const b of columns) wtw[a * dim + b] += 1;
        }
        yty += y[obs] ** 2;
    }

    const work = new Float64Array(dim * dim);
    const factorise = (theta) => {
        work.set(wtw);
        terms.forEach((term, k) => {
            const lambda = Math.exp(theta[k]);
            for (let i = 0; i < term.size; i++) work[(offsets[k] + i) * (dim + 1)] += lambda;
        });
        const logDet = cholesky(work, dim);
        if (Number.isNaN(logDet)) return null;
        const solution = choleskySolve(work, dim, wty);
        let residualSs = yty;
        for (let i = 0; i < dim; i++) residualSs -= solution[i] * wty[i];
        return residualSs > 0 ? { logDet, solution, residualSs } : null;
    };
    const profile = (theta) => {
        const fit = factorise(theta);
        if (!fit) return Infinity;
        let value = (n - 1) * Math.log(fit.residualSs / (n - 1)) + fit.logDet;
        terms.forEach((term, k) => (value -= term.size * theta[k]));
        return value;
    };

    // log(lambda) between about 0.001 and 160 000: the upper end is a variance of zero.
    const theta = minimise(profile, terms.map(() => 0), -7, 12);
    const fit = factorise(theta);
    const residualVariance = fit.residualSs / (n - 1);
    const inverseDiagonal = choleskyInverseDiagonal(work, dim);
    const minus2LogLik = profile(theta) + (n - 1) * (1 + Math.log(2 * Math.PI));
    const parameters = terms.length + 1;

    return {
        mean: fit.solution[0],
        residualVariance,
        variances: theta.map((value) => residualVariance / Math.exp(value)),
        effects: terms.map((term, k) => fit.solution.slice(offsets[k], offsets[k] + term.size)),
        // Prediction error variance of each level: the matching diagonal of C^-1, times s2_e
        errorVariances: terms.map((term, k) =>
            inverseDiagonal.slice(offsets[k], offsets[k] + term.size).map((value) => value * residualVariance),
        ),
        minus2LogLik,
        aic: minus2LogLik + 2 * parameters,
    };
};

/* --------------------------------------------------------------------------
   Figure 1. A field trial, taken apart

   A simulated trial of 36 genotypes in three replicates, laid out on a 9 x 12 field.
   Three candidate models are fitted by REML. They share the same fixed part (an overall
   mean), so their restricted likelihoods are comparable and the model with the lowest
   AIC is selected. The figure splits every plot's measurement into the part each model
   attributes to the field, to the genotype, and to the residual.
   -------------------------------------------------------------------------- */

const FIELD = { rows: 9, cols: 12, reps: 3, genotypes: 36, sdGenetic: 0.8, sdResidual: 1 };

// Four simulated trials. For each kind of field, the seed is one whose result is close to the
// average over 160 seeds, so the examples are typical rather than flattering. `col` and `row` are [size of a linear trend from one side of the
// field to the other, standard deviation of extra row or column effects]; `rep` is the
// standard deviation of replicate effects. All in units of the residual standard deviation.
const TRIALS = [
    { seed: 63, truth: "a fertility gradient across the columns", col: [4.5, 0.3], row: [0, 0.15], rep: 0.15 },
    { seed: 64, truth: "no field trend at all", col: [0, 0], row: [0, 0], rep: 0 },
    { seed: 5, truth: "replicates that differ from one another", col: [0, 0], row: [0, 0], rep: 1.3 },
    { seed: 9, truth: "trends along both rows and columns", col: [2.6, 0.4], row: [2.2, 0.4], rep: 0.2 },
];

const MODELS = [
    { name: "Genotype only", short: "genotype only", detail: "Ignores where each plot sits in the field.", terms: ["genotype"] },
    { name: "Replicates", short: "replicates", detail: "Adds an effect for each replicate.", terms: ["genotype", "rep"] },
    {
        name: "Replicates, rows and columns",
        short: "replicates, rows and columns",
        detail: "Also adjusts for every row and every column.",
        terms: ["genotype", "rep", "row", "col"],
    },
];

const simulateTrial = (trial) => {
    const { rows, cols, reps, genotypes, sdGenetic, sdResidual } = FIELD;
    const rng = makeRng(trial.seed);
    const rowsPerRep = rows / reps;
    const plots = rows * cols;

    const trueGenetic = Array.from({ length: genotypes }, () => rng.normal() * sdGenetic);
    const drawEffects = (count, [trend, sd]) => {
        const direction = rng.uniform() < 0.5 ? -1 : 1;
        return Array.from({ length: count }, (_, i) => direction * trend * (i / (count - 1) - 0.5) + rng.normal() * sd);
    };
    const colEffect = drawEffects(cols, trial.col);
    const rowEffect = drawEffects(rows, trial.row);
    const repEffect = Array.from({ length: reps }, () => rng.normal() * trial.rep);

    const plot = { genotype: new Int32Array(plots), rep: new Int32Array(plots), row: new Int32Array(plots), col: new Int32Array(plots) };
    const y = new Float64Array(plots);
    for (let rep = 0; rep < reps; rep++) {
        // Complete randomisation of the genotypes within each replicate
        const order = rng.shuffle([...Array(genotypes).keys()]);
        order.forEach((genotype, position) => {
            const row = rep * rowsPerRep + Math.floor(position / cols);
            const col = position % cols;
            const index = row * cols + col;
            plot.genotype[index] = genotype;
            plot.rep[index] = rep;
            plot.row[index] = row;
            plot.col[index] = col;
            y[index] = 10 + repEffect[rep] + rowEffect[row] + colEffect[col] + trueGenetic[genotype] + rng.normal() * sdResidual;
        });
    }
    return { plot, y, trueGenetic };
};

// Fit one candidate model and split every plot's measurement into its parts.
const fitCandidate = (data, model) => {
    const { rows, cols, reps, genotypes } = FIELD;
    const { plot, y, trueGenetic } = data;
    const sizes = { genotype: genotypes, rep: reps, row: rows, col: cols };
    const fit = fitReml(y, model.terms.map((name) => ({ size: sizes[name], levels: plot[name] })));
    const effectOf = (name) => {
        const k = model.terms.indexOf(name);
        return k < 0 ? null : fit.effects[k];
    };
    const blup = Array.from(effectOf("genotype"));
    const field = new Float64Array(y.length);
    const genetic = new Float64Array(y.length);
    const residual = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) {
        for (const name of ["rep", "row", "col"]) field[i] += effectOf(name)?.[plot[name][i]] ?? 0;
        genetic[i] = blup[plot.genotype[i]];
        residual[i] = y[i] - fit.mean - field[i] - genetic[i];
    }
    const fieldVariance = fit.variances.slice(1).reduce((sum, value) => sum + value, 0);
    const total = fit.variances[0] + fieldVariance + fit.residualVariance;
    return {
        ...fit,
        blup,
        standardError: Array.from(fit.errorVariances[0], Math.sqrt),
        observed: Float64Array.from(y, (value) => value - fit.mean),
        field,
        genetic,
        residual,
        share: { field: fieldVariance / total, genetic: fit.variances[0] / total, residual: fit.residualVariance / total },
        accuracy: correlation(blup, trueGenetic),
    };
};

// Choose the model with the lowest AIC, and rank the genotypes by their plain averages for comparison.
const summariseTrial = (data, fits) => {
    const { plot, y, trueGenetic } = data;
    const plainMean = Array.from({ length: FIELD.genotypes }, () => 0);
    y.forEach((value, index) => (plainMean[plot.genotype[index]] += value / FIELD.reps));
    const best = fits.reduce((choice, fit, k) => (fit.aic < fits[choice].aic - 1e-6 ? k : choice), 0);
    return { ...data, fits, best, plainRank: ranksOf(plainMean), plainAccuracy: correlation(plainMean, trueGenetic) };
};

const analyseTrial = (trial) => {
    const data = simulateTrial(trial);
    return summariseTrial(data, MODELS.map((model) => fitCandidate(data, model)));
};

// The same analysis, giving the browser a turn between models so the page stays responsive while it loads.
const analyseTrialInSteps = async (trial) => {
    const data = simulateTrial(trial);
    const fits = [];
    for (const model of MODELS) {
        await new Promise((resolve) => setTimeout(resolve));
        fits.push(fitCandidate(data, model));
    }
    return summariseTrial(data, fits);
};

const buildFieldFigure = (figure) => {
    const stage = figure.querySelector(".viz-stage");
    const { rows, cols, reps, genotypes } = FIELD;
    const rowsPerRep = rows / reps;
    const CELL = 10;
    const REP_GAP = 2.5;
    const SCALE = 3.4; // deviation (in residual standard deviations) drawn at full colour
    const TOP = 8;
    const yOf = (row) => row * CELL + Math.floor(row / rowsPerRep) * REP_GAP;
    const height = yOf(rows - 1) + CELL;
    const nameOf = (genotype) => `G${String(genotype + 1).padStart(2, "0")}`;

    // The layout is built straight away; the models are fitted a moment later (see the end)
    const state = { trial: 0, model: 0, plot: null, analysis: null };

    /* --- The four maps: measured = field + genotype + residual --- */
    const parts = [
        { key: "observed", label: "Measured", share: null },
        { key: "field", label: "Field", share: "field" },
        { key: "genetic", label: "Genotype", share: "genetic" },
        { key: "residual", label: "Unexplained", share: "residual" },
    ];
    const equation = el("div", { class: "field-eq" });
    parts.forEach((part, position) => {
        if (position > 0) equation.append(el("span", { class: "field-op", "aria-hidden": "true", text: position === 1 ? "=" : "+" }));
        const svg = svgEl("svg", { viewBox: `-1 -1 ${cols * CELL + 2} ${height + 2}`, class: "field-svg", "aria-hidden": "true" });
        part.cells = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                part.cells.push(svgEl("rect", { class: "viz-cell", x: col * CELL + 0.5, y: yOf(row) + 0.5, width: CELL - 1, height: CELL - 1, rx: 1.2 }, svg));
            }
        }
        part.marks = Array.from({ length: reps }, () => svgEl("rect", { class: "plot-mark", width: CELL, height: CELL, rx: 1.6 }, svg));
        part.svg = svg;
        part.caption = el("span", { class: "field-share" });
        equation.append(
            el("div", { class: `field-map field-map-${part.key}` }, [svg, el("p", { class: "field-label" }, [el("strong", { text: part.label }), part.caption])]),
        );
    });
    const observedSvg = parts[0].svg;
    observedSvg.removeAttribute("aria-hidden");
    observedSvg.setAttribute("role", "group");
    observedSvg.setAttribute("tabindex", "0");
    observedSvg.setAttribute("aria-label", "Field map of the simulated trial. Use the arrow keys to move from plot to plot.");

    const legend = el("p", { class: "viz-legend", "aria-hidden": "true" }, [
        el("span", { text: "Below the trial mean" }),
        el("span", { class: "viz-ramp" }),
        el("span", { text: "Above" }),
    ]);

    const hint = canHover.matches
        ? "Point at a plot to see how its measurement is split."
        : "Tap a plot to see how its measurement is split.";
    const status = el("p", { class: "viz-status is-hint", "aria-live": "polite", text: hint });

    /* --- Candidate models --- */
    const modelList = el("fieldset", { class: "model-list" }, [el("legend", { text: "Candidate models, compared by AIC" })]);
    const modelRows = MODELS.map((model, k) => {
        const input = el("input", { type: "radio", name: "field-model", value: String(k) });
        const delta = el("span", { class: "model-delta" });
        const row = el("label", { class: "model-row" }, [
            input,
            el("span", { class: "model-text" }, [el("strong", { text: model.name }), el("span", { text: model.detail })]),
            delta,
        ]);
        input.addEventListener("change", () => {
            if (!state.analysis) return;
            stopIntro();
            state.model = k;
            render();
        });
        modelList.append(row);
        return { row, input, delta };
    });

    /* --- What the breeder receives --- */
    const ranking = el("ol", { class: "rank-list is-loading" });
    const rankSummary = el("p", { class: "rank-summary" });
    const rankPanel = el("div", { class: "rank-panel" }, [
        el("p", { class: "rank-title", text: `Top ${TOP} genotypes, predicted genetic value` }),
        ranking,
        rankSummary,
    ]);

    /* --- Another trial --- */
    const trialNote = el("span", { class: "trial-note" });
    const trialButton = el("button", { type: "button", class: "viz-button", text: "Simulate another trial" });
    trialButton.addEventListener("click", () => {
        if (!state.analysis) return;
        stopIntro();
        state.trial = (state.trial + 1) % TRIALS.length;
        state.analysis = analyseTrial(TRIALS[state.trial]);
        state.model = state.analysis.best;
        state.plot = null;
        render();
    });

    /* --- Concept: the maps and one sentence. Analysis: models, ranking, other trials. --- */
    const takeaway = el("p", { class: "viz-takeaway", "aria-live": "polite" });
    const analysisPanel = el("div", { class: "field-lower" }, [
        el("div", { class: "field-controls" }, [modelList, el("p", { class: "viz-actions" }, [trialButton, trialNote])]),
        rankPanel,
    ]);
    const explorer = makeExplorer(figure, [analysisPanel], "field trial");
    stage.append(
        equation,
        el("div", { class: "field-readout" }, [legend, status]),
        el("div", { class: "viz-brief field-brief" }, [takeaway, explorer.button]),
        analysisPanel,
    );

    /* --- Drawing --- */
    const paint = (cell, value) => {
        cell.classList.toggle("is-low", value < 0);
        cell.style.setProperty("--t", `${(Math.min(1, Math.abs(value) / SCALE) ** 0.8 * 100).toFixed(1)}%`);
    };

    const describePlot = () => {
        const { plot, fits } = state.analysis;
        const fit = fits[state.model];
        const i = state.plot;
        return (
            `${nameOf(plot.genotype[i])} in replicate ${plot.rep[i] + 1}: measured ${signed(fit.observed[i])} = ` +
            `field ${signed(fit.field[i])}, genotype ${signed(fit.genetic[i])}, unexplained ${signed(fit.residual[i])}.`
        );
    };

    const renderMarks = () => {
        if (!state.analysis) return;
        const { plot } = state.analysis;
        const selected = state.plot;
        const genotype = selected === null ? null : plot.genotype[selected];
        const same = selected === null ? [] : [...plot.genotype.keys()].filter((i) => plot.genotype[i] === genotype);
        for (const part of parts) {
            part.marks.forEach((mark, k) => {
                const index = same[k];
                mark.classList.toggle("is-on", index !== undefined);
                mark.classList.toggle("is-current", index === selected);
                if (index === undefined) return;
                mark.setAttribute("x", plot.col[index] * CELL);
                mark.setAttribute("y", yOf(plot.row[index]));
            });
        }
        for (const row of ranking.children) row.classList.toggle("is-on", genotype !== null && row.dataset.key === String(genotype));
        status.classList.toggle("is-hint", selected === null);
        status.textContent = selected === null ? hint : describePlot();
    };

    const render = () => {
        trialNote.textContent = `Trial ${state.trial + 1} of ${TRIALS.length}, simulated with ${TRIALS[state.trial].truth}.`;
        const { analysis } = state;
        if (!analysis) return;
        const fit = analysis.fits[state.model];
        ranking.classList.remove("is-loading");

        for (const part of parts) {
            part.cells.forEach((cell, i) => paint(cell, fit[part.key][i]));
            part.caption.textContent = part.share
                ? `${Math.round(fit.share[part.share] * 100)}% of estimated variance`
                : `${rows * cols} plots, ${genotypes} genotypes, ${reps} replicates`;
        }

        const bestAic = analysis.fits[analysis.best].aic;
        modelRows.forEach(({ row, input, delta }, k) => {
            const difference = analysis.fits[k].aic - bestAic;
            input.checked = k === state.model;
            row.classList.toggle("is-shown", k === state.model);
            row.classList.toggle("is-best", k === analysis.best);
            delta.textContent = k === analysis.best ? "Lowest AIC, selected" : `AIC ${difference.toFixed(1)} higher`;
        });

        const maxBar = Math.max(...analysis.fits.flatMap((candidate) => candidate.blup.map((value, g) => value + candidate.standardError[g])));
        const share = (value) => `${((Math.min(maxBar, Math.max(0, value)) / maxBar) * 100).toFixed(1)}%`;
        const order = [...fit.blup.keys()].sort((a, b) => fit.blup[b] - fit.blup[a]).slice(0, TOP);
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
                const [place, , bar, value, plain] = row.children;
                const blup = fit.blup[genotype];
                const se = fit.standardError[genotype];
                place.textContent = String(position + 1);
                bar.style.setProperty("--v", share(blup));
                bar.style.setProperty("--lo", share(blup - se));
                bar.style.setProperty("--hi", share(blup + se));
                value.textContent = signed(blup);
                const plainRank = analysis.plainRank[genotype];
                plain.firstChild.textContent = `${ordinal(plainRank)} by plain average`;
                plain.lastChild.textContent = `avg. ${ordinal(plainRank)}`;
                // Highlight genotypes the model moved by three places or more
                plain.classList.toggle("is-moved", Math.abs(plainRank - (position + 1)) >= 3);
            },
        );
        // With complete replicates, a model without rows and columns ranks genotypes exactly as their averages do.
        const sameOrder = ranksOf(fit.blup).every((rank, g) => rank === analysis.plainRank[g]);
        rankSummary.textContent =
            `Correlation with the true genetic values, known here because the data are simulated: ` +
            (sameOrder
                ? `${fixed(fit.accuracy)}, the same as for plain averages. Every genotype appears once in each replicate, ` +
                  `so this model changes how precise the predictions are, not their order.`
                : `${fixed(fit.accuracy)} for these predictions, ${fixed(analysis.plainAccuracy)} for plain averages.`);

        // The sentence under the maps: what this model does to the selection
        const model = MODELS[state.model];
        const subject = state.model === analysis.best ? `The selected model, with ${model.short},` : `The model with ${model.short}`;
        const moved = order.filter((genotype) => analysis.plainRank[genotype] > TOP).length;
        takeaway.textContent =
            (state.model === 0
                ? `${subject} ignores where each plot sits in the field.`
                : `${subject} attributes ${Math.round(fit.share.field * 100)}% of the estimated variance to the field.`) +
            " " +
            (sameOrder
                ? "It ranks the genotypes exactly as their plain averages do."
                : moved > 0
                  ? `Adjusting for the field brings ${moved} genotype${moved === 1 ? "" : "s"} into the top eight that plain averages would leave out.`
                  : "The top eight are the same genotypes as with plain averages, in a different order.");

        renderMarks();
    };

    /* --- Pointing at plots --- */
    const select = (index) => {
        if (index === state.plot || !state.analysis) return;
        state.plot = index;
        renderMarks();
    };
    const plotAt = (svg, event) => {
        const matrix = svg.getScreenCTM();
        if (!matrix) return null;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const col = Math.floor(point.x / CELL);
        let row = -1;
        for (let r = 0; r < rows; r++) if (point.y >= yOf(r) && point.y < yOf(r) + CELL) row = r;
        return row >= 0 && col >= 0 && col < cols ? row * cols + col : null;
    };
    for (const part of parts) {
        part.svg.addEventListener("pointerdown", (event) => {
            stopIntro();
            const index = plotAt(part.svg, event);
            // On touch screens a second tap on the same plot clears the selection
            select(event.pointerType !== "mouse" && index === state.plot ? null : index);
        });
        part.svg.addEventListener("pointermove", (event) => {
            if (event.pointerType === "mouse") select(plotAt(part.svg, event));
        });
        part.svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "mouse") select(null);
        });
    }
    observedSvg.addEventListener("keydown", (event) => {
        const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
        if (event.key === "Escape") {
            select(null);
            return;
        }
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        stopIntro();
        const current = state.plot ?? 0;
        const row = Math.min(rows - 1, Math.max(0, Math.floor(current / cols) + (state.plot === null ? 0 : move[0])));
        const col = Math.min(cols - 1, Math.max(0, (current % cols) + (state.plot === null ? 0 : move[1])));
        select(row * cols + col);
    });

    // On a phone the measured map scrolls away while its three parts stay in view (see the stylesheet)
    new ResizeObserver(() => {
        const partsTop = parts[1].svg.parentElement.offsetTop - equation.offsetTop;
        equation.style.setProperty("--pin", `${Math.max(0, partsTop - 8)}px`);
    }).observe(equation);

    /* --- Fit the models once the figure is near the viewport, then step through the
           candidates once, ending on the selected one --- */
    let stopIntro = () => {};
    render();
    const begin = async () => {
        try {
            state.analysis = await analyseTrialInSteps(TRIALS[state.trial]);
        } catch (error) {
            figure.hidden = true;
            console.error(error);
            return;
        }
        const final = state.analysis.best;
        state.model = reduceMotion.matches ? final : 0;
        render();
        if (state.model === final) return;
        let timer = null;
        const cancel = playOnceVisible(equation, (isCancelled) => {
            const advance = () => {
                if (isCancelled() || state.model >= final) return;
                state.model += 1;
                render();
                timer = setTimeout(advance, 1500);
            };
            timer = setTimeout(advance, 1100);
        });
        stopIntro = () => {
            cancel();
            clearTimeout(timer);
            stopIntro = () => {};
        };
    };
    whenNear(equation, () => whenIdle(begin));
};

/* --------------------------------------------------------------------------
   Figure 2. What the pedigree records, and what the genotypes show

   Five parents, four full-sib families that share parents, and three repeated samples.
   Marker genotypes are simulated by Mendelian sampling from the true pedigree, and the
   genomic relationship matrix is VanRaden's first method, G = WW' / (2 sum p(1 - p)),
   using the allele frequencies of the base population (known here because it is simulated).
   The recorded pedigree contains three errors; the figure compares the relationships it
   implies (above the diagonal) with the genomic ones (below).
   -------------------------------------------------------------------------- */

// A pair is flagged when its two relationships differ by more than `threshold`. Relationship
// classes are 0.25 apart and the genomic estimates here have a standard deviation near 0.03.
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

const simulateKinship = () => {
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
            let actual = f === 3 ? [3, UNKNOWN] : recorded; // error 3: P5 is not a parent of family D
            if (family === "C" && k === 7) actual = [0, 1]; // error 1: C7 belongs to family A
            trueParents.push(actual);
            recordedParents.push(recorded);
        }
    });

    // Samples, in the order of the records as received. `recorded` and `actual` are individuals.
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
            // error 2: the tube labelled as a repeat of C5 holds DNA from D2
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

    return { samples, indexOf, genomic, recorded, corrected, recordedOrder, correctedOrder, correctedGroup, n };
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
    // Each finding is worded as what the data show and what would explain it. A discrepancy shows
    // that pedigree and genotypes cannot both be right; it does not say which one is wrong.
    const siblingMean = mean(members("D").flatMap((i) => members("D").filter((j) => j < i).map((j) => genomic[i][j])));
    const findings = [
        {
            focal: c7,
            title: "An offspring that does not fit its recorded family",
            brief: "recorded in family C, but its genotypes place it in family A",
            evidence:
                `C7 is recorded in family C, but its genomic relationship with its recorded siblings averages ` +
                `${fixed(meanWith(c7, members("C")))}. With the offspring of family A it averages ${fixed(meanWith(c7, members("A")))}, ` +
                `the value expected between full siblings. The most likely explanation is a labelling error.`,
            resolved: "reassign C7 to family A, where its relationships agree with the pedigree.",
        },
        {
            focal: c5r,
            title: "A repeated sample that does not match",
            brief: "labelled as a repeat of C5, but its genotypes match D2",
            evidence:
                `The second sample of C5 should be identical to the first, yet their relationship is ` +
                `${fixed(genomic[c5r][indexOf.C5])}. With D2 it is ${fixed(genomic[c5r][indexOf.D2])}. ` +
                `The simplest explanation is a sample mix-up that put DNA from D2 in this tube.`,
            resolved: "relabel the sample as a repeat of D2.",
        },
        {
            focal: p5,
            title: "A parent unrelated to its recorded offspring",
            brief: "recorded as a parent of family D, but shows no relationship to its offspring",
            evidence:
                `P5 is recorded as a parent of family D, but its relationship with the eight offspring averages ` +
                `${fixed(meanWith(p5, members("D")))} where 0.50 is expected. The offspring are still related to one another ` +
                `as full siblings (${fixed(siblingMean)} on average), which points to one other, unrecorded second parent.`,
            resolved: "record the second parent of family D as unknown.",
        },
    ];

    const state = { finding: 0, corrected: false, mix: 0, reveal: 1, cursor: null, size: 0 };

    /* --- Matrix --- */
    const canvas = el("canvas", {
        class: "kin-canvas",
        tabindex: "0",
        role: "img",
        "aria-label":
            "Relationship matrix for 40 samples: five parents, four families of eight offspring and three repeated samples. " +
            "Above the diagonal, relationships expected from the recorded pedigree; below it, relationships estimated from marker genotypes. " +
            "Use the arrow keys to move between pairs.",
    });
    const context = canvas.getContext("2d");
    const hint = canHover.matches ? "Point at a cell to compare the two values for that pair." : "Tap a cell to compare the two values for that pair.";
    const status = el("p", { class: "viz-status is-hint", "aria-live": "polite", text: hint });
    const key = el("p", { class: "kin-key", "aria-hidden": "true" }, [
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-tri kin-tri-upper" }), "Recorded pedigree"]),
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-tri kin-tri-lower" }), "Marker genotypes"]),
    ]);
    // The shading scale, with the relationships a reader will meet marked on it. Its ends say
    // "or below" and "or above" because genomic relationships are not confined to 0-1.
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

    /* --- Findings --- */
    const findingList = el("fieldset", { class: "model-list kin-findings" }, [el("legend", { text: "Three discrepancies to investigate" })]);
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
    const evidenceKey = el("p", { class: "kin-key", "aria-hidden": "true" }, [
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-dash" }), "Expected from the pedigree"]),
        el("span", { class: "kin-key-item" }, [el("i", { class: "kin-dot" }), "Estimated from genotypes"]),
    ]);
    const evidence = svgEl("svg", { class: "kin-evidence", "aria-hidden": "true" });
    const tally = el("span", { class: "trial-note" });
    const correctButton = el("button", { type: "button", class: "viz-button", "aria-pressed": "false", text: "Apply the proposed corrections" });
    const caveat = el("p", {
        class: "kin-caveat",
        text: "The corrections are hypotheses. In practice each would be confirmed against sampling, crossing and laboratory records before the pedigree is changed.",
    });

    /* --- Concept: the matrix and one sentence. Analysis: the three cases, their evidence, the corrections. --- */
    const takeaway = el("p", { class: "viz-takeaway", "aria-live": "polite" });
    const analysisPanel = el("div", { class: "kin-side" }, [
        findingList,
        detail,
        evidenceTitle,
        evidenceKey,
        evidence,
        el("p", { class: "viz-actions kin-actions" }, [correctButton, tally]),
        caveat,
    ]);
    const explorer = makeExplorer(figure, [analysisPanel], "pedigree and genomic relationships", () => renderEvidence());
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

    /* --- Evidence: the selected sample against every other sample --- */
    const renderEvidence = () => {
        const { order, pedigree } = settled();
        const focal = findings[state.finding].focal;
        const width = Math.max(200, Math.round(evidence.clientWidth || 420));
        const height = 176;
        const left = 30;
        const right = width - 4;
        const top = 10;
        const bottom = 132;
        // Genomic relationships are not confined to 0-1: the axis runs a little past both ends
        const LOW = -0.2;
        const HIGH = 1.2;
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

    const render = () => {
        const finding = findings[state.finding];
        const { pedigree } = settled();
        findingInputs.forEach((input, k) => {
            input.checked = k === state.finding;
            input.closest(".model-row").classList.toggle("is-shown", k === state.finding);
        });
        detail.textContent = state.corrected ? `${finding.evidence} Proposed correction, now applied: ${finding.resolved}` : `${finding.evidence} Proposed correction: ${finding.resolved}`;
        evidenceTitle.textContent = `${samples[finding.focal].label} against every other sample`;
        correctButton.setAttribute("aria-pressed", String(state.corrected));
        correctButton.textContent = state.corrected ? "Return to the records as received" : "Apply the proposed corrections";
        const flagged = discordant(pedigree);
        tally.textContent = `Pairs where pedigree and genotypes disagree: ${flagged} of ${pairs}.`;
        takeaway.textContent = state.corrected
            ? flagged === 0
                ? `With the three proposed corrections applied, pedigree and genotypes agree for all ${pairs} pairs of samples.`
                : `With the three proposed corrections applied, ${flagged} of ${pairs} pairs still disagree.`
            : `${flagged} of ${pairs} pairs of samples disagree with the recorded pedigree. They trace back to three samples. The one outlined is ${finding.brief}.`;
        renderEvidence();
        draw();
    };

    /* --- Animation of the corrections --- */
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
        return `${samples[i].label} and ${samples[j].label}: pedigree ${fixed(pedigree[i][j])}, genotypes ${fixed(genomic[i][j])}.${differs ? " They disagree." : ""}`;
    };
    const point = (cursor) => {
        const same = cursor === state.cursor || (cursor && state.cursor && cursor[0] === state.cursor[0] && cursor[1] === state.cursor[1]);
        if (same) return;
        state.cursor = cursor;
        status.classList.toggle("is-hint", !cursor);
        status.textContent = describe();
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
            // Start on the selected finding's row, in the half that shows the genotypes
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
    new MutationObserver(() => {
        readColours();
        draw();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    document.fonts?.ready.then(() => {
        readColours();
        draw();
    });

    /* --- Entry: the genotype half develops outward from the diagonal --- */
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
   Figure 3. The best genotypes depend on the environment

   Twenty genotypes with linear reaction norms along an environmental index:

       u_i(x) = a_i + b_i x

   The index is the first principal component of four simulated environmental descriptors
   for fourteen environments. Three cases are shown: no interaction (b_i = 0), a scale
   effect (b_i proportional to a_i: genetic variance changes, order does not), and
   re-ranking (b_i independent of a_i). The figure compares selecting the best five at a
   target environment with selecting on average performance across environments.
   -------------------------------------------------------------------------- */

// The seed is one for which the share of gain captured by an overall ranking is close to
// the value the model predicts (the genetic correlation), so the example is a typical one.
const GXE = {
    genotypes: 20,
    environments: 14,
    selected: 5,
    seed: 18,
    descriptors: [
        { name: "Temperature", loading: 0.85, low: "cooler", high: "warmer" },
        { name: "Rainfall", loading: -0.7, low: "drier", high: "wetter" },
        { name: "Elevation", loading: -0.75, low: "lower", high: "higher" },
        { name: "Management", loading: 0.45 },
    ],
    scenarios: [
        { name: "No interaction", detail: "Every genotype responds to the environment in the same way.", slope: () => 0, correlation: () => 1 },
        { name: "Scale only", detail: "Differences widen along the gradient; the order never changes.", slope: (a) => 0.3 * a, correlation: () => 1 },
        {
            name: "Re-ranking (crossover)",
            detail: "Genotypes respond differently, so the order changes.",
            slope: (a, b) => 0.6 * b,
            // Correlation between genetic merit at x and at the average environment (x = 0)
            correlation: (x) => 1 / Math.sqrt(1 + 0.36 * x * x),
        },
    ],
};

const standardise = (values) => {
    const centre = mean(values);
    const sd = Math.sqrt(mean(values.map((value) => (value - centre) ** 2)));
    return values.map((value) => (value - centre) / sd);
};

const simulateGxe = () => {
    const { genotypes, environments, descriptors, seed } = GXE;
    const rng = makeRng(seed);

    // Environments spread along a latent gradient; each descriptor follows it with its own noise
    const latent = Array.from({ length: environments }, (_, j) => ((j + 0.5) / environments - 0.5) * 3.2 + 0.3 * rng.normal());
    const table = descriptors.map(({ loading }) => standardise(latent.map((z) => loading * z + Math.sqrt(1 - loading ** 2) * rng.normal())));

    // First principal component of the standardised descriptors, by power iteration
    const k = descriptors.length;
    const corr = table.map((a) => table.map((b) => mean(a.map((value, j) => value * b[j]))));
    let vector = Array.from({ length: k }, () => 1 / Math.sqrt(k));
    let eigenvalue = 0;
    for (let iteration = 0; iteration < 200; iteration++) {
        const next = corr.map((row) => row.reduce((sum, value, i) => sum + value * vector[i], 0));
        eigenvalue = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0));
        vector = next.map((value) => value / eigenvalue);
    }
    if (vector[0] < 0) vector = vector.map((value) => -value);
    const index = standardise(latent.map((_, j) => vector.reduce((sum, weight, i) => sum + weight * table[i][j], 0)));

    // Genotype effects are centred on their own mean, so that zero on the merit axis is exactly
    // the average of the genotypes shown, in every environment. Centring subtracts the same
    // straight line from every genotype, so it changes no ranking and no selection comparison.
    const centred = (values) => values.map((value) => value - mean(values));
    const intercept = centred(Array.from({ length: genotypes }, () => rng.normal()));
    const deviation = centred(Array.from({ length: genotypes }, () => rng.normal()));
    return { index, table, weights: vector, explained: eigenvalue / k, intercept, deviation };
};

const buildGxeFigure = (figure) => {
    const stage = figure.querySelector(".viz-stage");
    const data = simulateGxe();
    const { genotypes, selected, scenarios, descriptors } = GXE;
    const nameOf = (genotype) => `G${String(genotype + 1).padStart(2, "0")}`;
    const lowest = Math.min(...data.index);
    const highest = Math.max(...data.index);
    const REST = 0.72; // where the target rests, as a share of the way to the upper end

    const state = {
        scenario: 2,
        target: highest * REST,
        slopes: data.intercept.map((a, i) => scenarios[2].slope(a, data.deviation[i])),
        dragging: false,
    };
    const meritAt = (genotype, x) => data.intercept[genotype] + state.slopes[genotype] * x;
    // Average performance over the environments: the index has mean zero, so this is the intercept
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
        "aria-label": "Target environment, as a position on the environmental index",
    });
    // Under the plot: the table of descriptors behind the index (part of the analysis), then
    // the labels of the axis. Keeping them apart from the plot lets a phone hold the plot in
    // view while the rest scrolls.
    const tableSvg = svgEl("svg", { class: "rn-table", "aria-hidden": "true", hidden: "" });
    const endLow = el("span");
    const endHigh = el("span");
    const axisLabels = el("p", { class: "rn-axis-labels", "aria-hidden": "true" }, [endLow, el("strong", { text: "Environmental index" }), endHigh]);
    const plotPanel = el("div", { class: "rn-plot" }, [
        el("p", { class: "field-label" }, [el("strong", { text: "Genetic merit along the environmental gradient" }), "Relative to the average genotype in each environment"]),
        el("div", { class: "rn-canvas" }, [svg, slider]),
        tableSvg,
        axisLabels,
        el("p", { class: "kin-key", "aria-hidden": "true" }, [
            el("span", { class: "kin-key-item" }, [el("i", { class: "rn-swatch rn-swatch-top" }), "Best five at the target"]),
            el("span", { class: "kin-key-item" }, [el("i", { class: "rn-swatch rn-swatch-overall" }), "Chosen on average performance, but not among the best here"]),
        ]),
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
    const summary = el("p", { class: "rank-summary" });
    const results = el("div", { class: "rn-results" }, [
        el("p", { class: "rank-title", text: "Best five at the target environment" }),
        ranking,
        summary,
    ]);

    /* --- Concept: the lines, the target and one sentence. Analysis: the ranking, the kinds of
           interaction, and the descriptors behind the environmental index. --- */
    const takeaway = el("p", { class: "viz-takeaway" });
    const analysisPanel = el("div", { class: "rn-panel" }, [results, scenarioList]);
    const tableKey = el("span", { class: "kin-key-item" }, ["Descriptors: below average", el("i", { class: "viz-ramp" }), "above"]);
    tableKey.hidden = true;
    plotPanel.lastChild.append(tableKey);
    const explorer = makeExplorer(figure, [analysisPanel], "genotype by environment", (open) => {
        tableKey.hidden = !open;
        tableSvg.toggleAttribute("hidden", !open);
        if (open && !reduceMotion.matches) tableSvg.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
    });
    stage.append(
        el("div", { class: "rn-layout" }, [plotPanel, el("div", { class: "viz-aside" }, [el("div", { class: "viz-brief" }, [takeaway, explorer.button]), analysisPanel])]),
    );

    /* --- Geometry, redone whenever the figure changes size --- */
    let geometry = null;
    let lines = [];
    let dots = [];
    let targetLine = null;

    const layout = () => {
        // One unit of the drawing is one pixel, which keeps the text sharp and lets the slider line up
        const width = Math.max(200, Math.round(svg.clientWidth || 520));
        const compact = width < 430;
        const left = compact ? 70 : 84;
        const right = width - 9;
        const top = 8;
        const plotHeight = compact ? 220 : 300;
        const bottom = top + plotHeight;
        const height = bottom + 15;
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
        const thumb = coarsePointer.matches ? 26 : 20;
        const track = coarsePointer.matches ? 44 : 30;
        slider.style.left = `${xOf(lowest) - thumb / 2}px`;
        slider.style.width = `${xOf(highest) - xOf(lowest) + thumb}px`;
        slider.style.top = `${bottom - track / 2}px`;

        // Horizontal guides; zero is the average genotype
        for (const tick of [-2, 0, 2]) {
            svgEl("line", { class: tick === 0 ? "rn-zero" : "kin-grid", x1: left, x2: right, y1: yOf(tick), y2: yOf(tick) }, svg);
            svgEl("text", { class: "rn-tick", x: left - 8, y: yOf(tick) + 3.5, "text-anchor": "end" }, svg).textContent = tick === 0 ? "0" : signed(tick, 0);
        }

        // Reaction norms, drawn only over the range of environments that were observed
        const lineLayer = svgEl("g", {}, svg);
        lines = data.intercept.map(() => svgEl("line", { class: "rn-line", x1: xOf(lowest), x2: xOf(highest) }, lineLayer));

        // The environments on the axis
        svgEl("line", { class: "rn-axis", x1: left, x2: right, y1: bottom, y2: bottom }, svg);
        const order = [...data.index.keys()].sort((a, b) => data.index[a] - data.index[b]);
        for (const environment of order) {
            const x = xOf(data.index[environment]);
            svgEl("line", { class: "rn-axis", x1: x, x2: x, y1: bottom - 4, y2: bottom + 4 }, svg);
        }

        // Their descriptors, in the order of the index and evenly spaced, each column tied to
        // its environment's place on the axis above. Drawn directly under the plot.
        const rowHeight = compact ? 13 : 14;
        const tableTop = 22;
        const slot = (right - left) / order.length;
        const cellWidth = Math.min(slot - 3, 22);
        const cellHeight = rowHeight - 2;
        tableSvg.setAttribute("viewBox", `0 0 ${width} ${tableTop + descriptors.length * rowHeight + 2}`);
        tableSvg.replaceChildren();
        order.forEach((environment, k) => {
            const column = left + (k + 0.5) * slot;
            // The line starts above this drawing, at the tick on the axis
            svgEl("path", { class: "rn-leader", d: `M${xOf(data.index[environment])} ${4 - 15} L${column} ${tableTop - 4}` }, tableSvg);
            descriptors.forEach((_, row) => {
                const value = data.table[row][environment];
                const mark = svgEl(
                    "rect",
                    { class: value < 0 ? "viz-cell is-low" : "viz-cell", x: column - cellWidth / 2, y: tableTop + row * rowHeight, width: cellWidth, height: cellHeight, rx: 1.5 },
                    tableSvg,
                );
                mark.style.setProperty("--t", `${(Math.min(1, Math.abs(value) / 2) * 100).toFixed(0)}%`);
            });
        });
        descriptors.forEach((descriptor, row) => {
            svgEl("text", { class: "rn-tick", x: left - 8, y: tableTop + row * rowHeight + cellHeight - 2, "text-anchor": "end" }, tableSvg).textContent = descriptor.name;
        });

        // What the two ends of the index mean, from the signs of the descriptors' weights
        const ends = (side) =>
            descriptors
                .filter((descriptor) => descriptor.low)
                .map((descriptor) => ((data.weights[descriptors.indexOf(descriptor)] > 0) === (side === "high") ? descriptor.high : descriptor.low))
                .join(", ");
        const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
        endLow.textContent = capital(ends("low"));
        endHigh.textContent = capital(ends("high"));
        axisLabels.style.paddingLeft = `${left}px`;
        axisLabels.style.paddingRight = `${width - right}px`;

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
    let shownOrder = "";
    const drawTarget = () => {
        const x = state.target;
        const merit = data.intercept.map((_, genotype) => meritAt(genotype, x));
        const best = [...merit.keys()].sort((a, b) => merit[b] - merit[a]).slice(0, selected);

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
        }

        const average = mean(merit);
        const gainHere = mean(best.map((g) => merit[g])) - average;
        const gainOverall = mean(overallBest.map((g) => merit[g])) - average;
        const kept = best.filter((g) => overallBest.includes(g)).length;
        const captured = Math.round(Math.max(0, gainOverall / gainHere) * 100);
        const correlationHere = scenarios[state.scenario].correlation(x);

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

        takeaway.textContent =
            kept === selected
                ? "At this environment, a single ranking on average performance would select the same five genotypes."
                : `At this environment, a single ranking on average performance would miss ${selected - kept} of the ${selected} best genotypes.`;
        summary.textContent =
            `Selecting on average performance instead would capture ${captured}% of the genetic gain available here. ` +
            `Genetic correlation between this environment and the average one: ${fixed(correlationHere)}.`;

        slider.value = x.toFixed(2);
        const share = (x - lowest) / (highest - lowest);
        // Screen readers hear the reading of the figure as the slider's value
        slider.setAttribute("aria-valuetext", `${Math.round(share * 100)}% of the way along the environmental index. ${takeaway.textContent}`);
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
        svg.setPointerCapture?.(event.pointerId);
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
const builders = { field: buildFieldFigure, kinship: buildKinFigure, gxe: buildGxeFigure };

// The figures are laid out as soon as this file runs, so the page below them does not move
// afterwards (links to later sections land where they should).
for (const figure of document.querySelectorAll(".viz[data-viz]")) {
    const build = builders[figure.dataset.viz];
    if (!build) continue;
    try {
        figure.hidden = false;
        build(figure);
    } catch (error) {
        // A figure that cannot be built is left out; the text of the section stands on its own.
        figure.hidden = true;
        console.error(error);
    }
}

export { fitReml, makeRng, simulateTrial, analyseTrial, TRIALS, MODELS, FIELD, simulateKinship, additiveRelationships, KIN, simulateGxe, GXE };
