import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-xl border border-line bg-elev px-3 text-base text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-copper",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
