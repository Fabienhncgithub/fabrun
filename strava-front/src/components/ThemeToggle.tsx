import type { Theme } from "../utils/theme";

export default function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Activer le thème clair" : "Activer le thème sombre"}
      title={dark ? "Thème clair" : "Thème sombre"}
    >
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
      <span>{dark ? "Clair" : "Sombre"}</span>
    </button>
  );
}

