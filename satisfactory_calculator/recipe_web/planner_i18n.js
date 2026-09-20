(() => {
  "use strict";

  const DEFAULT_LOCALE = "en-US";
  const STORAGE_KEY = "satisfactoryProductionPlanner.locale.v1";
  const LOCALES = Object.freeze({
    "en-US": "English", "fr-FR": "Français", "it-IT": "Italiano", "de-DE": "Deutsch",
    "es-ES": "Español", "ja-JP": "日本語", "ko-KR": "한국어", "pl-PL": "Polski",
    "pt-BR": "Português (Brasil)", "ru-RU": "Русский", "zh-CN": "简体中文",
    "zh-TW": "繁體中文", "uk-UA": "Українська",
  });
  const ALIASES = Object.freeze({
    en: "en-US", fr: "fr-FR", it: "it-IT", de: "de-DE", es: "es-ES", ja: "ja-JP", ko: "ko-KR",
    pl: "pl-PL", pt: "pt-BR", ru: "ru-RU", uk: "uk-UA", "zh-hans": "zh-CN", "zh-cn": "zh-CN",
    "zh-sg": "zh-CN", zh: "zh-CN", "zh-hant": "zh-TW", "zh-tw": "zh-TW", "zh-hk": "zh-TW",
  });
  const config = window.PLANNER_CONFIG || {};
  const selection = selectedLocale();
  let ui = {};
  let english = {};
  let game = { items: {}, recipes: {}, devices: {} };
  let collator = new Intl.Collator(selection.locale, { numeric: true, sensitivity: "base" });
  let numberFormatter = new Intl.NumberFormat(selection.locale, { maximumFractionDigits: 6 });
  let integerFormatter = new Intl.NumberFormat(selection.locale, { maximumFractionDigits: 0 });
  let pluralRules = new Intl.PluralRules(selection.locale);

  function matchLocale(value) {
    const normalized = String(value || "").trim().replace(/_/g, "-");
    if (!normalized) return "";
    const exact = Object.keys(LOCALES).find((locale) => locale.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;
    const lower = normalized.toLowerCase();
    return ALIASES[lower] || ALIASES[lower.split("-")[0]] || "";
  }

  function selectedLocale() {
    const parameter = new URLSearchParams(window.location.search).get("lang");
    const stored = safeStorageGet(STORAGE_KEY);
    const explicitlySelected = parameter || stored;
    if (explicitlySelected && explicitlySelected !== "auto") {
      return { locale: matchLocale(explicitlySelected) || DEFAULT_LOCALE, preference: explicitlySelected };
    }
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages : [navigator.language];
    return { locale: candidates.map(matchLocale).find(Boolean) || DEFAULT_LOCALE, preference: "auto" };
  }

  function assetUrl(locale, kind) {
    return config.localizationAssets?.[locale]?.[kind] || `i18n/${kind}.${locale}.json`;
  }

  async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load localization ${url} (${response.status})`);
    return response.json();
  }

  const ready = (async () => {
    const [englishResult, uiResult, gameResult] = await Promise.all([
      loadJson(assetUrl(DEFAULT_LOCALE, "ui")),
      selection.locale === DEFAULT_LOCALE ? Promise.resolve(null) : loadJson(assetUrl(selection.locale, "ui")),
      loadJson(assetUrl(selection.locale, "game")),
    ]);
    english = englishResult || {};
    ui = { ...english, ...(uiResult || {}) };
    game = gameResult || game;
    document.documentElement.lang = selection.locale;
    applyDocument();
    initializeLanguageSelector();
    return api;
  })().catch((error) => {
    console.error("Localization initialization failed", error);
    ui = english;
    applyDocument();
    initializeLanguageSelector();
    return api;
  });

  function t(key, parameters = {}) {
    let template = ui[key] ?? english[key] ?? key;
    if (parameters.count !== undefined) {
      const pluralKey = `${key}.${pluralRules.select(Number(parameters.count))}`;
      template = ui[pluralKey] ?? english[pluralKey] ?? ui[`${key}.other`] ?? english[`${key}.other`] ?? template;
    }
    return String(template).replace(/\{(\w+)\}/g, (_match, name) => parameters[name] ?? `{${name}}`);
  }

  function applyDocument(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.dataset.i18nTitle));
    });
    document.title = t("app.title");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("app.description"));
  }

  function initializeLanguageSelector() {
    const select = document.getElementById("languageSelect");
    if (!(select instanceof HTMLSelectElement)) return;
    select.replaceChildren();
    const auto = new Option(t("language.auto"), "auto");
    select.add(auto);
    Object.entries(LOCALES).forEach(([locale, label]) => select.add(new Option(label, locale)));
    select.value = selection.preference === "auto" ? "auto" : selection.locale;
    select.addEventListener("change", () => {
      safeStorageSet(STORAGE_KEY, select.value);
      const url = new URL(window.location.href);
      if (select.value === "auto") url.searchParams.delete("lang");
      else url.searchParams.set("lang", select.value);
      window.location.assign(url);
    });
  }

  function localizePayload(value) {
    if (Array.isArray(value)) return value.map(localizePayload);
    if (!value || typeof value !== "object") return value;
    const copy = {};
    Object.entries(value).forEach(([key, child]) => { copy[key] = localizePayload(child); });
    if (copy.className && copy.name) {
      copy.name = game.items?.[copy.className] || game.devices?.[copy.className] || copy.name;
    }
    if (copy.id && copy.name) copy.name = game.recipes?.[copy.id] || copy.name;
    if (Array.isArray(copy.producerRecipeIds)) copy.producers = copy.producerRecipeIds.map(recipeName);
    if (Array.isArray(copy.consumerRecipeIds)) copy.consumers = copy.consumerRecipeIds.map(recipeName);
    if (Array.isArray(copy.recipeIds)) copy.recipes = copy.recipeIds.map(recipeName);
    if (copy.titleKey === "targetOutputs") copy.title = t("results.targetOutputs");
    if (copy.titleKey === "supplyLayer") copy.title = t("results.supplyLayer", { index: copy.layerIndex });
    if (copy.titleKey === "sharedSupply") copy.title = t("results.sharedSupply");
    if (copy.titleKey === "externalInput") copy.title = t("results.externalInput");
    return copy;
  }

  const itemName = (id, fallback = id) => game.items?.[id] || fallback;
  const recipeName = (id, fallback = id) => game.recipes?.[id] || fallback;
  const deviceName = (id, fallback = id) => game.devices?.[id] || fallback;
  const compare = (left, right) => collator.compare(String(left || ""), String(right || ""));
  const normalizeSearch = (value) => String(value || "").normalize("NFKD").toLocaleLowerCase(selection.locale)
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const formatNumber = (value) => numberFormatter.format(Number(value));
  const formatInteger = (value) => integerFormatter.format(Number(value));

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key) || ""; } catch (_error) { return ""; }
  }
  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_error) { /* Optional browser storage. */ }
  }

  const api = Object.freeze({
    ready, t, applyDocument, localizePayload, itemName, recipeName, deviceName, compare, normalizeSearch,
    formatNumber, formatInteger, locale: selection.locale, locales: LOCALES,
  });
  window.PlannerI18n = api;
})();
