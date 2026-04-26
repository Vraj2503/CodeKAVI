import * as React from "react";
import { cn } from "../../lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const AnimatedInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-accent/40 to-accent/20 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-500"></div>
        <input
          type={type}
          className={cn(
            "relative flex h-12 w-full rounded-xl border border-border/50 bg-bg-primary px-4 py-2 text-sm text-text-primary shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);
AnimatedInput.displayName = "AnimatedInput";

export { AnimatedInput };
