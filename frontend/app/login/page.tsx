"use client";

/**
 * Sign-in, split in two: what the product does on the left, the single button
 * that starts it on the right.
 *
 * The left pane stays ink in both themes on purpose — it is the one branded
 * surface in the app, and a sign-in screen is the only place that can afford
 * one. Everything past this door is theme-obedient.
 */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LoginForm } from "@/components/ui/login-form";
import { Mark } from "@/components/shell/AppRail";
import ThemeSwitch from "@/components/ui/theme-switch";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/**
 * Where to land after signing in. Only same-origin paths are honoured —
 * anything else (`https://…`, `//evil.example`) would turn the login page into
 * an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//"))
    return "/dashboard";
  return raw;
}

/**
 * Where a visitor was trying to go, stored before the OAuth round trip.
 * The `next` param survives the redirect to Google; this survives the tab.
 */
const POST_LOGIN_DESTINATION_KEY = "postLoginDestination";

/**
 * A first sign-in is the only time `last_sign_in_at` is within seconds of
 * `created_at`. There is no counter to read, and waiting for a second visit to
 * show the welcome would be too late to be useful.
 */
function isFirstTimeAccount(
  user: { created_at?: string; last_sign_in_at?: string } | null,
): boolean {
  if (!user) return false;
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isNaN(created)) return false;
  const lastSignIn = user.last_sign_in_at
    ? Date.parse(user.last_sign_in_at)
    : NaN;
  if (Number.isNaN(lastSignIn)) return true;
  return Math.abs(lastSignIn - created) < 60_000;
}

/** A still frame of the thing the button starts. Static by design. */
const TRANSCRIPT = [
  ["clone", "238 files"],
  ["parse", "1,204 imports"],
  ["classify", "14 roles"],
  ["index", "862 chunks"],
];

function LoginContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set when a protected page bounced the user here — send them back to it
  // rather than to the dashboard, which would lose the link they followed.
  // `redirect` is accepted as an alias so both spellings of the same idea work.
  const requested = searchParams.get("next") ?? searchParams.get("redirect");
  const next = safeNext(requested);

  useEffect(() => {
    if (searchParams.get("error") === "auth_callback_failed") {
      toast.error("Authentication failed. Please try again.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (loading || !user) return;

    /*
     * The URL wins, the stored destination is the fallback, and a visitor with
     * neither lands on the dashboard — which is the product's home for a
     * signed-in account. Cleared before navigating so the next sign-in on this
     * tab is not dragged to an old destination.
     */
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(POST_LOGIN_DESTINATION_KEY);
      if (stored) sessionStorage.removeItem(POST_LOGIN_DESTINATION_KEY);
    } catch {
      // Storage unavailable: fall through to the URL or the dashboard.
    }

    const destination = safeNext(requested ?? stored);

    router.replace(
      isFirstTimeAccount(user) && destination === "/dashboard"
        ? "/dashboard?firstTime=true"
        : destination,
    );
  }, [user, loading, router, requested]);

  if (loading || user) return <Splash />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* ── Brand pane ── */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-[hsl(30_9%_6%)] px-8 py-10 text-[hsl(40_18%_94%)] lg:px-14 lg:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(40 18% 94% / 0.08) 1px, transparent 0)",
            backgroundSize: "26px 26px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 20% 0%, #000, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 60% at 20% 0%, #000, transparent 75%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(40rem 22rem at 90% 110%, hsl(34 96% 56% / 0.16), transparent 70%)",
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <Mark className="text-[hsl(40_18%_94%)]" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            Rune
          </span>
        </div>

        <div className="relative my-10 lg:my-0">
          <h2 className="max-w-lg text-[clamp(1.75rem,3.4vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em]">
            A repository explains itself
            <br />
            <span className="text-[hsl(40_18%_94%/0.55)]">
              once something has read all of it.
            </span>
          </h2>

          <div className="mt-9 max-w-sm rounded-lg border border-[hsl(40_18%_94%/0.14)] bg-[hsl(40_18%_94%/0.03)] p-4 font-mono text-[12px]">
            <p className="text-[hsl(40_18%_94%/0.5)]">
              <span className="text-[hsl(34_96%_56%)]">$</span> codekavi analyze
              pallets/flask
            </p>
            <ul className="mt-3 space-y-1.5">
              {TRANSCRIPT.map(([step, result]) => (
                <li key={step} className="flex items-center gap-2.5">
                  <span className="text-[hsl(34_96%_56%)]">✓</span>
                  <span className="w-20 text-[hsl(40_18%_94%/0.85)]">
                    {step}
                  </span>
                  <span className="tnum text-[hsl(40_18%_94%/0.45)]">
                    {result}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="relative font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(40_18%_94%/0.4)]">
          grounded in source · never invented
        </p>
      </section>

      {/* ── Sign-in pane ── */}
      <section className="relative flex items-center justify-center bg-background px-8 py-16">
        <div className="absolute right-6 top-6">
          <ThemeSwitch />
        </div>
        <div className="animate-rise">
          <LoginForm next={next} />
        </div>
      </section>
    </div>
  );
}

function Splash() {
  return (
    <div className="grid h-dvh w-screen place-items-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Splash />}>
      <LoginContent />
    </Suspense>
  );
}
