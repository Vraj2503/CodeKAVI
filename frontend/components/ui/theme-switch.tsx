"use client";

import { Theme } from "@/components/ui/theme";

const ThemeSwitch = ({ className }: { className?: string }) => {
  return (
    <Theme
      variant="button"
      size="sm"
      themes={["light", "dark"]}
      className={className}
    />
  );
};

export default ThemeSwitch;
