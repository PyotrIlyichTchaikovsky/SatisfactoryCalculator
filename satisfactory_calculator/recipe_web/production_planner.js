(() => {
  "use strict";

  const targetRows = document.getElementById("targetRows");
  const targetTemplate = document.getElementById("targetRowTemplate");
  const addTargetButton = document.getElementById("addTargetButton");
  const savePlanButton = document.getElementById("savePlanButton");
  const savePlanDialog = document.getElementById("savePlanDialog");
  const savePlanForm = document.getElementById("savePlanForm");
  const savePlanNameInput = document.getElementById("savePlanNameInput");
  const cancelSavePlanButton = document.getElementById("cancelSavePlanButton");
  const planLibrary = document.querySelector(".plan-library");
  const savedPlanSelect = document.getElementById("savedPlanSelect");
  const recipeFilterButton = document.getElementById("recipeFilterButton");
  const plannerForm = document.getElementById("plannerForm");
  const calculateButton = document.getElementById("calculateButton");
  const dataSummary = document.getElementById("dataSummary");
  const initialLoading = document.getElementById("initialLoading");
  const initialLoadingTitle = document.getElementById("initialLoadingTitle");
  const initialLoadingMessage = document.getElementById("initialLoadingMessage");
  const initialLoadingRetry = document.getElementById("initialLoadingRetry");
  const calculationLoading = document.getElementById("calculationLoading");
  const statusMessage = document.getElementById("statusMessage");
  const treeView = document.getElementById("treeView");
  const findRecipeButton = document.getElementById("findRecipeButton");
  const locateChangedRecipesButton = document.getElementById("locateChangedRecipesButton");
  const resultFocusControls = document.getElementById("resultFocusControls");
  const pageFocusButton = document.getElementById("pageFocusButton");
  const browserFocusButton = document.getElementById("browserFocusButton");
  const exitFocusButton = document.getElementById("exitFocusButton");
  const STORAGE_KEY = "satisfactoryProductionPlanner.v1";
  const SELECTION_CACHE_VERSION = 6;
  const GRAPH_FLOW_WIDTH = 8;
  const GRAPH_VIEWPORT_MIN_HEIGHT = 360;
  const GRAPH_VIEWPORT_BOTTOM_GAP = 18;
  const GRAPH_BUS_CLEARANCE = 7;
  const GRAPH_BUS_LANE_SPACING = GRAPH_FLOW_WIDTH + 2;
  const RECIPE_MODE_BASE = "base";
  const RECIPE_MODE_BEST_EFFICIENCY = "bestEfficiency";
  const DIRECT_RAW_RECIPE_ID = "__raw__";
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
  let resultFocusMode = null;
  let savedState = loadPlannerState();
  let savedTargetPlans = normalizeTargetPlanList(savedState.savedTargetPlans);
  let pendingRecipeMode = RECIPE_MODE_BASE;
  let suppressStateSave = false;
  let activePlanKey = "";
  let activePreferredPlan = [];
  let activeGraphPan = null;
  let activeRecipeFilterDrag = null;
  let selectedGraphRecipeId = "";
  let selectedGraphHighlightDepth = 1;
  let compactFocusView = null;
  let compactFocusViewport = null;
  let suppressNextGraphBlankClick = false;
  let lastServerResult = null;
  let lastServerTargets = [];
  let lastServerPlanSignature = "";
  let lastRenderedGraph = null;
  let recipeFilterInitialSelection = null;
  let changedRecipeIdsToLocate = [];
  const plannerLoadStartedAt = performance.now();
  const analytics = window.PlannerAnalytics || { track: () => false };

  addTargetButton.addEventListener("click", () => addTargetRow());
  savePlanButton?.addEventListener("click", openSavePlanDialog);
  savePlanForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const saved = saveCurrentTargetPlan(savePlanNameInput?.value || "");
    if (saved) {
      if (savePlanDialog instanceof HTMLDialogElement) savePlanDialog.close();
      analytics.track("plan_saved", { context: savePlanNameInput?.value.trim() ? "named" : "unnamed" });
    }
  });
  cancelSavePlanButton?.addEventListener("click", () => savePlanDialog?.close());
  savedPlanSelect?.addEventListener("click", (event) => handleTargetPlanPickerClick(event, savedPlanSelect, savedTargetPlans));
  recipeFilterButton?.addEventListener("click", openRecipeFilterDialog);
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  pageFocusButton?.addEventListener("click", switchToPageFocusMode);
  browserFocusButton?.addEventListener("click", enterBrowserFullscreen);
  exitFocusButton?.addEventListener("click", closeResultFocusMode);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("keydown", handleFocusModeKeydown);
  updateFocusControls();
  findRecipeButton?.addEventListener("click", () => openFindRecipeDialog());
  locateChangedRecipesButton?.addEventListener("click", () => openFindRecipeDialog({ recipeIds: changedRecipeIdsToLocate }));
  initialLoadingRetry?.addEventListener("click", () => window.location.reload());
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".plan-picker")) {
      closeTargetPlanPickers();
    }
  });
  window.addEventListener("resize", handleWindowResize);

  try {
    restorePreferredPlanCache(savedState.selectionCacheVersion === SELECTION_CACHE_VERSION ? savedState.preferredPlanByTarget : []);
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
      if (!restoreTargetRows(savedState.targets)) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      renderTargetPlanSelectors();
      dataSummary.textContent = t("status.itemsLoading", { count: formatInteger(items.length) });
      setInitialLoadingMessage("loading.recipes");
      setStatus(t("status.itemsReady"), false);

      const [summary, recipePayload] = await supportingData;
      initializeRecipeSelection(recipePayload);
      plannerReady = true;
      if (recipeFilterButton) recipeFilterButton.disabled = false;
      if (calculateButton) calculateButton.disabled = false;
      activatePlanCacheForCurrentTargets();
      dataSummary.textContent = summaryText(summary);
      setStatus(t("results.initial"), false);
      finishInitialLoading();
      analytics.track("planner_ready", {
        durationMs: performance.now() - plannerLoadStartedAt,
        recipeCount: summary?.recipeCount,
      });
    } catch (error) {
      window.PlannerDiagnostics.reportError(error, "load-data");
      if (!targetRows.querySelector(".target-row")) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      renderTargetPlanSelectors();
      dataSummary.textContent = t("status.connectionFailed");
      setStatus(t("status.loadFailed"), true);
      showInitialLoadingError();
      analytics.track("planner_load_failed", {
        durationMs: performance.now() - plannerLoadStartedAt,
        reason: error?.name || "error",
      });
    }
  }

  function setInitialLoadingMessage(key) {
    if (initialLoadingMessage) initialLoadingMessage.textContent = t(key);
  }

  function finishInitialLoading() {
    if (!initialLoading) return;
    initialLoading.setAttribute("aria-busy", "false");
    initialLoading.classList.add("complete");
    document.body.classList.remove("is-loading");
    window.setTimeout(() => {
      initialLoading.hidden = true;
    }, 180);
  }

  function showInitialLoadingError() {
    if (!initialLoading) return;
    initialLoading.classList.add("error");
    initialLoading.setAttribute("aria-busy", "false");
    if (initialLoadingTitle) initialLoadingTitle.textContent = t("loading.failedTitle");
    setInitialLoadingMessage("loading.failed");
    if (initialLoadingRetry) initialLoadingRetry.hidden = false;
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
    savePlannerState();

    let calculationResult = null;
    const calculationStartedAt = performance.now();
    setCalculationLoading(true);
    analytics.track("calculation_started", {
      targetCount: targets.length,
      enabledRecipeCount: selectedRecipeIds.size,
    });
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
        analytics.track("recipe_expansion_required", {
          durationMs: performance.now() - calculationStartedAt,
          targetCount: targets.length,
        });
        handleRecipeExpansionRequired(result);
        return;
      }
      storeCurrentPreferredPlan();
      lastServerResult = clonePlannerResult(result);
      lastServerTargets = targetSnapshotsFromTargets(targets);
      lastServerPlanSignature = planSignature();
      renderPlannerResult(result, { selectTree: true });
      handlePostCalculationRecipeLocation(
        options.locateRecipeIds,
        options.locateMaterialClasses,
        options.focusMaterialClass,
      );
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
      analytics.track("calculation_succeeded", {
        durationMs: performance.now() - calculationStartedAt,
        targetCount,
        recipeCount: recipeRunCount,
        enabledRecipeCount: selectedRecipeIds.size,
        resultRowCount: totalRows,
      });
    } catch (error) {
      const issue = window.PlannerDiagnostics.reportError(error, "calculate-or-render", true, calculationResult);
      lastServerResult = null;
      lastServerTargets = [];
      lastServerPlanSignature = "";
      setStatus(t("status.calcFailed", { issue: issue.id }), true);
      treeView.replaceChildren(makeEmptyMessage(t("results.noPlan")));
      analytics.track("calculation_failed", {
        durationMs: performance.now() - calculationStartedAt,
        targetCount: targets.length,
        reason: error?.name || "error",
      });
    } finally {
      setCalculationLoading(false);
    }
  }

  function setCalculationLoading(isLoading) {
    if (!calculationLoading) return;
    calculationLoading.hidden = !isLoading;
    calculationLoading.setAttribute("aria-busy", isLoading ? "true" : "false");
    document.body.classList.toggle("is-calculating", isLoading);
  }

  function handleRecipeExpansionRequired(result) {
    const requiredRecipeIds = normalizedRecipeIdList(result.requiredRecipeIds);
    lastServerResult = null;
    lastServerTargets = [];
    lastServerPlanSignature = "";

    if (!requiredRecipeIds.length) {
      setStatus(t("status.expansionFailed"), true);
      treeView.replaceChildren(makeEmptyMessage(t("results.noPlan")));
      return;
    }

    requiredRecipeIds.forEach((recipeId) => selectedRecipeIds.add(recipeId));
    savePlannerState();
    updateRecipeFilterButton();

    openRecipeFilterDialog({
      filterRecipeIds: requiredRecipeIds,
      notice: t("recipes.expansionNotice"),
    });
    setStatus(t("status.expansionFailed"), true);
    treeView.replaceChildren(makeEmptyMessage(t("results.expansionEmpty")));
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
      preferredPlanByTarget: Array.from(preferredPlanByTargetKey.entries()).map(([key, plan]) => ({
        key,
        plan: normalizePreferredPlan(plan),
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
      const plan = {
        id: String(entry?.id || entry?.key || "").trim() || createSavedPlanId(),
        name: String(entry?.name || "").trim(),
        targets,
        enabledRecipeIds: Array.isArray(entry?.enabledRecipeIds) ? normalizedRecipeIdList(entry.enabledRecipeIds) : null,
        disabledRawMaterialClasses: Array.isArray(entry?.disabledRawMaterialClasses)
          ? normalizeStringList(entry.disabledRawMaterialClasses)
          : null,
        savedAt: Number(entry?.savedAt) || Date.now(),
      };
      plan.signature = savedTargetPlanSignature(plan);
      const existingIndex = result.findIndex((savedPlan) => savedPlan.signature === plan.signature);
      if (existingIndex >= 0) result.splice(existingIndex, 1);
      result.unshift(plan);
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

  function normalizeStringList(values) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).sort();
  }

  function savedTargetPlanSignature(plan) {
    return JSON.stringify([
      targetPlanKey(plan.targets),
      Array.isArray(plan.enabledRecipeIds) ? normalizedRecipeIdList(plan.enabledRecipeIds) : null,
      Array.isArray(plan.disabledRawMaterialClasses) ? normalizeStringList(plan.disabledRawMaterialClasses) : null,
    ]);
  }

  function createSavedPlanId() {
    return window.crypto?.randomUUID?.() || `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openSavePlanDialog() {
    if (!collectTargets().length || !(savePlanDialog instanceof HTMLDialogElement)) return;
    if (savePlanNameInput instanceof HTMLInputElement) savePlanNameInput.value = "";
    savePlanDialog.showModal();
    window.requestAnimationFrame(() => savePlanNameInput?.focus());
  }

  function saveCurrentTargetPlan(name = "") {
    const targets = collectTargets();
    if (!targets.length) {
      return false;
    }
    const snapshots = targetSnapshotsFromTargets(targets);
    if (!snapshots.length) {
      return false;
    }
    const plan = {
      id: "",
      name: String(name || "").trim(),
      targets: snapshots,
      enabledRecipeIds: selectedRecipeIdsPayload(),
      disabledRawMaterialClasses: disabledRawMaterialClassesPayload(),
      savedAt: Date.now(),
    };
    plan.signature = savedTargetPlanSignature(plan);
    const existingIndex = savedTargetPlans.findIndex((savedPlan) => savedPlan.signature === plan.signature);
    plan.id = existingIndex >= 0 ? savedTargetPlans.splice(existingIndex, 1)[0].id : createSavedPlanId();
    savedTargetPlans.unshift(plan);
    savePlannerState();
    renderTargetPlanSelectors();
    setStatus(t("status.saved", { plan: plan.name || targetPlanLabel(snapshots) }), false);
    return true;
  }

  function renderTargetPlanSelectors() {
    renderTargetPlanPicker(savedPlanSelect, savedTargetPlans, t("targets.noSaved"), t("targets.saved"));
    if (planLibrary instanceof HTMLElement) {
      planLibrary.hidden = !savedTargetPlans.length;
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
    button.setAttribute("aria-label", plans.length ? placeholderText : emptyText);
    button.title = plans.length ? placeholderText : emptyText;
    button.disabled = !plans.length;
    menu.hidden = true;
    menu.replaceChildren();
    plans.forEach((plan) => {
      const option = document.createElement("div");
      option.className = "plan-picker-option";
      const select = document.createElement("button");
      select.type = "button";
      select.className = "plan-picker-option-select";
      select.dataset.planId = plan.id;
      const planLabel = plan.name || targetPlanLabel(plan.targets);
      select.title = planLabel;
      select.setAttribute("aria-label", planLabel);
      select.appendChild(renderTargetPlanSummary(plan.targets, { iconsOnly: true, name: plan.name }));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button plan-picker-delete";
      remove.dataset.planId = plan.id;
      remove.textContent = "×";
      const deleteLabel = t("targets.deleteSavedPlan", { plan: planLabel });
      remove.title = deleteLabel;
      remove.setAttribute("aria-label", deleteLabel);
      option.append(select, remove);
      menu.appendChild(option);
    });
  }

  function renderTargetPlanSummary(targets, options = {}) {
    const summary = document.createElement("span");
    summary.className = `plan-picker-summary${options.iconsOnly ? " icons-only" : ""}`;
    if (options.name) {
      const name = document.createElement("span");
      name.className = "plan-picker-name";
      name.textContent = options.name;
      summary.appendChild(name);
    }
    normalizeTargetSnapshots(targets).forEach((target) => {
      const token = document.createElement("span");
      token.className = "plan-picker-target";
      const item = itemsByClass.get(target.itemClass) || {
        className: target.itemClass,
        name: target.itemName,
      };
      token.append(makeMaterialIcon(item, "plan-picker-icon"));
      if (!options.iconsOnly) {
        token.appendChild(document.createTextNode(`${target.itemName} (${formatNumber(target.rate)})`));
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
    const remove = target?.closest(".plan-picker-delete");
    if (remove instanceof HTMLButtonElement) {
      const planIndex = plans.findIndex((entry) => entry.id === remove.dataset.planId);
      if (planIndex >= 0) {
        plans.splice(planIndex, 1);
        savePlannerState();
        renderTargetPlanSelectors();
      }
      return;
    }
    const option = target?.closest(".plan-picker-option-select");
    if (option instanceof HTMLButtonElement) {
      const plan = plans.find((entry) => entry.id === option.dataset.planId);
      closeTargetPlanPickers();
      if (plan) {
        applyTargetPlan(plan);
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
      if (menu instanceof HTMLElement) menu.hidden = true;
    });
  }

  function applyTargetPlan(plan) {
    const normalized = normalizeTargetSnapshots(plan?.targets);
    if (!normalized.length) {
      return;
    }
    if (Array.isArray(plan.enabledRecipeIds)) {
      const selectable = selectableRecipeIdSet();
      selectedRecipeIds.clear();
      normalizedRecipeIdList(plan.enabledRecipeIds).forEach((recipeId) => {
        if (selectable.has(recipeId)) selectedRecipeIds.add(recipeId);
      });
    }
    if (Array.isArray(plan.disabledRawMaterialClasses)) {
      disabledRawMaterialClasses.clear();
      normalizeStringList(plan.disabledRawMaterialClasses).forEach((itemClass) => disabledRawMaterialClasses.add(itemClass));
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
    updateRecipeFilterButton();
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
    const count = recipeFilterButton.querySelector(".recipe-filter-change-count");
    if (!(count instanceof HTMLElement)) return;
    const defaults = defaultRecipeIdSet();
    const selectable = selectableRecipeIdSet();
    let changedCount = 0;
    selectable.forEach((recipeId) => {
      if (defaults.has(recipeId) !== selectedRecipeIds.has(recipeId)) changedCount += 1;
    });
    count.replaceChildren();
    count.hidden = changedCount === 0;
    if (changedCount > 0) {
      count.append(" (");
      const number = document.createElement("span");
      number.className = "recipe-filter-change-number";
      number.textContent = formatInteger(changedCount);
      count.append(number, ")");
    }
    recipeFilterButton.setAttribute(
      "aria-label",
      changedCount > 0 ? `${t("recipes.short")} (${formatInteger(changedCount)})` : t("recipes.short"),
    );
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
        analyticsContext: "target",
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
      analytics.track("target_removed");
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
        setStatus(t("status.unmatched", { name: rawName || t("common.unknown") }), true);
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
    exitCompactFocusView();
    const graph = buildFlowGraph(result);
    lastRenderedGraph = graph;
    if (!graph.nodes.length) {
      treeView.replaceChildren(makeEmptyMessage(t("results.noTarget")));
      return;
    }

    const scrollState = options.preserveViewport ? graphViewportScrollState() : null;
    const viewport = renderFlowGraph(graph);
    treeView.replaceChildren(viewport);
    fitGraphViewportHeight(viewport);
    layoutGraphEdgeLabels(graph);
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
        nonBaseRecipe: !isDefaultRecipeId(run.recipe.id),
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
    const maxColumn = Math.max(0, ...sortedColumns);
    const autoWidth = constants.marginX * 2 + constants.nodeWidth + maxColumn * (constants.nodeWidth + constants.columnGap);
    const autoHeight = Math.max(constants.minHeight, constants.marginY * 2 + maxColumnHeight);
    refreshEdgeFeedback(edges, nodeById);
    const busRoutes = routeEdges(edges, nodeById, constants);
    const { width, height } = graphExtents(nodes, autoWidth, autoHeight, edges);
    return { nodes, width, height, nodeById, busRoutes, columnGap: constants.columnGap };
  }

  function graphExtents(nodes, minWidth, minHeight, edges = []) {
    const padding = 56;
    const maxRight = Math.max(0, ...nodes.map((node) => Number(node.x) + Number(node.width) + padding));
    const maxBottom = Math.max(
      0,
      ...nodes.map((node) => Number(node.y) + Number(node.height) + padding),
      ...edges.filter((edge) => edge.busLaneY != null).map((edge) => Number(edge.busLaneY) + padding),
    );
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
      edge.pathElement?.setAttribute("class", graphEdgePathClass(edge));
    });
  }

  function graphEdgePathClass(edge) {
    return `graph-flow${edge.feedback ? " feedback" : ""}${edge.busRouteId ? " bus-route" : ""}`;
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

    // Process each column once from right to left. The immediate downstream
    // column is already in its final order, so each upstream column can align
    // directly to it without a later global score undoing that alignment.
    sortColumnsByNeighborScores(columns, [...sortedColumns].reverse(), edges, nodeById, balanceByClass);
  }

  function sortColumnsByNeighborScores(columns, orderedColumns, edges, nodeById, balanceByClass) {
    orderedColumns.forEach((column) => {
      const columnNodes = columns.get(column) || [];
      if (columnNodes.length <= 1) {
        return;
      }
      const rank = graphColumnRank(columns);
      columnNodes.sort((a, b) => {
        const scoreA = downstreamNeighborOrderScore(a, edges, nodeById, rank);
        const scoreB = downstreamNeighborOrderScore(b, edges, nodeById, rank);
        if (scoreA.priority !== scoreB.priority) {
          return scoreA.priority - scoreB.priority;
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

  function downstreamNeighborOrderScore(node, edges, nodeById, rank) {
    const adjacentNeighbors = [];
    const distantNeighbors = [];
    edges.forEach((edge) => {
      if (edge.source === node.id) {
        const target = nodeById.get(edge.target);
        if (target && target.column > node.column) {
          const neighbor = {
            rank: rank.get(target.id) ?? 0,
            weight: graphLayoutEdgeWeight(edge),
          };
          (Number(target.column) === Number(node.column) + 1 ? adjacentNeighbors : distantNeighbors).push(neighbor);
        }
      }
    });
    // A recipe feeding the very next column always takes precedence over one
    // that only feeds farther columns; nodes with no downstream edge come last.
    const neighbors = adjacentNeighbors.length ? adjacentNeighbors : distantNeighbors;
    if (!neighbors.length) return { priority: 2, value: Number.POSITIVE_INFINITY };
    const priority = adjacentNeighbors.length ? 0 : 1;
    const totalWeight = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
    const average = neighbors.reduce((sum, neighbor) => sum + neighbor.rank * neighbor.weight, 0) / totalWeight;
    const median = weightedMedianRank(neighbors, totalWeight);
    return {
      priority,
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

  function routeEdges(edges, nodeById, layout = {}) {
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
      const reverse = Number(target.column) < Number(source.column);
      edge.x1 = source.x + source.width;
      edge.y1 = source.y + source.height / 2 + edge.sourceOffset;
      edge.x2 = target.x;
      edge.y2 = target.y + target.height / 2 + edge.targetOffset;
      edge.busRouteId = "";
      edge.busDropX = null;
      edge.busLaneY = null;
      edge.busBranchPath = "";
      edge.busBranchGeometry = null;
      edge.busBranchLabel = null;
    });

    const busEdges = edges.filter((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return false;
      const columnSpan = Number(target.column) - Number(source.column);
      return columnSpan < 0 || columnSpan >= 2;
    });
    const directEdges = new Set(busEdges);
    const buses = assignGraphBusRoutes(busEdges, nodeById, layout);
    edges.forEach((edge) => {
      if (directEdges.has(edge)) {
        positionBusBranchLabel(edge);
      } else {
        positionEdgeLabel(edge);
      }
      edge.pathElement?.setAttribute("class", graphEdgePathClass(edge));
    });
    return buses;
  }

  function assignGraphBusRoutes(edges, nodeById, layout = {}) {
    if (!edges.length) return [];
    const lanes = graphBusLanes(Array.from(nodeById.values()));
    const busGroups = new Map();
    edges.forEach((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      const direction = Number(target?.column) < Number(source?.column) ? "reverse" : "forward";
      const key = `${edge.source}\n${direction}`;
      if (!busGroups.has(key)) busGroups.set(key, []);
      busGroups.get(key).push({ edge, direction });
    });
    const occupied = new Map(lanes.map((lane) => [lane.id, []]));
    const columnGap = Math.max(80, Number(layout.columnGap) || 285);
    const columnPitch = Math.max(200, Number(layout.nodeWidth) || 208) + columnGap;
    const buses = [];

    Array.from(busGroups.entries()).forEach(([busId, groupEntries]) => {
      const group = groupEntries.map((entry) => entry.edge);
      const source = nodeById.get(group[0].source);
      if (!source) return;
      const directions = new Map(groupEntries.map((entry) => [entry.edge, entry.direction]));
      const direction = groupEntries[0].direction;
      const boardX = graphBusBoardX(source, direction, columnGap, columnPitch);
      const start = {
        x: Number(source.x) + Number(source.width),
        y: Number(source.y) + Number(source.height) / 2,
      };
      let best = null;
      lanes.forEach((lane) => {
        const stops = group.map((edge) => {
          const target = nodeById.get(edge.target);
          const edgeDirection = directions.get(edge);
          const dropX = graphBusDropX(target, edgeDirection, columnGap, columnPitch);
          const branchCurve = graphBusBranchGeometry(edge, lane.y, dropX, edgeDirection);
          const clear = target && graphCurveGeometryIsClear(branchCurve, nodeById, target.id);
          return { edge, target, dropX, edgeDirection, clear };
        });
        if (stops.some((stop) => !stop.clear)) return;
        const minX = Math.min(boardX, ...stops.map((stop) => stop.dropX));
        const maxX = Math.max(boardX, ...stops.map((stop) => stop.dropX));
        if (!graphHorizontalRouteIsClear(lane.y, minX, maxX, nodeById)) return;
        const sourceCurve = graphBusSourceCurve(start, boardX, lane.y, direction);
        if (!graphCurveGeometryIsClear(sourceCurve, nodeById, source.id)) return;
        const laneOccupants = occupied.get(lane.id) || [];
        const overlaps = laneOccupants.filter((interval) => minX < interval.maxX && maxX > interval.minX).length;
        const sourceDistance = Math.abs(start.y - lane.y);
        const targetDistance = group.reduce((sum, edge) => sum + Math.abs(edge.y2 - lane.y), 0) / group.length;
        const aboveSourcePenalty = lane.y < start.y ? 500 : 0;
        const score = sourceDistance * 5 + targetDistance * 0.35 + aboveSourcePenalty + overlaps * 10000;
        if (!best || score < best.score) best = { lane, stops, sourceCurve, minX, maxX, score };
      });

      if (!best) {
        best = graphFallbackBusRoute(group, source, nodeById, columnGap, columnPitch, lanes, direction);
      }
      if (!best) return;
      best.lane.usage += 1;
      occupied.get(best.lane.id)?.push({ minX: best.minX, maxX: best.maxX, busId });
      const stopsByX = new Map();
      const bus = {
        id: busId,
        sourceId: source.id,
        direction,
        color: source.edgeColor || group[0].color,
        width: GRAPH_FLOW_WIDTH,
        boardX,
        y: best.lane.y,
        sourceCurve: best.sourceCurve || graphBusSourceCurve(start, boardX, best.lane.y, direction),
        edges: group,
        directions,
        stops: [],
        trunk: null,
        sourceElement: null,
        trunkElement: null,
      };
      group.forEach((edge) => {
        const target = nodeById.get(edge.target);
        const edgeDirection = directions.get(edge);
        const dropX = graphBusDropX(target, edgeDirection, columnGap, columnPitch);
        const stopId = `${busId}\n${Math.round(dropX * 10)}`;
        if (!stopsByX.has(stopId)) {
          stopsByX.set(stopId, {
            id: stopId,
            x: dropX,
            edges: [],
            element: null,
          });
        }
        const stop = stopsByX.get(stopId);
        stop.edges.push(edge);
        edge.busRouteId = busId;
        edge.busDropX = dropX;
        edge.busLaneY = best.lane.y;
        edge.busBranchGeometry = graphBusBranchGeometry(edge, best.lane.y, dropX, edgeDirection);
        edge.busBranchPath = graphBusBranchPath(edge, best.lane.y, dropX, edgeDirection);
        edge.busBranchLabel = graphBusBranchLabel(edge.busBranchGeometry);
      });
      bus.stops = Array.from(stopsByX.values());
      const trunkEndX = direction === "reverse"
        ? Math.min(...bus.stops.map((stop) => stop.x))
        : Math.max(...bus.stops.map((stop) => stop.x));
      bus.trunk = `M ${boardX} ${best.lane.y} L ${trunkEndX} ${best.lane.y}`;
      buses.push(bus);
    });
    return buses;
  }

  function graphBusLanes(nodes) {
    const clearance = GRAPH_BUS_CLEARANCE + GRAPH_FLOW_WIDTH / 2;
    const intervals = nodes
      .map((node) => ({
        min: Number(node.y) - clearance,
        max: Number(node.y) + Number(node.height) + clearance,
      }))
      .sort((a, b) => a.min - b.min);
    const merged = [];
    intervals.forEach((interval) => {
      const previous = merged[merged.length - 1];
      if (previous && interval.min <= previous.max) {
        previous.max = Math.max(previous.max, interval.max);
      } else {
        merged.push({ ...interval });
      }
    });
    if (!merged.length) return [];
    const lanes = [];
    const spacing = GRAPH_BUS_LANE_SPACING;
    const addLanesInGap = (start, end) => {
      let index = 0;
      for (let y = start + GRAPH_FLOW_WIDTH / 2; y <= end - GRAPH_FLOW_WIDTH / 2; y += spacing) {
        lanes.push({ id: Math.round(y * 10), y, usage: index });
        index += 1;
      }
    };
    const firstTop = Math.min(...nodes.map((node) => Number(node.y)));
    const lastBottom = Math.max(...nodes.map((node) => Number(node.y) + Number(node.height)));
    for (let offset = GRAPH_BUS_LANE_SPACING + 3; offset <= 3 * GRAPH_BUS_LANE_SPACING; offset += GRAPH_BUS_LANE_SPACING) {
      const y = Math.max(8, firstTop - offset);
      if (y < merged[0].min) lanes.push({ id: Math.round(y * 10), y, usage: 0 });
    }
    for (let index = 0; index < merged.length - 1; index += 1) {
      addLanesInGap(merged[index].max, merged[index + 1].min);
    }
    for (let offset = GRAPH_BUS_LANE_SPACING + 3; offset <= 3 * GRAPH_BUS_LANE_SPACING; offset += GRAPH_BUS_LANE_SPACING) {
      const y = lastBottom + offset;
      lanes.push({ id: Math.round(y * 10), y, usage: 0 });
    }
    const uniqueLanes = new Map();
    lanes.sort((a, b) => a.y - b.y).forEach((lane) => {
      if (!uniqueLanes.has(lane.id)) uniqueLanes.set(lane.id, lane);
    });
    const result = Array.from(uniqueLanes.values());
    result.forEach((lane, index) => {
      lane.usage = 0;
      lane.order = index;
    });
    return result;
  }

  function graphHorizontalRouteIsClear(y, x1, x2, nodeById) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (const node of nodeById.values()) {
      const nodeLeft = Number(node.x) - GRAPH_BUS_CLEARANCE;
      const nodeRight = Number(node.x) + Number(node.width) + GRAPH_BUS_CLEARANCE;
      const nodeTop = Number(node.y) - GRAPH_BUS_CLEARANCE - GRAPH_FLOW_WIDTH / 2;
      const nodeBottom = Number(node.y) + Number(node.height) + GRAPH_BUS_CLEARANCE + GRAPH_FLOW_WIDTH / 2;
      if (maxX > nodeLeft && minX < nodeRight && y > nodeTop && y < nodeBottom) return false;
    }
    return true;
  }

  function graphEdgePathIsBlocked(edge, nodeById) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return false;
    for (let step = 1; step < 12; step += 1) {
      const point = edgePoint(edge, step / 12);
      for (const node of nodeById.values()) {
        if (node.id === source.id || node.id === target.id) continue;
        if (
          point.x >= node.x - GRAPH_BUS_CLEARANCE
          && point.x <= node.x + node.width + GRAPH_BUS_CLEARANCE
          && point.y >= node.y - GRAPH_BUS_CLEARANCE
          && point.y <= node.y + node.height + GRAPH_BUS_CLEARANCE
        ) return true;
      }
    }
    return false;
  }

  function graphFallbackBusRoute(group, source, nodeById, columnGap, columnPitch, lanes, direction) {
    const lane = lanes.reduce((best, candidate) => {
      const distance = group.reduce((sum, edge) => sum + Math.abs(edge.y1 - candidate.y) + Math.abs(edge.y2 - candidate.y), 0);
      return !best || distance < best.distance ? { lane: candidate, distance } : best;
    }, null)?.lane;
    if (!lane) return null;
    const boardX = graphBusBoardX(source, direction, columnGap, columnPitch);
    const targetXs = group.map((edge) => {
      const target = nodeById.get(edge.target);
      return target ? graphBusDropX(target, graphBusEdgeDirection(source, target), columnGap, columnPitch) : edge.x2;
    });
    return {
      lane,
      boardX,
      targetXs,
      minX: Math.min(boardX, ...targetXs),
      maxX: Math.max(boardX, ...targetXs),
    };
  }

  function graphBusBoardX(source, direction, columnGap, columnPitch) {
    if (direction === "reverse") return Number(source.x) + Number(source.width);
    return Number(source.x) + columnPitch;
  }

  function graphBusDropX(target, direction, columnGap, columnPitch) {
    if (!target) return 0;
    if (direction === "reverse") return Number(target.x);
    return Number(target.x) - columnGap;
  }

  function graphBusSourceCurve(start, boardX, laneY, direction) {
    if (direction !== "reverse") return graphCurveGeometry(start, { x: boardX, y: laneY });
    const reach = Math.min(72, Math.max(36, Math.abs(laneY - start.y) * 0.22));
    const control1 = { x: boardX + reach, y: start.y };
    const control2 = { x: boardX + reach, y: laneY };
    return {
      p0: start,
      c1: control1,
      c2: control2,
      p3: { x: boardX, y: laneY },
      path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${boardX} ${laneY}`,
    };
  }

  function graphBusEdgeDirection(source, target) {
    const columnSpan = Number(target?.column) - Number(source?.column);
    return columnSpan < 0 ? "reverse" : "forward";
  }

  function graphBusBranchGeometry(edge, laneY, dropX, direction) {
    const start = { x: dropX, y: laneY };
    const end = { x: edge.x2, y: edge.y2 };
    if (direction === "reverse" && Math.abs(end.x - start.x) < 0.5) {
      const deltaY = end.y - start.y;
      const reach = Math.min(48, Math.max(24, Math.abs(deltaY) * 0.25));
      const c1 = { x: start.x - reach, y: start.y };
      const c2 = { x: end.x - reach, y: end.y };
      return {
        p0: start,
        c1,
        c2,
        p3: end,
        path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
      };
    }
    return graphCurveGeometry(start, end);
  }

  function graphBusBranchPath(edge, laneY, dropX, direction) {
    return graphBusBranchGeometry(edge, laneY, dropX, direction).path;
  }

  function graphBusBranchLabel(curve) {
    const point = cubicPoint(curve.p0, curve.c1, curve.c2, curve.p3, 0.62);
    return { x: point.x, y: point.y };
  }

  function graphCurveGeometry(start, end) {
    const direction = Math.sign(end.x - start.x) || 1;
    const distance = Math.abs(end.x - start.x);
    const reach = Math.min(distance / 2, 150, Math.max(4, distance * 0.42));
    const c1 = {
      x: start.x + direction * reach,
      y: start.y,
    };
    const c2 = {
      x: end.x - direction * reach,
      y: end.y,
    };
    return {
      p0: start,
      c1,
      c2,
      p3: end,
      path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    };
  }

  function graphCurveGeometryIsClear(curve, nodeById, excludeId) {
    for (let step = 1; step < 20; step += 1) {
      const point = cubicPoint(curve.p0, curve.c1, curve.c2, curve.p3, step / 20);
      for (const node of nodeById.values()) {
        if (node.id === excludeId) continue;
        if (
          point.x >= node.x - GRAPH_BUS_CLEARANCE
          && point.x <= node.x + node.width + GRAPH_BUS_CLEARANCE
          && point.y >= node.y - GRAPH_BUS_CLEARANCE
          && point.y <= node.y + node.height + GRAPH_BUS_CLEARANCE
        ) return false;
      }
    }
    return true;
  }

  function graphCurveRouteIsClear(start, end, nodeById, excludeId) {
    return graphCurveGeometryIsClear(graphCurveGeometry(start, end), nodeById, excludeId);
  }

  function positionBusBranchLabel(edge) {
    if (!edge.busBranchLabel) return;
    edge.labelX = edge.busBranchLabel.x;
    edge.labelY = edge.busBranchLabel.y;
  }

  function layoutGraphEdgeLabels(graph) {
    if (!graph.canvas?.isConnected) return;
    const labels = graph.edges
      .filter((edge) => edge.labelElement)
      .map((edge) => {
        const label = edge.labelElement;
        const control = edge.busBranchGeometry || edgeControlPoints(edge);
        const curve = edge.busBranchGeometry || {
          p0: { x: edge.x1, y: edge.y1 },
          c1: control.c1,
          c2: control.c2,
          p3: { x: edge.x2, y: edge.y2 },
        };
        return {
          edge,
          label,
          curve,
          width: Math.max(1, label.offsetWidth),
          height: Math.max(1, label.offsetHeight),
          highlighted: label.classList.contains("highlight-edge"),
        };
      })
      .sort((a, b) => Number(b.highlighted) - Number(a.highlighted)
        || (b.width * b.height) - (a.width * a.height)
        || String(a.edge.id).localeCompare(String(b.edge.id)));
    const padding = 6;
    const nodeBounds = graph.nodes.map((node) => ({
      left: Number(node.x) - padding,
      right: Number(node.x) + Number(node.width) + padding,
      top: Number(node.y) - padding,
      bottom: Number(node.y) + Number(node.height) + padding,
    }));
    const placed = [];
    const positions = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.1, 0.9, 0.04, 0.96];
    const offsets = [0, -16, 16, -32, 32, -48, 48, -64, 64, -88, 88, -112, 112];

    labels.forEach((entry) => {
      const { edge, curve, width, height, label } = entry;
      let best = null;
      positions.forEach((t) => {
        const point = cubicPoint(curve.p0, curve.c1, curve.c2, curve.p3, t);
        const tangent = cubicTangent(curve.p0, curve.c1, curve.c2, curve.p3, t);
        const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
        const normal = { x: -tangent.y / tangentLength, y: tangent.x / tangentLength };
        offsets.forEach((offset) => {
          const x = point.x + normal.x * offset;
          const y = point.y + normal.y * offset;
          const rect = {
            left: x - width / 2 - padding,
            right: x + width / 2 + padding,
            top: y - height / 2 - padding,
            bottom: y + height / 2 + padding,
          };
          const nodeCollisions = nodeBounds.reduce((count, node) => count + Number(rectanglesOverlap(rect, node)), 0);
          const labelCollisions = placed.reduce((count, previous) => count + Number(rectanglesOverlap(rect, previous)), 0);
          const distanceCost = Math.abs(t - 0.5) * 160 + Math.abs(offset) * 1.25;
          const score = nodeCollisions * 1000000 + labelCollisions * 100000 + distanceCost;
          if (!best || score < best.score) best = { x, y, rect, score, nodeCollisions, labelCollisions };
        });
      });
      if (!best) return;
      edge.labelX = best.x;
      edge.labelY = best.y;
      label.style.left = `${best.x}px`;
      label.style.top = `${best.y}px`;
      placed.push(best.rect);
    });
  }

  function cubicTangent(p0, p1, p2, p3, t) {
    const inverse = 1 - t;
    return {
      x: 3 * inverse * inverse * (p1.x - p0.x)
        + 6 * inverse * t * (p2.x - p1.x)
        + 3 * t * t * (p3.x - p2.x),
      y: 3 * inverse * inverse * (p1.y - p0.y)
        + 6 * inverse * t * (p2.y - p1.y)
        + 3 * t * t * (p3.y - p2.y),
    };
  }

  function rectanglesOverlap(left, right) {
    return left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top;
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
      path.setAttribute("class", graphEdgePathClass(edge));
      path.setAttribute("d", edgePath(edge));
      path.setAttribute("stroke", edge.color);
      path.setAttribute("stroke-width", String(edge.width));
      edge.pathElement = path;
      svg.appendChild(path);
    });
    renderGraphBusRoutes(graph);
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
    if (!graph.isCompactFocus) {
      bindGraphSelectionClear(viewport, graph);
      bindGraphPan(viewport);
    }
    applyGraphSelection(graph, selectedGraphRecipeId);
    return viewport;
  }

  function renderGraphBusRoutes(graph) {
    if (!graph.svg) return;
    graph.svg.querySelectorAll(".graph-bus-route-group").forEach((element) => element.remove());
    (graph.busRoutes || []).forEach((bus) => {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "graph-bus-route-group");
      group.setAttribute("data-bus-id", bus.id);
      bus.groupElement = group;

      const sourcePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      sourcePath.setAttribute("class", "graph-flow bus-route graph-bus-source");
      sourcePath.setAttribute("d", bus.sourceCurve.path);
      sourcePath.setAttribute("stroke", bus.color);
      sourcePath.setAttribute("stroke-width", String(bus.width));
      bus.sourceElement = sourcePath;
      group.appendChild(sourcePath);

      const trunkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      trunkPath.setAttribute("class", "graph-flow bus-route graph-bus-trunk");
      trunkPath.setAttribute("d", bus.trunk);
      trunkPath.setAttribute("stroke", bus.color);
      trunkPath.setAttribute("stroke-width", String(bus.width));
      bus.trunkElement = trunkPath;
      group.appendChild(trunkPath);

      graph.svg.appendChild(group);
    });
  }

  function handlePostCalculationRecipeLocation(recipeIds, materialClasses, focusMaterialClass = "") {
    const normalizedFocusMaterialClass = String(focusMaterialClass || "").trim();
    if (normalizedFocusMaterialClass && locateGraphMaterial(normalizedFocusMaterialClass)) {
      changedRecipeIdsToLocate = [];
      if (locateChangedRecipesButton) locateChangedRecipesButton.hidden = true;
      return;
    }
    const ids = normalizedRecipeIdList(recipeIds);
    const requestedMaterials = new Set(normalizedRecipeIdList(materialClasses));
    const presentIds = ids.filter((id) => lastRenderedGraph?.nodeById?.has(id));
    const locatedIds = new Set(presentIds);
    (lastRenderedGraph?.nodes || []).forEach((node) => {
      if (node.type !== "recipe" || !requestedMaterials.size) return;
      const producesChangedMaterial = (node.recipe?.currentOutputs || []).some((output) => (
        requestedMaterials.has(String(output.item?.className || ""))
      ));
      if (producesChangedMaterial) locatedIds.add(node.id);
    });
    changedRecipeIdsToLocate = Array.from(locatedIds);
    if (locateChangedRecipesButton) {
      locateChangedRecipesButton.hidden = changedRecipeIdsToLocate.length < 2;
    }
    if (changedRecipeIdsToLocate.length === 1) {
      locateGraphNode(changedRecipeIdsToLocate[0]);
    }
  }

  function locateGraphMaterial(materialClass) {
    const graph = lastRenderedGraph;
    const normalizedMaterialClass = String(materialClass || "").trim();
    if (!graph || !normalizedMaterialClass) return false;
    const recipeNodes = graph.nodes.filter((node) => node.type === "recipe");
    const primaryRecipe = recipeNodes.find((node) => (
      String((node.recipe?.currentOutputs || [])[0]?.item?.className || node.recipe?.primaryOutput?.className || "")
        === normalizedMaterialClass
    ));
    const anyRecipe = recipeNodes.find((node) => (
      (node.recipe?.currentOutputs || []).some((output) => output.item?.className === normalizedMaterialClass)
    ));
    const rawNode = graph.nodes.find((node) => (
      node.type === "raw" && node.item?.className === normalizedMaterialClass
    ));
    return locateGraphNode((primaryRecipe || anyRecipe || rawNode)?.id || "");
  }

  function locateGraphNode(nodeId) {
    const graph = lastRenderedGraph;
    const node = graph?.nodeById?.get(nodeId);
    const viewport = treeView.querySelector(".graph-viewport");
    if (!graph || !node || !(viewport instanceof HTMLElement)) return false;
    selectTab("tree");
    selectedGraphHighlightDepth = 1;
    applyGraphSelection(graph, nodeId);
    viewport.scrollTo({
      left: Math.max(0, node.x + node.width / 2 - viewport.clientWidth / 2),
      top: Math.max(0, node.y + node.height / 2 - viewport.clientHeight / 2),
      behavior: "smooth",
    });
    node.element?.classList.remove("located");
    window.requestAnimationFrame(() => node.element?.classList.add("located"));
    window.setTimeout(() => node.element?.classList.remove("located"), 1800);
    return true;
  }

  function renderGraphNode(node, graph) {
    const switchRecipe = graphNodeSwitchRecipe(node);
    const hasRecipeFilterShortcut = node.type === "recipe";
    const hasSwitchButton = !graph.isCompactFocus && (hasRecipeFilterShortcut || canSwitchRecipe(switchRecipe));
    const recipeMaterial = hasRecipeFilterShortcut
      ? ((node.recipe?.currentOutputs || [])[0]?.item || node.recipe?.primaryOutput)
      : switchRecipe?.primaryOutput;
    const card = document.createElement("article");
    card.className = `graph-node ${node.type}${node.alternate ? " alternate" : ""}`;
    card.dataset.nodeId = node.id;
    card.addEventListener("dragstart", (event) => event.preventDefault());
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button")) {
        return;
      }
      event.stopPropagation();
      if (typeof graph.onCompactNodeSelected === "function") {
        graph.onCompactNodeSelected(node, event);
      } else {
        selectGraphNode(graph, node.id);
      }
    });
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
      switchButton.title = t("recipes.filterOpen");
      switchButton.setAttribute("aria-label", t("recipes.showForMaterial", { name: recipeMaterial?.name || node.title }));
      switchButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openRecipeFilterDialog({ materialClass: recipeMaterial?.className || "" });
      });
      card.appendChild(switchButton);
    }

    if (node.type === "recipe" && !graph.isCompactFocus) {
      const focusButton = document.createElement("button");
      focusButton.type = "button";
      focusButton.className = "compact-focus-entry";
      focusButton.hidden = true;
      focusButton.title = t("results.compactFocus");
      focusButton.setAttribute("aria-label", t("results.compactFocus"));
      focusButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 12h2.25m4.5 0h2.25"/><circle cx="5" cy="12" r="2.5"/><circle class="focus-center" cx="12" cy="12" r="3.5"/><circle cx="19" cy="12" r="2.5"/></svg>';
      focusButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (graph.isCompactFocus) {
          exitCompactFocusView(true);
        } else {
          enterCompactFocusView(graph, node.id);
        }
      });
      card.appendChild(focusButton);
      node.focusButton = focusButton;
    }

    if (graphNodeHasCheck(node)) {
      const checkLabel = document.createElement("label");
      checkLabel.className = "graph-check-control";
      checkLabel.title = t("graph.checkTitle", { type: graphNodeCheckLabel(node) });
      checkLabel.addEventListener("click", (event) => event.stopPropagation());
      checkLabel.addEventListener("pointerdown", (event) => event.stopPropagation());

      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      checkInput.className = "graph-check-input";
      checkInput.setAttribute("aria-label", t("graph.checkAria", { name: node.title || graphNodeCheckLabel(node) }));
      const sourceCheckInput = node.sourceElement?.querySelector(".graph-check-input");
      checkInput.checked = sourceCheckInput instanceof HTMLInputElement ? sourceCheckInput.checked : false;
      if (graph.isCompactFocus) {
        checkInput.addEventListener("change", () => {
          const originalCheckInput = node.sourceElement?.querySelector(".graph-check-input");
          if (originalCheckInput instanceof HTMLInputElement) {
            originalCheckInput.checked = checkInput.checked;
          }
        });
      }
      checkLabel.appendChild(checkInput);
      card.appendChild(checkLabel);
    }

    let media = null;
    if (node.type === "recipe") {
      media = document.createElement("div");
      media.className = "graph-node-media";
      const iconPath = String(node.recipe?.deviceIconPath || "").trim();
      if (iconPath) {
        const icon = document.createElement("img");
        icon.className = "graph-device-icon";
        icon.src = iconPath;
        icon.alt = node.recipe?.deviceIcons?.[0]?.name || t("graph.building");
        icon.draggable = false;
        media.appendChild(icon);
      }
      card.classList.add("has-media");
    } else {
      const iconPath = materialIconPath(node.item);
      if (iconPath) {
        media = document.createElement("div");
        media.className = "graph-node-media graph-material-media";
        const icon = document.createElement("img");
        icon.className = "graph-material-icon";
        icon.src = iconPath;
        icon.alt = node.item?.name || node.title || t("graph.material");
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
    if (node.type === "recipe" && node.nonBaseRecipe) {
      kind.classList.add("alternate-recipe-kind");
      kind.textContent = "";
      const alternateTag = document.createElement("span");
      alternateTag.className = "alternate-recipe-tag";
      alternateTag.textContent = "ALT";
      alternateTag.title = t("kind.alternateRecipe");
      alternateTag.setAttribute("aria-label", t("kind.alternateRecipe"));
      kind.append(alternateTag, document.createTextNode(graphNodeKindText(node)));
    }
    if (node.type === "recipe") {
      kind.title = node.recipe?.deviceIcons?.[0]?.name || "";
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

  function enterCompactFocusView(graph, nodeId) {
    const node = graph?.nodeById?.get(nodeId);
    const viewport = compactFocusViewport || treeView.querySelector(".graph-viewport:not(.compact-focus-graph-viewport)");
    if (!node || node.type !== "recipe" || !(viewport instanceof HTMLElement)) return;

    const previousFocusRoot = compactFocusView;
    const previousGraph = previousFocusRoot?.graph;
    const previousRects = new Map((previousGraph?.nodes || []).map((previousNode) => [
      previousNode.id,
      previousNode.element?.getBoundingClientRect?.() || null,
    ]));
    compactFocusView?.remove();
    compactFocusViewport = viewport;
    compactFocusView = renderCompactFocusView(graph, nodeId);
    const focusRoot = compactFocusView;
    const focusGraph = focusRoot.graph;
    const sourceRects = new Map(focusGraph.nodes.map((focusNode) => {
      const previousRect = previousRects.get(focusNode.id);
      const sourceNode = graph.nodeById.get(focusNode.id);
      const sourceRect = previousRect?.width
        ? previousRect
        : sourceNode?.element?.getBoundingClientRect?.() || null;
      return [focusNode.id, sourceRect];
    }));
    prepareCompactFocusEntry(focusGraph);
    treeView.appendChild(compactFocusView);
    viewport.hidden = true;
    const focusViewport = focusRoot.querySelector(".compact-focus-graph-viewport");
    if (focusViewport instanceof HTMLElement) {
      focusViewport.scrollLeft = Math.max(0, focusGraph.focusCenterX - focusViewport.clientWidth / 2);
    }
    window.requestAnimationFrame(() => {
      if (compactFocusView !== focusRoot || !focusRoot.isConnected) return;
      layoutGraphEdgeLabels(focusGraph);
      playCompactFocusEntry(focusRoot, sourceRects);
    });
  }

  function prepareCompactFocusEntry(graph) {
    graph.svg.style.opacity = "0";
    graph.highlightSvg.style.opacity = "0";
    graph.edges.forEach((edge) => {
      if (edge.labelElement) edge.labelElement.style.opacity = "0";
    });
  }

  function playCompactFocusEntry(root, sourceRects) {
    const graph = root.graph;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animations = [];
    if (!reduceMotion && typeof Element.prototype.animate === "function") {
      const viewport = root.querySelector(".compact-focus-graph-viewport");
      const viewportRect = viewport?.getBoundingClientRect?.();
      graph.nodes.forEach((node) => {
        const targetRect = node.element?.getBoundingClientRect();
        if (!targetRect?.width) return;
        let sourceRect = sourceRects.get(node.id);
        if (!sourceRect?.width && viewportRect) {
          const entersFromLeft = node.column < 1;
          sourceRect = {
            left: entersFromLeft ? viewportRect.left - targetRect.width - 48 : viewportRect.right + 48,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          };
        }
        if (!sourceRect?.width) return;
        const offsetX = sourceRect.left - targetRect.left;
        const offsetY = sourceRect.top - targetRect.top;
        if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) return;
        animations.push(node.element.animate([
          { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ], {
          duration: 680,
          easing: "cubic-bezier(0.2, 0.72, 0.25, 1)",
        }));
      });
    }

    Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (compactFocusView !== root || !root.isConnected) return;
      [graph.svg, graph.highlightSvg].forEach((svg) => {
        svg.style.transition = reduceMotion ? "none" : "opacity 240ms ease-out";
        svg.style.opacity = "1";
      });
      graph.edges.forEach((edge) => {
        if (!edge.labelElement) return;
        edge.labelElement.style.transition = reduceMotion ? "none" : "opacity 240ms ease-out";
        edge.labelElement.style.opacity = "1";
      });
    });
  }

  function exitCompactFocusView(centerSelection = false) {
    if (!compactFocusView) return;
    compactFocusView.remove();
    compactFocusView = null;
    if (compactFocusViewport?.isConnected) {
      const viewport = compactFocusViewport;
      viewport.hidden = false;
      window.requestAnimationFrame(() => {
        fitGraphViewportHeight(viewport);
        if (lastRenderedGraph?.canvas?.isConnected) {
          layoutGraphEdgeLabels(lastRenderedGraph);
          const node = centerSelection ? lastRenderedGraph.nodeById.get(selectedGraphRecipeId) : null;
          if (node) {
            viewport.scrollTo({
              left: Math.max(0, node.x + node.width / 2 - viewport.clientWidth / 2),
              top: Math.max(0, node.y + node.height / 2 - viewport.clientHeight / 2),
              behavior: "smooth",
            });
          }
        }
      });
    }
    compactFocusViewport = null;
  }

  function renderCompactFocusView(graph, nodeId) {
    const focusedNode = graph.nodeById.get(nodeId);
    const { leftNodes, rightNodes } = compactFocusNeighbors(graph, nodeId);
    const root = document.createElement("section");
    root.className = "compact-focus-view";
    root.setAttribute("aria-label", t("results.compactFocus"));
    root.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".graph-node, .graph-edge-label, button, input, select, textarea, a")) return;
      exitCompactFocusView(true);
    });

    const compactGraph = createCompactFocusGraph(graph, nodeId, leftNodes, rightNodes);
    root.graph = compactGraph;
    const graphViewport = renderFlowGraph(compactGraph);
    graphViewport.classList.add("compact-focus-graph-viewport");
    root.appendChild(graphViewport);

    const hint = document.createElement("p");
    hint.className = "compact-focus-exit-hint";
    hint.textContent = t("results.compactExitHint");
    root.appendChild(hint);
    return root;
  }

  function compactFocusNeighbors(graph, focusedNodeId) {
    const focusedNode = graph.nodeById.get(focusedNodeId);
    const focusedCenterX = Number(focusedNode?.x || 0) + Number(focusedNode?.width || 0) / 2;
    const incidentById = new Map();
    graph.edges.forEach((edge) => {
      if (edge.source !== focusedNodeId && edge.target !== focusedNodeId) return;
      const otherId = edge.source === focusedNodeId ? edge.target : edge.source;
      if (otherId === focusedNodeId) return;
      const entry = incidentById.get(otherId) || { node: graph.nodeById.get(otherId), hasIncoming: false };
      if (edge.target === focusedNodeId) entry.hasIncoming = true;
      incidentById.set(otherId, entry);
    });
    const sortBySourcePosition = (left, right) => left.y - right.y || left.x - right.x;
    const leftNodes = [];
    const rightNodes = [];
    incidentById.forEach(({ node, hasIncoming }) => {
      if (!node) return;
      const nodeCenterX = Number(node.x || 0) + Number(node.width || 0) / 2;
      if (nodeCenterX < focusedCenterX || (nodeCenterX === focusedCenterX && hasIncoming)) {
        leftNodes.push(node);
      } else {
        rightNodes.push(node);
      }
    });
    return {
      leftNodes: leftNodes.sort(sortBySourcePosition),
      rightNodes: rightNodes.sort(sortBySourcePosition),
    };
  }

  function createCompactFocusGraph(sourceGraph, nodeId, upstreamNodes, downstreamNodes) {
    const focused = sourceGraph.nodeById.get(nodeId);
    const viewportWidth = Math.max(320, window.innerWidth);
    const viewportHeight = Math.max(360, window.innerHeight);
    const sideGap = 285;
    let centerX = viewportWidth / 2 - focused.width / 2;
    const leftWidth = Math.max(focused.width, ...upstreamNodes.map((node) => node.width));
    const rightWidth = Math.max(focused.width, ...downstreamNodes.map((node) => node.width));
    let leftX = centerX - sideGap - leftWidth;
    let rightX = centerX + focused.width + sideGap;
    const horizontalShift = Math.max(0, 32 - leftX);
    centerX += horizontalShift;
    leftX += horizontalShift;
    rightX += horizontalShift;
    const verticalGap = 42;
    const stackHeight = (nodes) => nodes.reduce((sum, node) => sum + node.height, 0)
      + Math.max(0, nodes.length - 1) * verticalGap;
    const leftHeight = stackHeight(upstreamNodes);
    const rightHeight = stackHeight(downstreamNodes);
    const graphHeight = Math.max(viewportHeight, leftHeight + 100, rightHeight + 100, focused.height + 100);
    const centerY = (viewportHeight - focused.height) / 2;
    const placeStack = (nodes, x, width, totalHeight) => {
      let y = Math.max(64, (viewportHeight - totalHeight) / 2);
      if (totalHeight > viewportHeight - 96) y = 64;
      return nodes.map((node) => {
        const copy = { ...node, x: x + width - node.width, y, element: null, focusButton: null };
        y += node.height + verticalGap;
        return copy;
      });
    };
    const focusCopy = { ...focused, x: centerX, y: centerY, column: 1, element: null, focusButton: null };
    const leftCopies = placeStack(upstreamNodes, leftX, leftWidth, leftHeight).map((node) => ({ ...node, column: 0 }));
    const rightCopies = placeStack(downstreamNodes, rightX, rightWidth, rightHeight)
      .map((node) => ({ ...node, x: rightX, column: 2 }));
    const nodes = [...leftCopies, focusCopy, ...rightCopies].map((node) => ({
      ...node,
      sourceElement: sourceGraph.nodeById.get(node.id)?.element || null,
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges = sourceGraph.edges
      .filter((edge) => (edge.source === nodeId && nodeById.has(edge.target)) || (edge.target === nodeId && nodeById.has(edge.source)))
      .map((edge) => ({ ...edge, pathElement: null, labelElement: null }));
    const width = Math.max(viewportWidth, rightX + rightWidth + 32);
    const busRoutes = routeEdges(edges, nodeById, { columnGap: sideGap, nodeWidth: Math.max(leftWidth, focused.width, rightWidth) });
    const compactGraph = {
      nodes,
      nodeById,
      edges,
      width,
      height: graphHeight,
      busRoutes,
      columnGap: sideGap,
      selectedNodeId: nodeId,
      isCompactFocus: true,
      sourceGraph,
      focusCenterX: centerX + focused.width / 2,
      onCompactNodeSelected(node) {
        if (node.type !== "recipe" || node.id === nodeId) return;
        selectedGraphHighlightDepth = 1;
        selectedGraphRecipeId = node.id;
        applyGraphSelection(sourceGraph, node.id);
        enterCompactFocusView(sourceGraph, node.id);
      },
    };
    return compactGraph;
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
    return node.type === "raw" ? t("category.RawMaterial") : t("kind.recipe");
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

    graph.highlightSvg?.querySelectorAll(".graph-bus-highlight-group").forEach((element) => element.remove());
    (graph.busRoutes || []).forEach((bus) => {
      const highlightedBusEdges = bus.edges.filter((edge) => highlightedEdgeIds.has(edge.id));
      [bus.sourceElement, bus.trunkElement].filter(Boolean).forEach((element) => {
        element.classList.remove("highlight-edge", "flowing-edge");
        element.classList.toggle("dimmed", hasSelection);
      });
      if (hasSelection && highlightedBusEdges.length && graph.highlightSvg) {
        renderGraphBusHighlight(bus, highlightedBusEdges, graph.highlightSvg);
      }
    });

    if (graph.canvas?.isConnected) layoutGraphEdgeLabels(graph);

    graph.nodes.forEach((node) => {
      const isSelected = node.id === selectedNodeId;
      const isUpstream = upstreamNodeIds.has(node.id);
      const isDownstream = downstreamNodeIds.has(node.id);
      const isHighlighted = highlightedNodeIds.has(node.id);
      node.element?.classList.toggle("selected", isSelected);
      node.element?.classList.toggle("highlight-upstream", isUpstream);
      node.element?.classList.toggle("highlight-downstream", isDownstream);
      node.element?.classList.toggle("dimmed", hasSelection && !isHighlighted);
      if (node.focusButton) {
        node.focusButton.hidden = !(isSelected && node.type === "recipe");
      }
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

  function renderGraphBusHighlight(bus, highlightedEdges, highlightSvg) {
    const highlightedStops = highlightedEdges
      .map((edge) => Number(edge.busDropX))
      .filter(Number.isFinite);
    if (!highlightedStops.length) return;

    const terminalX = bus.direction === "reverse"
      ? Math.min(...highlightedStops)
      : Math.max(...highlightedStops);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "graph-bus-highlight-group");

    const sourcePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    sourcePath.setAttribute("class", "graph-flow bus-route highlight-edge flowing-edge");
    sourcePath.setAttribute("d", bus.sourceCurve.path);
    sourcePath.setAttribute("stroke", bus.color);
    sourcePath.setAttribute("stroke-width", String(bus.width));
    group.appendChild(sourcePath);

    const trunkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    trunkPath.setAttribute("class", "graph-flow bus-route highlight-edge flowing-edge");
    trunkPath.setAttribute("d", `M ${bus.boardX} ${bus.y} L ${terminalX} ${bus.y}`);
    trunkPath.setAttribute("stroke", bus.color);
    trunkPath.setAttribute("stroke-width", String(bus.width));
    group.appendChild(trunkPath);

    highlightSvg.appendChild(group);
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
    analytics.track("recipe_filter_opened", {
      context: options.materialClass ? "result_material" : "toolbar",
      itemClass: options.materialClass || "",
    });
    closeRecipeFilterDialog();
    const focusMaterialClass = String(options.materialClass || "").trim();
    recipeFilterInitialSelection = {
      recipeIds: new Set(selectedRecipeIds),
      disabledRawMaterials: new Set(disabledRawMaterialClasses),
      focusMaterialClass,
    };
    let activeFocusTarget = normalizeRecipeFilterFocus(options.focusTarget);
    const activeRecipeIdFilter = normalizeRecipeIdSet(options.filterRecipeIds || options.requiredRecipeIds);
    const hasRecipeIdFilter = activeRecipeIdFilter.size > 0;
    const noticeText = String(options.notice || "").trim();
    let activeMaterialClass = String(options.materialClass || "").trim();
    const expansionState = new Map();
    const materialOrder = new Map(recipeCatalog.materials
      .map((group, catalogIndex) => ({
        materialClass: String(group.item?.className || "").trim(),
        catalogIndex,
        modified: groupHasModifiedRecipeSelection(group),
      }))
      .sort((left, right) => (
        Number(right.modified) - Number(left.modified)
        || left.catalogIndex - right.catalogIndex
      ))
      .map(({ materialClass }, index) => [materialClass, index]));

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
    dragHandle.title = t("graph.dragFilter");
    dragHandle.setAttribute("aria-label", t("graph.dragFilter"));
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
      analytics.track("recipe_defaults_restored");
    });
    materialButton.addEventListener("click", async () => {
      const recipeMaterialIds = new Set(recipeCatalog.materials.map((group) => group.item?.className).filter(Boolean));
      const selection = await window.MaterialPicker.open({
        items,
        filter: (item) => recipeMaterialIds.has(item.className),
        title: t("recipes.chooseSearchMaterial"),
        description: t("recipes.chooseSearchHelp"),
        initialId: activeMaterialClass,
        analyticsContext: "recipe_search",
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
        materialOrder,
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
    const changedRecipeIds = recipeFilterInitialSelection
      ? symmetricRecipeSelectionDifference(recipeFilterInitialSelection.recipeIds, selectedRecipeIds)
      : [];
    const changedRawMaterialClasses = recipeFilterInitialSelection
      ? symmetricRecipeSelectionDifference(recipeFilterInitialSelection.disabledRawMaterials, disabledRawMaterialClasses)
      : [];
    const changedMaterialClasses = new Set([
      ...changedRawMaterialClasses,
      ...recipeMaterialClassesForIds(changedRecipeIds),
    ]);
    const focusMaterialClass = String(recipeFilterInitialSelection?.focusMaterialClass || "").trim();
    recipeFilterInitialSelection = null;
    overlay.remove();
    if (shouldRefreshDisplayedPlan) {
      calculate({
        locateRecipeIds: changedRecipeIds,
        locateMaterialClasses: Array.from(changedMaterialClasses),
        focusMaterialClass,
      });
    } else if (focusMaterialClass) {
      locateGraphMaterial(focusMaterialClass);
    }
  }

  function symmetricRecipeSelectionDifference(before, after) {
    const changed = [];
    before.forEach((id) => {
      if (!after.has(id)) changed.push(id);
    });
    after.forEach((id) => {
      if (!before.has(id)) changed.push(id);
    });
    return normalizedRecipeIdList(changed);
  }

  function recipeMaterialClassesForIds(recipeIds) {
    const requestedIds = normalizeRecipeIdSet(recipeIds);
    if (!requestedIds.size) return [];
    const classes = new Set();
    recipeCatalog.materials.forEach((group) => {
      const materialClass = String(group?.item?.className || "").trim();
      if (!materialClass) return;
      if ((group.recipes || []).some((recipe) => requestedIds.has(String(recipe?.id || "")))) {
        classes.add(materialClass);
      }
    });
    return Array.from(classes);
  }

  function openFindRecipeDialog(options = {}) {
    const graph = lastRenderedGraph;
    const recipeNodes = (graph?.nodes || []).filter((node) => node.type === "recipe");
    if (!recipeNodes.length) {
      setStatus(t("results.noTarget"), false);
      return;
    }
    analytics.track("recipe_finder_opened", { resultRecipeCount: recipeNodes.length });
    document.querySelector(".recipe-finder-overlay")?.remove();
    const requestedRecipeIds = normalizeRecipeIdSet(options.recipeIds);
    let activeMaterialClass = "";

    const overlay = document.createElement("div");
    overlay.className = "recipe-filter-overlay recipe-finder-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const dialog = document.createElement("section");
    dialog.className = "recipe-filter-dialog recipe-finder-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", t("results.findRecipe"));

    const header = document.createElement("div");
    header.className = "recipe-filter-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "recipe-filter-title";
    const title = document.createElement("h3");
    title.textContent = t("results.findRecipe");
    const summary = document.createElement("div");
    summary.className = "recipe-filter-summary";
    titleWrap.append(title, summary);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "secondary-button";
    close.textContent = t("recipes.close");
    close.addEventListener("click", () => overlay.remove());
    header.append(titleWrap, close);

    const tools = document.createElement("div");
    tools.className = "recipe-filter-tools";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "recipe-filter-search";
    search.placeholder = t("results.findRecipeSearch");
    const materialButton = document.createElement("button");
    materialButton.type = "button";
    materialButton.className = "secondary-button recipe-material-picker-button";
    const clearMaterialButton = document.createElement("button");
    clearMaterialButton.type = "button";
    clearMaterialButton.className = "secondary-button";
    clearMaterialButton.textContent = t("recipes.clearMaterial");
    tools.append(search, materialButton, clearMaterialButton);

    const list = document.createElement("div");
    list.className = "recipe-filter-list recipe-finder-list";
    dialog.append(header, tools, list);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const availableMaterialClasses = new Set(recipeNodes.flatMap((node) => (
      (node.recipe?.currentOutputs || []).map((output) => output.item?.className).filter(Boolean)
    )));
    materialButton.addEventListener("click", async () => {
      const selection = await window.MaterialPicker.open({
        items,
        filter: (item) => availableMaterialClasses.has(item.className),
        title: t("results.findRecipeMaterial"),
        description: t("results.findRecipeMaterialHelp"),
        initialId: activeMaterialClass,
        analyticsContext: "recipe_finder",
      });
      if (!selection) return;
      activeMaterialClass = selection.id;
      search.value = "";
      renderList();
    });
    clearMaterialButton.addEventListener("click", () => {
      activeMaterialClass = "";
      renderList();
    });
    search.addEventListener("input", renderList);

    function renderList() {
      const query = normalize(search.value);
      const matches = recipeNodes.filter((node) => {
        if (requestedRecipeIds.size && !requestedRecipeIds.has(node.id)) return false;
        const outputs = node.recipe?.currentOutputs || [];
        if (activeMaterialClass && !outputs.some((output) => output.item?.className === activeMaterialClass)) return false;
        return !query || normalize(`${node.title} ${outputs.map((output) => output.item?.name || "").join(" ")}`).includes(query);
      });
      const selectedItem = itemsByClass.get(activeMaterialClass);
      materialButton.textContent = selectedItem ? t("recipes.material", { name: selectedItem.name }) : t("results.findRecipeChooseMaterial");
      clearMaterialButton.hidden = !selectedItem;
      summary.textContent = t("results.findRecipeCount", { count: formatInteger(matches.length) });
      list.replaceChildren();
      if (!matches.length) {
        list.appendChild(makeEmptyMessage(t("results.findRecipeNone")));
        return;
      }
      matches.sort((left, right) => left.title.localeCompare(right.title));
      matches.forEach((node) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recipe-finder-row";
        const name = document.createElement("span");
        name.className = "recipe-finder-name";
        const primaryOutput = (node.recipe?.currentOutputs || [])[0]?.item || node.recipe?.primaryOutput;
        if (primaryOutput) {
          name.appendChild(makeMaterialIcon(primaryOutput, "recipe-finder-output-icon"));
        }
        if (node.nonBaseRecipe) {
          const tag = document.createElement("span");
          tag.className = "alternate-recipe-tag";
          tag.textContent = "ALT";
          name.appendChild(tag);
        }
        name.appendChild(document.createTextNode(node.title));
        const formula = document.createElement("span");
        formula.className = "recipe-finder-formula";
        formula.append(
          renderRecipeSide(node.recipe?.currentInputs || []),
          document.createTextNode(" = "),
          renderRecipeSide(node.recipe?.currentOutputs || []),
        );
        button.append(name, formula);
        button.addEventListener("click", () => {
          overlay.remove();
          locateGraphNode(node.id);
          analytics.track("recipe_finder_located", { recipeId: node.id });
        });
        list.appendChild(button);
      });
    }
    renderList();
    search.focus();
  }

  function refreshRecipeFilterControls() {
    const overlay = document.querySelector(".recipe-filter-overlay");
    if (!overlay) {
      return;
    }
    setRecipeFilterControlDisabled(
      overlay.querySelector('[data-recipe-filter-action="clear-alternates"]'),
      isDefaultRecipeSelection(),
      t("recipes.clearAlternatesHelp"),
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

  function renderRecipeFilterList(list, rawQuery, summary, focusTarget = null, recipeIdFilter = null, expansionState = null, materialClassFilter = "", materialOrder = null) {
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
        materialOrder instanceof Map
          ? (materialOrder.get(String(left.group.item?.className || "").trim()) ?? left.catalogIndex)
            - (materialOrder.get(String(right.group.item?.className || "").trim()) ?? right.catalogIndex)
          : Number(right.modified) - Number(left.modified)
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
        document.createTextNode(group.item?.name || group.item?.className || t("common.unknown")),
      );
      const meta = document.createElement("span");
      meta.className = "recipe-material-meta";
      meta.textContent = `${t("recipes.count", { count: formatInteger(displayedRecipeCount) })} · ${materialCategoryText(group.item, group.materialCategory)}`;
      groupSummary.append(name, meta);
      details.appendChild(groupSummary);

      if (hasDirectRawRecipe) {
        details.appendChild(renderDirectRawBaseRecipeRow(group, {
          onSelectionChange: () => {
            captureRecipeFilterExpansionState(list, expansionState);
            renderRecipeFilterList(list, rawQuery, summary, null, exactRecipeIds, expansionState, materialClassFilter, materialOrder);
          },
        }));
      }

      recipes.forEach((recipe) => {
        const row = renderRecipeFilterRow(recipe, group, {
          required: hasExactRecipeFilter && exactRecipeIds.has(recipe.id),
          onSelectionChange: () => {
            captureRecipeFilterExpansionState(list, expansionState);
            renderRecipeFilterList(list, rawQuery, summary, null, exactRecipeIds, expansionState, materialClassFilter, materialOrder);
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
      const counts = {
        selected: formatInteger(selectedRecipeIds.size),
        total: formatInteger(recipeCatalog.selectableRecipeIds.length),
        materials: formatInteger(visibleMaterialCount),
        rows: formatInteger(visibleRecipeCount),
        required: formatInteger(exactRecipeIds.size),
      };
      summary.textContent = materialFilterItem
        ? t("recipes.summaryFiltered", { ...counts, material: materialFilterItem.name })
        : hasExactRecipeFilter
        ? t("recipes.summaryRequired", counts)
        : t("recipes.summaryAll", counts);
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
    meta.textContent = `${t("recipes.primary")} · ${t("recipes.base")} · ${t("recipes.rawSource")}`;
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
      recipe.relation === "byproduct" ? t("recipes.byproduct") : t("recipes.primary"),
      isDefaultRecipe ? t("recipes.base") : recipe.isAlternate ? t("recipes.alternate") : t("recipes.additional"),
      ...(recipe.flags || []).map(recipeFlagLabel),
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

  function recipeFlagLabel(flag) {
    if (flag === "RawMaterial") return t("recipes.rawSource");
    if (flag === "PowerRecipe") return t("recipes.powerFlag");
    if (flag === "Package") return t("recipes.packagedFlag");
    return String(flag || "");
  }

  function renderRecipeSide(entries) {
    const side = document.createElement("span");
    side.className = "recipe-formula-side";
    if (!Array.isArray(entries) || !entries.length) {
      side.textContent = t("common.none");
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
      return t("common.none");
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
    if (activeGraphPan) {
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

  function resizeGraphCanvas(graph) {
    const { width, height } = graphExtents(graph.nodes, graph.baseWidth, graph.baseHeight, graph.edges);
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
    if (edge.busRouteId) {
      return edge.busBranchPath;
    }
    const control = edgeControlPoints(edge);
    return `M ${edge.x1} ${edge.y1} C ${control.c1.x} ${control.c1.y}, ${control.c2.x} ${control.c2.y}, ${edge.x2} ${edge.y2}`;
  }

  function roundedGraphPolylinePath(points) {
    const corners = points.filter((point, index) => {
      if (index === 0 || index === points.length - 1) return true;
      const previous = points[index - 1];
      const next = points[index + 1];
      const incomingX = point.x - previous.x;
      const incomingY = point.y - previous.y;
      const outgoingX = next.x - point.x;
      const outgoingY = next.y - point.y;
      return Math.abs(incomingX * outgoingY - incomingY * outgoingX) > 0.5;
    });
    if (corners.length < 2) return `M ${points[0].x} ${points[0].y} L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    let path = `M ${corners[0].x} ${corners[0].y}`;
    const radius = 12;
    for (let index = 1; index < corners.length - 1; index += 1) {
      const previous = corners[index - 1];
      const current = corners[index];
      const next = corners[index + 1];
      const previousDistance = Math.hypot(current.x - previous.x, current.y - previous.y);
      const nextDistance = Math.hypot(next.x - current.x, next.y - current.y);
      const cornerRadius = Math.min(radius, previousDistance / 2, nextDistance / 2);
      const before = {
        x: current.x - Math.sign(current.x - previous.x) * cornerRadius,
        y: current.y - Math.sign(current.y - previous.y) * cornerRadius,
      };
      const after = {
        x: current.x + Math.sign(next.x - current.x) * cornerRadius,
        y: current.y + Math.sign(next.y - current.y) * cornerRadius,
      };
      path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y}, ${after.x} ${after.y}`;
    }
    const last = corners[corners.length - 1];
    path += ` L ${last.x} ${last.y}`;
    return path;
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

  function summaryText(summary) {
    return t("summary.loaded", {
      recipes: formatInteger(summary.recipeCount), items: formatInteger(summary.itemCount),
      raw: formatInteger(summary.rawMaterialCount),
    });
  }

  function makeEmptyMessage(text) {
    const message = document.createElement("div");
    message.className = "status-message";
    message.textContent = text;
    return message;
  }

  function selectTab(tabName) {
    if (tabName !== "tree") return;
    exitCompactFocusView();
    fitCurrentGraphViewportHeight();
  }

  function setResultFocusMode(mode) {
    resultFocusMode = mode;
    document.body.classList.toggle("result-focus-mode", Boolean(mode));
    updateFocusControls();
    window.requestAnimationFrame(fitCurrentGraphViewportHeight);
  }

  function updateFocusControls() {
    if (!resultFocusControls) return;
    resultFocusControls.hidden = false;
    if (pageFocusButton) {
      pageFocusButton.hidden = resultFocusMode === "page";
      const key = resultFocusMode === "browser" ? "focus.switchToPage" : "focus.enterPage";
      const label = t(key);
      pageFocusButton.setAttribute("aria-label", label);
      pageFocusButton.title = label;
    }
    if (browserFocusButton) {
      browserFocusButton.hidden = resultFocusMode === "browser";
      const label = t("focus.enterBrowser");
      browserFocusButton.setAttribute("aria-label", label);
      browserFocusButton.title = label;
    }
    if (exitFocusButton) {
      exitFocusButton.hidden = !resultFocusMode;
      const label = t("focus.exit");
      exitFocusButton.setAttribute("aria-label", label);
      exitFocusButton.title = label;
    }
  }

  function switchToPageFocusMode() {
    const wasBrowserFullscreen = resultFocusMode === "browser" && Boolean(document.fullscreenElement);
    setResultFocusMode("page");
    if (wasBrowserFullscreen) {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }

  async function enterBrowserFullscreen() {
    if (!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== "function") {
      setResultFocusMode("page");
      return;
    }
    setResultFocusMode("browser");
    try {
      await document.documentElement.requestFullscreen();
    } catch (error) {
      if (resultFocusMode === "browser") {
        setResultFocusMode("page");
      }
    }
  }

  function closeResultFocusMode() {
    const wasBrowserFullscreen = Boolean(document.fullscreenElement);
    setResultFocusMode(null);
    if (wasBrowserFullscreen) {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }

  function handleFullscreenChange() {
    if (!document.fullscreenElement && resultFocusMode === "browser") {
      setResultFocusMode(null);
    }
  }

  function handleFocusModeKeydown(event) {
    if (event.key === "Escape" && resultFocusMode === "page") {
      closeResultFocusMode();
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


})();
