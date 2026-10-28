"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import hi from "./hi.json";

/**
 * Translations (M11.4): English is the key, other languages are JSON files keyed by the English text,
 * so a regional language is added by dropping in a file (bn.json, as.json …) with no code change.
 * Missing keys fall back to English.
 */

const DICTS: Record<string, Record<string, string>> = { hi };
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
] as const;

type Ctx = { lang: string; setLang: (l: string) => void; t: (s: string, vars?: Record<string, string | number>) => string };
const I18n = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (s) => s });

export function I18nProvider({ children, defaultLang = "en" }: { children: ReactNode; defaultLang?: string }) {
  const [lang, setLangState] = useState(defaultLang);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cc.lang");
      if (saved) setLangState(saved);
    } catch {}
  }, []);
  const setLang = useCallback((l: string) => {
    setLangState(l);
    try { localStorage.setItem("cc.lang", l); } catch {}
    document.documentElement.lang = l;
  }, []);
  const t = useCallback(
    (s: string, vars?: Record<string, string | number>) => {
      let out = DICTS[lang]?.[s] ?? s;
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
      return out;
    },
    [lang],
  );
  return <I18n.Provider value={{ lang, setLang, t }}>{children}</I18n.Provider>;
}

export const useT = () => useContext(I18n);

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} className={className ?? "min-h-9 rounded-lg border-[1.5px] border-line bg-paper px-2 text-xs"}>
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
