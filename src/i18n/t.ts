import type { Locale } from "./locales";

/**
 * A pluralised message: the renderer picks a form via `Intl.PluralRules` from
 * the `count` param. `other` is required (it's the fallback for every locale);
 * the rest are optional and only used by locales that distinguish them.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type MessageParams = Record<string, string | number>;

/** A catalog leaf is either a plain string or a set of plural forms. */
type Leaf = string | PluralForms;

/** Dot-separated paths to every leaf of a nested catalog object. */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? K
      : `${K}.${MessageKey<T[K]>}`;
}[keyof T & string];

function lookup(catalog: unknown, key: string): Leaf | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (node != null && typeof node === "object" && "other" in node) {
    return node as PluralForms;
  }
  return undefined;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Resolve a message key against `messages`, falling back to `fallback` (the
 * English catalog) and finally to the raw key. Interpolates `{name}`
 * placeholders and selects a plural form from `params.count` when the leaf is
 * a {@link PluralForms} object.
 */
export function translate(
  messages: unknown,
  fallback: unknown,
  locale: Locale,
  key: string,
  params?: MessageParams,
): string {
  const raw = lookup(messages, key) ?? lookup(fallback, key);
  if (raw == null) return key;

  let str: string;
  if (typeof raw === "string") {
    str = raw;
  } else {
    const count = Number(params?.count ?? 0);
    const form = new Intl.PluralRules(locale).select(count);
    str = raw[form] ?? raw.other;
  }
  return interpolate(str, params);
}
