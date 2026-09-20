(() => {
  "use strict";

  const targetRows = document.getElementById("targetRows");
  const targetTemplate = document.getElementById("targetRowTemplate");
  const addTargetButton = document.getElementById("addTargetButton");
  const savePlanButton = document.getElementById("savePlanButton");
  const planLibrary = document.querySelector(".plan-library");
  const savedPlanSelect = document.getElementById("savedPlanSelect");
  const historyPlanSelect = document.getElementById("historyPlanSelect");
  const recipeFilterButton = document.getElementById("recipeFilterButton");
  const plannerForm = document.getElementById("plannerForm");
  const calculateButton = document.getElementById("calculateButton");
  const dataSummary = document.getElementById("dataSummary");
  const statusMessage = document.getElementById("statusMessage");
  const treeView = document.getElementById("treeView");
  const tableView = document.getElementById("tableView");
  const resetLayoutButton = document.getElementById("resetLayoutButton");
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const STORAGE_KEY = "satisfactoryProductionPlanner.v1";
  const SELECTION_CACHE_VERSION = 6;
  const GRAPH_FLOW_WIDTH = 8;
  const GRAPH_VIEWPORT_MIN_HEIGHT = 360;
  const GRAPH_VIEWPORT_BOTTOM_GAP = 18;
  const RECIPE_MODE_BASE = "base";
  const RECIPE_MODE_BEST_EFFICIENCY = "bestEfficiency";
  const DIRECT_RAW_RECIPE_ID = "__raw__";
  const TARGET_HISTORY_LIMIT = 10;
  const recipeModeInputs = [];
  const i18n = window.PlannerI18n;
  const t = (key, parameters) => i18n?.t(key, parameters) || key;

  let items = [];
  let plannerReady = false;
  let recipeCatalog = { materials: [], defaultEnabledRecipeIds: [], selectableRecipeIds: [] };
  const itemsByClass = new Map();
  const selectedRecipeIds = new Set();
  const disabledRawMaterialClasses = new Set();
  const preferredPlanByTargetKey = new Map();
  const recipeNodePositions = new Map();
  let activeTab = "tree";
  let savedState = loadPlannerState();
  let savedTargetPlans = normalizeTargetPlanList(savedState.savedTargetPlans);
  let targetHistory = normalizeTargetPlanList(savedState.targetHistory).slice(0, TARGET_HISTORY_LIMIT);
  let pendingRecipeMode = RECIPE_MODE_BASE;
  let suppressStateSave = false;
  let activePlanKey = "";
  let activePreferredPlan = [];
  let activeGraphDrag = null;
  let activeGraphPan = null;
  let activeRecipeFilterDrag = null;
  let selectedGraphRecipeId = "";
  let selectedGraphHighlightDepth = 1;
  let suppressNextGraphBlankClick = false;
  let lastServerResult = null;
  let lastServerTargets = [];
  let lastServerPlanSignature = "";

  addTargetButton.addEventListener("click", () => addTargetRow());
  savePlanButton?.addEventListener("click", saveCurrentTargetPlan);
  savedPlanSelect?.addEventListener("click", (event) => handleTargetPlanPickerClick(event, savedPlanSelect, savedTargetPlans));
  historyPlanSelect?.addEventListener("click", (event) => handleTargetPlanPickerClick(event, historyPlanSelect, targetHistory));
  recipeFilterButton?.addEventListener("click", openRecipeFilterDialog);
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  resetLayoutButton?.addEventListener("click", resetGraphLayout);
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".plan-picker")) {
      closeTargetPlanPickers();
    }
  });
  window.addEventListener("resize", handleWindowResize);

  window.PlannerDiagnostics.configure(() => ({
    targets: collectTargetState(),
    enabledRecipeIds: selectedRecipeIdsPayload(),
    disabledRawMaterialClasses: disabledRawMaterialClassesPayload(),
    recipeNodePositions: Array.from(recipeNodePositions.entries()),
    activeTab,
  }));
  try {
    restorePreferredPlanCache(savedState.selectionCacheVersion === SELECTION_CACHE_VERSION ? savedState.preferredPlanByTarget : []);
    restoreRecipeNodePositions(savedState.recipeNodePositions);
  } catch (error) {
    window.PlannerDiagnostics.reportError(error, "restore-state");
    console.error("Failed to restore planner state", error);
    preferredPlanByTargetKey.clear();
    activePreferredPlan = [];
  }
  initializeLocalizedPlanner();

  async function initializeLocalizedPlanner() {
    await i18n?.ready;
    loadInitialData();
  }

  async function loadInitialData() {
    const supportingData = Promise.all([
      fetchJson("/api/summary"),
      fetchJson("/api/recipes"),
    ]);
    supportingData.catch(() => undefined);
    try {
      const itemPayload = await fetchJson("/api/materials");
      items = Array.isArray(itemPayload.items) ? itemPayload.items : [];
      itemsByClass.clear();
      items.forEach((item) => itemsByClass.set(item.className, item));
      savedTargetPlans = normalizeTargetPlanList(savedState.savedTargetPlans);
      targetHistory = normalizeTargetPlanList(savedState.targetHistory).slice(0, TARGET_HISTORY_LIMIT);
      if (!restoreTargetRows(savedState.targets)) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      renderTargetPlanSelectors();
      dataSummary.textContent = t("status.itemsLoading", { count: formatInteger(items.length) });
      setStatus(t("status.itemsReady"), false);

      const [summary, recipePayload] = await supportingData;
      initializeRecipeSelection(recipePayload);
      plannerReady = true;
      if (recipeFilterButton) recipeFilterButton.disabled = false;
      if (calculateButton) calculateButton.disabled = false;
      activatePlanCacheForCurrentTargets();
      window.PlannerDiagnostics.setDataSummary(summary);
      dataSummary.textContent = summaryText(summary);
      setStatus(t("status.loaded"), false);
    } catch (error) {
      window.PlannerDiagnostics.reportError(error, "load-data");
      if (!targetRows.querySelector(".target-row")) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      renderTargetPlanSelectors();
      dataSummary.textContent = t("status.connectionFailed");
      setStatus(`Unable to load data: ${error.message} Please retry or use Report a problem.`, true);
    }
  }

  async function calculate(options = {}) {
    if (!plannerReady) {
      setStatus(t("status.loadingRecipes"), false);
      return;
    }
    clearRecipeCardChecks();
    const targets = collectTargets();
    if (!targets.length) {
      return;
    }
    activatePlanCacheForCurrentTargets();
    addTargetPlanToHistory(targetSnapshotsFromTargets(targets));
    savePlannerState();

    let calculationResult = null;
    setStatus(t("status.calculating"), false);
    try {
      const result = await fetchJson("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((target) => ({
            itemClass: target.item.className,
            rate: target.rate,
          })),
          enabledRecipeIds: selectedRecipeIdsPayload(),
          disabledRawMaterialClasses: disabledRawMaterialClassesPayload(),
          preferredPlan: [],
        }),
      });
      calculationResult = result;
      if (result.recipeExpansionRequired) {
        handleRecipeExpansionRequired(result, targets);
        return;
      }
      storeCurrentPreferredPlan();
      lastServerResult = clonePlannerResult(result);
      lastServerTargets = targetSnapshotsFromTargets(targets);
      lastServerPlanSignature = planSignature();
      renderPlannerResult(result, { selectTree: true });
      updateRecipeFilterButton();
      const targetCount = result.summary?.targetCount ?? targets.length;
      const totalRows = result.summary?.totalRows ?? 0;
      const recipeRunCount = result.summary?.recipeRunCount ?? 0;
      const externalInputRate = (result.rawTotals || []).reduce(
        (total, row) => total + Number(row.rate || 0),
        0,
      );
      setStatus(t("status.optimized", {
        targets: formatInteger(targetCount), recipes: formatInteger(recipeRunCount),
        selected: formatInteger(selectedRecipeIds.size), external: formatNumber(externalInputRate), rows: formatInteger(totalRows),
      }), false);
    } catch (error) {
      const issue = window.PlannerDiagnostics.reportError(error, "calculate-or-render", true, calculationResult);
      lastServerResult = null;
      lastServerTargets = [];
      lastServerPlanSignature = "";
      setStatus(`Calculation failed: ${error.message} Problem ID: ${issue.id}. Use Report a problem to share details.`, true);
      treeView.replaceChildren(makeEmptyMessage(t("results.noPlan")));
      tableView.replaceChildren(makeEmptyMessage(t("results.noTable")));
    }
  }

  function handleRecipeExpansionRequired(result, targets) {
    const requiredRecipeIds = normalizedRecipeIdList(result.requiredRecipeIds);
    lastServerResult = null;
    lastServerTargets = [];
    lastServerPlanSignature = "";

    if (!requiredRecipeIds.length) {
      setStatus(`Calculation failed: ${result.failure || "current recipe selection cannot satisfy the target."}`, true);
      treeView.replaceChildren(makeEmptyMessage(t("results.noPlan")));
      tableView.replaceChildren(makeEmptyMessage(t("results.noTable")));
      return;
    }

    requiredRecipeIds.forEach((recipeId) => selectedRecipeIds.add(recipeId));
    savePlannerState();
    updateRecipeFilterButton();

    const targetText = targetListText(result.targets, targets);
    const notice = result.message || `Producing ${targetText} requires the following recipes.`;
    openRecipeFilterDialog({
      filterRecipeIds: requiredRecipeIds,
      notice: `${notice} They have been selected automatically.`,
    });
    setStatus(
      `The current recipe selection cannot produce ${targetText}. Added ${formatInteger(requiredRecipeIds.length)} missing recipe(s); calculate again.`,
      true,
    );
    treeView.replaceChildren(makeEmptyMessage("The recipe filter is open and the missing recipes have been selected. Calculate again."));
    tableView.replaceChildren(makeEmptyMessage("The recipe filter is open and the missing recipes have been selected. Calculate again."));
  }

  function normalizedRecipeIdList(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    return Array.from(
      new Set(
        values
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
  }

  function normalizeRecipeIdSet(values) {
    return new Set(normalizedRecipeIdList(values));
  }

  function targetListText(resultTargets, fallbackTargets) {
    const source = Array.isArray(resultTargets) && resultTargets.length
      ? resultTargets.map((target) => ({
        item: target.item,
        rate: target.rate,
      }))
      : (fallbackTargets || []);
    const parts = source
      .map((target) => {
        const item = target.item || {};
        const name = item.name || item.className || "target";
        const unit = item.unit || "items";
        return `${name} ${formatNumber(target.rate)} ${unit}/min`;
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : "the current target";
  }

  async function fetchJson(url, options = {}) {
    const payload = await window.PlannerDiagnostics.fetchJson(url, options);
    return i18n?.localizePayload(payload) || payload;
  }

  function renderPlannerResult(result, options = {}) {
    selectedGraphRecipeId = "";
    selectedGraphHighlightDepth = 1;
    renderGraphView(result, { preserveViewport: Boolean(options.preserveGraphViewport) });
    renderMergedTable(result.totals || []);
    if (options.selectTree) {
      selectTab("tree");
    }
  }

  function loadPlannerState() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function savePlannerState() {
    if (suppressStateSave) {
      return;
    }
    storeCurrentPreferredPlan();
    const state = {
      selectionCacheVersion: SELECTION_CACHE_VERSION,
      targets: collectTargetState(),
      enabledRecipeIds: plannerReady
        ? selectedRecipeIdsPayload()
        : normalizedRecipeIdList(savedState.enabledRecipeIds),
      disabledRawMaterialClasses: disabledRawMaterialClassesPayload(),
      savedTargetPlans,
      targetHistory,
      preferredPlanByTarget: Array.from(preferredPlanByTargetKey.entries()).map(([key, plan]) => ({
        key,
        plan: normalizePreferredPlan(plan),
      })),
      recipeNodePositions: Array.from(recipeNodePositions.entries()).map(([id, position]) => ({
        id,
        x: roundGraphCoordinate(position.x),
        y: roundGraphCoordinate(position.y),
      })),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      savedState = state;
    } catch (_error) {
      // localStorage can be unavailable in restrictive browser modes.
    }
  }

  function collectTargetState() {
    return Array.from(targetRows.querySelectorAll(".target-row"))
      .map((row) => {
        const itemName = row.querySelector(".item-input").value.trim();
        const rate = row.querySelector(".amount-input").value.trim();
        return {
          itemClass: row.dataset.itemClass || "",
          itemName,
          rate,
        };
      })
      .filter((target) => target.itemClass || target.itemName || target.rate);
  }

  function normalizeTargetPlanList(entries) {
    const result = [];
    if (!Array.isArray(entries)) {
      return result;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const targets = normalizeTargetSnapshots(entry?.targets || entry);
      if (!targets.length) {
        continue;
      }
      addTargetPlanToList(result, targets);
    }
    return result;
  }

  function normalizeTargetSnapshots(targets) {
    if (!Array.isArray(targets)) {
      return [];
    }
    return targets
      .map((target) => {
        const itemClass = String(target?.itemClass || target?.item?.className || "").trim();
        const item = itemClass ? itemsByClass.get(itemClass) : null;
        const itemName = String(item?.name || target?.item?.name || target?.itemName || itemClass).trim();
        const rate = Number(target?.rate);
        if (!itemClass || !itemName || !Number.isFinite(rate) || rate <= 0) {
          return null;
        }
        return {
          itemClass,
          itemName,
          rate,
        };
      })
      .filter(Boolean);
  }

  function targetPlanKey(targets) {
    return normalizeTargetSnapshots(targets)
      .map((target) => `${target.itemClass}:${formatPlanRateKey(target.rate)}`)
      .sort()
      .join("|");
  }

  function formatPlanRateKey(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 1e9) / 1e9) : "";
  }

  function targetPlanLabel(targets) {
    const normalized = normalizeTargetSnapshots(targets);
    return normalized
      .map((target) => `${target.itemName} (${formatNumber(target.rate)})`)
      .join(" + ");
  }

  function addTargetPlanToList(list, targets, limit = Infinity) {
    const normalized = normalizeTargetSnapshots(targets);
    const key = targetPlanKey(normalized);
    if (!key) {
      return false;
    }
    const existingIndex = list.findIndex((entry) => entry.key === key);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
    list.unshift({
      key,
      label: targetPlanLabel(normalized),
      targets: normalized,
      savedAt: Date.now(),
    });
    if (Number.isFinite(limit) && list.length > limit) {
      list.length = limit;
    }
    return true;
  }

  function addTargetPlanToHistory(targets) {
    if (addTargetPlanToList(targetHistory, targets, TARGET_HISTORY_LIMIT)) {
      renderTargetPlanSelectors();
    }
  }

  function saveCurrentTargetPlan() {
    const targets = collectTargets();
    if (!targets.length) {
      return;
    }
    const snapshots = targetSnapshotsFromTargets(targets);
    addTargetPlanToList(savedTargetPlans, snapshots);
    savePlannerState();
    renderTargetPlanSelectors();
    setStatus(t("status.saved", { plan: targetPlanLabel(snapshots) }), false);
  }

  function renderTargetPlanSelectors() {
    renderTargetPlanPicker(savedPlanSelect, savedTargetPlans, t("targets.noSaved"), t("targets.selectSaved"));
    renderTargetPlanPicker(historyPlanSelect, targetHistory, t("targets.noHistory"), t("targets.selectHistory"));
    if (planLibrary instanceof HTMLElement) {
      planLibrary.hidden = !savedTargetPlans.length && !targetHistory.length;
    }
  }

  function renderTargetPlanPicker(picker, plans, emptyText, placeholderText) {
    if (!(picker instanceof HTMLElement)) {
      return;
    }
    const button = picker.querySelector(".plan-picker-button");
    const menu = picker.querySelector(".plan-picker-menu");
    if (!(button instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) {
      return;
    }
    const field = picker.closest(".plan-select-field");
    if (field instanceof HTMLElement) {
      field.hidden = !plans.length;
    }
    button.textContent = plans.length ? placeholderText : emptyText;
    button.disabled = !plans.length;
    menu.hidden = true;
    menu.replaceChildren();
    plans.forEach((plan) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "plan-picker-option";
      option.dataset.planKey = plan.key;
      option.setAttribute("role", "option");
      option.title = plan.label || targetPlanLabel(plan.targets);
      option.setAttribute("aria-label", option.title);
      option.appendChild(renderTargetPlanSummary(plan.targets, { iconsOnly: true }));
      menu.appendChild(option);
    });
  }

  function renderTargetPlanSummary(targets, options = {}) {
    const summary = document.createElement("span");
    summary.className = `plan-picker-summary${options.iconsOnly ? " icons-only" : ""}`;
    normalizeTargetSnapshots(targets).forEach((target, index) => {
      if (index > 0 && !options.iconsOnly) {
        summary.appendChild(document.createTextNode(" + "));
      }
      const token = document.createElement("span");
      token.className = "plan-picker-target";
      const item = itemsByClass.get(target.itemClass) || {
        className: target.itemClass,
        name: target.itemName,
      };
      token.append(
        makeMaterialIcon(item, "plan-picker-icon"),
      );
      if (!options.iconsOnly) {
        token.appendChild(document.createTextNode(`${target.itemName} (${formatNumber(target.rate)})`));
      } else {
        token.appendChild(document.createTextNode(`(${formatNumber(target.rate)})`));
      }
      summary.appendChild(token);
    });
    return summary;
  }

  function handleTargetPlanPickerClick(event, picker, plans) {
    if (!(picker instanceof HTMLElement)) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest(".plan-picker-option");
    if (option instanceof HTMLElement) {
      const plan = plans.find((entry) => entry.key === option.dataset.planKey);
      closeTargetPlanPickers();
      if (plan) {
        applyTargetPlan(plan.targets);
        calculate();
      }
      return;
    }
    const button = target?.closest(".plan-picker-button");
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }
    event.stopPropagation();
    const menu = picker.querySelector(".plan-picker-menu");
    if (!(menu instanceof HTMLElement)) {
      return;
    }
    const shouldOpen = menu.hidden;
    closeTargetPlanPickers();
    menu.hidden = !shouldOpen;
  }

  function closeTargetPlanPickers() {
    document.querySelectorAll(".plan-picker-menu").forEach((menu) => {
      if (menu instanceof HTMLElement) {
        menu.hidden = true;
      }
    });
  }

  function applyTargetPlan(targets) {
    const normalized = normalizeTargetSnapshots(targets);
    if (!normalized.length) {
      return;
    }
    suppressStateSave = true;
    targetRows.replaceChildren();
    normalized.forEach((target) => {
      const item = itemsByClass.get(target.itemClass) || null;
      addTargetRow(item, target.rate, { focus: false, save: false });
      const row = targetRows.lastElementChild;
      if (!item && row) {
        row.dataset.itemClass = target.itemClass;
        row.querySelector(".item-input").value = target.itemName;
      }
    });
    suppressStateSave = false;
    updateRemoveButtons();
    activatePlanCacheForCurrentTargets();
    savePlannerState();
  }

  function initializeRecipeSelection(payload) {
    recipeCatalog = {
      materials: Array.isArray(payload?.materials) ? payload.materials : [],
      defaultEnabledRecipeIds: Array.isArray(payload?.defaultEnabledRecipeIds) ? payload.defaultEnabledRecipeIds : [],
      selectableRecipeIds: Array.isArray(payload?.selectableRecipeIds) ? payload.selectableRecipeIds : [],
    };
    const selectable = new Set(recipeCatalog.selectableRecipeIds.map((id) => String(id || "").trim()).filter(Boolean));
    const hasSavedIds = Array.isArray(savedState.enabledRecipeIds);
    const sourceIds = hasSavedIds ? savedState.enabledRecipeIds : recipeCatalog.defaultEnabledRecipeIds;

    selectedRecipeIds.clear();
    sourceIds.forEach((id) => {
      const recipeId = String(id || "").trim();
      if (selectable.has(recipeId)) {
        selectedRecipeIds.add(recipeId);
      }
    });
    disabledRawMaterialClasses.clear();
    (Array.isArray(savedState.disabledRawMaterialClasses) ? savedState.disabledRawMaterialClasses : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .forEach((itemClass) => disabledRawMaterialClasses.add(itemClass));
    updateRecipeFilterButton();
  }

  function selectedRecipeIdsPayload() {
    return Array.from(selectedRecipeIds).sort();
  }

  function disabledRawMaterialClassesPayload() {
    return Array.from(disabledRawMaterialClasses).sort();
  }

  function recipeSelectionSignature() {
    return [
      selectedRecipeIdsPayload().join("|"),
      disabledRawMaterialClassesPayload().join("|"),
    ].join("::");
  }

  function updateRecipeFilterButton() {
    if (!recipeFilterButton) {
      return;
    }
    const total = Array.isArray(recipeCatalog.selectableRecipeIds) ? recipeCatalog.selectableRecipeIds.length : 0;
    recipeFilterButton.textContent = total
      ? `${t("recipes.filter")} ${formatInteger(selectedRecipeIds.size)}/${formatInteger(total)}`
      : t("recipes.filter");
  }

  function defaultRecipeIdSet() {
    return normalizeRecipeIdSet(recipeCatalog.defaultEnabledRecipeIds);
  }

  function selectableRecipeIdList() {
    return normalizedRecipeIdList(recipeCatalog.selectableRecipeIds);
  }

  function selectableRecipeIdSet() {
    return new Set(selectableRecipeIdList());
  }

  function resetToDefaultRecipes() {
    const selectable = selectableRecipeIdSet();
    const defaults = defaultRecipeIdSet();
    selectedRecipeIds.clear();
    defaults.forEach((recipeId) => {
      if (selectable.has(recipeId)) {
        selectedRecipeIds.add(recipeId);
      }
    });
    disabledRawMaterialClasses.clear();
    activePreferredPlan = [];
    storeCurrentPreferredPlan();
  }

  function isDefaultRecipeId(recipeId) {
    return defaultRecipeIdSet().has(String(recipeId || "").trim());
  }

  function selectedOptionalRecipeCount() {
    return selectableRecipeIdList()
      .filter((recipeId) => !isDefaultRecipeId(recipeId) && selectedRecipeIds.has(recipeId))
      .length;
  }

  function isDefaultRecipeSelection() {
    if (activePreferredPlan.length || disabledRawMaterialClasses.size) {
      return false;
    }
    const selectable = selectableRecipeIdSet();
    const defaults = defaultRecipeIdSet();
    if (selectedRecipeIds.size !== Array.from(defaults).filter((recipeId) => selectable.has(recipeId)).length) {
      return false;
    }
    return selectableRecipeIdList().every((recipeId) => selectedRecipeIds.has(recipeId) === defaults.has(recipeId));
  }

  function restoreTargetRows(targets) {
    if (!Array.isArray(targets) || !targets.length) {
      return false;
    }

    suppressStateSave = true;
    targetRows.replaceChildren();
    let restoredCount = 0;
    targets.forEach((target) => {
      if (!target || typeof target !== "object") {
        return;
      }
      const item = itemFromSavedTarget(target);
      const itemName = String(target.itemName || "").trim();
      const rate = target.rate ?? "";
      if (!item && !itemName && rate === "") {
        return;
      }

      addTargetRow(item, rate, { focus: false, save: false });
      const row = targetRows.lastElementChild;
      if (!item && itemName && row) {
        row.querySelector(".item-input").value = itemName;
      }
      restoredCount += 1;
    });
    suppressStateSave = false;
    updateRemoveButtons();
    return restoredCount > 0;
  }

  function itemFromSavedTarget(target) {
    const itemClass = String(target.itemClass || "").trim();
    if (itemClass && itemsByClass.has(itemClass)) {
      return itemsByClass.get(itemClass);
    }

    const itemName = String(target.itemName || "").trim();
    if (!itemName) {
      return null;
    }
    const normalizedName = normalize(itemName);
    const exact = items.find((item) => normalize(item.name) === normalizedName);
    if (exact) {
      return exact;
    }
    const compactName = compact(itemName);
    return items.find((item) => compact(item.name) === compactName) || null;
  }

  function restorePreferredPlanCache(cacheEntries) {
    preferredPlanByTargetKey.clear();
    if (Array.isArray(cacheEntries)) {
      cacheEntries.forEach((entry) => {
        const key = String(entry?.key || "").trim();
        const plan = normalizePreferredPlan(entry?.plan || entry?.preferredPlan);
        if (key && plan.length) {
          preferredPlanByTargetKey.set(key, plan);
        }
      });
      return;
    }

    if (cacheEntries && typeof cacheEntries === "object") {
      Object.entries(cacheEntries).forEach(([key, plan]) => {
        const cleanKey = String(key || "").trim();
        const normalizedPlan = normalizePreferredPlan(plan);
        if (cleanKey && normalizedPlan.length) {
          preferredPlanByTargetKey.set(cleanKey, normalizedPlan);
        }
      });
    }
  }

  function normalizePreferredPlan(planEntries) {
    if (!Array.isArray(planEntries)) {
      return [];
    }
    const byId = new Map();
    planEntries.forEach((entry) => {
      const id = String(typeof entry === "string" ? entry : entry?.id || "").trim();
      if (!id) {
        return;
      }
      const scale = Number(typeof entry === "string" ? 0 : entry?.scale || 0);
      const materialClass = String(typeof entry === "string" ? "" : entry?.materialClass || "").trim();
      byId.set(materialClass || id, {
        id,
        scale: Number.isFinite(scale) && scale > 0 ? roundPlannerNumber(scale) : 0,
        ...(materialClass ? { materialClass } : {}),
      });
    });
    return Array.from(byId.values());
  }

  function activatePlanCacheForCurrentTargets() {
    if (!plannerReady) {
      return;
    }
    const nextKey = currentTargetRecipeSelectionKey();
    if (nextKey === activePlanKey) {
      return;
    }

    storeCurrentPreferredPlan();
    activePlanKey = nextKey;
    activePreferredPlan = [];
    if (!nextKey) {
      return;
    }

    activePreferredPlan = normalizePreferredPlan(preferredPlanByTargetKey.get(nextKey));
  }

  function storeCurrentPreferredPlan() {
    if (!activePlanKey) {
      return;
    }
    const plan = normalizePreferredPlan(activePreferredPlan);
    if (plan.length) {
      preferredPlanByTargetKey.set(activePlanKey, plan);
    } else {
      preferredPlanByTargetKey.delete(activePlanKey);
    }
  }

  function currentTargetRecipeSelectionKey() {
    return collectTargetState()
      .filter((target) => target.itemClass || target.itemName)
      .map((target) => target.itemClass || `name:${compact(target.itemName || "")}`)
      .join("|");
  }

  function restoreRecipeNodePositions(positionEntries) {
    recipeNodePositions.clear();

    if (Array.isArray(positionEntries)) {
      positionEntries.forEach((entry) => {
        const id = String(entry?.id || "").trim();
        const x = Number(entry?.x);
        const y = Number(entry?.y);
        if (id && Number.isFinite(x) && Number.isFinite(y)) {
          recipeNodePositions.set(id, { x, y });
        }
      });
      return;
    }

    if (positionEntries && typeof positionEntries === "object") {
      Object.entries(positionEntries).forEach(([id, value]) => {
        const x = Number(value?.x);
        const y = Number(value?.y);
        if (id && Number.isFinite(x) && Number.isFinite(y)) {
          recipeNodePositions.set(id, { x, y });
        }
      });
    }
  }

  function resetGraphLayout() {
    if (!recipeNodePositions.size) {
      return;
    }
    recipeNodePositions.clear();
    savePlannerState();
    recalculateIfTargetsExist();
  }

  function normalizeRecipeMode(rawMode) {
    const mode = String(rawMode || "").trim();
    if (mode === RECIPE_MODE_BASE || mode === RECIPE_MODE_BEST_EFFICIENCY) {
      return mode;
    }
    return "";
  }

  function currentRecipeMode() {
    const checked = recipeModeInputs.find((input) => input.checked);
    return normalizeRecipeMode(checked?.value) || pendingRecipeMode || RECIPE_MODE_BASE;
  }

  function setRecipeMode(mode) {
    const normalized = normalizeRecipeMode(mode) || RECIPE_MODE_BASE;
    pendingRecipeMode = normalized;
    recipeModeInputs.forEach((input) => {
      input.checked = input.value === normalized;
    });
  }

  function recalculateIfTargetsExist(options = {}) {
    if (collectTargetState().some((target) => target.itemClass || target.itemName || target.rate)) {
      calculate(options);
    }
  }

  function addTargetRow(initialItem = null, initialRate = "1", options = {}) {
    const fragment = targetTemplate.content.cloneNode(true);
    i18n?.applyDocument(fragment);
    const row = fragment.querySelector(".target-row");
    const itemInput = row.querySelector(".item-input");
    const itemInputBox = row.querySelector(".item-input-box");
    const amountInput = row.querySelector(".amount-input");
    const removeButton = row.querySelector(".remove-button");

    if (initialItem) {
      selectItem(row, initialItem);
    }
    amountInput.value = initialRate === "" ? "1" : initialRate;

    const openTargetMaterialPicker = async () => {
      const selection = await window.MaterialPicker.open({
        items,
        title: t("targets.chooseTarget"),
        description: t("targets.chooseTargetHelp"),
        initialId: row.dataset.itemClass || "",
        preferredCategory: "NormalMaterial",
      });
      if (!selection) return;
      selectItem(row, selection.item);
      amountInput.focus();
      savePlannerState();
    };
    itemInputBox.addEventListener("click", openTargetMaterialPicker);
    itemInput.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        openTargetMaterialPicker();
      }
    });
    amountInput.addEventListener("input", handleTargetAmountInput);

    removeButton.addEventListener("click", () => {
      activatePlanCacheForCurrentTargets();
      row.remove();
      updateRemoveButtons();
      activatePlanCacheForCurrentTargets();
      savePlannerState();
    });

    targetRows.appendChild(fragment);
    updateRemoveButtons();
    if (options.focus !== false) {
      itemInput.focus();
    }
    if (options.save !== false) {
      savePlannerState();
    }
  }

  function updateRemoveButtons() {
    const rows = Array.from(targetRows.querySelectorAll(".target-row"));
    rows.forEach((row) => {
      row.querySelector(".remove-button").disabled = rows.length === 1;
    });
  }

  function selectItem(row, item) {
    activatePlanCacheForCurrentTargets();
    row.dataset.itemClass = item.className;
    row.querySelector(".item-input").value = item.name;
    row.querySelector(".item-input-box")?.classList.remove("invalid");
    updateUnitLabel(row, item);
    updateTargetItemIcon(row, item);
    row.dispatchEvent(new CustomEvent("materialselected", {
      bubbles: true,
      detail: { id: item.className, item },
    }));
    activatePlanCacheForCurrentTargets();
  }

  function updateUnitLabel(row, item) {
    row.querySelector(".unit-label").textContent = item ? `${item.unit}/min` : "/ min";
  }

  function updateTargetItemIcon(row, item) {
    const icon = row.querySelector(".target-item-icon");
    if (!icon) {
      return;
    }
    setMaterialIconBackground(icon, item);
  }

  function collectTargets() {
    const rows = Array.from(targetRows.querySelectorAll(".target-row"));
    const targets = [];

    for (const row of rows) {
      const itemInput = row.querySelector(".item-input");
      const amountInput = row.querySelector(".amount-input");
      const rawName = itemInput.value.trim();
      const rawAmount = amountInput.value.trim();

      if (!rawName && !rawAmount) {
        continue;
      }

      const item = selectedRowItem(row);
      if (!item) {
        setStatus(t("status.unmatched", { name: rawName || "empty input" }), true);
        row.querySelector(".item-input-box")?.classList.add("invalid");
        itemInput.focus();
        return [];
      }

      const rate = Number(rawAmount);
      if (!Number.isFinite(rate) || rate <= 0) {
        setStatus(t("status.invalidRate", { name: item.name }), true);
        amountInput.focus();
        return [];
      }

      targets.push({ item, rate });
    }

    if (!targets.length) {
      setStatus(t("status.addTarget"), true);
    }
    return targets;
  }

  function handleTargetAmountInput() {
    savePlannerState();
    tryRenderScaledResultFromInputs();
  }

  function tryRenderScaledResultFromInputs() {
    const targets = targetSnapshotsFromRows();
    if (!targets) {
      return false;
    }
    return tryRenderScaledResultForSnapshots(targets, { updateStatus: true });
  }

  function tryRenderScaledResultForSnapshots(currentTargets, options = {}) {
    if (!lastServerResult) {
      return false;
    }
    if (planSignature() !== lastServerPlanSignature) {
      return false;
    }

    const scaleFactor = targetScaleFactor(lastServerTargets, currentTargets);
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return false;
    }

    const scaledResult = scaledPlannerResult(lastServerResult, scaleFactor, currentTargets);
    renderPlannerResult(scaledResult, { preserveGraphViewport: true });
    activePreferredPlan = normalizePreferredPlan(
      activePreferredPlan.map((entry) => ({ ...entry, scale: Number(entry.scale || 0) * scaleFactor })),
    );
    storeCurrentPreferredPlan();
    lastServerPlanSignature = planSignature();
    if (options.updateStatus) {
      setStatus(t("status.scaled", { factor: formatNumber(scaleFactor) }), false);
    }
    return true;
  }

  function targetSnapshotsFromTargets(targets) {
    return (targets || []).map((target) => ({
      itemClass: target.item.className,
      itemName: target.item.name,
      rate: Number(target.rate),
    }));
  }

  function targetSnapshotsFromRows() {
    const snapshots = [];
    for (const row of Array.from(targetRows.querySelectorAll(".target-row"))) {
      const itemName = row.querySelector(".item-input").value.trim();
      const rawRate = row.querySelector(".amount-input").value.trim();
      if (!itemName && !rawRate) {
        continue;
      }

      const itemClass = String(row.dataset.itemClass || "").trim();
      const item = itemClass ? itemsByClass.get(itemClass) : null;
      const rate = Number(rawRate);
      if (!item || !Number.isFinite(rate) || rate <= 0) {
        return null;
      }
      snapshots.push({
        itemClass: item.className,
        itemName: item.name,
        rate,
      });
    }
    return snapshots.length ? snapshots : null;
  }

  function targetScaleFactor(originalTargets, currentTargets) {
    if (!Array.isArray(originalTargets) || !Array.isArray(currentTargets)) {
      return NaN;
    }
    if (!originalTargets.length || originalTargets.length !== currentTargets.length) {
      return NaN;
    }

    const ratios = [];
    for (let index = 0; index < originalTargets.length; index += 1) {
      const original = originalTargets[index];
      const current = currentTargets[index];
      if (original.itemClass !== current.itemClass || !Number.isFinite(original.rate) || original.rate <= 0) {
        return NaN;
      }
      ratios.push(current.rate / original.rate);
    }

    const firstRatio = ratios[0];
    const tolerance = Math.max(1e-7, Math.abs(firstRatio) * 1e-7);
    return ratios.every((ratio) => Math.abs(ratio - firstRatio) <= tolerance) ? firstRatio : NaN;
  }

  function scaledPlannerResult(baseResult, scaleFactor, currentTargets) {
    const result = clonePlannerResult(baseResult);
    scaleResultRates(result, scaleFactor);
    if (Array.isArray(result.targets)) {
      result.targets.forEach((target, index) => {
        if (currentTargets[index]) {
          target.rate = currentTargets[index].rate;
        }
      });
    }
    return result;
  }

  function scaleResultRates(result, scaleFactor) {
    (result.recipeRuns || []).forEach((run) => scaleRecipeRun(run, scaleFactor));
    (result.materialBalances || []).forEach((balance) => {
      ["produced", "consumed", "external", "targetDemand", "surplus"].forEach((key) => {
        scaleNumberProperty(balance, key, scaleFactor);
      });
    });
    (result.targetAllocations || []).forEach((allocation) => scaleNumberProperty(allocation, "rate", scaleFactor));
    (result.rawTotals || []).forEach((raw) => scaleNumberProperty(raw, "rate", scaleFactor));
    (result.totals || []).forEach((row) => scaleNumberProperty(row, "rate", scaleFactor));
    (result.layers || []).forEach((layer) => {
      (layer.recipeRuns || []).forEach((run) => scaleRecipeRun(run, scaleFactor));
      (layer.rawItems || []).forEach((raw) => scaleNumberProperty(raw, "rate", scaleFactor));
    });
    (result.preferredPlan || []).forEach((entry) => scaleNumberProperty(entry, "scale", scaleFactor));
    if (result.summary) {
      scaleNumberProperty(result.summary, "objectiveValue", scaleFactor);
      scaleNumberProperty(result.summary, "secondaryObjectiveValue", scaleFactor);
    }
  }

  function scaleRecipeRun(run, scaleFactor) {
    scaleNumberProperty(run, "scale", scaleFactor);
    (run.inputs || []).forEach((item) => scaleNumberProperty(item, "rate", scaleFactor));
    (run.outputs || []).forEach((item) => scaleNumberProperty(item, "rate", scaleFactor));
  }

  function scaleNumberProperty(object, key, scaleFactor) {
    if (!object || !(key in object)) {
      return;
    }
    const number = Number(object[key]);
    if (!Number.isFinite(number)) {
      return;
    }
    object[key] = roundedScaledNumber(number * scaleFactor);
  }

  function roundedScaledNumber(value) {
    if (!Number.isFinite(value)) {
      return value;
    }
    if (Math.abs(value) < 1e-10) {
      return 0;
    }
    return Number(value.toPrecision(12));
  }

  function roundPlannerNumber(value) {
    return roundedScaledNumber(value);
  }

  function clonePlannerResult(result) {
    return JSON.parse(JSON.stringify(result || {}));
  }

  function planSignature() {
    return recipeSelectionSignature();
  }

  function selectedRowItem(row) {
    const selectedClass = row.dataset.itemClass;
    if (selectedClass && itemsByClass.has(selectedClass)) {
      return itemsByClass.get(selectedClass);
    }

    const typed = row.querySelector(".item-input").value.trim();
    const normalizedTyped = normalize(typed);
    if (!normalizedTyped) {
      return null;
    }
    const exact = items.find((item) => normalize(item.name) === normalizedTyped);
    if (exact) {
      selectItem(row, exact);
      return exact;
    }
    const compactTyped = compact(typed);
    const compactExact = items.find((item) => compact(item.name) === compactTyped);
    if (compactExact) {
      selectItem(row, compactExact);
      return compactExact;
    }
    return null;
  }

  function renderGraphView(result, options = {}) {
    const graph = buildFlowGraph(result);
    if (!graph.nodes.length) {
      treeView.replaceChildren(makeEmptyMessage(t("results.noTarget")));
      return;
    }

    const scrollState = options.preserveViewport ? graphViewportScrollState() : null;
    const viewport = renderFlowGraph(graph);
    treeView.replaceChildren(viewport);
    fitGraphViewportHeight(viewport);
    restoreGraphViewportScroll(viewport, scrollState);
  }

  function graphViewportScrollState() {
    const viewport = treeView.querySelector(".graph-viewport");
    if (!(viewport instanceof HTMLElement)) {
      return null;
    }
    return {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
  }

  function restoreGraphViewportScroll(viewport, scrollState) {
    if (!scrollState) {
      return;
    }
    viewport.scrollLeft = scrollState.left;
    viewport.scrollTop = scrollState.top;
  }

  function fitCurrentGraphViewportHeight() {
    const viewport = treeView.querySelector(".graph-viewport");
    if (viewport instanceof HTMLElement) {
      fitGraphViewportHeight(viewport);
    }
  }

  function fitGraphViewportHeight(viewport) {
    if (treeView.classList.contains("hidden")) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const availableHeight = window.innerHeight - rect.top - GRAPH_VIEWPORT_BOTTOM_GAP;
    const height = Math.max(GRAPH_VIEWPORT_MIN_HEIGHT, Math.floor(availableHeight));
    viewport.style.height = `${height}px`;
  }

  function handleWindowResize() {
    fitCurrentGraphViewportHeight();
  }

  function buildFlowGraph(result) {
    const recipeRuns = result.recipeRuns || [];
    const targets = result.targets || [];
    const targetAllocations = graphTargetAllocations(result, targets);
    const rawTotals = result.rawTotals || [];
    const balances = result.materialBalances || [];
    const balanceByClass = new Map(balances.map((balance) => [balance.item.className, balance]));
    const nodes = new Map();
    const producersByMaterial = new Map();
    const consumersByMaterial = new Map();
    const recipeColumns = recipeColumnsFromLayers(result.layers || [], recipeRuns);
    const recipeColumnMax = Math.max(1, ...Array.from(recipeColumns.values(), (value) => value));

    rawTotals.forEach((raw) => {
      const rate = Number(raw.rate);
      if (!isPositive(rate)) return;
      const node = addGraphNode(nodes, {
        id: `raw:${raw.item.className}`,
        type: "raw",
        column: 0,
        title: raw.item.name,
        meta: `${formatNumber(rate)} ${raw.item.unit}/min`,
        item: raw.item,
        recipeSwitch: rawRecipeSwitch(raw),
        edgeColor: "rgb(45, 126, 192)",
      });
      addEndpoint(producersByMaterial, raw.item.className, {
        nodeId: node.id,
        item: raw.item,
        rate,
        remaining: rate,
        sourceScale: rate,
      });
    });

    recipeRuns.forEach((run) => {
      const color = recipeColor(recipeColorKeyForRun(run));
      const node = addGraphNode(nodes, {
        id: run.id,
        type: "recipe",
        column: recipeColumns.get(run.id) || 1,
        title: run.recipe.name,
        meta: `x ${formatMultiplier(run.scale)}`,
        alternate: Boolean(run.recipe.isAlternate),
        recipe: {
          ...run.recipe,
          currentScale: Number(run.scale || 0),
          currentInputs: run.inputs || [],
          currentOutputs: run.outputs || [],
        },
        fillColor: color.fill,
        borderColor: color.border,
        edgeColor: color.edge,
      });

      (run.outputs || []).forEach((output) => {
        const rate = Number(output.rate);
        if (!isPositive(rate)) return;
        addEndpoint(producersByMaterial, output.item.className, {
          nodeId: node.id,
          item: output.item,
          rate,
          remaining: rate,
          sourceScale: Number(run.scale || 0),
          byproduct: output.role === "byproduct",
        });
      });

      (run.inputs || []).forEach((input) => {
        const rate = Number(input.rate);
        if (!isPositive(rate)) return;
        addEndpoint(consumersByMaterial, input.item.className, {
          nodeId: node.id,
          item: input.item,
          rate,
          remaining: rate,
        });
      });
    });

    targetAllocations.forEach((target, index) => {
      const rate = Number(target.rate);
      const targetItem = target.targetItem || target.item;
      const flowItem = target.item || targetItem;
      if (!targetItem || !flowItem) return;
      if (!isPositive(rate)) return;
      const isAggregateTarget = targetItem.className !== flowItem.className;
      const node = addGraphNode(nodes, {
        id: `target:${index}:${targetItem.className}:${flowItem.className}`,
        type: "target",
        column: recipeColumnMax + 1,
        title: targetItem.name,
        meta: isAggregateTarget
          ? `${formatNumber(rate)} ${targetItem.unit}/min via ${flowItem.name}`
          : `${formatNumber(rate)} ${targetItem.unit}/min`,
        item: targetItem,
      });
      addEndpoint(consumersByMaterial, flowItem.className, {
        nodeId: node.id,
        item: flowItem,
        rate,
        remaining: rate,
      });
    });

    balances.forEach((balance) => {
      const surplus = Number(balance.surplus);
      if (!isPositive(surplus)) return;
      const node = addGraphNode(nodes, {
        id: `surplus:${balance.item.className}`,
        type: "surplus",
        column: recipeColumnMax + 1,
        title: balance.item.name,
        meta: `${formatNumber(surplus)} ${balance.item.unit}/min`,
        item: balance.item,
      });
      addEndpoint(consumersByMaterial, balance.item.className, {
        nodeId: node.id,
        item: balance.item,
        rate: surplus,
        remaining: surplus,
      });
    });

    const edges = allocateGraphEdges(producersByMaterial, consumersByMaterial, nodes);
    const laidOut = layoutFlowGraph(Array.from(nodes.values()), edges, balanceByClass);
    return {
      ...laidOut,
      edges,
      balanceByClass,
    };
  }

  function rawRecipeSwitch(raw) {
    const options = Array.isArray(raw?.replacementOptions) ? raw.replacementOptions : [];
    if (!raw?.item?.className || options.length <= 1) {
      return null;
    }
    return {
      id: String(raw.selectedRecipeId || raw.defaultRecipeId || DIRECT_RAW_RECIPE_ID),
      name: raw.item.name || raw.item.className,
      primaryOutput: raw.item,
      currentScale: Number(raw.rate || 0),
      currentInputs: [],
      currentOutputs: [
        {
          item: raw.item,
          rate: Number(raw.rate || 0),
          unit: raw.item.unit,
          role: "output",
        },
      ],
      replacementOptions: options,
    };
  }

  function materialCategoryText(item, fallback = "") {
    const category = String(item?.materialCategory || "").trim();
    return category ? t(`category.${category}`) : String(fallback || "").trim();
  }

  function materialIconPath(item) {
    return String(item?.iconPath || "").trim();
  }

  function setMaterialIconBackground(element, item) {
    const iconPath = materialIconPath(item);
    element.classList.toggle("empty", !iconPath);
    element.style.backgroundImage = iconPath ? `url("${cssUrl(iconPath)}")` : "";
    element.title = iconPath ? (item?.name || item?.className || "") : "";
  }

  function makeMaterialIcon(item, className = "material-icon") {
    const icon = document.createElement("span");
    icon.className = className;
    icon.setAttribute("aria-hidden", "true");
    setMaterialIconBackground(icon, item);
    return icon;
  }

  function cssUrl(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function graphTargetAllocations(result, targets) {
    if (Array.isArray(result.targetAllocations) && result.targetAllocations.length) {
      return result.targetAllocations;
    }
    return (targets || []).map((target) => ({
      targetItem: target.item,
      item: target.item,
      rate: target.rate,
      kind: "direct",
    }));
  }

  function recipeColumnsFromLayers(layers, recipeRuns) {
    const columns = new Map();
    const recipeLayers = (layers || []).filter((layer) => layer.kind !== "raw" && Array.isArray(layer.recipeRuns));
    const reversed = [...recipeLayers].reverse();
    reversed.forEach((layer, layerIndex) => {
      (layer.recipeRuns || []).forEach((run) => {
        columns.set(run.id, layerIndex + 1);
      });
    });
    recipeRuns.forEach((run) => {
      if (!columns.has(run.id)) {
        columns.set(run.id, 1);
      }
    });
    return columns;
  }

  function addGraphNode(nodes, node) {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
    return nodes.get(node.id);
  }

  function addEndpoint(map, itemClass, endpoint) {
    if (!map.has(itemClass)) {
      map.set(itemClass, []);
    }
    map.get(itemClass).push(endpoint);
  }

  function allocateGraphEdges(producersByMaterial, consumersByMaterial, nodes) {
    const edges = [];
    const dependencyInfo = buildRecipeDependencyInfo(producersByMaterial, consumersByMaterial, nodes);
    const materialClasses = new Set([...producersByMaterial.keys(), ...consumersByMaterial.keys()]);
    materialClasses.forEach((itemClass) => {
      const producers = (producersByMaterial.get(itemClass) || []).map((entry, order) => ({ ...entry, order }));
      const consumers = (consumersByMaterial.get(itemClass) || []).map((entry, order) => ({ ...entry, order }));

      while (true) {
        const candidate = bestGraphEdgeAllocationCandidate(producers, consumers, nodes, dependencyInfo);
        if (!candidate) {
          break;
        }
        const { producer, consumer } = candidate;
        const rate = Math.min(producer.remaining, consumer.remaining);

        if (isPositive(rate) && producer.nodeId !== consumer.nodeId) {
          const sourceNode = nodes.get(producer.nodeId);
          edges.push({
            id: `edge:${edges.length}`,
            source: producer.nodeId,
            target: consumer.nodeId,
            item: producer.item || consumer.item,
            rate,
            scale: graphEdgeAllocatedScale(producer, rate),
            showScale: graphEdgeShowsScale(sourceNode),
            byproduct: Boolean(producer.byproduct),
            color: materialColor(itemClass),
          });
        }

        producer.remaining -= rate;
        consumer.remaining -= rate;
      }
    });
    return edges;
  }

  function graphEdgeAllocatedScale(producer, rate) {
    const sourceScale = Number(producer.sourceScale);
    const sourceRate = Number(producer.rate);
    const edgeRate = Number(rate);
    if (!isPositive(sourceScale) || !isPositive(sourceRate) || !isPositive(edgeRate)) {
      return 0;
    }
    return sourceScale * (edgeRate / sourceRate);
  }

  function graphEdgeShowsScale(sourceNode) {
    return sourceNode?.type !== "raw";
  }

  function bestGraphEdgeAllocationCandidate(producers, consumers, nodes, dependencyInfo) {
    let best = null;
    producers.forEach((producer) => {
      if (!isPositive(Number(producer.remaining))) {
        return;
      }
      consumers.forEach((consumer) => {
        if (!isPositive(Number(consumer.remaining))) {
          return;
        }
        const cost = graphEdgeAllocationCost(producer, consumer, nodes, dependencyInfo);
        const rate = Math.min(Number(producer.remaining), Number(consumer.remaining));
        const candidate = {
          producer,
          consumer,
          cost,
          rate,
          orderScore: Number(producer.order || 0) + Number(consumer.order || 0),
        };
        if (!best || compareGraphEdgeAllocationCandidate(candidate, best) < 0) {
          best = candidate;
        }
      });
    });
    return best;
  }

  function compareGraphEdgeAllocationCandidate(left, right) {
    if (left.cost !== right.cost) {
      return left.cost - right.cost;
    }
    if (left.rate !== right.rate) {
      return right.rate - left.rate;
    }
    if (left.orderScore !== right.orderScore) {
      return left.orderScore - right.orderScore;
    }
    if (left.producer.order !== right.producer.order) {
      return left.producer.order - right.producer.order;
    }
    return left.consumer.order - right.consumer.order;
  }

  function graphEdgeAllocationCost(producer, consumer, nodes, dependencyInfo) {
    const source = nodes.get(producer.nodeId);
    const target = nodes.get(consumer.nodeId);
    if (!source || !target) {
      return 100000;
    }
    if (source.id === target.id) {
      return -100000;
    }

    const layerGap = Math.abs(Number(source.column || 0) - Number(target.column || 0));
    const sourceIsRecipe = source.type === "recipe";
    const targetIsRecipe = target.type === "recipe";
    const targetIsSurplus = target.type === "surplus";
    const targetIsFinal = target.type === "target";
    if (targetIsSurplus) {
      return 9000 + layerGap;
    }

    if (sourceIsRecipe && producer.byproduct) {
      if (targetIsRecipe) {
        const upstreamDistance = dependencyInfo.distance(target.id, source.id);
        if (Number.isFinite(upstreamDistance)) {
          return upstreamDistance;
        }
        const downstreamDistance = dependencyInfo.distance(source.id, target.id);
        if (Number.isFinite(downstreamDistance)) {
          return 100 + downstreamDistance;
        }
        return 240 + layerGap;
      }
      if (targetIsFinal) {
        return 260 + layerGap;
      }
      return 300 + layerGap;
    }

    if (sourceIsRecipe) {
      if (targetIsRecipe) {
        const downstreamDistance = dependencyInfo.distance(source.id, target.id);
        if (Number.isFinite(downstreamDistance)) {
          return 400 + downstreamDistance;
        }
        const upstreamDistance = dependencyInfo.distance(target.id, source.id);
        if (Number.isFinite(upstreamDistance)) {
          return 520 + upstreamDistance;
        }
        return 560 + layerGap;
      }
      if (targetIsFinal) {
        return 420 + layerGap;
      }
      return 600 + layerGap;
    }

    if (source.type === "raw") {
      return 700 + layerGap;
    }
    return 800 + layerGap;
  }

  function buildRecipeDependencyInfo(producersByMaterial, consumersByMaterial, nodes) {
    const recipeIds = new Set(
      Array.from(nodes.values())
        .filter((node) => node.type === "recipe")
        .map((node) => node.id),
    );
    const adjacency = new Map(Array.from(recipeIds, (recipeId) => [recipeId, new Set()]));
    const materialClasses = new Set([...producersByMaterial.keys(), ...consumersByMaterial.keys()]);
    materialClasses.forEach((itemClass) => {
      const producers = producersByMaterial.get(itemClass) || [];
      const consumers = consumersByMaterial.get(itemClass) || [];
      producers.forEach((producer) => {
        // Byproducts are excluded here so they do not make every possible consumer look downstream.
        if (producer.byproduct || !recipeIds.has(producer.nodeId)) {
          return;
        }
        consumers.forEach((consumer) => {
          if (producer.nodeId !== consumer.nodeId && recipeIds.has(consumer.nodeId)) {
            adjacency.get(producer.nodeId)?.add(consumer.nodeId);
          }
        });
      });
    });

    const distanceCache = new Map();
    const distance = (sourceId, targetId) => {
      if (sourceId === targetId) {
        return 0;
      }
      if (!recipeIds.has(sourceId) || !recipeIds.has(targetId)) {
        return Number.POSITIVE_INFINITY;
      }
      const cacheKey = `${sourceId}\n${targetId}`;
      if (distanceCache.has(cacheKey)) {
        return distanceCache.get(cacheKey);
      }
      const queue = [{ id: sourceId, distance: 0 }];
      const visited = new Set([sourceId]);
      while (queue.length) {
        const current = queue.shift();
        for (const nextId of adjacency.get(current.id) || []) {
          if (visited.has(nextId)) {
            continue;
          }
          const nextDistance = current.distance + 1;
          if (nextId === targetId) {
            distanceCache.set(cacheKey, nextDistance);
            return nextDistance;
          }
          visited.add(nextId);
          queue.push({ id: nextId, distance: nextDistance });
        }
      }
      distanceCache.set(cacheKey, Number.POSITIVE_INFINITY);
      return Number.POSITIVE_INFINITY;
    };

    return { distance };
  }

  function layoutFlowGraph(nodes, edges, balanceByClass) {
    const constants = {
      marginX: 28,
      marginY: 26,
      nodeWidth: 208,
      nodeHeight: 108,
      columnGap: 285,
      rowGap: 42,
      minHeight: 560,
    };
    assignDependencyColumns(nodes, edges);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    edges.forEach((edge) => {
      edge.width = GRAPH_FLOW_WIDTH;
      edge.color = edgeColor(edge, nodeById);
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      edge.feedback = Boolean(source && target && source.column >= target.column);
    });

    const columns = new Map();
    nodes.forEach((node) => {
      if (!columns.has(node.column)) {
        columns.set(node.column, []);
      }
      columns.get(node.column).push(node);
    });

    const sortedColumns = Array.from(columns.keys()).sort((a, b) => a - b);
    sortGraphColumns(columns, sortedColumns, edges, nodeById, balanceByClass);
    let maxColumnHeight = 0;
    sortedColumns.forEach((column) => {
      const columnNodes = columns.get(column);
      const columnHeight = columnNodes.length * constants.nodeHeight + Math.max(0, columnNodes.length - 1) * constants.rowGap;
      maxColumnHeight = Math.max(maxColumnHeight, columnHeight);
      columnNodes.forEach((node, index) => {
        node.x = constants.marginX + column * (constants.nodeWidth + constants.columnGap);
        node.y = constants.marginY + index * (constants.nodeHeight + constants.rowGap);
        node.width = constants.nodeWidth;
        node.height = constants.nodeHeight;
      });
    });
    applySavedRecipeNodePositions(nodes);

    const maxColumn = Math.max(0, ...sortedColumns);
    const autoWidth = constants.marginX * 2 + constants.nodeWidth + maxColumn * (constants.nodeWidth + constants.columnGap);
    const autoHeight = Math.max(constants.minHeight, constants.marginY * 2 + maxColumnHeight);
    const { width, height } = graphExtents(nodes, autoWidth, autoHeight);

    refreshEdgeFeedback(edges, nodeById);
    routeEdges(edges, nodeById);
    return { nodes, width, height, nodeById };
  }

  function applySavedRecipeNodePositions(nodes) {
    nodes.forEach((node) => {
      if (node.type !== "recipe") {
        return;
      }
      const position = recipeNodePositions.get(node.id);
      if (!position) {
        return;
      }
      const x = Number(position.x);
      const y = Number(position.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        node.x = Math.max(0, x);
        node.y = Math.max(0, y);
      }
    });
  }

  function graphExtents(nodes, minWidth, minHeight) {
    const padding = 56;
    const maxRight = Math.max(0, ...nodes.map((node) => Number(node.x) + Number(node.width) + padding));
    const maxBottom = Math.max(0, ...nodes.map((node) => Number(node.y) + Number(node.height) + padding));
    return {
      width: Math.ceil(Math.max(minWidth, maxRight)),
      height: Math.ceil(Math.max(minHeight, maxBottom)),
    };
  }

  function refreshEdgeFeedback(edges, nodeById) {
    edges.forEach((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      edge.feedback = Boolean(source && target && source.x >= target.x);
      edge.pathElement?.setAttribute("class", `graph-flow${edge.feedback ? " feedback" : ""}`);
    });
  }

  function assignDependencyColumns(nodes, edges) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const recipeNodes = nodes.filter((node) => node.type === "recipe");
    const recipeIds = new Set(recipeNodes.map((node) => node.id));
    const adjacency = new Map(recipeNodes.map((node) => [node.id, []]));
    const primaryOutputRecipeEdges = edges.filter(
      (edge) => !edge.byproduct && recipeIds.has(edge.source) && recipeIds.has(edge.target),
    );

    primaryOutputRecipeEdges.forEach((edge) => {
      adjacency.get(edge.source).push(edge.target);
    });

    const components = stronglyConnectedComponents(recipeNodes.map((node) => node.id), adjacency);
    const componentByNode = new Map();
    components.forEach((component, index) => {
      component.forEach((nodeId) => componentByNode.set(nodeId, index));
    });

    const componentEdges = new Map(components.map((_component, index) => [index, new Set()]));
    primaryOutputRecipeEdges.forEach((edge) => {
      const sourceComponent = componentByNode.get(edge.source);
      const targetComponent = componentByNode.get(edge.target);
      if (sourceComponent !== targetComponent) {
        componentEdges.get(sourceComponent).add(targetComponent);
      }
    });

    const componentColumns = new Array(components.length).fill(1);
    for (let pass = 0; pass < components.length; pass += 1) {
      let changed = false;
      componentEdges.forEach((targets, sourceComponent) => {
        targets.forEach((targetComponent) => {
          const nextColumn = componentColumns[sourceComponent] + 1;
          if (nextColumn > componentColumns[targetComponent]) {
            componentColumns[targetComponent] = nextColumn;
            changed = true;
          }
        });
      });
      if (!changed) {
        break;
      }
    }

    recipeNodes.forEach((node) => {
      const componentIndex = componentByNode.get(node.id);
      const component = components[componentIndex] || [];
      node.column = componentColumns[componentIndex] || 1;
      node.cycleGroup = component.length > 1;
    });

    const maxRecipeColumn = Math.max(0, ...recipeNodes.map((node) => node.column));
    nodes.forEach((node) => {
      if (node.type === "raw") {
        node.column = 0;
      } else if (node.type === "target" || node.type === "surplus") {
        node.column = maxRecipeColumn + 1;
      }
    });
  }

  function stronglyConnectedComponents(nodeIds, adjacency) {
    const indexByNode = new Map();
    const lowLinkByNode = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    let index = 0;

    function visit(nodeId) {
      indexByNode.set(nodeId, index);
      lowLinkByNode.set(nodeId, index);
      index += 1;
      stack.push(nodeId);
      onStack.add(nodeId);

      (adjacency.get(nodeId) || []).forEach((targetId) => {
        if (!indexByNode.has(targetId)) {
          visit(targetId);
          lowLinkByNode.set(nodeId, Math.min(lowLinkByNode.get(nodeId), lowLinkByNode.get(targetId)));
        } else if (onStack.has(targetId)) {
          lowLinkByNode.set(nodeId, Math.min(lowLinkByNode.get(nodeId), indexByNode.get(targetId)));
        }
      });

      if (lowLinkByNode.get(nodeId) === indexByNode.get(nodeId)) {
        const component = [];
        let current = null;
        do {
          current = stack.pop();
          onStack.delete(current);
          component.push(current);
        } while (current !== nodeId);
        components.push(component);
      }
    }

    nodeIds.forEach((nodeId) => {
      if (!indexByNode.has(nodeId)) {
        visit(nodeId);
      }
    });
    return components;
  }

  function sortGraphColumns(columns, sortedColumns, edges, nodeById, balanceByClass) {
    sortedColumns.forEach((column) => {
      columns.get(column).sort((a, b) => graphNodeSortKey(a, balanceByClass).localeCompare(graphNodeSortKey(b, balanceByClass)));
    });

    let bestOrder = snapshotColumnOrder(columns, sortedColumns);
    let bestScore = graphLayoutOrderScore(edges, nodeById, columns);
    for (let pass = 0; pass < 10; pass += 1) {
      sortColumnsByNeighborScores(columns, sortedColumns, edges, nodeById, balanceByClass, "incoming");
      let score = graphLayoutOrderScore(edges, nodeById, columns);
      if (score < bestScore) {
        bestScore = score;
        bestOrder = snapshotColumnOrder(columns, sortedColumns);
      }

      sortColumnsByNeighborScores(columns, [...sortedColumns].reverse(), edges, nodeById, balanceByClass, "outgoing");
      score = graphLayoutOrderScore(edges, nodeById, columns);
      if (score < bestScore) {
        bestScore = score;
        bestOrder = snapshotColumnOrder(columns, sortedColumns);
      }
    }
    restoreColumnOrder(columns, bestOrder, nodeById);
  }

  function sortColumnsByNeighborScores(columns, orderedColumns, edges, nodeById, balanceByClass, direction) {
    orderedColumns.forEach((column) => {
      const columnNodes = columns.get(column) || [];
      if (columnNodes.length <= 1) {
        return;
      }
      const rank = graphColumnRank(columns);
      columnNodes.sort((a, b) => {
        const scoreA = neighborOrderScore(a, edges, nodeById, rank, direction);
        const scoreB = neighborOrderScore(b, edges, nodeById, rank, direction);
        if (scoreA.hasNeighbors !== scoreB.hasNeighbors) {
          return scoreA.hasNeighbors ? -1 : 1;
        }
        if (scoreA.value !== scoreB.value) {
          return scoreA.value - scoreB.value;
        }
        const currentRankA = rank.get(a.id) ?? 0;
        const currentRankB = rank.get(b.id) ?? 0;
        if (currentRankA !== currentRankB) {
          return currentRankA - currentRankB;
        }
        return graphNodeSortKey(a, balanceByClass).localeCompare(graphNodeSortKey(b, balanceByClass));
      });
    });
  }

  function neighborOrderScore(node, edges, nodeById, rank, direction) {
    const neighbors = [];
    edges.forEach((edge) => {
      if (direction === "incoming" && edge.target === node.id) {
        const source = nodeById.get(edge.source);
        if (source && source.column < node.column) {
          neighbors.push({
            rank: rank.get(source.id) ?? 0,
            weight: graphLayoutEdgeWeight(edge),
          });
        }
      } else if (direction === "outgoing" && edge.source === node.id) {
        const target = nodeById.get(edge.target);
        if (target && target.column > node.column) {
          neighbors.push({
            rank: rank.get(target.id) ?? 0,
            weight: graphLayoutEdgeWeight(edge),
          });
        }
      }
    });
    if (!neighbors.length) {
      return { hasNeighbors: false, value: Number.POSITIVE_INFINITY };
    }
    const totalWeight = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
    const average = neighbors.reduce((sum, neighbor) => sum + neighbor.rank * neighbor.weight, 0) / totalWeight;
    const median = weightedMedianRank(neighbors, totalWeight);
    return {
      hasNeighbors: true,
      value: median * 0.65 + average * 0.35,
    };
  }

  function weightedMedianRank(entries, totalWeight = null) {
    const sorted = [...entries].sort((a, b) => a.rank - b.rank);
    const midpoint = (totalWeight ?? sorted.reduce((sum, entry) => sum + entry.weight, 0)) / 2;
    let running = 0;
    for (const entry of sorted) {
      running += entry.weight;
      if (running >= midpoint) {
        return entry.rank;
      }
    }
    return sorted[sorted.length - 1]?.rank ?? 0;
  }

  function graphLayoutEdgeWeight(edge) {
    const rate = Number(edge?.rate);
    const base = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const weighted = Math.sqrt(base);
    return Math.max(1, Math.min(32, weighted)) * (edge?.byproduct ? 0.75 : 1);
  }

  function graphColumnRank(columns) {
    const rank = new Map();
    columns.forEach((nodesInColumn) => {
      nodesInColumn.forEach((node, index) => rank.set(node.id, index));
    });
    return rank;
  }

  function graphLayoutOrderScore(edges, nodeById, columns) {
    const rank = graphColumnRank(columns);
    const forwardEdges = [];
    let weightedDistance = 0;
    edges.forEach((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target || source.column >= target.column) {
        return;
      }
      const sourceRank = rank.get(source.id) ?? 0;
      const targetRank = rank.get(target.id) ?? 0;
      const weight = graphLayoutEdgeWeight(edge);
      const span = Math.max(1, target.column - source.column);
      weightedDistance += weight * Math.abs(sourceRank - targetRank) * (1 + (span - 1) * 0.12);
      forwardEdges.push({
        source: source.id,
        target: target.id,
        sourceColumn: source.column,
        targetColumn: target.column,
        sourceRank,
        targetRank,
        weight,
      });
    });

    let crossings = 0;
    for (let leftIndex = 0; leftIndex < forwardEdges.length; leftIndex += 1) {
      const left = forwardEdges[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < forwardEdges.length; rightIndex += 1) {
        const right = forwardEdges[rightIndex];
        if (
          left.source === right.source
          || left.target === right.target
          || left.sourceColumn !== right.sourceColumn
          || left.targetColumn !== right.targetColumn
        ) {
          continue;
        }
        const sourceOrder = left.sourceRank - right.sourceRank;
        const targetOrder = left.targetRank - right.targetRank;
        if (sourceOrder * targetOrder < 0) {
          crossings += Math.sqrt(left.weight * right.weight);
        }
      }
    }
    return crossings * 1000 + weightedDistance;
  }

  function snapshotColumnOrder(columns, sortedColumns) {
    return new Map(sortedColumns.map((column) => [
      column,
      (columns.get(column) || []).map((node) => node.id),
    ]));
  }

  function restoreColumnOrder(columns, order, nodeById) {
    order.forEach((nodeIds, column) => {
      columns.set(column, nodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean));
    });
  }

  function routeEdges(edges, nodeById) {
    const outgoing = new Map();
    const incoming = new Map();
    edges.forEach((edge) => {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      outgoing.get(edge.source).push(edge);
      incoming.get(edge.target).push(edge);
    });

    for (const group of outgoing.values()) {
      group.sort((a, b) => {
        const targetA = nodeById.get(a.target);
        const targetB = nodeById.get(b.target);
        return (targetA?.y || 0) - (targetB?.y || 0);
      });
      assignEdgeOffsets(group, "source");
    }
    for (const group of incoming.values()) {
      group.sort((a, b) => {
        const sourceA = nodeById.get(a.source);
        const sourceB = nodeById.get(b.source);
        return (sourceA?.y || 0) - (sourceB?.y || 0);
      });
      assignEdgeOffsets(group, "target");
    }

    edges.forEach((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return;
      edge.x1 = source.x + source.width;
      edge.y1 = source.y + source.height / 2 + edge.sourceOffset;
      edge.x2 = target.x;
      edge.y2 = target.y + target.height / 2 + edge.targetOffset;
      positionEdgeLabel(edge);
    });
  }

  function assignEdgeOffsets(edges, side) {
    const gap = 3;
    const total = edges.reduce((sum, edge) => sum + edge.width, 0) + Math.max(0, edges.length - 1) * gap;
    let cursor = -total / 2;
    edges.forEach((edge) => {
      const offset = cursor + edge.width / 2;
      edge[`${side}Offset`] = offset;
      cursor += edge.width + gap;
    });
  }

  function renderFlowGraph(graph) {
    const viewport = document.createElement("div");
    viewport.className = "graph-viewport";

    const canvas = document.createElement("div");
    canvas.className = "graph-canvas";
    canvas.style.width = `${graph.width}px`;
    canvas.style.height = `${graph.height}px`;
    graph.canvas = canvas;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "graph-svg");
    svg.setAttribute("width", String(graph.width));
    svg.setAttribute("height", String(graph.height));
    svg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);
    graph.svg = svg;

    const highlightSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    highlightSvg.setAttribute("class", "graph-svg graph-highlight-svg");
    highlightSvg.setAttribute("width", String(graph.width));
    highlightSvg.setAttribute("height", String(graph.height));
    highlightSvg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);
    graph.highlightSvg = highlightSvg;
    graph.baseWidth = graph.width;
    graph.baseHeight = graph.height;
    graph.selectedNodeId = selectedGraphRecipeId;

    graph.edges.forEach((edge) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", `graph-flow${edge.feedback ? " feedback" : ""}`);
      path.setAttribute("d", edgePath(edge));
      path.setAttribute("stroke", edge.color);
      path.setAttribute("stroke-width", String(edge.width));
      edge.pathElement = path;
      svg.appendChild(path);
    });
    canvas.appendChild(svg);
    canvas.appendChild(highlightSvg);

    graph.edges.forEach((edge) => {
      if (!edge.x1 && !edge.x2) return;
      const label = renderEdgeLabel(edge);
      edge.labelElement = label;
      canvas.appendChild(label);
    });

    graph.nodes.forEach((node) => {
      const element = renderGraphNode(node, graph);
      node.element = element;
      canvas.appendChild(element);
    });

    viewport.appendChild(canvas);
    bindGraphSelectionClear(viewport, graph);
    bindGraphPan(viewport);
    applyGraphSelection(graph, selectedGraphRecipeId);
    return viewport;
  }

  function renderGraphNode(node, graph) {
    const switchRecipe = graphNodeSwitchRecipe(node);
    const hasRecipeFilterShortcut = node.type === "recipe";
    const hasSwitchButton = hasRecipeFilterShortcut || canSwitchRecipe(switchRecipe);
    const recipeMaterial = hasRecipeFilterShortcut
      ? ((node.recipe?.currentOutputs || [])[0]?.item || node.recipe?.primaryOutput)
      : switchRecipe?.primaryOutput;
    const card = document.createElement("article");
    card.className = `graph-node ${node.type}${node.alternate ? " alternate" : ""}`;
    card.dataset.nodeId = node.id;
    card.draggable = false;
    card.addEventListener("dragstart", (event) => event.preventDefault());
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button, .graph-drag-zone, .graph-drag-handle")) {
        return;
      }
      event.stopPropagation();
      selectGraphNode(graph, node.id);
    });
    if (node.type === "recipe") {
      card.classList.add("draggable");
    }
    if (hasSwitchButton) {
      card.classList.add("has-switch-button");
    }
    if (graphNodeHasCheck(node)) {
      card.classList.add("has-graph-check");
    }
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.width}px`;
    card.style.height = `${node.height}px`;
    if (node.fillColor) {
      card.style.background = node.fillColor;
    }
    if (node.borderColor) {
      card.style.borderColor = node.borderColor;
    }

    if (hasSwitchButton) {
      const switchButton = document.createElement("button");
      switchButton.type = "button";
      switchButton.className = "switch-recipe-button";
      switchButton.textContent = "R";
      switchButton.title = "Show this material in the recipe filter";
      switchButton.setAttribute("aria-label", `Show recipes for ${recipeMaterial?.name || node.title}`);
      switchButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openRecipeFilterDialog({ materialClass: recipeMaterial?.className || "" });
      });
      card.appendChild(switchButton);
    }

    if (graphNodeHasCheck(node)) {
      const checkLabel = document.createElement("label");
      checkLabel.className = "graph-check-control";
      checkLabel.title = `Mark this ${graphNodeCheckLabel(node)} as checked`;
      checkLabel.addEventListener("click", (event) => event.stopPropagation());
      checkLabel.addEventListener("pointerdown", (event) => event.stopPropagation());

      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      checkInput.className = "graph-check-input";
      checkInput.setAttribute("aria-label", `Mark ${node.title || graphNodeCheckLabel(node)} as checked`);
      checkLabel.appendChild(checkInput);
      card.appendChild(checkLabel);
    }

    let media = null;
    if (node.type === "recipe") {
      media = document.createElement("div");
      media.className = "graph-node-media graph-drag-handle";
      media.title = node.recipe?.deviceIcons?.[0]?.name
        ? `Drag recipe node · ${node.recipe.deviceIcons[0].name}`
        : "Drag recipe node";
      const iconPath = String(node.recipe?.deviceIconPath || "").trim();
      if (iconPath) {
        const icon = document.createElement("img");
        icon.className = "graph-device-icon";
        icon.src = iconPath;
        icon.alt = node.recipe?.deviceIcons?.[0]?.name || "Production building";
        icon.draggable = false;
        media.appendChild(icon);
      } else {
        media.textContent = "Drag";
      }
      bindGraphDragStart(media, node, graph);
      card.classList.add("has-media");
    } else {
      const iconPath = materialIconPath(node.item);
      if (iconPath) {
        media = document.createElement("div");
        media.className = "graph-node-media graph-material-media";
        const icon = document.createElement("img");
        icon.className = "graph-material-icon";
        icon.src = iconPath;
        icon.alt = node.item?.name || node.title || "Material";
        icon.draggable = false;
        media.appendChild(icon);
        card.classList.add("has-media");
      }
    }

    const content = document.createElement("div");
    content.className = "graph-node-content";

    const kind = document.createElement("div");
    kind.className = "graph-node-kind";
    kind.textContent = graphNodeKindText(node);
    if (node.type === "recipe") {
      kind.title = "Drag recipe node from here";
      bindGraphDragStart(kind, node, graph);
    }

    const title = document.createElement("div");
    title.className = "graph-node-title";
    title.textContent = node.title;

    content.append(kind, title);
    if (node.type === "recipe" && node.meta) {
      const scale = document.createElement("span");
      scale.className = "graph-node-scale";
      scale.textContent = node.meta;
      content.appendChild(scale);
    }
    if (node.type !== "recipe" && node.meta) {
      const meta = document.createElement("div");
      meta.className = "graph-node-meta";
      meta.textContent = node.meta;
      content.appendChild(meta);
    }
    if (media) card.appendChild(media);
    card.appendChild(content);

    return card;
  }

  function clearRecipeCardChecks() {
    document.querySelectorAll(".graph-check-input").forEach((checkbox) => {
      checkbox.checked = false;
    });
  }

  function graphNodeHasCheck(node) {
    return node.type === "recipe" || node.type === "raw";
  }

  function graphNodeCheckLabel(node) {
    return node.type === "raw" ? "raw material" : "recipe";
  }

  function graphNodeSwitchRecipe(node) {
    if (node.type === "recipe") {
      return node.recipe;
    }
    if (node.type === "raw") {
      return node.recipeSwitch;
    }
    return null;
  }

  function recipeColorKeyForRun(run) {
    return String(
      run?.outputs?.[0]?.item?.name
      || run?.recipe?.primaryOutput?.name
      || run?.recipe?.name
      || run?.id
      || "",
    );
  }

  function bindGraphSelectionClear(viewport, graph) {
    viewport.addEventListener("click", (event) => {
      if (suppressNextGraphBlankClick) {
        suppressNextGraphBlankClick = false;
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest(".graph-node, .graph-flow, .graph-edge-label, button, input, select, textarea, a")) {
        return;
      }
      clearGraphSelectionForGraph(graph);
    });
  }

  function selectGraphNode(graph, nodeId) {
    const node = graph.nodeById.get(nodeId);
    if (!node) {
      clearGraphSelectionForGraph(graph);
      return;
    }
    if (selectedGraphRecipeId === nodeId && canExpandGraphSelection(node)) {
      selectedGraphHighlightDepth = selectedGraphHighlightDepth === 1 ? 2 : Number.POSITIVE_INFINITY;
    } else {
      selectedGraphHighlightDepth = 1;
    }
    selectedGraphRecipeId = nodeId;
    applyGraphSelection(graph, nodeId);
  }

  function selectGraphRecipe(graph, nodeId) {
    selectGraphNode(graph, nodeId);
  }

  function clearGraphSelectionForGraph(graph) {
    if (!graph) {
      selectedGraphRecipeId = "";
      selectedGraphHighlightDepth = 1;
      return;
    }
    selectedGraphRecipeId = "";
    selectedGraphHighlightDepth = 1;
    applyGraphSelection(graph, "");
  }

  function applyGraphSelection(graph, selectedNodeId) {
    const selectedNode = selectedNodeId ? graph.nodeById.get(selectedNodeId) : null;
    const hasSelection = Boolean(selectedNode);
    const highlightedNodeIds = new Set();
    const upstreamNodeIds = new Set();
    const downstreamNodeIds = new Set();
    const highlightedEdgeIds = new Set();

    if (hasSelection) {
      highlightedNodeIds.add(selectedNodeId);
      collectGraphSelectionDirection(graph, selectedNodeId, "upstream", selectedGraphHighlightDepth, highlightedNodeIds, upstreamNodeIds, highlightedEdgeIds);
      collectGraphSelectionDirection(graph, selectedNodeId, "downstream", selectedGraphHighlightDepth, highlightedNodeIds, downstreamNodeIds, highlightedEdgeIds);
    } else {
      selectedNodeId = "";
    }

    graph.selectedNodeId = selectedNodeId;
    selectedGraphRecipeId = selectedNodeId;

    graph.edges.forEach((edge) => {
      const isHighlighted = highlightedEdgeIds.has(edge.id);
      const pathParent = isHighlighted && graph.highlightSvg ? graph.highlightSvg : graph.svg;
      if (edge.pathElement && pathParent && edge.pathElement.parentNode !== pathParent) {
        pathParent.appendChild(edge.pathElement);
      }
      edge.pathElement?.classList.toggle("highlight-edge", isHighlighted);
      edge.pathElement?.classList.toggle("flowing-edge", isHighlighted);
      edge.pathElement?.classList.toggle("dimmed", hasSelection && !isHighlighted);
      edge.labelElement?.classList.toggle("highlight-edge", isHighlighted);
      edge.labelElement?.classList.toggle("dimmed", hasSelection && !isHighlighted);
    });

    graph.nodes.forEach((node) => {
      const isSelected = node.id === selectedNodeId;
      const isUpstream = upstreamNodeIds.has(node.id);
      const isDownstream = downstreamNodeIds.has(node.id);
      const isHighlighted = highlightedNodeIds.has(node.id);
      node.element?.classList.toggle("selected", isSelected);
      node.element?.classList.toggle("highlight-upstream", isUpstream);
      node.element?.classList.toggle("highlight-downstream", isDownstream);
      node.element?.classList.toggle("dimmed", hasSelection && !isHighlighted);
    });

    if (!hasSelection) {
      return;
    }

    graph.edges.forEach((edge) => {
      if (highlightedEdgeIds.has(edge.id)) {
        bringToFront(edge.pathElement);
      }
    });
    graph.edges.forEach((edge) => {
      if (highlightedEdgeIds.has(edge.id)) {
        bringToFront(edge.labelElement);
      }
    });
    graph.nodes.forEach((node) => {
      if (highlightedNodeIds.has(node.id)) {
        bringToFront(node.element);
      }
    });
  }

  function canExpandGraphSelection(node) {
    return node?.type === "recipe" || node?.type === "raw";
  }

  function collectGraphSelectionDirection(
    graph,
    selectedNodeId,
    direction,
    depth,
    highlightedNodeIds,
    directionalNodeIds,
    highlightedEdgeIds,
  ) {
    const recursive = depth === Number.POSITIVE_INFINITY;
    let current = new Set([selectedNodeId]);
    const visited = new Set([selectedNodeId]);
    let steps = 0;

    while (current.size && (recursive || steps < depth)) {
      const next = new Set();
      graph.edges.forEach((edge) => {
        const matched = direction === "upstream"
          ? current.has(edge.target)
          : current.has(edge.source);
        if (!matched) {
          return;
        }
        const nextNodeId = direction === "upstream" ? edge.source : edge.target;
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(nextNodeId);
        directionalNodeIds.add(nextNodeId);
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          next.add(nextNodeId);
        }
      });
      current = next;
      steps += 1;
    }
  }

  function bringToFront(element) {
    if (element?.parentNode) {
      element.parentNode.appendChild(element);
    }
  }

  function normalizeRecipeFilterFocus(target) {
    const recipeId = String(target?.recipeId || "").trim();
    if (!recipeId) {
      return null;
    }
    return {
      recipeId,
      materialClass: String(target?.materialClass || "").trim(),
    };
  }

  function openRecipeFilterDialog(options = {}) {
    closeRecipeFilterDialog();
    let activeFocusTarget = normalizeRecipeFilterFocus(options.focusTarget);
    const activeRecipeIdFilter = normalizeRecipeIdSet(options.filterRecipeIds || options.requiredRecipeIds);
    const hasRecipeIdFilter = activeRecipeIdFilter.size > 0;
    const noticeText = String(options.notice || "").trim();
    let activeMaterialClass = String(options.materialClass || "").trim();
    const expansionState = new Map();

    const overlay = document.createElement("div");
    overlay.className = "recipe-filter-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeRecipeFilterDialog();
      }
    });

    const dialog = document.createElement("section");
    dialog.className = "recipe-filter-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const titleId = `recipe-filter-title-${Date.now()}`;
    dialog.setAttribute("aria-labelledby", titleId);

    const dragHandle = document.createElement("div");
    dragHandle.className = "recipe-filter-drag-handle";
    dragHandle.title = "Drag recipe filter panel";
    dragHandle.setAttribute("aria-label", "Drag recipe filter panel");
    const dragGrip = document.createElement("span");
    dragGrip.className = "recipe-filter-drag-grip";
    dragHandle.appendChild(dragGrip);
    bindRecipeFilterDialogDrag(dialog, dragHandle);

    const header = document.createElement("div");
    header.className = "recipe-filter-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "recipe-filter-title";
    const title = document.createElement("h3");
    title.id = titleId;
    title.textContent = hasRecipeIdFilter ? t("recipes.required") : t("recipes.filter");
    titleWrap.appendChild(title);
    if (noticeText) {
      const notice = document.createElement("div");
      notice.className = "recipe-filter-notice";
      notice.textContent = noticeText;
      titleWrap.appendChild(notice);
    }
    const summary = document.createElement("div");
    summary.className = "recipe-filter-summary";
    titleWrap.appendChild(summary);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "secondary-button";
    closeButton.textContent = t("recipes.close");
    closeButton.addEventListener("click", closeRecipeFilterDialog);
    header.append(titleWrap, closeButton);

    const tools = document.createElement("div");
    tools.className = "recipe-filter-tools";
    const search = document.createElement("input");
    search.className = "recipe-filter-search";
    search.type = "search";
    search.placeholder = hasRecipeIdFilter ? t("recipes.searchRequired") : t("recipes.search");
    const materialButton = document.createElement("button");
    materialButton.type = "button";
    materialButton.className = "secondary-button recipe-material-picker-button";
    materialButton.textContent = t("recipes.chooseMaterial");
    const clearMaterialButton = document.createElement("button");
    clearMaterialButton.type = "button";
    clearMaterialButton.className = "secondary-button";
    clearMaterialButton.textContent = t("recipes.clearMaterial");
    clearMaterialButton.hidden = true;
    const defaultButton = document.createElement("button");
    defaultButton.type = "button";
    defaultButton.className = "secondary-button";
    defaultButton.dataset.recipeFilterAction = "clear-alternates";
    defaultButton.textContent = t("recipes.resetAll");
    tools.append(search, materialButton, clearMaterialButton, defaultButton);

    const list = document.createElement("div");
    list.className = "recipe-filter-list";

    const footer = document.createElement("div");
    footer.className = "recipe-filter-footer";
    const hint = document.createElement("div");
    hint.className = "recipe-filter-summary";
    hint.textContent = t("recipes.hint");
    const doneButton = document.createElement("button");
    doneButton.type = "button";
    doneButton.className = "primary-button";
    doneButton.textContent = t("recipes.done");
    doneButton.addEventListener("click", closeRecipeFilterDialog);
    footer.append(hint, doneButton);

    defaultButton.addEventListener("click", () => {
      if (isRecipeFilterControlDisabled(defaultButton)) {
        return;
      }
      resetToDefaultRecipes();
      savePlannerState();
      updateRecipeFilterButton();
      renderCurrentRecipeFilterList();
      refreshRecipeFilterControls();
    });
    materialButton.addEventListener("click", async () => {
      const recipeMaterialIds = new Set(recipeCatalog.materials.map((group) => group.item?.className).filter(Boolean));
      const selection = await window.MaterialPicker.open({
        items,
        filter: (item) => recipeMaterialIds.has(item.className),
        title: t("recipes.chooseSearchMaterial"),
        description: t("recipes.chooseSearchHelp"),
        initialId: activeMaterialClass,
      });
      if (!selection) return;
      activeMaterialClass = selection.id;
      activeFocusTarget = { materialClass: selection.id };
      search.value = "";
      refreshMaterialFilterControls();
      renderCurrentRecipeFilterList({ preserveExpansion: false });
    });
    clearMaterialButton.addEventListener("click", () => {
      activeMaterialClass = "";
      activeFocusTarget = null;
      refreshMaterialFilterControls();
      renderCurrentRecipeFilterList({ preserveExpansion: false });
    });
    search.addEventListener("input", () => {
      activeFocusTarget = null;
      activeMaterialClass = "";
      refreshMaterialFilterControls();
      renderCurrentRecipeFilterList({ preserveExpansion: false });
    });

    dialog.append(dragHandle, header, tools, list, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    refreshMaterialFilterControls();
    renderCurrentRecipeFilterList({ preserveExpansion: false });
    refreshRecipeFilterControls();
    try {
      search.focus({ preventScroll: true });
    } catch (_error) {
      search.focus();
    }

    function renderCurrentRecipeFilterList(options = {}) {
      if (options.preserveExpansion !== false) {
        captureRecipeFilterExpansionState(list, expansionState);
      }
      renderRecipeFilterList(
        list,
        search.value,
        summary,
        activeFocusTarget,
        activeRecipeIdFilter,
        expansionState,
        activeMaterialClass,
      );
      if (Number.isFinite(options.restoreScrollTop)) {
        const scrollTop = Math.max(0, Number(options.restoreScrollTop));
        window.requestAnimationFrame(() => {
          list.scrollTop = scrollTop;
        });
      }
    }

    function refreshMaterialFilterControls() {
      const selectedItem = itemsByClass.get(activeMaterialClass);
      materialButton.textContent = selectedItem ? t("recipes.material", { name: selectedItem.name }) : t("recipes.chooseMaterial");
      materialButton.classList.toggle("active", Boolean(selectedItem));
      clearMaterialButton.hidden = !selectedItem;
    }
  }

  function closeRecipeFilterDialog() {
    activeRecipeFilterDrag = null;
    const overlay = document.querySelector(".recipe-filter-overlay");
    if (!overlay) {
      return;
    }
    const shouldRefreshDisplayedPlan = Boolean(lastServerResult)
      && planSignature() !== lastServerPlanSignature;
    overlay.remove();
    if (shouldRefreshDisplayedPlan) {
      calculate();
    }
  }

  function refreshRecipeFilterControls() {
    const overlay = document.querySelector(".recipe-filter-overlay");
    if (!overlay) {
      return;
    }
    setRecipeFilterControlDisabled(
      overlay.querySelector('[data-recipe-filter-action="clear-alternates"]'),
      isDefaultRecipeSelection(),
      "All default recipes are already selected and no optional recipes are selected.",
    );
  }

  function setRecipeFilterControlDisabled(button, disabled, tooltip) {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    button.classList.toggle("is-disabled", Boolean(disabled));
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
    button.tabIndex = disabled ? -1 : 0;
    if (disabled) {
      button.title = tooltip;
    } else {
      button.removeAttribute("title");
    }
  }

  function isRecipeFilterControlDisabled(button) {
    return button?.getAttribute("aria-disabled") === "true";
  }

  function bindRecipeFilterDialogDrag(dialog, dragHandle) {
    dragHandle.addEventListener("pointerdown", (event) => startRecipeFilterDialogDrag(event, dialog, dragHandle));
  }

  function startRecipeFilterDialogDrag(event, dialog, dragHandle) {
    if (activeRecipeFilterDrag) {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    event.preventDefault();

    const rect = dialog.getBoundingClientRect();
    dialog.classList.add("dragging");
    dialog.style.position = "fixed";
    dialog.style.width = `${rect.width}px`;
    dialog.style.left = `${rect.left}px`;
    dialog.style.top = `${rect.top}px`;
    dialog.style.margin = "0";

    activeRecipeFilterDrag = {
      dialog,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };

    try {
      dragHandle.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // Pointer capture can fail if the pointer was already canceled.
    }

    const handleMove = (moveEvent) => {
      if (!activeRecipeFilterDrag) {
        return;
      }
      moveEvent.preventDefault();
      const maxLeft = Math.max(8, window.innerWidth - activeRecipeFilterDrag.width - 8);
      const maxTop = Math.max(8, window.innerHeight - activeRecipeFilterDrag.height - 8);
      const nextLeft = activeRecipeFilterDrag.startLeft + moveEvent.clientX - activeRecipeFilterDrag.startClientX;
      const nextTop = activeRecipeFilterDrag.startTop + moveEvent.clientY - activeRecipeFilterDrag.startClientY;
      dialog.style.left = `${Math.min(Math.max(8, nextLeft), maxLeft)}px`;
      dialog.style.top = `${Math.min(Math.max(8, nextTop), maxTop)}px`;
    };

    const stopDrag = (stopEvent) => {
      try {
        dragHandle.releasePointerCapture?.(stopEvent.pointerId);
      } catch (_error) {
        // Ignore pointer capture cleanup failures.
      }
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", stopDrag, true);
      window.removeEventListener("pointercancel", stopDrag, true);
      dialog.classList.remove("dragging");
      activeRecipeFilterDrag = null;
    };

    window.addEventListener("pointermove", handleMove, { capture: true, passive: false });
    window.addEventListener("pointerup", stopDrag, { capture: true });
    window.addEventListener("pointercancel", stopDrag, { capture: true });
  }

  function captureRecipeFilterExpansionState(list, expansionState) {
    if (!list || !(expansionState instanceof Map)) {
      return;
    }
    list.querySelectorAll(".recipe-material-group").forEach((details) => {
      const materialClass = String(details.dataset.materialClass || "").trim();
      if (materialClass) {
        expansionState.set(materialClass, Boolean(details.open));
      }
    });
  }

  function groupHasModifiedRecipeSelection(group, recipes = null) {
    const source = Array.isArray(recipes) ? recipes : group?.recipes;
    const recipeSelectionChanged = (source || []).some((recipe) => {
      const recipeId = String(recipe?.id || "").trim();
      return Boolean(recipeId)
        && selectedRecipeIds.has(recipeId) !== isDefaultRecipeId(recipeId);
    });
    const materialClass = String(group?.item?.className || "").trim();
    const directRawSelectionChanged = isRawMaterialGroup(group)
      && disabledRawMaterialClasses.has(materialClass);
    return recipeSelectionChanged || directRawSelectionChanged;
  }

  function recipeFilterGroupOpen(group, recipes, context) {
    const materialClass = String(group?.item?.className || "").trim();
    if (context.materialClassFilter || context.hasExactRecipeFilter || Boolean(context.query)) {
      return true;
    }
    if (context.normalizedFocusTarget?.materialClass && materialClass === context.normalizedFocusTarget.materialClass) {
      return true;
    }
    if (context.expansionState instanceof Map && context.expansionState.has(materialClass)) {
      return Boolean(context.expansionState.get(materialClass));
    }
    return groupHasModifiedRecipeSelection(group, recipes);
  }

  function renderRecipeFilterList(list, rawQuery, summary, focusTarget = null, recipeIdFilter = null, expansionState = null, materialClassFilter = "") {
    const query = normalize(rawQuery);
    const normalizedFocusTarget = normalizeRecipeFilterFocus(focusTarget);
    const exactRecipeIds = recipeIdFilter instanceof Set ? recipeIdFilter : normalizeRecipeIdSet(recipeIdFilter);
    const hasExactRecipeFilter = exactRecipeIds.size > 0;
    list.replaceChildren();
    let visibleMaterialCount = 0;
    let visibleRecipeCount = 0;
    let focusedRow = null;
    let fallbackFocusedRow = null;

    const visibleGroups = recipeCatalog.materials
      .map((group, catalogIndex) => {
        const groupMaterialClass = String(group.item?.className || "").trim();
        if (materialClassFilter && groupMaterialClass !== materialClassFilter) {
          return null;
        }
        const recipes = (group.recipes || []).filter((recipe) => (
          (!hasExactRecipeFilter || exactRecipeIds.has(recipe.id))
          && recipeMatchesQuery(group, recipe, query)
        ));
        if (!recipes.length) {
          return null;
        }
        return {
          group,
          recipes,
          catalogIndex,
          modified: groupHasModifiedRecipeSelection(group),
        };
      })
      .filter(Boolean)
      .sort((left, right) => (
        Number(right.modified) - Number(left.modified)
        || left.catalogIndex - right.catalogIndex
      ));

    visibleGroups.forEach(({ group, recipes, modified }) => {
      const groupMaterialClass = String(group.item?.className || "").trim();
      const hasDirectRawRecipe = isRawMaterialGroup(group);
      const displayedRecipeCount = recipes.length + (hasDirectRawRecipe ? 1 : 0);
      visibleMaterialCount += 1;
      visibleRecipeCount += displayedRecipeCount;

      const details = document.createElement("details");
      details.className = "recipe-material-group";
      details.classList.toggle("modified", modified);
      details.dataset.materialClass = groupMaterialClass;
      details.open = recipeFilterGroupOpen(group, recipes, {
        expansionState,
        hasExactRecipeFilter,
        normalizedFocusTarget,
        query,
        materialClassFilter,
      });

      const groupSummary = document.createElement("summary");
      groupSummary.className = "recipe-material-summary";
      const name = document.createElement("span");
      name.className = "recipe-material-name";
      name.append(
        makeMaterialIcon(group.item, "recipe-material-icon"),
        document.createTextNode(group.item?.name || group.item?.className || "Unknown"),
      );
      const meta = document.createElement("span");
      meta.className = "recipe-material-meta";
      meta.textContent = `${formatInteger(displayedRecipeCount)} recipe(s) · ${group.materialCategory || ""}`;
      groupSummary.append(name, meta);
      details.appendChild(groupSummary);

      if (hasDirectRawRecipe) {
        details.appendChild(renderDirectRawBaseRecipeRow(group, {
          onSelectionChange: () => {
            captureRecipeFilterExpansionState(list, expansionState);
            renderRecipeFilterList(list, rawQuery, summary, null, exactRecipeIds, expansionState, materialClassFilter);
          },
        }));
      }

      recipes.forEach((recipe) => {
        const row = renderRecipeFilterRow(recipe, group, {
          required: hasExactRecipeFilter && exactRecipeIds.has(recipe.id),
          onSelectionChange: () => {
            captureRecipeFilterExpansionState(list, expansionState);
            renderRecipeFilterList(list, rawQuery, summary, null, exactRecipeIds, expansionState, materialClassFilter);
          },
        });
        if (normalizedFocusTarget?.recipeId && recipe.id === normalizedFocusTarget.recipeId) {
          if (normalizedFocusTarget.materialClass && groupMaterialClass === normalizedFocusTarget.materialClass) {
            focusedRow = row;
          } else if (!fallbackFocusedRow) {
            fallbackFocusedRow = row;
          }
        }
        details.appendChild(row);
      });
      list.appendChild(details);
    });

    const rowToFocus = focusedRow || fallbackFocusedRow;
    if (rowToFocus) {
      rowToFocus.classList.add("focused");
      const group = rowToFocus.closest(".recipe-material-group");
      if (group) {
        group.open = true;
      }
      window.requestAnimationFrame(() => {
        rowToFocus.scrollIntoView({ block: "center", inline: "nearest" });
      });
    }

    if (!visibleMaterialCount) {
      list.replaceChildren(makeEmptyMessage(t("recipes.none")));
    }
    if (summary) {
      const materialFilterItem = itemsByClass.get(materialClassFilter);
      summary.textContent = materialFilterItem
        ? `${materialFilterItem.name} · ${formatInteger(visibleRecipeCount)} recipe row(s) · ${formatInteger(selectedRecipeIds.size)} / ${formatInteger(recipeCatalog.selectableRecipeIds.length)} selected`
        : hasExactRecipeFilter
        ? `${formatInteger(visibleRecipeCount)} row(s) for ${formatInteger(exactRecipeIds.size)} required recipe(s) · ${formatInteger(selectedRecipeIds.size)} / ${formatInteger(recipeCatalog.selectableRecipeIds.length)} selected`
        : `${formatInteger(selectedRecipeIds.size)} / ${formatInteger(recipeCatalog.selectableRecipeIds.length)} selected · ${formatInteger(visibleMaterialCount)} material(s), ${formatInteger(visibleRecipeCount)} visible recipe row(s)`;
    }
  }

  function isRawMaterialGroup(group) {
    return String(group?.materialCategory || group?.item?.materialCategory || "").trim() === "RawMaterial";
  }

  function renderDirectRawBaseRecipeRow(group, options = {}) {
    const itemClass = String(group?.item?.className || "").trim();
    const row = document.createElement("div");
    row.className = "recipe-row base-recipe direct-raw-base-recipe";
    row.dataset.materialClass = itemClass;
    row.dataset.recipeId = `${DIRECT_RAW_RECIPE_ID}:${itemClass}`;

    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "recipe-row-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "recipe-filter-checkbox direct-raw-checkbox";
    checkbox.checked = !disabledRawMaterialClasses.has(itemClass);
    checkbox.setAttribute("aria-label", t("recipes.directRaw", { name: group.item?.name || itemClass }));
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        disabledRawMaterialClasses.delete(itemClass);
      } else {
        disabledRawMaterialClasses.add(itemClass);
      }
      savePlannerState();
      refreshRecipeFilterControls();
      options.onSelectionChange?.();
    });
    checkboxLabel.appendChild(checkbox);

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "recipe-row-name";
    const recipeTag = document.createElement("span");
    recipeTag.className = "recipe-row-tag";
    recipeTag.textContent = t("recipes.baseTag");
    name.append(recipeTag, document.createTextNode(t("recipes.directRawName", { name: group.item?.name || itemClass })));
    const meta = document.createElement("div");
    meta.className = "recipe-row-meta";
    meta.textContent = "primary · base · raw source";
    const formula = document.createElement("div");
    formula.className = "recipe-row-formula";
    const selfIngredient = [{ item: group.item, rate: 1 }];
    formula.append(renderRecipeSide(selfIngredient), document.createTextNode(" = "), renderRecipeSide(selfIngredient));
    body.append(name, meta, formula);
    row.append(checkboxLabel, body);
    return row;
  }

  function renderRecipeFilterRow(recipe, group, options = {}) {
    const row = document.createElement("div");
    row.className = "recipe-row";
    const isDefaultRecipe = isDefaultRecipeId(recipe.id);
    if (options.required) {
      row.classList.add("required");
    }
    if (isDefaultRecipe) {
      row.classList.add("base-recipe");
    }
    row.dataset.recipeId = recipe.id || "";
    row.dataset.materialClass = group?.item?.className || "";

    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "recipe-row-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "recipe-filter-checkbox";
    checkbox.dataset.recipeId = recipe.id;
    checkbox.checked = selectedRecipeIds.has(recipe.id);
    checkbox.addEventListener("change", () => {
      setRecipeSelected(recipe.id, checkbox.checked);
      options.onSelectionChange?.();
    });
    checkboxLabel.appendChild(checkbox);

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "recipe-row-name";
    const recipeTag = document.createElement("span");
    recipeTag.className = "recipe-row-tag";
    recipeTag.textContent = isDefaultRecipe ? t("recipes.baseTag") : t("recipes.recipeTag");
    name.append(recipeTag, document.createTextNode(recipe.name || recipe.id));
    const meta = document.createElement("div");
    meta.className = "recipe-row-meta";
    meta.textContent = [
      recipe.relation === "byproduct" ? "byproduct" : "primary",
      isDefaultRecipe ? "base" : recipe.isAlternate ? "alternate" : "additional",
      ...(recipe.flags || []),
    ].filter(Boolean).join(" · ");
    const formula = document.createElement("div");
    formula.className = "recipe-row-formula";
    formula.append(renderRecipeSide(recipe.inputs), document.createTextNode(" = "), renderRecipeSide(recipe.outputs));
    body.append(name, meta, formula);
    row.append(checkboxLabel, body);
    return row;
  }

  function setRecipeSelected(recipeId, selected) {
    if (!recipeId) {
      return;
    }
    if (selected) {
      selectedRecipeIds.add(recipeId);
    } else {
      selectedRecipeIds.delete(recipeId);
      activePreferredPlan = activePreferredPlan.filter((entry) => entry.id !== recipeId);
      storeCurrentPreferredPlan();
    }
    document.querySelectorAll(".recipe-filter-checkbox").forEach((checkbox) => {
      if (checkbox.dataset.recipeId === recipeId) {
        checkbox.checked = selectedRecipeIds.has(recipeId);
      }
    });
    updateRecipeFilterButton();
    refreshRecipeFilterControls();
    savePlannerState();
  }

  function recipeMatchesQuery(group, recipe, query) {
    if (!query) {
      return true;
    }
    return [
      group.item?.name,
      group.item?.className,
      recipe.name,
      recipe.id,
      ...(recipe.flags || []),
      recipeFormula(recipe),
    ].some((value) => normalize(value).includes(query));
  }

  function recipeFormula(recipe) {
    return `${recipeSide(recipe.inputs)} = ${recipeSide(recipe.outputs)}`;
  }

  function renderRecipeSide(entries) {
    const side = document.createElement("span");
    side.className = "recipe-formula-side";
    if (!Array.isArray(entries) || !entries.length) {
      side.textContent = "None";
      return side;
    }
    entries.forEach((entry, index) => {
      if (index > 0) {
        side.appendChild(document.createTextNode(" + "));
      }
      const token = document.createElement("span");
      token.className = "recipe-formula-item";
      token.append(
        makeMaterialIcon(entry.item, "recipe-formula-icon"),
        document.createTextNode(`${entry.item?.name || ""} (${formatNumber(entry.rate)})`),
      );
      side.appendChild(token);
    });
    return side;
  }

  function recipeSide(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return "None";
    }
    return entries
      .map((entry) => `${entry.item?.name || ""} (${formatNumber(entry.rate)})`)
      .join(" + ");
  }

  function canSwitchRecipe(recipe) {
    return Array.isArray(recipe?.replacementOptions) && recipe.replacementOptions.length > 1;
  }

  function bindGraphPan(viewport) {
    viewport.addEventListener("pointerdown", (event) => startGraphPan(event, viewport));
  }

  function startGraphPan(event, viewport) {
    if (activeGraphDrag || activeGraphPan) {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".graph-node, .graph-edge-label, button, input, select, textarea, a")) {
      return;
    }

    event.preventDefault();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startScrollLeft = viewport.scrollLeft;
    const startScrollTop = viewport.scrollTop;
    let moved = false;
    activeGraphPan = { viewport };
    viewport.classList.add("panning");

    try {
      viewport.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // Pointer capture can fail if the browser already canceled the pointer.
    }

    const handleMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startClientX;
      const deltaY = moveEvent.clientY - startClientY;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        moved = true;
      }
      viewport.scrollLeft = startScrollLeft - deltaX;
      viewport.scrollTop = startScrollTop - deltaY;
    };

    const stopPan = (stopEvent) => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", stopPan, true);
      window.removeEventListener("pointercancel", stopPan, true);
      try {
        viewport.releasePointerCapture?.(stopEvent.pointerId);
      } catch (_error) {
        // Capture may already be released by the browser.
      }
      viewport.classList.remove("panning");
      activeGraphPan = null;
      if (moved) {
        suppressNextGraphBlankClick = true;
        window.setTimeout(() => {
          suppressNextGraphBlankClick = false;
        }, 0);
        stopEvent.preventDefault();
      }
    };

    window.addEventListener("pointermove", handleMove, { capture: true, passive: false });
    window.addEventListener("pointerup", stopPan, true);
    window.addEventListener("pointercancel", stopPan, true);
  }

  function bindGraphDragStart(element, node, graph) {
    element.classList.add("graph-drag-zone");
    element.addEventListener("pointerdown", (event) => startGraphNodeDrag(event, node, graph));
    element.addEventListener("mousedown", (event) => startGraphNodeDrag(event, node, graph));
    element.addEventListener("touchstart", (event) => startGraphNodeDrag(event, node, graph), { passive: false });
  }

  function startGraphNodeDrag(event, node, graph) {
    const target = event.target;
    if (activeGraphDrag || activeGraphPan || (target instanceof Element && target.closest("button"))) {
      return;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    const startPoint = graphDragPoint(event);
    if (!startPoint) {
      return;
    }

    event.preventDefault();
    const card = node.element || event.currentTarget;
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const startClientX = startPoint.clientX;
    const startClientY = startPoint.clientY;
    const startNodeX = node.x;
    const startNodeY = node.y;
    let moved = false;
    const eventNames = graphDragEventNames(event.type);

    activeGraphDrag = { node, graph };
    card.classList.add("dragging");
    if (event.type === "pointerdown") {
      try {
        card.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Some browsers can reject capture if the pointer is already gone.
      }
    }

    const handleMove = (moveEvent) => {
      const point = graphDragPoint(moveEvent);
      if (!point) {
        return;
      }
      moveEvent.preventDefault();
      const nextX = Math.max(0, startNodeX + point.clientX - startClientX);
      const nextY = Math.max(0, startNodeY + point.clientY - startClientY);
      if (Math.abs(nextX - node.x) < 0.5 && Math.abs(nextY - node.y) < 0.5) {
        return;
      }
      moved = true;
      node.x = nextX;
      node.y = nextY;
      updateGraphNodeElement(node);
      refreshRenderedGraph(graph);
    };

    const stopDrag = (stopEvent) => {
      eventNames.move.forEach((name) => window.removeEventListener(name, handleMove, true));
      eventNames.end.forEach((name) => window.removeEventListener(name, stopDrag, true));
      if (event.type === "pointerdown") {
        try {
          card.releasePointerCapture?.(stopEvent.pointerId);
        } catch (_error) {
          // Capture may already have been released by the browser.
        }
      }
      card.classList.remove("dragging");
      activeGraphDrag = null;

      if (moved) {
        recipeNodePositions.set(node.id, {
          x: roundGraphCoordinate(node.x),
          y: roundGraphCoordinate(node.y),
        });
        savePlannerState();
      }
    };

    eventNames.move.forEach((name) => window.addEventListener(name, handleMove, { capture: true, passive: false }));
    eventNames.end.forEach((name) => window.addEventListener(name, stopDrag, true));
  }

  function graphDragEventNames(startType) {
    if (startType === "touchstart") {
      return {
        move: ["touchmove"],
        end: ["touchend", "touchcancel"],
      };
    }
    if (startType === "mousedown") {
      return {
        move: ["mousemove"],
        end: ["mouseup"],
      };
    }
    return {
      move: ["pointermove", "mousemove", "touchmove"],
      end: ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"],
    };
  }

  function graphDragPoint(event) {
    if (event.touches?.length) {
      return {
        clientX: event.touches[0].clientX,
        clientY: event.touches[0].clientY,
      };
    }
    if (event.changedTouches?.length) {
      return {
        clientX: event.changedTouches[0].clientX,
        clientY: event.changedTouches[0].clientY,
      };
    }
    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      return {
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }
    return null;
  }

  function updateGraphNodeElement(node) {
    if (!node.element) {
      return;
    }
    node.element.style.left = `${node.x}px`;
    node.element.style.top = `${node.y}px`;
  }

  function refreshRenderedGraph(graph) {
    resizeGraphCanvas(graph);
    refreshEdgeFeedback(graph.edges, graph.nodeById);
    routeEdges(graph.edges, graph.nodeById);
    graph.edges.forEach((edge) => {
      edge.pathElement?.setAttribute("d", edgePath(edge));
      if (edge.labelElement) {
        edge.labelElement.style.left = `${edge.labelX}px`;
        edge.labelElement.style.top = `${edge.labelY}px`;
      }
    });
    applyGraphSelection(graph, graph.selectedNodeId || "");
  }

  function resizeGraphCanvas(graph) {
    const { width, height } = graphExtents(graph.nodes, graph.baseWidth, graph.baseHeight);
    if (width === graph.width && height === graph.height) {
      return;
    }

    graph.width = width;
    graph.height = height;
    graph.canvas.style.width = `${width}px`;
    graph.canvas.style.height = `${height}px`;
    graph.svg.setAttribute("width", String(width));
    graph.svg.setAttribute("height", String(height));
    graph.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    graph.highlightSvg?.setAttribute("width", String(width));
    graph.highlightSvg?.setAttribute("height", String(height));
    graph.highlightSvg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  function renderEdgeLabel(edge) {
    const label = document.createElement("div");
    label.className = "graph-edge-label";
    label.style.left = `${edge.labelX}px`;
    label.style.top = `${edge.labelY}px`;

    const summary = document.createElement("div");
    summary.className = "graph-edge-label-summary";

    const icon = makeMaterialIcon(edge.item, "graph-edge-label-icon");
    const name = document.createElement("span");
    name.className = "graph-edge-label-name";
    name.textContent = edge.item.name;
    const rate = document.createElement("span");
    rate.className = "graph-edge-label-rate";
    rate.textContent = `${formatNumber(edge.rate)}/min`;
    summary.append(icon, rate);

    const edgeScale = graphEdgeDisplayScale(edge);
    if (isPositive(edgeScale)) {
      const scale = document.createElement("span");
      scale.className = "graph-edge-label-scale";
      scale.textContent = `[x${formatMultiplier(edgeScale)}]`;
      summary.appendChild(scale);
    }
    label.append(summary, name);
    label.title = edgeLabelTitle(edge);
    return label;
  }

  function edgeLabelTitle(edge) {
    const parts = [`${edge.item.name}: ${formatNumber(edge.rate)} ${edge.item.unit}/min`];
    const edgeScale = graphEdgeDisplayScale(edge);
    if (isPositive(edgeScale)) {
      parts.push(`allocated multiplier [x${formatMultiplier(edgeScale)}]`);
    }
    return parts.join(" · ");
  }

  function graphEdgeDisplayScale(edge) {
    return edge.showScale === false ? 0 : Number(edge.scale || 0);
  }

  function positionEdgeLabel(edge) {
    const point = edgePoint(edge, 0.5);
    edge.labelX = point.x;
    edge.labelY = point.y + (edge.feedback ? -12 : 0);
  }

  function edgePoint(edge, t) {
    const control = edgeControlPoints(edge);
    return cubicPoint(
      { x: edge.x1, y: edge.y1 },
      control.c1,
      control.c2,
      { x: edge.x2, y: edge.y2 },
      t,
    );
  }

  function edgeControlPoints(edge) {
    const distance = Math.abs(edge.x2 - edge.x1);
    const curve = Math.max(80, Math.min(220, distance * 0.45));
    if (edge.feedback) {
      const backtrack = Math.max(0, edge.x1 - edge.x2);
      const horizontal = Math.max(180, Math.min(420, backtrack * 0.35 + 180));
      const vertical = Math.max(100, Math.min(280, backtrack * 0.18 + Math.abs(edge.y2 - edge.y1) * 0.35 + 110));
      return {
        c1: { x: edge.x1 + horizontal, y: edge.y1 + vertical },
        c2: { x: edge.x2 - horizontal, y: edge.y2 + vertical },
      };
    }
    return {
      c1: { x: edge.x1 + curve, y: edge.y1 },
      c2: { x: edge.x2 - curve, y: edge.y2 },
    };
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
  }

  function edgePath(edge) {
    const control = edgeControlPoints(edge);
    return `M ${edge.x1} ${edge.y1} C ${control.c1.x} ${control.c1.y}, ${control.c2.x} ${control.c2.y}, ${edge.x2} ${edge.y2}`;
  }

  function graphNodeKindText(node) {
    if (node.type === "raw") return materialCategoryText(node.item, t("category.RawMaterial"));
    if (node.type === "target") return t("kind.output");
    if (node.type === "surplus") return t("kind.surplus");
    return t("kind.recipe");
  }

  function graphNodeSortKey(node, balanceByClass) {
    const typeOrder = { target: "0", recipe: "1", raw: "2", surplus: "3" };
    const targetDemand = node.item ? Number(balanceByClass.get(node.item.className)?.targetDemand || 0) : 0;
    const priority = targetDemand > 0 ? "0" : "1";
    return `${typeOrder[node.type] || "9"}:${priority}:${node.title.toLowerCase()}:${node.id}`;
  }

  function edgeColor(edge, nodeById) {
    const source = nodeById.get(edge.source);
    return source?.edgeColor || source?.borderColor || materialColor(edge.item?.className || edge.source);
  }

  function recipeColor(recipeName) {
    const hash = hashString(recipeName);
    const hue = hash % 360;
    const saturation = 38 + ((hash >>> 8) % 10);
    const lightness = 29 + ((hash >>> 16) % 7);
    const fill = hslToRgb(hue, saturation, lightness);
    const border = hslToRgb(hue, Math.min(58, saturation + 10), Math.min(56, lightness + 18));
    const edge = hslToRgb(hue, Math.min(62, saturation + 14), Math.min(50, lightness + 12));
    return {
      fill: `rgba(${fill.r}, ${fill.g}, ${fill.b}, 0.94)`,
      border: `rgb(${border.r}, ${border.g}, ${border.b})`,
      edge: `rgb(${edge.r}, ${edge.g}, ${edge.b})`,
    };
  }

  function hslToRgb(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const h = hue / 60;
    const x = c * (1 - Math.abs((h % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (h >= 0 && h < 1) {
      r1 = c;
      g1 = x;
    } else if (h < 2) {
      r1 = x;
      g1 = c;
    } else if (h < 3) {
      g1 = c;
      b1 = x;
    } else if (h < 4) {
      g1 = x;
      b1 = c;
    } else if (h < 5) {
      r1 = x;
      b1 = c;
    } else {
      r1 = c;
      b1 = x;
    }

    const m = l - c / 2;
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function materialColor(itemClass) {
    let hash = 0;
    for (const char of String(itemClass)) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    const hue = hash % 360;
    return `hsl(${hue}, 62%, 45%)`;
  }

  function isPositive(value) {
    return Number.isFinite(value) && value > 1e-5;
  }

  function renderMergedTable(totals) {
    if (!totals.length) {
      tableView.replaceChildren(makeEmptyMessage(t("results.noDownstream")));
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "merged-table-wrap";

    const table = document.createElement("table");
    table.className = "merged-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["table.item", "table.required", "table.unit", "table.type", "table.recipes"].map(t).forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    totals.forEach((row) => {
      const tr = document.createElement("tr");
      appendCell(tr, row.item.name);
      appendCell(tr, formatNumber(row.rate), "number-cell");
      appendCell(tr, row.item.unit);
      appendCell(tr, row.raw ? materialCategoryText(row.item, t("category.RawMaterial")) : t("kind.intermediate"));
      appendRecipeUsageCell(tr, row);
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    wrap.appendChild(table);
    tableView.replaceChildren(wrap);
  }

  function appendRecipeUsageCell(tr, row) {
    const cell = document.createElement("td");
    const switchRecipe = row.raw ? rawRecipeSwitch(row) : null;
    if (canSwitchRecipe(switchRecipe)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-switch-recipe-button";
      button.textContent = t("results.recipes");
      button.setAttribute("aria-label", `Show recipes for ${switchRecipe.primaryOutput?.name || row.item?.name || ""}`);
      button.addEventListener("click", () => openRecipeFilterDialog({
        materialClass: switchRecipe.primaryOutput?.className || row.item?.className || "",
      }));
      cell.appendChild(button);
    }

    const recipeText = Array.isArray(row.recipes) ? row.recipes.join(", ") : "";
    if (recipeText) {
      const text = document.createElement("span");
      text.textContent = recipeText;
      cell.appendChild(text);
    }
    tr.appendChild(cell);
  }

  function summaryText(summary) {
    return t("summary.loaded", {
      recipes: formatInteger(summary.recipeCount), items: formatInteger(summary.itemCount),
      raw: formatInteger(summary.rawMaterialCount),
    });
  }

  function appendCell(row, text, className = "") {
    const cell = document.createElement("td");
    if (className) {
      cell.className = className;
    }
    cell.textContent = text;
    row.appendChild(cell);
  }

  function makeEmptyMessage(text) {
    const message = document.createElement("div");
    message.className = "status-message";
    message.textContent = text;
    return message;
  }

  function selectTab(tabName) {
    activeTab = tabName;
    const showTree = tabName === "tree";
    treeView.classList.toggle("hidden", !showTree);
    tableView.classList.toggle("hidden", showTree);
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === tabName;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (showTree) {
      fitCurrentGraphViewportHeight();
    }
  }

  function setStatus(text, isError) {
    statusMessage.textContent = text;
    statusMessage.classList.toggle("error", Boolean(isError));
  }

  function normalize(value) {
    return i18n?.normalizeSearch(value) || String(value || "").normalize("NFKD").toLowerCase().trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "";
    }
    return i18n?.formatNumber(number) || String(number);
  }

  function formatMultiplier(value) {
    return formatCompactDecimal(value, {
      maxNormalFractionDigits: 3,
      significantFractionDigits: 3,
      maxFractionDigits: 9,
    });
  }

  function formatCompactDecimal(value, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "";
    }
    if (number === 0) {
      return "0";
    }
    const absolute = Math.abs(number);
    const nearestInteger = Math.round(number);
    if (nearestInteger !== 0 && Math.abs(number - nearestInteger) <= Math.max(1e-9, absolute * 1e-9)) {
      return String(nearestInteger);
    }

    const maxNormalFractionDigits = Number(options.maxNormalFractionDigits ?? 3);
    const significantFractionDigits = Number(options.significantFractionDigits ?? 3);
    const maxFractionDigits = Number(options.maxFractionDigits ?? 9);
    const fractionDigits = absolute >= 1
      ? maxNormalFractionDigits
      : Math.min(
        maxFractionDigits,
        Math.max(
          maxNormalFractionDigits,
          Math.ceil(-Math.log10(absolute)) + significantFractionDigits - 1,
        ),
      );
    const rounded = number.toFixed(fractionDigits).replace(/0+$/, "").replace(/\.$/, "");
    if (rounded !== "0" && rounded !== "-0") {
      return rounded;
    }
    return number.toExponential(Math.max(0, significantFractionDigits - 1)).replace(/\.?0+e/, "e");
  }

  function formatInteger(value) {
    return i18n?.formatInteger(value || 0) || Number(value || 0).toLocaleString();
  }

  function roundGraphCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
  }
})();
