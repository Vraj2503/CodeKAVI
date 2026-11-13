"use client";

/**
 * The public landing page.
 *
 * A port of the approved design: one screen per section, a live dependency
 * graph behind the hero, and every claim on the page tied to a file path and
 * a line range. The page is deliberately self-contained — its own dark
 * palette, its own type scale — and everything is namespaced behind `.lp` so
 * none of it reaches the app shell.
 *
 * Motion is opt-out: the graph animates, the answers type themselves in and
 * the pipeline walks its eight stages, but all three fall back to their final
 * state under `prefers-reduced-motion`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./landing.css";
import { useAuth } from "@/lib/auth-context";
import { validateRepoUrl } from "@/lib/validation";

/* ── the hero graph ─────────────────────────────────────────
   The files are Starlette's real module layout, and the dashed
   nodes are the two imports that do not resolve inside the
   project — the picture shows a real dependency graph, not a
   decorative mesh. */

type GraphNode = {
  id: number;
  name: string;
  u: number;
  v: number;
  role: string;
  ghost: boolean;
  key: boolean;
  ph: number;
  x: number;
  y: number;
};

const GRAPH_SOURCE: [string, number, number, string, number?, number?][] = [
  ["applications.py", 0.6, 0.12, "entry_point", 0, 1],
  ["routing.py", 0.8, 0.3, "core_module", 0, 1],
  ["middleware/errors.py", 0.93, 0.1, "shared_utility"],
  ["requests.py", 0.6, 0.52, "core_module", 0, 1],
  ["responses.py", 0.82, 0.62, "core_module", 0, 1],
  ["datastructures.py", 0.34, 0.9, "shared_utility"],
  ["_utils.py", 0.96, 0.8, "shared_utility"],
  ["background.py", 0.08, 0.12, "shared_utility"],
  ["concurrency.py", 0.3, 0.14, "shared_utility"],
  ["endpoints.py", 0.67, 0.3, "core_module"],
  ["websockets.py", 0.5, 0.74, "core_module"],
  ["middleware/base.py", 0.76, 0.08, "shared_utility"],
  ["staticfiles.py", 0.05, 0.84, "core_module"],
  ["templating.py", 0.12, 0.92, "shared_utility"],
  ["exceptions.py", 0.52, 0.3, "core_module"],
  ["config.py", 0.06, 0.7, "config"],
  ["types.py", 0.9, 0.92, "shared_utility"],
  ["status.py", 0.7, 0.94, "shared_utility"],
  ["starlette._exceptions", 0.92, 0.46, "unresolved", 1, 1],
  ["itsdangerous", 0.7, 0.76, "unresolved", 1, 1],
];

const GRAPH_EDGES: [number, number, number?][] = [
  [0, 1],
  [0, 2],
  [0, 11],
  [1, 3],
  [1, 4],
  [1, 6],
  [1, 9],
  [1, 14],
  [2, 4],
  [3, 5],
  [4, 5],
  [7, 8],
  [8, 14],
  [3, 10],
  [10, 17],
  [12, 13],
  [12, 15],
  [12, 5],
  [4, 16],
  [9, 3],
  [1, 18, 1],
  [4, 19, 1],
];

/* ── the repository chat ────────────────────────────────────
   Real questions against Starlette, answered with the citations
   the product actually produces. */

type Source = [path: string, lines: string, role: string];
type Part = string | [cite: string];
type Token = { cite: string } | { text: string };

const ANSWERS: { q: string; a: Part[]; s: Source[] }[] = [
  {
    q: "What happens when someone visits a page?",
    a: [
      "Everything starts in the main application file. ",
      ["starlette/applications.py:L70-L118"],
      " sets the app up once and hands each visit to the router, which finds the right page to run. ",
      ["starlette/routing.py:L594-L641"],
    ],
    s: [
      ["starlette/applications.py", "70–118", "entry_point"],
      ["starlette/routing.py", "594–641", "core_module"],
      ["starlette/middleware/errors.py", "146–171", "shared_utility"],
    ],
  },
  {
    q: "What would break if routing.py were removed?",
    a: [
      "Almost everything that serves a page. ",
      ["starlette/applications.py:L112-L130"],
      " sends every visit to the router, and ",
      ["starlette/requests.py:L48-L73"],
      " relies on what the router works out. The tests and startup code would still load.",
    ],
    s: [
      ["starlette/applications.py", "112–130", "entry_point"],
      ["starlette/requests.py", "48–73", "core_module"],
      ["tests/test_routing.py", "1–40", "test"],
    ],
  },
  {
    q: "Where are errors caught and turned into a response?",
    a: [
      "At the outermost layer, before anything reaches the visitor. ",
      ["starlette/middleware/errors.py:L146-L171"],
      " catches the problem and turns it into a proper error response.",
    ],
    s: [
      ["starlette/middleware/errors.py", "146–171", "shared_utility"],
    ],
  },
];

/* ── the eight stages ─────────────────────────────────────── */

const STEPS: [name: string, detail: string][] = [
  ["cloning", "a quick, temporary copy of the repository"],
  ["traversing", "skips clutter like dependencies and build files"],
  ["analyzing", "reads every file and what is inside it"],
  ["classifying", "labels what each file is for, across 14+ roles"],
  ["graphing", "works out how files connect and flags loops"],
  ["selecting", "picks the most important files to focus on"],
  ["indexing", "makes the code searchable for your questions"],
  ["complete", "your workspace is ready to explore"],
];

/* ── the written report ───────────────────────────────────── */

const REPORT: { title: string; body: string; cites: string[]; srcs: Source[] }[] =
  [
    {
      title: "Overview",
      body: "What the project is for, what it is built with, and how it runs. Starlette is a small toolkit for building web services, with its tests and docs alongside.",
      cites: [
        "starlette/applications.py:L70-L118",
        "starlette/routing.py:L594-L641",
      ],
      srcs: [
        ["starlette/__init__.py", "1–12", "entry_point"],
        ["docs/index.md", "1–60", "documentation"],
      ],
    },
    {
      title: "Architecture",
      body: "How the code is divided up and where everything starts. Every visit enters through one door, which sets things up once and passes the visit along.",
      cites: [
        "starlette/applications.py:L70-L118",
        "starlette/routing.py:L594-L641",
      ],
      srcs: [
        ["starlette/applications.py", "70–118", "entry_point"],
        ["starlette/routing.py", "594–641", "core_module"],
      ],
    },
    {
      title: "Components",
      body: "The key parts, what each one is responsible for, and the small helpers. Two files carry most of the weight: one sets things up and one decides where each visit goes.",
      cites: [
        "starlette/applications.py:L112-L130",
        "starlette/routing.py:L640-L688",
      ],
      srcs: [
        ["starlette/applications.py", "112–130", "entry_point"],
        ["starlette/routing.py", "640–688", "core_module"],
      ],
    },
    {
      title: "Data Flow",
      body: "How a request travels from start to finish. A visit becomes one object that is passed along, and the reply travels back the same way.",
      cites: [
        "starlette/requests.py:L231-L268",
        "starlette/responses.py:L26-L54",
        "starlette/middleware/errors.py:L146-L171",
      ],
      srcs: [
        ["requests.py", "231–268", "core_module"],
        ["responses.py", "26–54", "core_module"],
        ["middleware/errors.py", "146–171", "shared_utility"],
      ],
    },
    {
      title: "Patterns",
      body: "The habits and conventions the code follows. Features are layered like wrappers around the app, and shared settings are passed around openly rather than hidden.",
      cites: ["starlette/middleware/base.py:L30-L96"],
      srcs: [
        ["starlette/middleware/base.py", "30–96", "shared_utility"],
        ["starlette/datastructures.py", "12–60", "shared_utility"],
      ],
    },
    {
      title: "Mind Map",
      body: "A picture of the whole codebase and how its ideas fit together. This slice has 18 files and 20 connections.",
      cites: [
        "starlette/_utils.py:L1-L40",
        "starlette/datastructures.py:L12-L60",
      ],
      srcs: [
        ["starlette/_utils.py", "1–40", "shared_utility"],
        ["starlette/datastructures.py", "12–60", "shared_utility"],
      ],
    },
  ];

const ROLE_BARS: [role: string, count: number][] = [
  ["core_module", 62],
  ["shared_utility", 41],
  ["test", 38],
  ["config", 17],
  ["documentation", 12],
  ["orchestrator", 9],
  ["entry_point", 6],
];

function Roles({ sources }: { sources: Source[] }) {
  const present = new Set(sources.map((source) => source[2]));
  return (
    <aside className="roles" aria-label="Roles in this repository">
      <h4>What the files are for</h4>
      {ROLE_BARS.map(([role, count]) => (
        <div
          key={role}
          className={present.has(role) ? "role on" : "role"}
        >
          <span>{role.replace("_", " ")}</span>
          <em>{count}</em>
          <i>
            <b style={{ width: `${(count / 62) * 100}%` }} />
          </i>
        </div>
      ))}
    </aside>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const heroTextRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  /* ── routing off this page ──
     The page is public, so both of its actions have two versions: signed in,
     they go where they say; signed out, they hand the destination to the login
     page and come back to it. `sessionStorage` carries the intent and the
     `next` param carries it through the OAuth round trip, which is the only
     way a destination survives a full-page redirect to Google.

     Analysis has no address to navigate to until it has run — a repo id is
     minted by the backend — so "analyze this repository" is expressed as a
     dashboard URL that starts the analysis on arrival. */
  const router = useRouter();
  const { user } = useAuth();
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);

  const rememberDestination = (destination: string) => {
    try {
      sessionStorage.setItem("postLoginDestination", destination);
    } catch {
      // Private mode or a full quota: the URL param still carries it.
    }
  };

  const openDashboard = () => {
    if (!user) rememberDestination("/dashboard");
  };

  const submitRepo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = validateRepoUrl(repoInput);
    if (!result.valid) {
      setRepoError(result.error);
      return;
    }

    setRepoError(null);
    const destination = `/dashboard?analyze=${encodeURIComponent(result.normalized)}`;

    if (!user) {
      rememberDestination(destination);
      router.push(`/login?next=${encodeURIComponent(destination)}`);
      return;
    }

    router.push(destination);
  };

  /* ── the hero graph ── */
  useEffect(() => {
    const cv = canvasRef.current;
    const hero = heroRef.current;
    const text = heroTextRef.current;
    if (!cv || !hero || !text) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const root = cv.closest<HTMLElement>(".lp") ?? document.documentElement;
    const css = getComputedStyle(root);
    const accent = css.getPropertyValue("--acc").trim();
    const amber = css.getPropertyValue("--amb").trim();
    const ink = css.getPropertyValue("--ink").trim();
    const paper = css.getPropertyValue("--paper").trim();
    const mono = css.getPropertyValue("--mono").trim();

    const nodes: GraphNode[] = GRAPH_SOURCE.map((n, i) => ({
      id: i,
      name: n[0],
      u: n[1],
      v: n[2],
      role: n[3],
      ghost: n[4] === 1,
      key: n[5] === 1,
      ph: i * 1.7,
      x: 0,
      y: 0,
    }));
    const edges = GRAPH_EDGES.map((e, i) => ({
      a: nodes[e[0]],
      b: nodes[e[1]],
      open: Boolean(e[2]),
      t: i * 0.13,
    }));

    const calm = reducedMotion();
    const startedAt = performance.now();

    let width = 0;
    let height = 0;
    let scale = 1;
    let narrow = false;
    let box = { x: 0, y: 0, w: 0, h: 0 };
    let pointerX = -999;
    let pointerY = -999;
    let hot: GraphNode | null = null;
    let running = false;
    let frame = 0;

    function size() {
      const dpr = window.devicePixelRatio || 1;
      const rect = cv!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      cv!.width = width * dpr;
      cv!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      narrow = width < 820;
      scale = Math.max(0.9, Math.min(1.35, width / 1100));
      box = { x: width * 0.05, y: height * 0.1, w: width * 0.9, h: height * 0.82 };
    }

    function place(t: number) {
      for (const node of nodes) {
        let x = box.x + node.u * box.w + Math.sin(t * 0.0005 + node.ph) * 16;
        let y =
          box.y +
          (narrow ? 0.48 + node.v * 0.52 : node.v) * box.h +
          Math.cos(t * 0.0004 + node.ph * 1.3) * 16;
        const dx = pointerX - x;
        const dy = pointerY - y;
        const d = Math.hypot(dx, dy);
        if (d < 170 * scale) {
          const push = (1 - d / (170 * scale)) * 16;
          x += (dx / d) * push;
          y += (dy / d) * push;
        }
        node.x = x;
        node.y = y;
      }
    }

    function draw(now: number) {
      const t = now - startedAt;
      place(t);
      ctx!.clearRect(0, 0, width, height);

      const canvasRect = cv!.getBoundingClientRect();
      const textRect = text!.getBoundingClientRect();
      const keep = {
        l: textRect.left - canvasRect.left - 30,
        r: textRect.right - canvasRect.left + 30,
        t: textRect.top - canvasRect.top - 30,
        b: textRect.bottom - canvasRect.top + 30,
      };
      const covered = (x: number, y: number) =>
        x > keep.l && x < keep.r && y > keep.t && y < keep.b;

      hot = null;
      let best = 38 * scale;
      for (const node of nodes) {
        const d = Math.hypot(node.x - pointerX, node.y - pointerY);
        if (d < best) {
          best = d;
          hot = node;
        }
      }

      for (const edge of edges) {
        const lit =
          hot !== null && (edge.a === hot || edge.b === hot);
        const dim =
          covered(edge.a.x, edge.a.y) ||
          covered(edge.b.x, edge.b.y) ||
          covered((edge.a.x + edge.b.x) / 2, (edge.a.y + edge.b.y) / 2);

        ctx!.save();
        ctx!.lineWidth = (lit ? 2.2 : 1.2) * Math.min(scale, 1.2);
        ctx!.strokeStyle = edge.open ? amber : accent;
        ctx!.globalAlpha = hot && !lit ? 0.2 : lit ? 1 : dim ? 0.14 : 0.55;
        if (edge.open) ctx!.setLineDash([5, 5]);
        const cx = (edge.a.x + edge.b.x) / 2;
        const cy = (edge.a.y + edge.b.y) / 2 - 18;
        ctx!.beginPath();
        ctx!.moveTo(edge.a.x, edge.a.y);
        ctx!.quadraticCurveTo(cx, cy, edge.b.x, edge.b.y);
        ctx!.stroke();
        ctx!.restore();

        if (!edge.open) {
          const p = (t * 0.00022 + edge.t) % 1;
          const q = 1 - p;
          const px = q * q * edge.a.x + 2 * q * p * cx + p * p * edge.b.x;
          const py = q * q * edge.a.y + 2 * q * p * cy + p * p * edge.b.y;
          ctx!.fillStyle = accent;
          ctx!.globalAlpha = lit ? 1 : dim ? 0.2 : 0.7;
          ctx!.beginPath();
          ctx!.arc(px, py, (lit ? 3.4 : 2.4) * scale, 0, 7);
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      }

      const fontSize = Math.max(9, Math.round(9.5 * scale));
      ctx!.font = `500 ${fontSize}px ${mono}`;
      for (const node of nodes) {
        const isHot = node === hot;
        const r = (node.ghost ? 7 : isHot ? 11 : 8) * scale;
        const left = node.u > 0.68;
        const gap = r + 8;
        const labelWidth = ctx!.measureText(node.name).width;
        const labelLeft = left ? node.x - gap - labelWidth : node.x + gap;
        const labelRight = left ? node.x - gap : node.x + gap + labelWidth;
        const faded =
          (covered(node.x, node.y) ||
            (node.y + 4 > keep.t &&
              node.y - fontSize < keep.b &&
              labelRight > keep.l &&
              labelLeft < keep.r)) &&
          !isHot;
        const related = edges.some(
          (edge) =>
            (edge.a === hot && edge.b === node) ||
            (edge.b === hot && edge.a === node),
        );

        ctx!.globalAlpha = faded ? 0.22 : hot && !isHot && !related ? 0.35 : 1;
        ctx!.beginPath();
        ctx!.arc(node.x, node.y, r, 0, 7);
        ctx!.fillStyle = node.ghost
          ? paper
          : node.role === "entry_point"
            ? ink
            : accent;
        ctx!.fill();
        if (node.ghost) {
          ctx!.strokeStyle = amber;
          ctx!.lineWidth = 2;
          ctx!.setLineDash([3, 3]);
          ctx!.stroke();
          ctx!.setLineDash([]);
        }
        ctx!.fillStyle = ink;
        ctx!.textAlign = left ? "right" : "left";
        if (!faded && (!narrow || node.key || isHot)) {
          ctx!.fillText(node.name, node.x + (left ? -gap : gap), node.y + 4);
        }
        if (isHot) {
          ctx!.fillStyle = node.ghost ? amber : accent;
          ctx!.fillText(
            node.role.replace("_", " "),
            node.x + (left ? -gap : gap),
            node.y + 4 + fontSize + 4,
          );
        }
        ctx!.globalAlpha = 1;
      }
    }

    function loop(now: number) {
      draw(now);
      if (running) frame = requestAnimationFrame(loop);
    }

    function start() {
      if (running || calm) return;
      running = true;
      frame = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(frame);
    }

    const onResize = () => {
      size();
      if (calm) draw(startedAt);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = cv!.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      if (calm) draw(startedAt);
    };

    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerX = -999;
      pointerY = -999;
      if (calm) draw(startedAt);
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start();
      else stop();
    });
    observer.observe(hero);

    size();
    if (calm) draw(startedAt);
    else start();

    window.addEventListener("resize", onResize);
    hero.addEventListener("pointermove", onPointer);
    hero.addEventListener("pointerdown", onPointer);
    hero.addEventListener("pointerleave", onLeave);

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      hero.removeEventListener("pointermove", onPointer);
      hero.removeEventListener("pointerdown", onPointer);
      hero.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  /* ── the pill nav hides on the way down, returns on the way up ── */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let lastY = window.scrollY;
    let queued = false;

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 80 || delta < -6) nav.classList.remove("is-hidden");
        else if (delta > 6) nav.classList.add("is-hidden");
        if (Math.abs(delta) > 6 || y < 80) lastY = y;
        queued = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ── chat ── */
  const [active, setActive] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  const answer = active === null ? null : ANSWERS[active];

  const tokens = useMemo<Token[]>(() => {
    if (!answer) return [];
    const out: Token[] = [];
    for (const part of answer.a) {
      if (Array.isArray(part)) {
        out.push({ cite: part[0] });
        continue;
      }
      for (const chunk of part.split(/(?<= )/)) out.push({ text: chunk });
    }
    return out;
  }, [answer]);

  const typing = answer !== null && shown < tokens.length;

  useEffect(() => {
    if (!answer) return;
    const calm = reducedMotion();
    setShown(0);
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      count += 1;
      setShown(count);
      if (count < tokens.length) {
        timer = setTimeout(tick, calm ? 0 : 45);
      }
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [answer, tokens]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry], self) => {
        if (!entry.isIntersecting) return;
        setActive((current) => (current === null ? 0 : current));
        self.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ask = (index: number) => {
    setShown(0);
    setActive(index);
  };

  const spoken = answer
    ? `${answer.q} ${answer.a
        .map((part) => (Array.isArray(part) ? part[0] : part))
        .join("")}`
    : "";

  /* ── pipeline ── */
  const [step, setStep] = useState(-1);
  const stagesRef = useRef<HTMLElement>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const section = stagesRef.current;
    if (!section) return;
    const calm = reducedMotion();
    let current = -1;

    const tick = () => {
      current += 1;
      setStep(current);
      if (current < STEPS.length) {
        stepTimer.current = setTimeout(tick, calm ? 0 : 850);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(stepTimer.current);
        current = -1;
        setStep(-1);
        if (!entry.isIntersecting) return;
        if (calm) {
          current = STEPS.length;
          setStep(STEPS.length);
          return;
        }
        stepTimer.current = setTimeout(tick, 0);
      },
      { threshold: 0.55 },
    );
    observer.observe(section);

    return () => {
      clearTimeout(stepTimer.current);
      observer.disconnect();
    };
  }, []);

  const jumpToStep = (index: number) => {
    clearTimeout(stepTimer.current);
    setStep(index);
  };

  const finished = step >= STEPS.length;

  /* ── report ── */
  const [tab, setTab] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const section = REPORT[tab];

  const selectTab = (index: number, focus = false) => {
    setTab(index);
    if (focus) tabRefs.current[index]?.focus();
  };

  return (
    <div className="lp">
      <header className="pill-nav" aria-label="Main Navigation" ref={navRef}>
        <a className="pill-nav__logo" href="#top">
          <svg width="20" height="20" viewBox="0 0 26 26" aria-hidden="true">
            <path
              d="M5 20 13 6l8 14M5 20h16"
              fill="none"
              stroke="#CF9D7B"
              strokeWidth="2"
            />
            <circle cx="13" cy="6" r="3.4" fill="#CF9D7B" />
            <circle cx="5" cy="20" r="3" fill="#F1E6DA" />
            <circle
              cx="21"
              cy="20"
              r="3"
              fill="none"
              stroke="#E0674B"
              strokeWidth="2"
            />
          </svg>
          <span>CodeKAVI</span>
        </a>
        <nav aria-label="Main">
          <a href="#answers">Answers</a>
          <a href="#stages">Pipeline</a>
          <a href="#report">Report</a>
        </nav>
        <Link
          className="pill-nav__btn"
          href={user ? "/dashboard" : "/login?next=%2Fdashboard"}
          onClick={openDashboard}
        >
          {user ? "Dashboard" : "Launch app"}
        </Link>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="h1" ref={heroRef}>
          <canvas
            id="graph"
            ref={canvasRef}
            role="img"
            aria-label="Interactive graph showing how the files in a codebase connect to each other. Solid lines are connections, dashed lines point to code that is missing."
          />
          <div className="wrap">
            <div className="hero__text" ref={heroTextRef}>
              <h1 id="h1">Read any repository like you wrote it.</h1>
              <p className="lead">
                Paste in any public repository and see how it works in
                seconds. CodeKAVI maps the code, explains what each file is
                for, and answers your questions with the exact files and lines
                behind every answer.
              </p>
              <form className="repo" onSubmit={submitRepo} noValidate>
                <label htmlFor="lp-repo" className="sr">
                  Repository URL
                </label>
                <div className={repoError ? "repo__field is-bad" : "repo__field"}>
                  <input
                    id="lp-repo"
                    type="text"
                    value={repoInput}
                    onChange={(event) => {
                      setRepoInput(event.target.value);
                      if (repoError) setRepoError(null);
                    }}
                    placeholder="owner/repository"
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-invalid={repoError ? true : undefined}
                    aria-describedby={repoError ? "lp-repo-error" : undefined}
                  />
                  <button className="btn btn--p" type="submit">
                    Analyze
                  </button>
                </div>
                {repoError && (
                  <p className="repo__err" id="lp-repo-error" role="alert">
                    {repoError}
                  </p>
                )}
              </form>

              <div className="row">
                <a className="btn btn--s" href="#report">
                  See a report
                </a>
                <a className="btn btn--s" href="#answers">
                  Repository chat
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="answers" aria-labelledby="a-h">
          <div className="wrap">
            <div className="split">
              <div>
                <div className="head" style={{ margin: 0 }}>
                  <h2 id="a-h">Answers that show their proof.</h2>
                  <p>
                    Ask about the code in plain words. CodeKAVI finds the
                    relevant parts and answers with the exact files and lines
                    behind it. If it can&apos;t find anything to back an answer
                    up, it says so instead of guessing.
                  </p>
                </div>
                <div className="qs" role="group" aria-label="Try a question">
                  {ANSWERS.map((item, index) => (
                    <button
                      key={item.q}
                      type="button"
                      className="q"
                      aria-pressed={active === index}
                      onClick={() => ask(index)}
                    >
                      {item.q}
                    </button>
                  ))}
                </div>
              </div>
              <div className="win">
                <div className="win__bar">
                  <b>encode/starlette</b>
                  <span>main</span>
                  <span>a1e4d7c</span>
                  <em>indexed</em>
                </div>
                <div className="chat" ref={chatRef}>
                  <div className="me">{answer?.q ?? ""}</div>
                  <div className={typing ? "ai live" : "ai"}>
                    {tokens.slice(0, shown).map((token, index) => (
                      <Fragment key={index}>
                        {"cite" in token ? (
                          <span className="cite">{token.cite}</span>
                        ) : (
                          token.text
                        )}
                      </Fragment>
                    ))}
                  </div>
                  <ul className="srcs">
                    {!typing &&
                      answer?.s.map(([path, lines, role]) => (
                        <li key={path}>
                          <span>{path}</span>
                          <em>
                            {lines} · {role.replace("_", " ")}
                          </em>
                        </li>
                      ))}
                  </ul>
                  <p className="sr" role="status">
                    {!typing ? spoken : ""}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className="pipe"
          id="stages"
          aria-labelledby="p-h"
          ref={stagesRef}
        >
          <div className="pipe__in wrap">
            <div className="head" style={{ margin: 0 }}>
              <h2 id="p-h">From repository to answers in eight steps.</h2>
              <p>
                Watch each step finish live. CodeKAVI reads the most popular
                languages in depth and understands how files connect in many
                others. Come back later and it only re-reads what has changed.
              </p>
              <div className="bar" aria-hidden="true">
                <i
                  style={{
                    width: `${Math.min(
                      100,
                      ((step + 1) / STEPS.length) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <ol className="st">
                {STEPS.map(([name, detail], index) => {
                  const on = step === index && !finished;
                  const done = step > index || finished;
                  return (
                    <li
                      key={name}
                      className={on ? "on" : done ? "done" : undefined}
                    >
                      <button
                        type="button"
                        className="stb"
                        aria-current={on ? "step" : undefined}
                        onClick={() => jumpToStep(index)}
                      >
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        <em>{name}</em>
                        <span>{detail}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className={finished ? "again on" : "again"}>
                second run: unchanged files are skipped, so only what changed
                is read again.
              </p>
            </div>
          </div>
        </section>

        <section id="report" aria-labelledby="r-h">
          <div className="wrap">
            <div className="head">
              <h2 id="r-h">A written tour for whoever inherits the code.</h2>
            </div>
            <div className="tabs" role="tablist" aria-label="Report sections">
              {REPORT.map((item, index) => (
                <button
                  key={item.title}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`report-tab-${index}`}
                  className="tab"
                  aria-controls="report-panel"
                  aria-selected={tab === index}
                  tabIndex={tab === index ? 0 : -1}
                  onClick={() => selectTab(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      selectTab((index + 1) % REPORT.length, true);
                    }
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      selectTab(
                        (index + REPORT.length - 1) % REPORT.length,
                        true,
                      );
                    }
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
            <div className="win">
              <div className="win__bar">
                <b>encode/starlette</b>
                <span>report</span>
                <em>section {tab + 1} of 6</em>
              </div>
              <div
                className="rep"
                role="tabpanel"
                id="report-panel"
                aria-labelledby={`report-tab-${tab}`}
              >
                <div className="pane">
                  <div className="mn">
                    <h3>{section.title}</h3>
                    <p>{section.body}</p>
                    <p>
                      {section.cites.map((cite, index) => (
                        <Fragment key={cite}>
                          {index > 0 ? " " : null}
                          <span className="cite">{cite}</span>
                        </Fragment>
                      ))}
                    </p>
                    <ul className="srcs">
                      {section.srcs.map(([path, lines, role]) => (
                        <li key={path}>
                          <span>{path}</span>
                          <em>
                            {lines} · {role.replace("_", " ")}
                          </em>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Roles sources={section.srcs} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="close" aria-labelledby="c-h">
        <div className="wrap">
          <div className="head" style={{ margin: 0 }}>
            <h2 id="c-h">Point it at the repository you inherited.</h2>
            <p>
              Start exploring in under 30 seconds. It works with public GitHub,
              GitLab and Bitbucket repositories, there is nothing to install,
              and you can wipe an analyzed repository with one click.
            </p>
            <p>
              <a className="btn btn--p" href="#report">
                See a report
              </a>
            </p>
          </div>
          <p className="big" aria-hidden="true">
            CodeKAVI
          </p>
          <div className="foot">
            <span>
              &copy; 2026 CodeKAVI · Powered by Rune Architecture Engine
            </span>
            <nav aria-label="Footer">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href="https://github.com/your-org/codekavi">GitHub</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
