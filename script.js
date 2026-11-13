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
   Selecting one of the offspring's homologs shows the parental segments it is
   made of. The first time the figure comes into view, those segments move
   down from the parents into place, one offspring homolog after another.
   -------------------------------------------------------------------------- */
{
    const svg = document.querySelector(".schem-hx");

    if (svg && svg.getScreenCTM) {
        const X0 = 108; // left and right ends of the linkage group
        const X1 = 404;

        // Where each parental homolog is drawn.
        const parentRows = new Map(
            [...svg.querySelectorAll(".hx-parent rect")].map((rect) => [
                rect.dataset.hom,
                { y: Number(rect.getAttribute("y")), height: Number(rect.getAttribute("height")) },
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
            };
        });
        const mostSegments = Math.max(...rows.map((row) => row.segments.length));

        // Reusable highlights over the parents, and marks for the crossovers on the offspring.
        const arrow = svg.querySelector(".schem-arrow");
        const picks = [];
        const marks = [];
        for (let i = 0; i < mostSegments; i++) {
            const pick = createSvg("rect", { class: "hx hx-pick" });
            svg.insertBefore(pick, arrow);
            picks.push(pick);
        }
        for (let i = 0; i < mostSegments - 1; i++) {
            const mark = createSvg("line", { class: "hs-cross" });
            svg.append(mark);
            marks.push(mark);
        }

        const setStatus = addStatus(
            svg,
            "Point at one of the offspring's homologs to see which parental homologs it came from.",
            "Tap one of the offspring's homologs to see which parental homologs it came from.",
        );

        const describe = (row) => {
            const count = new Set(row.segments.map((segment) => segment.dataset.hom)).size;
            if (count === 1) return `From ${row.parent}: one whole homolog, no crossover.`;
            if (count === 2) return `From ${row.parent}: segments of two homologs, joined at one crossover.`;
            return `From ${row.parent}: segments of three homologs, joined at two crossovers.`;
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
            row.segments.forEach((segment, i) => {
                const homolog = segment.dataset.hom;
                const source = parentRows.get(homolog);
                const pick = picks[i];
                pick.setAttribute("class", `hx hx-pick hx-${homolog} is-on`);
                pick.setAttribute("x", segment.getAttribute("x"));
                pick.setAttribute("width", segment.getAttribute("width"));
                pick.setAttribute("y", source.y);
                pick.setAttribute("height", source.height);
            });
            row.crossovers.forEach((x, i) => {
                const mark = marks[i];
                mark.setAttribute("x1", x);
                mark.setAttribute("x2", x);
                mark.setAttribute("y1", row.y - 2.5);
                mark.setAttribute("y2", row.y + row.height + 2.5);
                mark.classList.add("is-on");
            });
            setStatus(describe(row));
        };

        const rowAt = (event) => {
            const point = svgPoint(svg, event);
            if (!point || point.x < X0 - 10 || point.x > X1 + 10) return null;
            let nearest = null;
            let distance = Infinity;
            rows.forEach((row, i) => {
                const d = Math.abs(point.y - (row.y + row.height / 2));
                if (d < distance) {
                    distance = d;
                    nearest = i;
                }
            });
            return distance <= rows[0].height ? nearest : null;
        };

        svg.addEventListener("pointerdown", (event) => select(rowAt(event)));
        svg.addEventListener("pointermove", (event) => {
            if (event.pointerType === "mouse") select(rowAt(event));
        });
        svg.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "mouse") select(null);
        });

        const animated = playWhenVisible(svg, () => {
            const ROW_GAP = 280; // the offspring's homologs are assembled one after another
            const SEGMENT_GAP = 90;
            const MOVE = 750;
            const moves = [];
            rows.forEach((row, r) => {
                row.segments.forEach((segment, s) => {
                    const source = parentRows.get(segment.dataset.hom);
                    // Start exactly on top of the parental homolog, then move into the offspring row.
                    const move = segment.animate(
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
                    moves.push(move.finished.catch(() => {}));
                });
            });
            Promise.all(moves).then(() => {
                ready = true;
            });
        });
        if (!animated) ready = true;
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
