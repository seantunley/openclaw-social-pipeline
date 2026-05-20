/**
 * Inline SVG country flags.
 *
 * Why not emoji: Windows doesn't ship the regional-indicator glyphs that
 * make 🇬🇧 / 🇫🇷 / 🇷🇺 render as flags — it falls back to plain "GB" /
 * "FR" / "RU" text. SVG renders identically on every OS and stays sharp at
 * any size.
 *
 * Why not a flag-icon library: pulling in `flag-icons` (3.5MB) for three
 * flags is wasteful. These three are simple geometric primitives.
 *
 * Add a flag: register an SVG below + the LocaleId in the type union, then
 * map it in i18n.tsx's LOCALES.
 */

import type React from 'react';
import type { LocaleId } from '@/lib/i18n';

interface FlagProps {
  id: LocaleId;
  /** Pixel size — defaults to 16. */
  size?: number;
  className?: string;
}

export default function Flag({ id, size = 16, className }: FlagProps) {
  const flag = FLAGS[id];
  if (!flag) return null;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: size,
        height: Math.round(size * (2 / 3)),
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {flag}
    </span>
  );
}

const FLAGS: Record<LocaleId, React.JSX.Element> = {
  // Union Jack — three crosses (St George red, St Andrew white-on-blue, St
  // Patrick red diagonal). Simplified to the standard 30:20 ratio.
  en: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        stroke="#C8102E"
        strokeWidth="4"
        clipPath="polygon(0 0, 50% 50%, 100% 0, 100% 100%, 50% 50%, 0 100%)"
      />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  ),

  // Tricolour: blue / white / red, vertical thirds.
  fr: (
    <svg viewBox="0 0 3 2" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="1" height="2" fill="#0055A4" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#EF4135" />
    </svg>
  ),

  // Russian tricolour: white / blue / red, horizontal thirds.
  ru: (
    <svg viewBox="0 0 3 2" preserveAspectRatio="none" width="100%" height="100%">
      <rect width="3" height="2" fill="#fff" />
      <rect y="0.667" width="3" height="0.667" fill="#0039A6" />
      <rect y="1.333" width="3" height="0.667" fill="#D52B1E" />
    </svg>
  ),
};
