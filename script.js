// Small enhancements for marcelomollinari.com. Everything on the page works without this file:
// it adds the theme switch, the reading position on the navigation map, the interactive
// schematic, the figure viewer and the copy button.

const root = document.documentElement;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* --------------------------------------------------------------------------
   Theme switch
   The <head> script has already set data-theme (saved choice, else the system).
   -------------------------------------------------------------------------- */
{
    const button = document.querySelector(".theme-toggle");
    const label = button?.querySelector(".theme-toggle-label");
    const system = matchMedia("(prefers-color-scheme: dark)");

    const savedTheme = () => {
        try {
            const value = localStorage.getItem("theme");
            return value === "light" || value === "dark" ? value : null;
        } catch {
            return null;
        }
    };

    const render = (theme) => {
        root.dataset.theme = theme;
        const other = theme === "dark" ? "light" : "dark";
        if (label) label.textContent = other === "dark" ? "Dark theme" : "Light theme";
        button.setAttribute("aria-label", `Switch to ${other} theme`);
    };

    if (button) {
        render(root.dataset.theme === "dark" ? "dark" : "light");
        button.hidden = false;

        button.addEventListener("click", () => {
            const next = root.dataset.theme === "dark" ? "light" : "dark";
            try {
                localStorage.setItem("theme", next);
            } catch {
                // Storage is unavailable: the choice lasts for this visit only.
            }
            if (document.startViewTransition && !reduceMotion.matches) {
                document.startViewTransition(() => render(next));
            } else {
                render(next);
            }
        });

        // Follow the system while the visitor has not chosen a theme here.
        system.addEventListener("change", (event) => {
            if (!savedTheme()) render(event.matches ? "dark" : "light");
        });
    }
}

/* --------------------------------------------------------------------------
   Navigation map
   Each link gets a position (--pos) equal to where its section starts in the
   page, and the header gets --progress, the reading position. The reading
   line moves from the top of the window at the start of the page to the
   bottom of the window at the end, so it crosses every section.
   -------------------------------------------------------------------------- */
{
    const header = document.querySelector(".site-header");
    const nav = document.querySelector(".map");
    const rail = matchMedia("(min-width: 75rem)");
    const MIN_GAP = 30; // px between two ticks on the rail, so labels never overlap

    const items = nav
        ? [...nav.querySelectorAll('a[href^="#"]')]
            .map((link) => ({
                link,
                item: link.parentElement,
                section: document.getElementById(decodeURIComponent(link.hash.slice(1))),
            }))
            .filter((entry) => entry.section)
        : [];

    let tops = [];
    let pageHeight = 1;
    let offset = 0;
    let current = null;
    let queued = false;

    const update = () => {
        queued = false;
        const range = Math.max(1, pageHeight - window.innerHeight);
        const fraction = Math.min(1, Math.max(0, window.scrollY / range));
        const line = window.scrollY + offset + fraction * (window.innerHeight - offset);
        header.style.setProperty("--progress", Math.min(1, line / pageHeight).toFixed(4));

        let index = -1;
        for (let i = 0; i < tops.length; i++) {
            if (tops[i] <= line + 1) index = i;
        }
        // A link that is hidden at this width is never marked. If its section lies inside the
        // section of a link that is shown (Explorations, inside Work), that link is marked instead.
        let next = null;
        if (index >= 0) {
            const here = items[index];
            const shown = (entry) => entry.link.offsetParent !== null;
            next = shown(here) ? here.link : (items.slice(0, index).reverse().find((entry) => shown(entry) && entry.section.contains(here.section))?.link ?? null);
        }
        if (next === current) return;
        current?.removeAttribute("aria-current");
        next?.setAttribute("aria-current", "location");
        current = next;

        // In the top bar, keep the current link in view if the row is scrolled.
        if (next && !rail.matches) {
            const box = nav.getBoundingClientRect();
            const linkBox = next.getBoundingClientRect();
            if (linkBox.left < box.left || linkBox.right > box.right) {
                nav.scrollLeft += linkBox.left - box.left - (box.width - linkBox.width) / 2;
            }
        }
    };

    const measure = () => {
        pageHeight = root.scrollHeight;
        offset = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
        tops = items.map((entry) => entry.section.getBoundingClientRect().top + window.scrollY);

        const positions = tops.map((top) => top / pageHeight);
        if (rail.matches) {
            const gap = MIN_GAP / (nav.clientHeight || 1);
            for (let i = 1; i < positions.length; i++) {
                positions[i] = Math.max(positions[i], positions[i - 1] + gap);
            }
            const last = positions.length - 1;
            positions[last] = Math.min(positions[last], 1);
            for (let i = last - 1; i >= 0; i--) {
                positions[i] = Math.min(positions[i], positions[i + 1] - gap);
            }
        }
        items.forEach((entry, i) => entry.item.style.setProperty("--pos", positions[i].toFixed(4)));
        update();
    };

    if (header && items.length) {
        window.addEventListener(
            "scroll",
            () => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(update);
            },
            { passive: true },
        );
        window.addEventListener("resize", measure);
        rail.addEventListener("change", measure);
        // The page height changes when fonts and images load or a disclosure opens.
        if ("ResizeObserver" in window) new ResizeObserver(measure).observe(document.body);
        measure();
    }
}

/* --------------------------------------------------------------------------
   Shared helpers for the two inline schematics
   -------------------------------------------------------------------------- */
const SVG_NS = "http://www.w3.org/2000/svg";

const createSvg = (name, attributes) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
};

// Pointer position in the drawing's own coordinates (its viewBox units).
const svgPoint = (svg, event) => {
    const matrix = svg.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
};

// The line of text under a schematic: a hint until something is selected.
const addStatus = (svg, pointHint, tapHint) => {
    const hint = matchMedia("(hover: hover)").matches ? pointHint : tapHint;
    const status = document.createElement("p");
    status.className = "schem-status is-hint";
    status.setAttribute("aria-hidden", "true");
    status.textContent = hint;
    svg.after(status);
    return (text) => {
        status.classList.toggle("is-hint", text === null);
        status.textContent = text ?? hint;
    };
};

// Run an entry animation once, the first time the figure is mostly in view.
// Returns false when animations are unavailable or the visitor prefers reduced motion.
const playWhenVisible = (svg, play) => {
    if (reduceMotion.matches || !("IntersectionObserver" in window) || !svg.animate) return false;
    svg.classList.add("is-pending");
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            svg.classList.remove("is-pending");
            play();
        },
        { threshold: 0.6 },
    );
    observer.observe(svg);
    return true;
};

/* --------------------------------------------------------------------------
   Map-integration schematic (MAPpoly2)
   Selecting a marker shows which populations mapped it. The first time the
   figure comes into view, the markers drop into the consensus map.
   -------------------------------------------------------------------------- */
{
    const svg = document.querySelector(".schem-map");

    if (svg && svg.getScreenCTM) {
        const X0 = 98; // x of the first marker position
        const STEP = 14.5; // distance between neighbouring positions
        const CONSENSUS_Y = 160;
        const xOf = (k) => X0 + STEP * k;

        const populations = [...svg.querySelectorAll(".pop")].map((group) => {
            const y = Number(group.dataset.y);
            const placeholder = createSvg("circle", { class: "absent", r: 5, cy: y });
            group.insertBefore(placeholder, group.querySelector(".markers"));
            return {
                id: group.dataset.pop,
                y,
                placeholder,
                markers: new Map([...group.querySelectorAll(".markers circle")].map((c) => [Number(c.dataset.k), c])),
            };
        });
        const ticks = [...svg.querySelectorAll(".cons-ticks line")];
        const count = ticks.length;

        const guide = createSvg("line", { class: "guide", y1: populations[0].y, y2: CONSENSUS_Y - 8 });
        svg.insertBefore(guide, svg.querySelector(".pop"));

        const setStatus = addStatus(
            svg,
            "Point at a marker to see which populations mapped it.",
            "Tap a marker to see which populations mapped it.",
        );

        const listNames = (names) => {
            if (names.length === 1) return `${names[0]} only`;
            return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
        };

        let active = null;
        const select = (k) => {
            if (k === active) return;
            active = k;
            svg.querySelectorAll(".is-on").forEach((node) => node.classList.remove("is-on"));
            svg.classList.toggle("has-active", k !== null);
            if (k === null) {
                setStatus(null);
                return;
            }
            const x = xOf(k);
            guide.setAttribute("x1", x);
            guide.setAttribute("x2", x);
            ticks[k].classList.add("is-on");
            const mappedIn = [];
            for (const population of populations) {
                const marker = population.markers.get(k);
                if (marker) {
                    marker.classList.add("is-on");
                    mappedIn.push(`Pop ${population.id}`);
                } else {
                    population.placeholder.setAttribute("cx", x);
                    population.placeholder.classList.add("is-on");
                }
            }
            setStatus(`Mapped in ${listNames(mappedIn)}; placed once on the consensus map.`);
        };

        const positionAt = (event) => {
            const point = svgPoint(svg, event);
            if (!point) return null;
            const k = Math.round((point.x - X0) / STEP);
            return k >= 0 && k < count ? k : null;
        };

        svg.addEventListener("pointerdown", (event) => select(positionAt(event)));
        // Mouse: follow the pointer. Touch: follow a horizontal drag (see touch-action in the CSS).
        svg.addEventListener("pointermove", (event) => select(positionAt(event)));
        svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "mouse") select(null);
        });

        playWhenVisible(svg, () => {
            const STAGGER = 45;
            const FALL = 650;
            const layer = createSvg("g", { class: "ghosts", "aria-hidden": "true" });
            svg.insertBefore(layer, svg.querySelector(".consensus"));

            let lastAnimation = null;
            for (let k = 0; k < count; k++) {
                const delay = k * STAGGER;
                for (const population of populations) {
                    if (!population.markers.has(k)) continue;
                    const ghost = createSvg("circle", {
                        class: `ghost-${population.id}`,
                        r: 5,
                        cx: xOf(k),
                        cy: population.y,
                    });
                    layer.append(ghost);
                    const drop = `translateY(${CONSENSUS_Y - population.y}px)`;
                    lastAnimation = ghost.animate(
                        [
                            { transform: "translateY(0)", opacity: 1 },
                            { transform: drop, opacity: 1, offset: 0.85 },
                            { transform: drop, opacity: 0 },
                        ],
                        { duration: FALL, delay, easing: "cubic-bezier(0.45, 0, 0.9, 0.5)", fill: "both" },
                    );
                }
                ticks[k].animate(
                    [
                        { opacity: 0, transform: "scaleY(0)" },
                        { opacity: 1, transform: "scaleY(1)" },
                    ],
                    { duration: 220, delay: delay + FALL * 0.8, easing: "ease-out", fill: "backwards" },
                );
            }
            lastAnimation?.finished.then(() => layer.remove()).catch(() => layer.remove());
        });
    }
}

/* --------------------------------------------------------------------------
   Maternal-inheritance schematic (HalfSibMap)
   Each offspring row is coloured by the maternal homolog it inherited.
   Selecting an offspring marks its crossovers and where they fall on the map.
   The first time the figure comes into view, the rows start out unknown and
   are filled in from left to right, with the map markers appearing in step.
   -------------------------------------------------------------------------- */
{
    const svg = document.querySelector(".schem-hs");

    if (svg && svg.getScreenCTM) {
        const X0 = 108; // left and right ends of the linkage group
        const X1 = 404;
        const ROW_H = 7;
        const MAP_TOP = 196;

        const rows = [...svg.querySelectorAll(".hs-row")].map((group) => ({
            group,
            y: Number(group.dataset.y),
            homologs: group.dataset.homs.split(","),
            crossovers: group.dataset.cross ? group.dataset.cross.split(",").map(Number) : [],
        }));
        const pitch = rows.length > 1 ? rows[1].y - rows[0].y : ROW_H;
        const ticks = [...svg.querySelectorAll(".hs-ticks line")];
        const mostCrossovers = Math.max(...rows.map((row) => row.crossovers.length));

        // One mark on the row and one dashed guide down to the map for each crossover.
        const mapGroup = svg.querySelector(".hs-map");
        const marks = [];
        const guides = [];
        for (let i = 0; i < mostCrossovers; i++) {
            const guide = createSvg("line", { class: "guide", y2: MAP_TOP });
            const mark = createSvg("line", { class: "hs-cross" });
            svg.insertBefore(guide, mapGroup);
            svg.insertBefore(mark, mapGroup);
            guides.push(guide);
            marks.push(mark);
        }

        const setStatus = addStatus(
            svg,
            "Point at an offspring to see where its crossovers fall on the map.",
            "Tap an offspring to see where its crossovers fall on the map.",
        );

        const describe = (row) => {
            const sequence = row.homologs.map((h) => `homolog ${h}`);
            if (sequence.length === 1) return `No crossover: ${sequence[0]} along the whole linkage group.`;
            const counted = sequence.length === 2 ? "One crossover" : "Two crossovers";
            return `${counted}: ${sequence.join(", then ")}.`;
        };

        let ready = false;
        let active = null;
        const select = (index) => {
            if (!ready || index === active) return;
            active = index;
            svg.querySelectorAll(".is-on").forEach((node) => node.classList.remove("is-on"));
            svg.classList.toggle("has-active", index !== null);
            if (index === null) {
                setStatus(null);
                return;
            }
            const row = rows[index];
            row.group.classList.add("is-on");
            row.crossovers.forEach((x, i) => {
                for (const line of [marks[i], guides[i]]) {
                    line.setAttribute("x1", x);
                    line.setAttribute("x2", x);
                    line.classList.add("is-on");
                }
                marks[i].setAttribute("y1", row.y - 2.5);
                marks[i].setAttribute("y2", row.y + ROW_H + 2.5);
                guides[i].setAttribute("y1", row.y + ROW_H + 2.5);
            });
            setStatus(describe(row));
        };

        const rowAt = (event) => {
            const point = svgPoint(svg, event);
            if (!point || point.x < X0 - 10 || point.x > X1 + 10) return null;
            const index = Math.round((point.y - (rows[0].y + ROW_H / 2)) / pitch);
            return index >= 0 && index < rows.length ? index : null;
        };

        svg.addEventListener("pointerdown", (event) => select(rowAt(event)));
        svg.addEventListener("pointermove", (event) => {
            if (event.pointerType === "mouse") select(rowAt(event));
        });
        svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "mouse") select(null);
        });

        // Until the animation runs, a plain cover hides each row's colours.
        const cover = createSvg("g", { class: "hs-cover", "aria-hidden": "true" });
        for (const row of rows) {
            cover.append(createSvg("rect", { x: X0, y: row.y - 0.5, width: X1 - X0 + 0.5, height: ROW_H + 1 }));
        }

        const animated = playWhenVisible(svg, () => {
            const SWEEP = 1800;
            const travel = `translateX(${X1 - X0}px)`;
            const scan = createSvg("line", {
                class: "hs-scan",
                x1: X0,
                x2: X0,
                y1: rows[0].y - 4,
                y2: MAP_TOP + 16,
            });
            svg.append(scan);

            // The cover shrinks toward the right edge, so its left edge follows the scan line.
            cover.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
                duration: SWEEP,
                easing: "linear",
                fill: "forwards",
            });
            const sweep = scan.animate([{ transform: "translateX(0)" }, { transform: travel }], {
                duration: SWEEP,
                easing: "linear",
                fill: "forwards",
            });
            for (const tick of ticks) {
                const reached = (Number(tick.getAttribute("x1")) - X0) / (X1 - X0);
                tick.animate(
                    [
                        { opacity: 0, transform: "scaleY(0)" },
                        { opacity: 1, transform: "scaleY(1)" },
                    ],
                    { duration: 200, delay: reached * SWEEP, easing: "ease-out", fill: "backwards" },
                );
            }
            const finish = () => {
                cover.remove();
                ready = true;
                const fade = scan.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
                fade.finished.then(() => scan.remove()).catch(() => scan.remove());
            };
            sweep.finished.then(finish).catch(finish);
        });

        if (animated) {
            svg.querySelector(".hs-offspring").append(cover);
        } else {
            ready = true;
        }
    }
}

/* --------------------------------------------------------------------------
   Hexaploid-inheritance schematic (sweetpotato)
   Each parent has six homologs; the offspring has three from each parent.
   The figure has five views of the same linkage group.

   1. Haplotypes. Selecting one of the offspring's homologs shows the parental
      segments it is made of. The first time the figure comes into view, those
      segments move down from the parents into place. Where an offspring
      homolog switches from one parental homolog to another, those two
      exchanged segments, so they were paired at that place. Each exchange is
      drawn in its parent as a link between the two homologs.
   2. Partners. Each parent's homologs are drawn beside the homologs they
      paired with. In Beauregard every homolog has one partner. In Tanzania
      the pairs on the left of the linkage group are not the pairs on the right.
   3. Pairing. Beauregard stays as three pairs (bivalents). In Tanzania the
      changes of partner join all six homologs: a star with six arms, each arm
      a pair of homologs, with the change of partners at its centre.
   4. Gametes. The three chromosomes each meiosis sent to its gamete, picked
      out where they lie in the bivalents and the star: each follows one
      homolog and passes to its partner at a crossover.
   5. Offspring. Those chromosomes leave the two meioses and come together as
      the offspring's six homologs: the picture of view 1 again.

   Views 2 and 3 are arrangements of the same twelve strands, one per parental
   homolog, and views 4 and 5 of the six chromosomes cut from them. Changing
   view moves the strands or the chromosomes from one arrangement to the next.
   -------------------------------------------------------------------------- */
{
    const svg = document.querySelector(".schem-hx");

    if (svg && svg.getScreenCTM) {
        const X0 = 108; // left and right ends of the linkage group
        const X1 = 404;
        const MAP = 290; // its length, in centimorgans
        const cmOf = (x) => ((x - X0) / (X1 - X0)) * MAP;
        const pairOf = (a, b) => [a, b].sort().join("");
        const mix = (a, b, t) => a + (b - a) * t;
        const clamp = (n) => Math.min(1, Math.max(0, n));
        const point = (x, y) => ({ x, y });

        // The parental homologs, by letter
        const homologs = new Map(
            [...svg.querySelectorAll(".hx-parent rect")].map((bar) => [
                bar.dataset.hom,
                {
                    bar,
                    parent: bar.closest(".hx-parent").dataset.parent,
                    y: Number(bar.getAttribute("y")),
                    height: Number(bar.getAttribute("height")),
                },
            ]),
        );

        const rows = [...svg.querySelectorAll(".hx-row")].map((group) => {
            const segments = [...group.querySelectorAll(".hx-seg")];
            return {
                group,
                segments,
                y: Number(group.dataset.y),
                height: Number(segments[0].getAttribute("height")),
                parent: group.dataset.parent,
                crossovers: group.dataset.cross ? group.dataset.cross.split(",").map(Number) : [],
                // The two parental homologs that meet at each crossover
                pairs: segments.slice(1).map((segment, i) => pairOf(segments[i].dataset.hom, segment.dataset.hom)),
            };
        });

        const parents = [...svg.querySelectorAll(".hx-parent")].map((group) => {
            const bars = [...group.querySelectorAll("rect")];
            return {
                group,
                name: group.dataset.parent,
                top: Math.min(...bars.map((bar) => Number(bar.getAttribute("y")))) - 4,
                bottom: Math.max(...bars.map((bar) => Number(bar.getAttribute("y")) + Number(bar.getAttribute("height")))) + 4,
                links: [...group.querySelectorAll(".hx-link")],
            };
        });

        // One exchange per link: which two homologs, and where on the linkage group
        const exchanges = parents.flatMap((parent) =>
            parent.links.map((link) => ({
                link,
                parent: parent.name,
                pair: link.dataset.pair,
                homs: [...link.dataset.pair],
                cm: cmOf(Number(link.dataset.x)),
            })),
        );

        /* What the exchanges say about pairing.
           Beauregard: each exchange joins a different pair of homologs, and the two homologs
           with no exchange are drawn together.
           Tanzania: left of the change of partners the pairs are k-g, l-i and h-j; right of it
           they are g-l, i-h and, the only two left, j-k. Followed from partner to partner, the
           six homologs form one ring, in this order. */
        const BIVALENTS = ["a", "b", "c", "e", "d", "f"]; // in pairs
        const RING = ["k", "g", "l", "i", "h", "j"];
        const CHANGE = [82, 124]; // where the change of partners is drawn, in cM (it lies between 60 and 147)

        // Each strand is drawn through these four positions of the linkage group
        const STOPS = [0, CHANGE[0], CHANGE[1], MAP];
        const WIDE = 5; // strand width on the parents, and once drawn beside its partners
        const SLIM = 4.4;
        const OFF = 3.8; // half the distance between two paired strands
        const PAIR_ROWS = [147, 175, 203];
        const FLAT = { Beauregard: 14, Tanzania: 232, length: 168 };
        const STAR = { x: 316, y: 192, inner: 10, scale: 0.4 };

        // Arrangement 0: on the parent's bars
        const onBars = (hom) => {
            const { y, height } = homologs.get(hom);
            return STOPS.map((cm) => point(mix(X0, X1, cm / MAP), y + height / 2));
        };
        // Arrangement 1: beside its partner, left to right. Six places, two to a row.
        const placeY = (place) => PAIR_ROWS[place >> 1] + (place % 2 ? OFF : -OFF);
        const besidePartners = (hom) => {
            const { parent } = homologs.get(hom);
            const ring = RING.indexOf(hom);
            const [left, right] = ring < 0 ? Array(2).fill(BIVALENTS.indexOf(hom)) : [ring, (ring + 5) % 6];
            return STOPS.map((cm, i) => point(FLAT[parent] + (cm / MAP) * FLAT.length, placeY(i < 2 ? left : right)));
        };
        // Arrangement 2, Tanzania only: the star. Arm m holds RING[m] and RING[m + 1], one on
        // each side. Even arms carry the left of the linkage group, odd arms the right.
        const onArm = (arm, side, radius) => {
            const angle = ((210 + 60 * arm) * Math.PI) / 180;
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            return point(STAR.x + dx * radius - dy * side * OFF, STAR.y + dy * radius + dx * side * OFF);
        };
        const inStar = (hom) => {
            const ring = RING.indexOf(hom);
            const before = (ring + 5) % 6;
            const [leftArm, leftSide, rightArm, rightSide] = ring % 2 === 0 ? [ring, -1, before, 1] : [before, 1, ring, -1];
            return [
                onArm(leftArm, leftSide, STAR.inner + CHANGE[0] * STAR.scale),
                onArm(leftArm, leftSide, STAR.inner),
                onArm(rightArm, rightSide, STAR.inner),
                onArm(rightArm, rightSide, STAR.inner + (MAP - CHANGE[1]) * STAR.scale),
            ];
        };

        // Everything drawn for views 2 to 5: the homologs as they paired, and over them
        // the chromosomes that went to the gametes
        const layer = createSvg("g", { class: "hx-strands" });
        const meiosis = createSvg("g", { class: "hx-meiosis" });
        const gametes = createSvg("g", { class: "hx-gametes" });
        layer.append(meiosis, gametes);
        const zone = createSvg("ellipse", { class: "hx-zone" });
        meiosis.append(zone);
        const zonePoses = [
            { cx: mix(X0, X1, (CHANGE[0] + CHANGE[1]) / 2 / MAP), cy: 80, rx: 22, ry: 25 },
            { cx: FLAT.Tanzania + ((CHANGE[0] + CHANGE[1]) / 2 / MAP) * FLAT.length, cy: PAIR_ROWS[1], rx: 17, ry: 44 },
            { cx: STAR.x, cy: STAR.y, rx: 17, ry: 17 },
        ];

        // Drawn in this order, so the one strand that crosses the others lies on top
        const strands = [...homologs.keys()]
            .sort((a, b) => (a === RING[0]) - (b === RING[0]))
            .map((hom) => {
                const group = createSvg("g", { class: "hx-strand-group", "data-hom": hom });
                const edge = createSvg("path", { class: "hx-strand-edge" });
                const line = createSvg("path", { class: "hx-strand" });
                line.style.stroke = `var(--hx-${hom})`;
                group.append(edge, line);
                meiosis.append(group);
                const beside = besidePartners(hom);
                return {
                    hom,
                    parent: homologs.get(hom).parent,
                    group,
                    paths: [edge, line],
                    poses: [onBars(hom), beside, RING.includes(hom) ? inStar(hom) : beside],
                    now: null,
                };
            });
        const strandOf = new Map(strands.map((strand) => [strand.hom, strand]));
        // The homologs each one is drawn beside
        const partnersOf = (hom) => {
            const ring = RING.indexOf(hom);
            if (ring >= 0) return [RING[(ring + 5) % 6], RING[(ring + 1) % 6]];
            return [BIVALENTS[BIVALENTS.indexOf(hom) ^ 1]];
        };

        // Each exchange again, as a tie between the two strands
        const ties = exchanges.map((exchange) => {
            const group = createSvg("g", { class: "hx-link hx-tie", "data-pair": exchange.pair });
            const lines = [createSvg("line", { class: "hx-link-halo" }), createSvg("line", {})];
            const dots = [createSvg("circle", { r: 1.7 }), createSvg("circle", { r: 1.7 })];
            group.append(...lines, ...dots);
            meiosis.append(group);
            return { ...exchange, group, lines, dots };
        });

        const NOTES = {
            2: { Beauregard: "Beauregard: one partner each", Tanzania: "Tanzania: partners change" },
            3: { Beauregard: "Beauregard: three bivalents", Tanzania: "Tanzania: one hexavalent" },
            4: { Beauregard: "Gamete from Beauregard", Tanzania: "Gamete from Tanzania" },
        };
        const notes = parents.map((parent) => {
            const text = createSvg("text", { class: "hx-note", x: FLAT[parent.name] + FLAT.length / 2, y: 255 });
            layer.append(text);
            return { parent: parent.name, text };
        });

        // A point of a strand, by its position on the linkage group
        const along = (points, cm) => {
            const [from, to, start, end] = cm <= CHANGE[0] ? [points[0], points[1], 0, CHANGE[0]] : [points[2], points[3], CHANGE[1], MAP];
            const t = (cm - start) / (end - start);
            return point(mix(from.x, to.x, t), mix(from.y, to.y, t));
        };
        const round = (n) => Math.round(n * 100) / 100;
        const at = (p) => `${round(p.x)} ${round(p.y)}`;
        // Straight to the change of partners, a curve through it, straight again
        const controls = ([p0, p1, p2, p3]) => {
            const reach = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
            const beyond = (from, to) => {
                const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                return point(to.x + ((to.x - from.x) / length) * reach, to.y + ((to.y - from.y) / length) * reach);
            };
            return [beyond(p0, p1), beyond(p3, p2)];
        };
        const pathOf = (points) => {
            const [c1, c2] = controls(points);
            return `M${at(points[0])}L${at(points[1])}C${at(c1)} ${at(c2)} ${at(points[2])}L${at(points[3])}`;
        };
        // The same point as `along`, but also inside the curve
        const curveAt = (points, cm) => {
            if (cm <= CHANGE[0] || cm >= CHANGE[1]) return along(points, cm);
            const [c1, c2] = controls(points);
            const t = (cm - CHANGE[0]) / (CHANGE[1] - CHANGE[0]);
            const s = 1 - t;
            const blend = (key) => s ** 3 * points[1][key] + 3 * s * s * t * c1[key] + 3 * s * t * t * c2[key] + t ** 3 * points[2][key];
            return point(blend("x"), blend("y"));
        };

        /* Views 4 and 5: the three chromosomes each meiosis sent to its gamete. They are the
           offspring's homologs again. Every segment is a stretch of one parental strand, drawn
           first where that strand lies in its bivalent or in the star, then in the offspring. */
        const SAMPLE = 4; // cM between the points a segment is drawn through
        const GHOST = 0.25; // how much of the homologs is left once the chromosomes are picked out
        const chromosomes = rows.map((row) => {
            const group = createSvg("g", { class: "hx-chrom" });
            const edge = createSvg("path", { class: "hx-chrom-edge" });
            group.append(edge);
            const parts = row.segments.map((segment) => {
                const hom = segment.dataset.hom;
                const x = Number(segment.getAttribute("x"));
                const from = cmOf(x);
                const to = cmOf(x + Number(segment.getAttribute("width")));
                const count = Math.max(1, Math.ceil((to - from) / SAMPLE));
                const stops = Array.from({ length: count + 1 }, (_, i) => mix(from, to, i / count));
                const line = createSvg("path", { class: "hx-part" });
                line.style.stroke = `var(--hx-${hom})`;
                group.append(line);
                return {
                    line,
                    poses: [
                        stops.map((cm) => curveAt(strandOf.get(hom).poses[2], cm)),
                        stops.map((cm) => point(mix(X0, X1, cm / MAP), row.y + row.height / 2)),
                    ],
                    now: null,
                };
            });
            gametes.append(group);
            return { row, group, edge, parts };
        });

        /* 0 on the parents' bars, 1 beside their partners, 2 in bivalents and the star, 3 the
           same with the gametes' chromosomes picked out, 4 those chromosomes in the offspring;
           anything between while moving */
        let pose = 0;
        const draw = (to) => {
            pose = to;
            const paired = Math.min(to, 2);
            const from = Math.min(1, Math.floor(paired));
            const t = paired - from;
            const width = mix(WIDE, SLIM, Math.min(to, 1));
            for (const strand of strands) {
                const a = strand.poses[from];
                const b = strand.poses[from + 1];
                strand.now = a.map((p, i) => point(mix(p.x, b[i].x, t), mix(p.y, b[i].y, t)));
                const d = pathOf(strand.now);
                strand.paths.forEach((path, i) => {
                    path.setAttribute("d", d);
                    path.setAttribute("stroke-width", round(i ? width : width + 0.8));
                });
            }
            for (const tie of ties) {
                const ends = tie.homs.map((hom) => along(strandOf.get(hom).now, tie.cm));
                for (const line of tie.lines) {
                    line.setAttribute("x1", round(ends[0].x));
                    line.setAttribute("y1", round(ends[0].y));
                    line.setAttribute("x2", round(ends[1].x));
                    line.setAttribute("y2", round(ends[1].y));
                }
                tie.dots.forEach((dot, i) => {
                    dot.setAttribute("cx", round(ends[i].x));
                    dot.setAttribute("cy", round(ends[i].y));
                });
            }
            for (const key of ["cx", "cy", "rx", "ry"]) zone.setAttribute(key, round(mix(zonePoses[from][key], zonePoses[from + 1][key], t)));
            zone.style.opacity = round(Math.min(to, 1));

            // From view 4 the homologs step back behind the chromosomes; in view 5 they are gone
            meiosis.style.opacity = round(to <= 2 ? 1 : to <= 3 ? mix(1, GHOST, to - 2) : mix(GHOST, 0, clamp((to - 3) * 2)));
            gametes.style.opacity = round(clamp(to - 2));
            if (to > 2) {
                const leave = clamp(to - 3);
                for (const chromosome of chromosomes) {
                    const thick = mix(SLIM, chromosome.row.height, leave);
                    const whole = [];
                    for (const part of chromosome.parts) {
                        const [here, there] = part.poses;
                        part.now = here.map((p, i) => point(mix(p.x, there[i].x, leave), mix(p.y, there[i].y, leave)));
                        part.line.setAttribute("d", `M${part.now.map(at).join("L")}`);
                        part.line.setAttribute("stroke-width", round(thick));
                        whole.push(...part.now);
                    }
                    // One outline for the whole chromosome, across its crossovers
                    chromosome.edge.setAttribute("d", `M${whole.map(at).join("L")}`);
                    chromosome.edge.setAttribute("stroke-width", round(thick + mix(1.4, 0.7, leave)));
                }
            }
            svg.classList.toggle("is-flat", to === 0);
        };
        draw(0);
        svg.append(layer);

        // Move to another arrangement, through the ones in between if there are any
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
        const FORWARD = [1000, 1300, 700, 1500]; // time to reach arrangements 1 to 4
        const BACK = [650, 650, 400, 900]; // and to go back to arrangements 0 to 3
        let move = 0;
        let landing;
        const moveTo = (target) => {
            const id = ++move;
            clearTimeout(landing);
            svg.classList.remove("is-settled", "is-landed");
            const still = reduceMotion.matches || !window.requestAnimationFrame;
            const settle = () => {
                svg.classList.add("is-settled");
                // In the last view the offspring itself takes over from the chromosomes that moved there
                if (target === 4) landing = setTimeout(() => svg.classList.add("is-landed"), still ? 0 : 320);
            };
            // Views 1 and 5 are the same picture, so going from the last to the first moves nothing
            if (still || (pose === 4 && target === 0)) {
                draw(target);
                settle();
                return;
            }
            const leg = (from, to, duration) =>
                new Promise((resolve) => {
                    const start = performance.now();
                    const frame = (now) => {
                        if (id !== move) return; // replaced by a newer move
                        const t = clamp((now - start) / duration);
                        draw(mix(from, to, ease(t)));
                        if (t < 1) requestAnimationFrame(frame);
                        else resolve();
                    };
                    requestAnimationFrame(frame);
                });
            (async () => {
                while (id === move && pose !== target) {
                    const forward = target > pose;
                    const next = forward ? Math.min(target, Math.floor(pose) + 1) : Math.max(target, Math.ceil(pose) - 1);
                    const full = forward ? FORWARD[next - 1] : BACK[next];
                    await leg(pose, next, full * Math.max(Math.abs(next - pose), 0.4));
                    if (forward && next !== target) await new Promise((resolve) => setTimeout(resolve, next === 3 ? 900 : 550));
                }
                if (id === move) settle();
            })();
        };

        // Reusable highlights over the parents, and marks for the crossovers on the offspring.
        const arrow = svg.querySelector(".schem-arrow");
        const mostSegments = Math.max(...rows.map((row) => row.segments.length));
        const mostCrossovers = Math.max(...parents.map((parent) => rows.filter((row) => row.parent === parent.name).reduce((sum, row) => sum + row.crossovers.length, 0)));
        const picks = [];
        const marks = [];
        for (let i = 0; i < mostSegments; i++) {
            const pick = createSvg("rect", { class: "hx hx-pick" });
            svg.insertBefore(pick, arrow);
            picks.push(pick);
        }
        for (let i = 0; i < mostCrossovers; i++) {
            const mark = createSvg("line", { class: "hs-cross" });
            svg.insertBefore(mark, layer);
            marks.push(mark);
        }
        // Links sit above the highlights, so they stay visible on a selected homolog
        for (const parent of parents) for (const link of parent.links) svg.insertBefore(link, arrow);

        const setStatus = addStatus(
            svg,
            "Point at an offspring homolog to see where it came from, or at a parent to see its crossovers.",
            "Tap an offspring homolog to see where it came from, or a parent to see its crossovers.",
        );
        const status = svg.nextElementSibling;

        // What each view says: with nothing selected, and for each parent
        const VIEWS = ["Haplotypes", "Partners", "Pairing", "Gametes", "Offspring"];
        const SAYS = {
            1: {
                idle: null, // the hint
                Beauregard: "Beauregard: two crossovers, each between a different pair of homologs.",
                Tanzania: "Tanzania: five crossovers. Four homologs exchanged segments with two different partners.",
            },
            2: {
                idle: "Homologs that exchanged segments were paired at that place. Here each homolog is drawn beside its partners.",
                Beauregard: "Beauregard: no homolog has more than one partner.",
                Tanzania: "Tanzania: the pairs on the left of the chromosome are not the pairs on the right.",
            },
            3: {
                idle: "Beauregard: three separate pairs, the bivalents. Tanzania: the changes of partner join all six homologs into one hexavalent.",
                Beauregard: "Beauregard: three separate pairs of homologs, or bivalents.",
                Tanzania: "Tanzania: one hexavalent. Each arm of the star is a pair of homologs, and partners change at its centre.",
            },
            4: {
                idle: "Each meiosis sends three chromosomes to its gamete. Each one follows a homolog and passes to its partner at a crossover.",
                Beauregard: "Gamete from Beauregard: two chromosomes with one crossover each, and one whole homolog.",
                Tanzania: "Gamete from Tanzania: one chromosome with one crossover, and two with two crossovers each.",
            },
            5: {
                idle: "The two gametes together are this offspring's six homologs, three from each parent: the genotype the inference started from.",
            },
        };
        SAYS[5].Beauregard = SAYS[1].Beauregard;
        SAYS[5].Tanzania = SAYS[1].Tanzania;
        const describeRow = (row) => {
            const count = new Set(row.segments.map((segment) => segment.dataset.hom)).size;
            if (count === 1) return `From ${row.parent}: one whole homolog, no crossover.`;
            if (count === 2) return `From ${row.parent}: segments of two homologs, joined at one crossover.`;
            return `From ${row.parent}: segments of three homologs, joined at two crossovers.`;
        };
        const HOMOLOG_SAYS = {
            two: "This homolog exchanged segments with two different partners, on different parts of the chromosome.",
            oneOfTwo: "This homolog exchanged segments with one partner. On the rest of the chromosome it is drawn with the only homolog left.",
            one: "This homolog exchanged segments with one partner only.",
            none: "No exchange was seen for this homolog. It is drawn with the only homolog left.",
        };
        const describeHomolog = (hom) => {
            const seen = new Set(exchanges.filter((exchange) => exchange.homs.includes(hom)).map((exchange) => exchange.pair)).size;
            if (RING.includes(hom)) return seen === 2 ? HOMOLOG_SAYS.two : HOMOLOG_SAYS.oneOfTwo;
            return seen === 1 ? HOMOLOG_SAYS.one : HOMOLOG_SAYS.none;
        };

        // Room for the longest of these, so the page below does not move as the words change
        {
            const texts = [...Object.values(SAYS).flatMap((says) => Object.values(says)), ...Object.values(HOMOLOG_SAYS), ...rows.map(describeRow)].filter(Boolean);
            let width = 0;
            const measure = () => {
                const now = status.clientWidth;
                if (!now || now === width) return;
                width = now;
                const probe = status.cloneNode(false);
                probe.className = "schem-status";
                probe.style.cssText = `position:absolute;visibility:hidden;min-height:0;width:${now}px`;
                status.parentNode.append(probe);
                let tallest = 0;
                for (const text of texts) {
                    probe.textContent = text;
                    tallest = Math.max(tallest, probe.offsetHeight);
                }
                probe.remove();
                status.style.minHeight = `${tallest}px`;
            };
            if ("ResizeObserver" in window) new ResizeObserver(measure).observe(status);
            document.fonts?.ready.then(() => {
                width = 0;
                measure();
            });
        }

        const markCrossovers = (shown) => {
            let used = 0;
            for (const row of shown) {
                for (const x of row.crossovers) {
                    const mark = marks[used++];
                    mark.setAttribute("x1", x);
                    mark.setAttribute("x2", x);
                    mark.setAttribute("y1", row.y - 2.5);
                    mark.setAttribute("y2", row.y + row.height + 2.5);
                    mark.classList.add("is-on");
                }
            }
        };

        // `target` is "row:<index>", "parent:<name>", "hom:<letter>" or null
        let step = 1;
        let ready = false;
        let active = null;
        // Views 1 and 5 show the offspring itself
        const atHome = () => step === 1 || (step === 5 && svg.classList.contains("is-landed"));
        const select = (target) => {
            if (!ready || target === active) return;
            active = target;
            svg.querySelectorAll(".is-on, .is-picked").forEach((node) => node.classList.remove("is-on", "is-picked"));
            svg.classList.toggle("has-active", target !== null);
            if (target === null) {
                setStatus(SAYS[step].idle);
                return;
            }
            const [kind, value] = target.split(":");
            if (kind === "row") {
                const row = rows[Number(value)];
                row.group.classList.add("is-on");
                chromosomes[Number(value)].group.classList.add("is-on");
                row.segments.forEach((segment, i) => {
                    const homolog = segment.dataset.hom;
                    const source = homologs.get(homolog);
                    const pick = picks[i];
                    pick.setAttribute("class", `hx hx-pick hx-${homolog} is-on`);
                    pick.setAttribute("x", segment.getAttribute("x"));
                    pick.setAttribute("width", segment.getAttribute("width"));
                    pick.setAttribute("y", source.y);
                    pick.setAttribute("height", source.height);
                });
                for (const exchange of ties) {
                    if (!row.pairs.includes(exchange.pair)) continue;
                    exchange.group.classList.add("is-on");
                    exchange.link.classList.add("is-on");
                }
                if (atHome()) markCrossovers([row]);
                setStatus(describeRow(row));
            } else if (kind === "parent") {
                const parent = parents.find((entry) => entry.name === value);
                parent.group.classList.add("is-on");
                for (const link of parent.links) link.classList.add("is-on");
                for (const strand of strands) if (strand.parent === value) strand.group.classList.add("is-on");
                for (const tie of ties) if (tie.parent === value) tie.group.classList.add("is-on");
                for (const chromosome of chromosomes) if (chromosome.row.parent === value) chromosome.group.classList.add("is-on");
                if (atHome()) {
                    const own = rows.filter((row) => row.parent === value);
                    for (const row of own) row.group.classList.add("is-on");
                    markCrossovers(own);
                }
                setStatus(SAYS[step][value]);
            } else {
                // A parental homolog, with the homologs it is drawn beside
                for (const hom of [value, ...partnersOf(value)]) {
                    strandOf.get(hom).group.classList.add("is-on");
                    homologs.get(hom).bar.classList.add("is-on");
                }
                strandOf.get(value).group.classList.add("is-picked");
                for (const exchange of ties) {
                    if (!exchange.homs.includes(value)) continue;
                    exchange.group.classList.add("is-on");
                    exchange.link.classList.add("is-on");
                }
                setStatus(describeHomolog(value));
            }
        };

        const distanceTo = (p, a, b) => {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        };
        const targetAt = (event) => {
            const p = svgPoint(svg, event);
            if (!p || p.x > X1 + 12 || p.x < -6) return null;
            const parentAt = parents.find((entry) => p.y >= entry.top && p.y <= entry.bottom);
            if (atHome()) {
                if (p.x >= X0 - 10) {
                    let nearest = null;
                    let distance = Infinity;
                    rows.forEach((row, i) => {
                        const d = Math.abs(p.y - (row.y + row.height / 2));
                        if (d < distance) {
                            distance = d;
                            nearest = i;
                        }
                    });
                    if (distance <= rows[0].height) return `row:${nearest}`;
                }
                return parentAt ? `parent:${parentAt.name}` : null;
            }
            if (step === 5) return null; // the chromosomes are still on their way
            if (parentAt) {
                // On a parent: one of its bars, or the parent as a whole
                if (step === 4 || p.x < X0 - 6) return `parent:${parentAt.name}`;
                for (const [hom, { parent, y, height }] of homologs) {
                    if (parent === parentAt.name && p.y >= y - 1 && p.y <= y + height + 1) return `hom:${hom}`;
                }
                return `parent:${parentAt.name}`;
            }
            if (p.y < parents[parents.length - 1].bottom) return null;
            // Below the parents: the nearest strand (or, in view 4, the nearest chromosome),
            // or else the parent whose side this is
            let nearest = null;
            let distance = 5.5;
            const consider = (points, target) => {
                for (let i = 0; i < points.length - 1; i++) {
                    const d = distanceTo(p, points[i], points[i + 1]);
                    if (d < distance) {
                        distance = d;
                        nearest = target;
                    }
                }
            };
            if (step === 4) chromosomes.forEach((chromosome, i) => chromosome.parts.forEach((part) => part.now && consider(part.now, `row:${i}`)));
            else for (const strand of strands) consider(strand.now, `hom:${strand.hom}`);
            return nearest ?? `parent:${parents[p.x < (FLAT.Beauregard + FLAT.length + FLAT.Tanzania) / 2 ? 0 : 1].name}`;
        };

        svg.addEventListener("pointerdown", (event) => {
            // A second tap on the same thing lets go of it
            const target = targetAt(event);
            select(event.pointerType !== "mouse" && target === active ? null : target);
        });
        svg.addEventListener("pointermove", (event) => {
            if (event.pointerType === "mouse") select(targetAt(event));
        });
        svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "mouse") select(null);
        });

        // The entry animation: the offspring is assembled, then the exchanges appear
        let entered = false;
        const animated = playWhenVisible(svg, () => {
            if (entered) return;
            const ROW_GAP = 280; // the offspring's homologs are assembled one after another
            const SEGMENT_GAP = 90;
            const MOVE = 750;
            const moves = [];
            svg.classList.add("is-building");
            rows.forEach((row, r) => {
                row.segments.forEach((segment, s) => {
                    const source = homologs.get(segment.dataset.hom);
                    // Start exactly on top of the parental homolog, then move into the offspring row.
                    const animation = segment.animate(
                        [
                            { transform: `translateY(${source.y - row.y}px) scaleY(${source.height / row.height})` },
                            { transform: "translateY(0) scaleY(1)" },
                        ],
                        {
                            duration: MOVE,
                            delay: r * ROW_GAP + s * SEGMENT_GAP,
                            easing: "cubic-bezier(0.5, 0, 0.3, 1)",
                            fill: "backwards",
                        },
                    );
                    moves.push(animation.finished.catch(() => {}));
                });
            });
            Promise.all(moves).then(() => {
                if (entered) return;
                entered = true;
                // Then the exchanges, one after another along the linkage group
                [...exchanges]
                    .sort((a, b) => a.cm - b.cm)
                    .forEach((exchange, i) => {
                        exchange.link.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 250 + i * 170, easing: "ease-out", fill: "backwards" });
                    });
                svg.classList.remove("is-building");
                ready = true;
            });
        });
        if (!animated) {
            entered = true;
            ready = true;
        }
        // Leaving view 1 before the entry animation is over ends it at once
        const endEntry = () => {
            if (entered) return;
            entered = true;
            svg.classList.remove("is-pending", "is-building");
            svg.getAnimations?.({ subtree: true }).forEach((animation) => animation.finish());
            ready = true;
        };

        // The choice of view. Where the named buttons do not fit on one row they show numbers
        // only, and the name of the current view is written after them.
        const steps = document.createElement("fieldset");
        steps.className = "seg hx-steps";
        const legend = document.createElement("legend");
        legend.className = "visually-hidden";
        legend.textContent = "What the figure shows";
        steps.append(legend);
        VIEWS.forEach((name, i) => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "hx-view";
            input.value = String(i + 1);
            input.checked = i === 0;
            const text = document.createElement("span");
            const word = document.createElement("i");
            word.textContent = ` ${name}`;
            text.append(String(i + 1), word);
            label.append(input, text);
            steps.append(label);
        });
        const viewName = document.createElement("strong");
        viewName.className = "hx-step-now";
        viewName.setAttribute("aria-hidden", "true");
        viewName.textContent = VIEWS[0];
        steps.append(viewName);
        svg.after(steps);
        svg.dataset.step = "1";
        {
            const labels = [...steps.querySelectorAll("label")];
            let width = 0;
            const fit = () => {
                steps.classList.remove("is-compact");
                steps.classList.toggle("is-compact", labels[labels.length - 1].offsetTop > labels[0].offsetTop);
            };
            if ("ResizeObserver" in window) {
                // Only a change of width can change the answer
                new ResizeObserver(() => {
                    if (steps.clientWidth === width) return;
                    width = steps.clientWidth;
                    fit();
                }).observe(steps);
            }
            fit();
            document.fonts?.ready.then(fit);
        }

        steps.addEventListener("change", (event) => {
            const next = Number(event.target.value);
            if (next === step) return;
            endEntry();
            select(null);
            step = next;
            svg.dataset.step = String(step);
            viewName.textContent = VIEWS[step - 1];
            if (NOTES[step]) for (const note of notes) note.text.textContent = NOTES[step][note.parent];
            setStatus(SAYS[step].idle);
            moveTo(step - 1);
        });
    }
}

/* --------------------------------------------------------------------------
   Figure viewer
   Links with class "zoom" open their figure in a native <dialog>. Without
   JavaScript the same link simply opens the image (or the PDF).
   -------------------------------------------------------------------------- */
{
    const links = document.querySelectorAll("a.zoom");

    if (links.length && typeof HTMLDialogElement === "function") {
        const dialog = document.createElement("dialog");
        dialog.className = "lightbox";
        dialog.setAttribute("aria-label", "Figure viewer");
        dialog.setAttribute("closedby", "any");
        dialog.innerHTML = `
            <div class="lightbox-inner">
                <div class="lightbox-bar">
                    <a class="lightbox-open" href="">Open full size</a>
                    <button class="lightbox-close" type="button" autofocus>Close</button>
                </div>
                <div class="lightbox-stage"><img alt=""></div>
                <p class="lightbox-caption"></p>
            </div>`;
        document.body.append(dialog);

        const image = dialog.querySelector("img");
        const caption = dialog.querySelector(".lightbox-caption");
        const openLink = dialog.querySelector(".lightbox-open");

        const show = (link) => {
            const thumbnail = link.querySelector("img");
            const figcaption = link.closest("figure")?.querySelector("figcaption");
            image.src = link.dataset.zoom || link.href;
            image.alt = thumbnail?.alt ?? "";
            caption.textContent = figcaption ? figcaption.textContent.replace(/\s+/g, " ").trim() : "";
            caption.hidden = !caption.textContent;
            openLink.href = link.href;
            openLink.textContent = /\.pdf$/i.test(link.pathname) ? "Open PDF" : "Open full size";
            dialog.classList.remove("is-zoomed");
            dialog.showModal();
        };

        links.forEach((link) => {
            link.addEventListener("click", (event) => {
                // Leave modified clicks alone so "open in new tab" still works.
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                show(link);
            });
        });

        dialog.addEventListener("click", (event) => {
            if (event.target === image) {
                dialog.classList.toggle("is-zoomed");
            } else if (event.target.closest(".lightbox-close") || !event.target.closest("a, button")) {
                dialog.close();
            }
        });
    }
}

/* --------------------------------------------------------------------------
   Selected scientific work on narrow screens: collapsible Approach text
   The text is always in the page. This adds a button to each Approach row;
   the stylesheet shows the button and hides the text only when the content
   column is narrow, so wide screens always show the full text. Without
   JavaScript the text is simply always visible.
   -------------------------------------------------------------------------- */
document.querySelectorAll(".pac-approach").forEach((row, index) => {
    const term = row.querySelector("dt");
    const detail = row.querySelector("dd");
    if (!term || !detail) return;
    if (!detail.id) detail.id = `approach-${index + 1}`;
    const project = row.closest(".project")?.querySelector("h3")?.textContent.replace(/\s+/g, " ").trim();

    const label = document.createElement("span");
    label.className = "pac-label";
    label.textContent = term.textContent;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pac-toggle";
    button.setAttribute("aria-controls", detail.id);

    const setOpen = (open) => {
        const text = open ? "Hide approach" : "Show approach";
        row.classList.toggle("is-open", open);
        button.textContent = text;
        button.setAttribute("aria-expanded", String(open));
        // The visible words come first, so voice control still matches the button.
        if (project) button.setAttribute("aria-label", `${text}: ${project}`);
    };
    button.addEventListener("click", () => setOpen(!row.classList.contains("is-open")));

    term.textContent = "";
    term.append(label, button);
    row.classList.add("is-collapsible");
    setOpen(false);
});

/* --------------------------------------------------------------------------
   Copy button for the email address
   -------------------------------------------------------------------------- */
document.querySelectorAll(".copy-btn").forEach((button) => {
    if (!navigator.clipboard?.writeText) return;
    button.hidden = false;
    button.setAttribute("aria-live", "polite");
    let timer;
    button.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(button.dataset.copy);
            button.textContent = "Copied";
        } catch {
            button.textContent = "Couldn't copy";
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
            button.textContent = "Copy";
        }, 2000);
    });
});
