"use client";

/**
 * The account's repositories, drawn as a small drifting map.
 *
 * Each point is a repository already analyzed; repositories that share a main
 * language are joined, and bigger points have had more conversation. It is the
 * landing page's graph put to work: the same object, now showing the reader's
 * own history. Hover names a point, a click opens it.
 *
 * Purely a shortcut. Everything it offers is also in the list below, so the
 * canvas is hidden from assistive tech and carries no information alone.
 */

import { useEffect, useRef } from "react";
import type { Session } from "@/lib/sessions";
import { hashString, seeded } from "./seed";

interface RepoConstellationProps {
  sessions: Session[];
  loading: boolean;
  onOpen: (session: Session) => void;
}

interface Star {
  session: Session | null;
  label: string;
  lang: string;
  u: number;
  v: number;
  r: number;
  phase: number;
  x: number;
  y: number;
}

const MAX_STARS = 14;
const GHOSTS = 8;

const clamp = (n: number, lo = 0.1, hi = 0.9) => Math.min(hi, Math.max(lo, n));

function topLanguage(languages: Record<string, number> | null): string {
  if (!languages) return "";
  const best = Object.entries(languages).sort(([, a], [, b]) => b - a)[0];
  return best ? best[0] : "";
}

function build(sessions: Session[], ghost: boolean) {
  const source: (Session | null)[] = ghost
    ? Array.from({ length: GHOSTS }, () => null)
    : sessions.slice(0, MAX_STARS);

  const stars: Star[] = source.map((session, i) => {
    const rand = seeded(hashString(session ? session.id : `ghost-${i}`));
    const messages = session?.message_count ?? 0;
    return {
      session,
      label: session ? `${session.owner}/${session.repo_name}` : "",
      lang: session ? topLanguage(session.languages) : "",
      u: 0.12 + rand() * 0.62,
      v: 0.16 + rand() * 0.68,
      r: session ? 6 + Math.min(5, Math.sqrt(messages)) : 5,
      phase: rand() * 6.28,
      x: 0,
      y: 0,
    };
  });

  // Push overlapping points apart so no two sit on top of each other.
  for (let pass = 0; pass < 90; pass++) {
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i];
        const b = stars[j];
        let dx = b.u - a.u;
        let dy = b.v - a.v;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < 0.2) {
          const push = (0.2 - d) / 2;
          dx /= d;
          dy /= d;
          a.u = clamp(a.u - dx * push, 0.1, 0.76);
          a.v = clamp(a.v - dy * push, 0.14, 0.86);
          b.u = clamp(b.u + dx * push, 0.1, 0.76);
          b.v = clamp(b.v + dy * push, 0.14, 0.86);
        }
      }
    }
  }

  const links: [number, number][] = [];
  const degree = stars.map(() => 0);
  const join = (i: number, j: number) => {
    links.push([i, j]);
    degree[i]++;
    degree[j]++;
  };

  if (ghost) {
    for (let i = 1; i < stars.length; i++) join(i - 1, i);
    join(0, 4);
    join(2, 6);
  } else {
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        if (
          stars[i].lang &&
          stars[i].lang === stars[j].lang &&
          degree[i] < 3 &&
          degree[j] < 3
        ) {
          join(i, j);
        }
      }
    }
    // Nobody floats alone: a repository with no language match hangs off its
    // nearest neighbour.
    stars.forEach((s, i) => {
      if (degree[i] > 0 || stars.length < 2) return;
      let best = i === 0 ? 1 : 0;
      let bestD = Infinity;
      stars.forEach((o, j) => {
        if (j === i) return;
        const d = Math.hypot(o.u - s.u, o.v - s.v);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      join(i, best);
    });
  }

  return { stars, links };
}

export function RepoConstellation({
  sessions,
  loading,
  onOpen,
}: RepoConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });

  const ghost = loading || sessions.length === 0;

  useEffect(() => {
    const cv = canvasRef.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;

    const css = getComputedStyle(cv);
    const read = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const C = {
      acc: read("--acc", "#cf9d7b"),
      ink: read("--ink", "#f1e6da"),
      mut: read("--mut", "#a8a39d"),
      paper: read("--paper", "#162127"),
    };
    const mono = read("--mono", "ui-monospace, monospace");

    const { stars, links } = build(sessions, ghost);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let W = 0;
    let H = 0;
    let mx = -999;
    let my = -999;
    let hot: Star | null = null;
    let raf = 0;
    let visible = true;

    const size = () => {
      const d = window.devicePixelRatio || 1;
      const b = cv.getBoundingClientRect();
      W = b.width;
      H = b.height;
      cv.width = W * d;
      cv.height = H * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    };

    const frame = (now: number) => {
      const t = now - t0;
      cx.clearRect(0, 0, W, H);

      for (const s of stars) {
        let x = s.u * W + Math.sin(t * 0.0005 + s.phase) * 12;
        let y = s.v * H + Math.cos(t * 0.0004 + s.phase * 1.3) * 12;
        const dx = mx - x;
        const dy = my - y;
        const d = Math.hypot(dx, dy);
        if (d < 150) {
          const k = (1 - d / 150) * 14;
          x += (dx / d) * k;
          y += (dy / d) * k;
        }
        s.x = x;
        s.y = y;
      }

      hot = null;
      let best = 26;
      for (const s of stars) {
        if (!s.session) continue;
        const d = Math.hypot(s.x - mx, s.y - my);
        if (d < best) {
          best = d;
          hot = s;
        }
      }
      cv.style.cursor = hot ? "pointer" : "default";

      links.forEach(([i, j], n) => {
        const a = stars[i];
        const b = stars[j];
        const lit = hot !== null && (a === hot || b === hot);
        const cxp = (a.x + b.x) / 2;
        const cyp = (a.y + b.y) / 2 - 16;
        cx.save();
        cx.strokeStyle = C.acc;
        cx.lineWidth = lit ? 2 : 1.1;
        cx.globalAlpha = ghost ? 0.18 : hot && !lit ? 0.16 : lit ? 1 : 0.5;
        if (ghost) cx.setLineDash([4, 5]);
        cx.beginPath();
        cx.moveTo(a.x, a.y);
        cx.quadraticCurveTo(cxp, cyp, b.x, b.y);
        cx.stroke();
        cx.restore();

        if (!ghost) {
          const p = (t * 0.0002 + n * 0.17) % 1;
          const q = 1 - p;
          cx.fillStyle = C.acc;
          cx.globalAlpha = lit ? 1 : 0.6;
          cx.beginPath();
          cx.arc(
            q * q * a.x + 2 * q * p * cxp + p * p * b.x,
            q * q * a.y + 2 * q * p * cyp + p * p * b.y,
            lit ? 3 : 2,
            0,
            7,
          );
          cx.fill();
          cx.globalAlpha = 1;
        }
      });

      cx.font = `500 12px ${mono}`;
      stars.forEach((s, i) => {
        const isHot = s === hot;
        const r = isHot ? s.r + 3 : s.r;
        cx.globalAlpha = hot && !isHot ? 0.45 : 1;
        cx.beginPath();
        cx.arc(s.x, s.y, r, 0, 7);
        if (ghost) {
          cx.strokeStyle = C.mut;
          cx.globalAlpha = 0.5;
          cx.setLineDash([3, 3]);
          cx.stroke();
          cx.setLineDash([]);
        } else {
          cx.fillStyle = i === 0 ? C.ink : C.acc;
          cx.fill();
          if (i < 3 && !hot) {
            cx.fillStyle = C.mut;
            cx.textAlign = "left";
            cx.fillText(s.session?.repo_name ?? "", s.x + r + 8, s.y + 4);
          }
        }
        cx.globalAlpha = 1;
      });

      const h = hot as Star | null;
      if (h) {
        const sub = h.lang;
        const w = Math.max(cx.measureText(h.label).width, sub ? cx.measureText(sub).width : 0) + 22;
        const bh = sub ? 42 : 28;
        let lx = h.x + 16;
        let ly = h.y - bh - 8;
        if (lx + w > W - 4) lx = h.x - 16 - w;
        if (ly < 4) ly = h.y + 16;
        cx.fillStyle = C.paper;
        cx.globalAlpha = 0.96;
        cx.beginPath();
        if (cx.roundRect) cx.roundRect(lx, ly, w, bh, 9);
        else cx.rect(lx, ly, w, bh);
        cx.fill();
        cx.globalAlpha = 1;
        cx.strokeStyle = "rgba(241,230,218,.2)";
        cx.lineWidth = 1;
        cx.stroke();
        cx.textAlign = "left";
        cx.fillStyle = C.ink;
        cx.fillText(h.label, lx + 11, ly + 18);
        if (sub) {
          cx.fillStyle = C.mut;
          cx.fillText(sub, lx + 11, ly + 34);
        }
      }

      if (!calm && visible) raf = requestAnimationFrame(frame);
    };

    const point = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect();
      mx = e.clientX - b.left;
      my = e.clientY - b.top;
      if (calm) frame(performance.now());
    };
    const leave = () => {
      mx = my = -999;
      if (calm) frame(performance.now());
    };
    const click = () => {
      const target = hot as Star | null;
      if (target?.session) openRef.current(target.session);
    };

    size();
    const resize = new ResizeObserver(() => {
      size();
      if (calm) frame(performance.now());
    });
    resize.observe(cv);

    const seen = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (visible && !was && !calm) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    });
    seen.observe(cv);

    cv.addEventListener("pointermove", point);
    cv.addEventListener("pointerdown", point);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("click", click);

    if (calm) frame(performance.now());
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      cv.removeEventListener("pointermove", point);
      cv.removeEventListener("pointerdown", point);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("click", click);
    };
  }, [sessions, ghost]);

  const caption = loading
    ? "Reading your history…"
    : sessions.length === 0
      ? "Your repositories will gather here as a map."
      : `${Math.min(sessions.length, MAX_STARS)} of your repositories · hover a point, click to open`;

  return (
    <div className="db-const" aria-hidden="true">
      <canvas ref={canvasRef} className="db-const__cv" />
      <p className="db-const__cap">{caption}</p>
    </div>
  );
}

export default RepoConstellation;
