/**
 * Genex Windows Community: shows the interface in Spanish (the default) or in the original English.
 *
 * Upstream Genex writes its English labels straight into components, so instead of touching every
 * component the fork swaps whole strings as they reach the page: a text node, or a `placeholder`,
 * `title`, `aria-label` or `alt` attribute whose trimmed text is exactly a known label. Nothing
 * else changes: React still owns every node, and when it writes new text the observer translates
 * that too. Editable text (the composer, inputs, the terminal) and code are never touched, so a
 * message you type or a model writes reaches the page as written.
 */
import { ES_PATTERNS, ES_STRINGS } from "./es.ts";

export const Language = { Spanish: "es", English: "en" } as const;
export type Language = (typeof Language)[keyof typeof Language];

const STORAGE_KEY = "genex-community.language";
const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt", "data-tooltip"] as const;
/** Elements whose text belongs to the person or the program, not the interface. */
const SKIP_SELECTOR =
  "textarea,input,pre,code,kbd,samp,script,style,[contenteditable],.xterm,.cm-editor,.monaco-editor,[data-no-translate]";

const DICTIONARY = new Map<string, string>(ES_STRINGS);

export function currentLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === Language.English ? Language.English : Language.Spanish;
  } catch {
    return Language.Spanish;
  }
}

/** Remember the choice and reload, so every label is drawn again in the new language. */
export function setLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {}
  location.reload();
}

/** The Spanish for one interface string, or null when it is not a known label. */
export function translateText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 400) return null;
  const exact = DICTIONARY.get(trimmed);
  let out: string | null = exact ?? null;
  if (out === null) {
    for (const [pattern, replacement] of ES_PATTERNS) {
      if (pattern.test(trimmed)) {
        out = trimmed.replace(pattern, replacement);
        break;
      }
    }
  }
  if (out === null) return null;
  if (trimmed === text) return out;
  const start = text.indexOf(trimmed);
  return text.slice(0, start) + out + text.slice(start + trimmed.length);
}

const skipped = (el: Element | null) => Boolean(el?.closest(SKIP_SELECTOR));

function translateTextNode(node: Text): void {
  const value = node.nodeValue;
  if (!value || !/[A-Za-z]/.test(value)) return;
  if (skipped(node.parentElement)) return;
  const next = translateText(value);
  if (next !== null && next !== value) node.nodeValue = next;
}

function translateAttributes(el: Element): void {
  if (el.closest("[contenteditable],.xterm,[data-no-translate]")) return;
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const next = translateText(value);
    if (next !== null && next !== value) el.setAttribute(name, next);
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skipped(root as Element) && !(root as Element).matches("input,textarea")) return;
    translateAttributes(root as Element);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).matches(SKIP_SELECTOR) &&
      !(node as Element).matches("input,textarea")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
    else translateAttributes(node as Element);
  }
}

let installed = false;

/**
 * Translate the page now and every change after it. Off in English, and off under automation
 * (`navigator.webdriver`), whose end-to-end checks find buttons by their English names.
 */
export function installTranslator(): void {
  if (installed || typeof document === "undefined") return;
  if (currentLanguage() !== Language.Spanish || navigator.webdriver) return;
  installed = true;
  document.documentElement.lang = Language.Spanish;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target as Text);
      else if (record.type === "attributes") translateAttributes(record.target as Element);
      else for (const node of record.addedNodes) translateTree(node);
    }
  });
  const start = () => {
    translateTree(document.body);
    if (document.title) document.title = translateText(document.title) ?? document.title;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
