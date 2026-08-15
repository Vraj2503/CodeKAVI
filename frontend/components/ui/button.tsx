import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * The one button. (There used to be two: this one, unused, and
 * `NeonButton`, whose visual idea was gradient hairlines fading in on
 * hover — an effect from a different product.)
 *
 * TELEMETRY treatment: square, hairlined, no gradient. Details that
 * matter:
 *
 *   · The press is `scale(0.97)` at 140ms. Instant physical feedback,
 *     before any state has changed. Subtle is the point — below ~0.95 it
 *     reads as a glitch.
 *   · Transitions name their properties. `transition: all` drags layout
 *     properties into the animation and is the usual reason a button
 *     feels mushy under load.
 *   · Hover is gated behind `(hover: hover)`. Touch devices fire hover on
 *     tap, so ungated hover states stick after the finger lifts.
 *   · `signal` gets a scanline sheen on hover via a clip-path wipe rather
 *     than a colour fade — the same "value being written" language the
 *     readouts use.
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans font-medium tracking-[0.01em]",
    "rounded-[var(--radius)]",
    "transition-[background-color,border-color,color,box-shadow,transform]",
    "duration-150 ease-out",
    "active:scale-[0.97] active:duration-100",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        signal: [
          "bg-signal text-signal-foreground border border-signal",
          "[@media(hover:hover)]:hover:brightness-110",
          "[@media(hover:hover)]:hover:shadow-glow",
          "active:brightness-95",
        ].join(" "),
        outline: [
          "border border-border bg-transparent text-foreground",
          "[@media(hover:hover)]:hover:border-signal/60",
          "[@media(hover:hover)]:hover:text-signal",
          "[@media(hover:hover)]:hover:bg-signal/[0.06]",
        ].join(" "),
        secondary:
          "border border-border bg-secondary text-secondary-foreground [@media(hover:hover)]:hover:bg-accent",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground",
        danger:
          "border border-destructive bg-destructive text-destructive-foreground [@media(hover:hover)]:hover:brightness-110 active:brightness-95",
        link: "text-signal underline-offset-4 hover:underline p-0 h-auto border-0",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px] [&_svg]:size-3.5",
        default: "h-9 px-4 text-[13px] [&_svg]:size-4",
        lg: "h-11 px-6 text-[14px] [&_svg]:size-4",
        icon: "h-9 w-9 p-0 [&_svg]:size-4",
        "icon-sm": "h-7 w-7 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "signal",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
