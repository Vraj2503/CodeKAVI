import { cn } from "@/lib/utils";

/**
 * A keycap. Used wherever a shortcut is advertised.
 *
 * Deliberately not a rounded pill: on this surface a key is a machined
 * square with a hairline, matching every other container. The inset top
 * highlight is the only nod to it being a physical thing.
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center px-1.5",
        "border border-border bg-muted/70",
        "font-mono text-[10px] font-medium leading-none text-muted-foreground",
        "shadow-raise",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
