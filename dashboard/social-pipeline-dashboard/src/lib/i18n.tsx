/**
 * Tiny i18n. Two languages now (EN, FR), drop in more by adding a locale
 * file under `src/locales/` and registering it in LOCALES below.
 *
 * Why hand-rolled instead of react-i18next: the surface area is small
 * (~200 strings, no plurals, no ICU formatting), and react-i18next pulls
 * in 80kB minified plus async loader plumbing we don't need. If the app
 * ever grows past simple key→string with light interpolation, swap in
 * react-i18next without touching call sites — `t(key, vars?)` matches
 * the i18next signature.
 *
 * Keys are dot-paths into the locale tree: `t('settings.import.title')`.
 * Variable interpolation: `t('counter', { count: 3 })` looks for `{count}`.
 */

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/fr';
import 'dayjs/locale/ru';
import en from '@/locales/en';
import fr from '@/locales/fr';
import ru from '@/locales/ru';

export type LocaleId = 'en' | 'fr' | 'ru';

export interface Locale {
  id: LocaleId;
  label: string;
  /** Native flag emoji or country code badge. */
  flag: string;
  /** Nested string tree. Missing keys fall through to EN. */
  strings: Record<string, unknown>;
}

export const LOCALES: Locale[] = [
  { id: 'en', label: 'English', flag: '🇬🇧', strings: en },
  { id: 'fr', label: 'Français', flag: '🇫🇷', strings: fr },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', strings: ru },
];

const STORAGE_KEY = 'social-pipeline-locale';
const FALLBACK: LocaleId = 'en';

interface I18nContextValue {
  locale: LocaleId;
  setLocale: (id: LocaleId) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): LocaleId {
  if (typeof window === 'undefined') return FALLBACK;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && LOCALES.some((l) => l.id === stored)) return stored as LocaleId;
  return FALLBACK;
}

dayjs.locale(readStoredLocale());

function lookup(tree: Record<string, unknown>, key: string): string | null {
  const path = key.split('.');
  let cur: unknown = tree;
  for (const segment of path) {
    if (cur && typeof cur === 'object' && segment in (cur as object)) {
      cur = (cur as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  return typeof cur === 'string' ? cur : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleId>(readStoredLocale);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, locale);
      // Reflect on <html> so a CSS author can target a specific locale if
      // ever needed (e.g., tighter line-height for FR labels).
      document.documentElement.lang = locale;
    }
    dayjs.locale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const active = LOCALES.find((l) => l.id === locale)!;
    const fallback = LOCALES.find((l) => l.id === FALLBACK)!;
    return {
      locale,
      setLocale: setLocaleState,
      t: (key, vars) => {
        const found = lookup(active.strings, key) ?? lookup(fallback.strings, key);
        if (!found) {
          // Show the key in dev so missing strings are visible at a glance,
          // rather than a silent empty span.
          if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
            console.warn(`[i18n] missing key: ${key}`);
          }
          return key;
        }
        return interpolate(found, vars);
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx.t;
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale must be used inside <I18nProvider>');
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
