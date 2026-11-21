import { dashboardPages, type DashboardPageId } from "../utils/dashboardNavigation";

const iconPaths = {
  training: <><path d="M4 13h4l3-8 4 14 3-6h3" /></>,
  chart: <><path d="M4 4v16h16M8 14l4-5 4 3 4-7" /></>,
  recovery: <><path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z" /></>,
  activity: <><path d="M8 5H5v15h14V5h-3M9 3h6v4H9zM8 11h8M8 15h5" /></>,
  goal: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m12 12 9-9M17 3h4v4" /></>,
  shoe: <><path d="M4 7h5l2 5 7 3c2 1 3 2 3 4H3V9a2 2 0 0 1 1-2ZM12 12l2-2M15 14l2-2M4 16h15" /></>,
};

export default function DashboardNav({ activePage }: { activePage: DashboardPageId }) {
  return (
    <nav className="dashboard-nav-v2" aria-label="Rubriques du tableau de bord">
      {dashboardPages.map((page) => (
        <a key={page.id} href={`#${page.id}`} aria-current={activePage === page.id ? "page" : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[page.icon]}</svg>
          <span>{page.label}</span>
        </a>
      ))}
    </nav>
  );
}
