import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * The one button.
 *
 * There used to be two implementations — this one (unused) and
 * `NeonButton` (used once), whose whole visual idea was two gradient
 * hairlines that faded in on hover. That effect belonged to a different
 * product; here the button's job is to be unmistakably pressable and
 * then get out of the way.
 *
 * Three details worth keeping:
 *
 *   · The press is `scale(0.97)` at 140ms. Instant, physical feedback —
 *     the control visibly acknowledges the click before any state has
 *     changed. Subtle is the point; below ~0.95 it reads as a glitch.
 *   · Transitions name their properties. `transition: all` would drag
 *     layout properties into the animation and is the usual reason a
 *     button feels mushy under load.
 *   · Hover effects are gated behind `(hover: hover)`. Touch devices fire
 *     hover on tap, so ungated hover states stick after the finger lifts.
 *   · `primary` carries a hairline top highlight. On a saturated fill
 *     that one line is what separates "a rectangle of colour" from
 *     "a physical control".
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans font-medium tracking-[-0.005em]",
    "rounded-[calc(var(--radius)-2px)]",
    "transition-[background-color,border-color,color,box-shadow,transform,filter]",
    "duration-150 ease-out",
    "active:scale-[0.97] active:duration-100",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-primary text-primary-foreground shadow-raise",
          "hover:[@media(hover:hover)]:brightness-[1.07]",
          "hover:[@media(hover:hover)]:shadow-lift",
          "active:brightness-95 active:shadow-none",
          // hairline highlight along the top edge
          "relative before:absolute before:inset-x-0 before:top-0 before:h-px",
          "before:rounded-t-[inherit] before:bg-white/25",
        ].join(" "),
        secondary:
          "bg-secondary text-secondary-foreground hover:[@media(hover:hover)]:bg-accent active:bg-accent",
        outline:
          "border border-border bg-transparent text-foreground hover:[@media(hover:hover)]:bg-accent/60 hover:[@media(hover:hover)]:border-foreground/20",
        ghost:
          "bg-transparent text-muted-foreground hover:[@media(hover:hover)]:bg-accent/60 hover:[@media(hover:hover)]:text-foreground",
        danger:
          "bg-destructive text-destructive-foreground shadow-raise hover:[@media(hover:hover)]:brightness-110 active:brightness-95",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        default: "h-9 px-4 text-sm [&_svg]:size-4",
        lg: "h-11 px-6 text-[15px] [&_svg]:size-4",
        icon: "h-9 w-9 p-0 [&_svg]:size-4",
        "icon-sm": "h-7 w-7 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
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
