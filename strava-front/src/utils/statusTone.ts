// Shared "good / warn / bad / neutral" status-tone system.
//
// Several cards each grew their own version of the same green/orange/red
// taxonomy (TrainingLoadCard's ACR zones, ShoeUsageCard's wear levels,
// FormTrendCard's load pill, PerformancePredictionsCard's confidence badge),
// with slightly different class names and duplicated color values in
// App.scss. The colors themselves now live in one place as CSS custom
// properties (--tone-good-*, --tone-warn-*, --tone-bad-*, --tone-neutral-*
// in styles/base.scss, light and dark). This module is the single place new
// code maps a domain-specific state to one of the four tones and to the
// shared `.tone-*` utility class.
export type Tone = "good" | "warn" | "bad" | "neutral";

export function toneClass(tone: Tone): string {
  return `tone-${tone}`;
}
