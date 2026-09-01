import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Isolates one dashboard card so a bug or an unexpected Strava data shape in
 * a single card (13 of them now, each doing their own client-side date/math
 * on raw activities) degrades just that card instead of taking the whole
 * dashboard down to a blank white screen. React error boundaries must be
 * class components - there is no hook equivalent.
 */
export default class CardErrorBoundary extends Component<
  { title?: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Card "${this.props.title ?? "?"}" crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card-error-fallback">
          <div className="card-error-title">
            {this.props.title ? `${this.props.title}: ` : ""}affichage impossible
          </div>
          <p className="card-error-text">
            Cette carte a rencontré un problème et a été désactivée pour ne pas bloquer le reste du
            dashboard. Un rechargement de la page peut suffire.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
