"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "light" || stored === "dark") setTheme(stored);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("range-theme", next);
    setTheme(next);
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-label="配色を切り替える">
      {theme === "dark" ? "ライト" : "ダーク"}
    </Button>
  );
}
