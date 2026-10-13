export const dashboardPages = [
  { id: "entrainement", label: "Entraînement", title: "Ton entraînement", description: "Une consigne pour aujourd’hui. Une semaine adaptée à ce que tu as déjà fait.", icon: "training" },
  { id: "progression", label: "Progression", title: "Ta progression", description: "Les tendances et les chiffres qui racontent ton parcours.", icon: "chart" },
  { id: "recuperation", label: "Récupération", title: "Ta récupération", description: "Sommeil, forme et énergie : les repères pour ajuster ton effort.", icon: "recovery" },
  { id: "activites", label: "Activités", title: "Tes activités", description: "Retrouve tes sorties, compare les données et exporte ce qui t’intéresse.", icon: "activity" },
  { id: "objectifs", label: "Objectifs", title: "Tes objectifs", description: "Tes prochaines courses et les estimations pour les préparer.", icon: "goal" },
  { id: "equipement", label: "Équipement", title: "Tes chaussures", description: "Suis le kilométrage et l’usure de chaque paire.", icon: "shoe" },
] as const;

export type DashboardPageId = typeof dashboardPages[number]["id"];

export function dashboardPageFromHash(hash: string): DashboardPageId {
  const target = hash.replace(/^#/, "");
  if (target === "plan-semaine" || target === "aujourdhui") return "entrainement";
  if (target === "chaussures") return "equipement";
  return dashboardPages.find((page) => page.id === target)?.id ?? "entrainement";
}
