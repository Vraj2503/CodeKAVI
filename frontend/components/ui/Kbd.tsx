import { cn } from "@/lib/utils";

/**
 * A key cap. Deliberately unanimated — the keys it names are pressed dozens of
 * times a session, and anything that moves on that cadence turns into noise.
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
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded",
        "border border-border bg-muted px-1.5",
        "font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
