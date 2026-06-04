(() => {
  "use strict";

  const targetRows = document.getElementById("targetRows");
  const targetTemplate = document.getElementById("targetRowTemplate");
  const addTargetButton = document.getElementById("addTargetButton");
  const plannerForm = document.getElementById("plannerForm");
  const dataSummary = document.getElementById("dataSummary");
  const statusMessage = document.getElementById("statusMessage");
  const treeView = document.getElementById("treeView");
  const tableView = document.getElementById("tableView");
  const resetLayoutButton = document.getElementById("resetLayoutButton");
  const resetRecipeSelectionsButton = document.getElementById("resetRecipeSelectionsButton");
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const STORAGE_KEY = "satisfactoryProductionPlanner.v1";
  const GRAPH_FLOW_WIDTH = 8;

  let items = [];
  const itemsByClass = new Map();
  const recipeSelections = new Map();
  const recipeNodePositions = new Map();
  let activeTab = "tree";
  let savedState = loadPlannerState();
  let suppressStateSave = false;
  let activeGraphDrag = null;

  addTargetButton.addEventListener("click", () => addTargetRow());
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  resetLayoutButton?.addEventListener("click", resetGraphLayout);
  resetRecipeSelectionsButton?.addEventListener("click", resetRecipeSelections);

  restoreRecipeSelections(savedState.recipeSelections);
  restoreRecipeNodePositions(savedState.recipeNodePositions);
  loadInitialData();

  async function loadInitialData() {
    try {
      const [summary, itemPayload] = await Promise.all([fetchJson("/api/summary"), fetchJson("/api/items")]);
      items = Array.isArray(itemPayload.items) ? itemPayload.items : [];
      itemsByClass.clear();
      items.forEach((item) => itemsByClass.set(item.className, item));
      if (!restoreTargetRows(savedState.targets)) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      dataSummary.textContent = summaryText(summary);
      setStatus("Loaded Excel recipe data from server. Select items and enter rates per minute.", false);
    } catch (error) {
      if (!targetRows.querySelector(".target-row")) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      dataSummary.textContent = "无法连接生产规划服务";
      setStatus(`Failed to load server data: ${error.message}. Start recipe_web/production_planner_server.py and reload.`, true);
    }
  }

  async function calculate() {
    const targets = collectTargets();
    if (!targets.length) {
      return;
    }
    savePlannerState();

    setStatus("正在请求服务端计算...", false);
    try {
      const result = await fetchJson("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targets.map((target) => ({
            itemClass: target.item.className,
            rate: target.rate,
          })),
          selectedRecipes: selectedRecipesPayload(),
        }),
      });
      reconcileRecipeSelections(result);
      renderGraphView(result);
      renderMergedTable(result.totals || []);
      selectTab("tree");
      const targetCount = result.summary?.targetCount ?? targets.length;
      const totalRows = result.summary?.totalRows ?? 0;
      const recipeRunCount = result.summary?.recipeRunCount ?? 0;
      const objectiveValue = result.summary?.objectiveValue ?? 0;
      setStatus(
        `Optimized ${formatInteger(targetCount)} target(s), using ${formatInteger(recipeRunCount)} recipe(s), external raw input ${formatNumber(objectiveValue)} /min, merged into ${formatInteger(totalRows)} material row(s).`,
        false,
      );
    } catch (error) {
      setStatus(`Calculation failed: ${error.message}`, true);
      treeView.replaceChildren(makeEmptyMessage("No production plan can be displayed for the current conditions."));
      tableView.replaceChildren(makeEmptyMessage("No merged table can be displayed for the current conditions."));
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.error || `${response.status} ${response.statusText}`);
    }
    return payload || {};
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
    const state = {
      targets: collectTargetState(),
      recipeSelections: Array.from(recipeSelections.values()),
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

  function restoreRecipeSelections(selectionEntries) {
    recipeSelections.clear();
    if (Array.isArray(selectionEntries)) {
      selectionEntries.forEach((entry) => {
        const itemClass = String(entry?.itemClass || "").trim();
        const recipeId = String(entry?.recipeId || "").trim();
        if (itemClass && recipeId) {
          recipeSelections.set(itemClass, {
            itemClass,
            itemName: String(entry?.itemName || itemClass),
            recipeId,
            recipeName: String(entry?.recipeName || recipeId),
          });
        }
      });
      return;
    }

    if (selectionEntries && typeof selectionEntries === "object") {
      Object.entries(selectionEntries).forEach(([itemClass, recipeId]) => {
        const cleanItemClass = String(itemClass || "").trim();
        const cleanRecipeId = String(recipeId || "").trim();
        if (cleanItemClass && cleanRecipeId) {
          recipeSelections.set(cleanItemClass, {
            itemClass: cleanItemClass,
            itemName: cleanItemClass,
            recipeId: cleanRecipeId,
            recipeName: cleanRecipeId,
          });
        }
      });
    }
  }

  function selectedRecipesPayload() {
    return Object.fromEntries(
      Array.from(recipeSelections.values()).map((selection) => [selection.itemClass, selection.recipeId]),
    );
  }

  function reconcileRecipeSelections(result) {
    const effectiveSelections = result?.selectedRecipes;
    if (!effectiveSelections || typeof effectiveSelections !== "object" || !recipeSelections.size) {
      return;
    }

    let changed = false;
    recipeSelections.forEach((selection, itemClass) => {
      const effectiveRecipeId = String(effectiveSelections[itemClass] || "").trim();
      if (!effectiveRecipeId) {
        recipeSelections.delete(itemClass);
        changed = true;
        return;
      }
      if (effectiveRecipeId !== selection.recipeId) {
        recipeSelections.set(itemClass, {
          ...selection,
          recipeId: effectiveRecipeId,
        });
        changed = true;
      }
    });

    if (changed) {
      savePlannerState();
    }
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

  function resetRecipeSelections() {
    if (!recipeSelections.size) {
      return;
    }
    recipeSelections.clear();
    savePlannerState();
    recalculateIfTargetsExist();
  }

  function selectRecipeForOutput(recipe, option) {
    const primaryOutput = recipe?.primaryOutput;
    const recipeId = String(option?.id || "").trim();
    if (!primaryOutput?.className || !recipeId) {
      return;
    }
    recipeSelections.set(primaryOutput.className, {
      itemClass: primaryOutput.className,
      itemName: primaryOutput.name || primaryOutput.className,
      recipeId,
      recipeName: option.name || recipeId,
    });
    savePlannerState();
    recalculateIfTargetsExist();
  }

  function recalculateIfTargetsExist() {
    if (collectTargetState().some((target) => target.itemClass || target.itemName || target.rate)) {
      calculate();
    }
  }

  function addTargetRow(initialItem = null, initialRate = "", options = {}) {
    const fragment = targetTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".target-row");
    const itemInput = row.querySelector(".item-input");
    const amountInput = row.querySelector(".amount-input");
    const removeButton = row.querySelector(".remove-button");
    const suggestions = row.querySelector(".suggestions");

    row._suggestions = [];
    row._activeIndex = -1;

    if (initialItem) {
      selectItem(row, initialItem);
    }
    if (initialRate !== "") {
      amountInput.value = initialRate;
    }

    itemInput.addEventListener("input", () => {
      delete row.dataset.itemClass;
      updateUnitLabel(row, null);
      renderSuggestions(row, itemInput.value);
      savePlannerState();
    });
    amountInput.addEventListener("input", savePlannerState);
    itemInput.addEventListener("focus", () => renderSuggestions(row, itemInput.value));
    itemInput.addEventListener("keydown", (event) => handleSuggestionKeys(event, row));
    itemInput.addEventListener("blur", () => {
      window.setTimeout(() => closeSuggestions(row), 120);
    });

    suggestions.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    suggestions.addEventListener("click", (event) => {
      const option = event.target.closest(".suggestion-option");
      if (!option) {
        return;
      }
      const item = itemsByClass.get(option.dataset.itemClass);
      if (item) {
        selectItem(row, item);
        amountInput.focus();
        savePlannerState();
      }
    });

    removeButton.addEventListener("click", () => {
      row.remove();
      updateRemoveButtons();
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

  function renderSuggestions(row, query) {
    const suggestions = row.querySelector(".suggestions");
    const matches = searchItems(query).slice(0, 14);
    row._suggestions = matches;
    row._activeIndex = matches.length ? 0 : -1;
    suggestions.replaceChildren();

    if (!matches.length) {
      closeSuggestions(row);
      return;
    }

    matches.forEach((item, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `suggestion-option${index === row._activeIndex ? " active" : ""}`;
      option.dataset.itemClass = item.className;
      option.setAttribute("role", "option");

      const name = document.createElement("span");
      name.className = "suggestion-name";
      name.textContent = item.name;

      const meta = document.createElement("span");
      meta.className = "suggestion-meta";
      meta.textContent = item.producible ? item.unit : `${item.unit} · 原材料`;

      option.append(name, meta);
      suggestions.appendChild(option);
    });
    suggestions.classList.add("open");
  }

  function closeSuggestions(row) {
    row.querySelector(".suggestions").classList.remove("open");
    row._activeIndex = -1;
  }

  function handleSuggestionKeys(event, row) {
    const suggestionsOpen = row.querySelector(".suggestions").classList.contains("open");
    if (!suggestionsOpen || !row._suggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      row._activeIndex = (row._activeIndex + 1) % row._suggestions.length;
      refreshActiveSuggestion(row);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      row._activeIndex = (row._activeIndex - 1 + row._suggestions.length) % row._suggestions.length;
      refreshActiveSuggestion(row);
    } else if (event.key === "Enter") {
      const item = row._suggestions[row._activeIndex];
      if (item) {
        event.preventDefault();
        selectItem(row, item);
        row.querySelector(".amount-input").focus();
        savePlannerState();
      }
    } else if (event.key === "Escape") {
      closeSuggestions(row);
    }
  }

  function refreshActiveSuggestion(row) {
    const options = Array.from(row.querySelectorAll(".suggestion-option"));
    options.forEach((option, index) => {
      option.classList.toggle("active", index === row._activeIndex);
      if (index === row._activeIndex) {
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function selectItem(row, item) {
    row.dataset.itemClass = item.className;
    row.querySelector(".item-input").value = item.name;
    updateUnitLabel(row, item);
    closeSuggestions(row);
  }

  function updateUnitLabel(row, item) {
    row.querySelector(".unit-label").textContent = item ? `${item.unit}/min` : "/ min";
  }

  function searchItems(query) {
    const trimmed = query.trim();
    return items
      .map((item) => ({ item, score: scoreItem(item, trimmed) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        if (a.item.producible !== b.item.producible) {
          return a.item.producible ? -1 : 1;
        }
        return a.item.name.localeCompare(b.item.name);
      })
      .map((entry) => entry.item);
  }

  function scoreItem(item, query) {
    if (!query) {
      return item.producible ? 20 : 80;
    }
    const itemName = normalize(item.name);
    const itemCompact = compact(item.name);
    const queryName = normalize(query);
    const queryCompact = compact(query);
    const className = normalize(item.className);

    if (itemName === queryName) return 0;
    if (itemName.startsWith(queryName)) return 1;
    if (itemName.split(" ").some((part) => part.startsWith(queryName))) return 2;
    if (itemCompact.startsWith(queryCompact)) return 3;
    if (itemName.includes(queryName)) return 4;
    if (itemCompact.includes(queryCompact)) return 5;
    if (className.includes(queryName)) return 6;
    return Infinity;
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
        setStatus(`无法匹配物品：${rawName || "空输入"}`, true);
        itemInput.focus();
        return [];
      }

      const rate = Number(rawAmount);
      if (!Number.isFinite(rate) || rate <= 0) {
        setStatus(`请输入 ${item.name} 的正数每分钟产量。`, true);
        amountInput.focus();
        return [];
      }

      targets.push({ item, rate });
    }

    if (!targets.length) {
      setStatus("至少添加一个目标物品，并输入每分钟数量。", true);
    }
    return targets;
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

  function renderGraphView(result) {
    const graph = buildFlowGraph(result);
    if (!graph.nodes.length) {
      treeView.replaceChildren(makeEmptyMessage("尚未计算生产目标。"));
      return;
    }

    treeView.replaceChildren(renderFlowGraph(graph));
  }

  function buildFlowGraph(result) {
    const recipeRuns = result.recipeRuns || [];
    const targets = result.targets || [];
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
        edgeColor: "rgb(45, 126, 192)",
      });
      addEndpoint(producersByMaterial, raw.item.className, {
        nodeId: node.id,
        item: raw.item,
        rate,
        remaining: rate,
      });
    });

    recipeRuns.forEach((run) => {
      const color = recipeColor(run.recipe.name);
      const node = addGraphNode(nodes, {
        id: run.id,
        type: "recipe",
        column: recipeColumns.get(run.id) || 1,
        title: run.recipe.name,
        meta: `x ${formatNumber(run.scale)}`,
        alternate: Boolean(run.recipe.isAlternate),
        recipe: run.recipe,
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

    targets.forEach((target, index) => {
      const rate = Number(target.rate);
      if (!isPositive(rate)) return;
      const node = addGraphNode(nodes, {
        id: `target:${index}:${target.item.className}`,
        type: "target",
        column: recipeColumnMax + 1,
        title: target.item.name,
        meta: `${formatNumber(rate)} ${target.item.unit}/min`,
        item: target.item,
      });
      addEndpoint(consumersByMaterial, target.item.className, {
        nodeId: node.id,
        item: target.item,
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

    const edges = allocateGraphEdges(producersByMaterial, consumersByMaterial);
    const laidOut = layoutFlowGraph(Array.from(nodes.values()), edges, balanceByClass);
    return {
      ...laidOut,
      edges,
      balanceByClass,
    };
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

  function allocateGraphEdges(producersByMaterial, consumersByMaterial) {
    const edges = [];
    const materialClasses = new Set([...producersByMaterial.keys(), ...consumersByMaterial.keys()]);
    materialClasses.forEach((itemClass) => {
      const producers = (producersByMaterial.get(itemClass) || []).map((entry) => ({ ...entry }));
      const consumers = (consumersByMaterial.get(itemClass) || []).map((entry) => ({ ...entry }));
      let producerIndex = 0;
      let consumerIndex = 0;

      while (producerIndex < producers.length && consumerIndex < consumers.length) {
        const producer = producers[producerIndex];
        const consumer = consumers[consumerIndex];
        const rate = Math.min(producer.remaining, consumer.remaining);

        if (isPositive(rate) && producer.nodeId !== consumer.nodeId) {
          edges.push({
            id: `edge:${edges.length}`,
            source: producer.nodeId,
            target: consumer.nodeId,
            item: producer.item || consumer.item,
            rate,
            byproduct: Boolean(producer.byproduct),
            color: materialColor(itemClass),
          });
        }

        producer.remaining -= rate;
        consumer.remaining -= rate;
        if (!isPositive(producer.remaining)) producerIndex += 1;
        if (!isPositive(consumer.remaining)) consumerIndex += 1;
      }
    });
    return edges;
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

    edges.forEach((edge) => {
      if (recipeIds.has(edge.source) && recipeIds.has(edge.target)) {
        adjacency.get(edge.source).push(edge.target);
      }
    });

    const components = stronglyConnectedComponents(recipeNodes.map((node) => node.id), adjacency);
    const componentByNode = new Map();
    components.forEach((component, index) => {
      component.forEach((nodeId) => componentByNode.set(nodeId, index));
    });

    const componentEdges = new Map(components.map((_component, index) => [index, new Set()]));
    edges.forEach((edge) => {
      if (!recipeIds.has(edge.source) || !recipeIds.has(edge.target)) {
        return;
      }
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

    for (let pass = 0; pass < 5; pass += 1) {
      for (const column of sortedColumns) {
        sortColumnByNeighbors(columns, columns.get(column), edges, nodeById, balanceByClass, "incoming");
      }
      for (const column of [...sortedColumns].reverse()) {
        sortColumnByNeighbors(columns, columns.get(column), edges, nodeById, balanceByClass, "outgoing");
      }
    }
  }

  function sortColumnByNeighbors(columns, columnNodes, edges, nodeById, balanceByClass, direction) {
    const rank = new Map();
    columns.forEach((nodesInColumn) => {
      nodesInColumn.forEach((node, index) => rank.set(node.id, index));
    });

    columnNodes.sort((a, b) => {
      const scoreA = neighborScore(a, edges, nodeById, rank, direction);
      const scoreB = neighborScore(b, edges, nodeById, rank, direction);
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return graphNodeSortKey(a, balanceByClass).localeCompare(graphNodeSortKey(b, balanceByClass));
    });
  }

  function neighborScore(node, edges, nodeById, rank, direction) {
    const neighbors = [];
    edges.forEach((edge) => {
      if (direction === "incoming" && edge.target === node.id) {
        const source = nodeById.get(edge.source);
        if (source && source.column < node.column) {
          neighbors.push(rank.get(source.id) ?? 0);
        }
      } else if (direction === "outgoing" && edge.source === node.id) {
        const target = nodeById.get(edge.target);
        if (target && target.column > node.column) {
          neighbors.push(rank.get(target.id) ?? 0);
        }
      }
    });
    if (!neighbors.length) {
      return Number.POSITIVE_INFINITY;
    }
    return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
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
    graph.baseWidth = graph.width;
    graph.baseHeight = graph.height;

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
    return viewport;
  }

  function renderGraphNode(node, graph) {
    const card = document.createElement("article");
    card.className = `graph-node ${node.type}${node.alternate ? " alternate" : ""}`;
    card.dataset.nodeId = node.id;
    card.draggable = false;
    card.addEventListener("dragstart", (event) => event.preventDefault());
    if (node.type === "recipe") {
      card.classList.add("draggable");
    }
    if (node.type === "recipe" && canSwitchRecipe(node.recipe)) {
      card.classList.add("has-switch-button");
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

    if (node.type === "recipe" && canSwitchRecipe(node.recipe)) {
      const switchButton = document.createElement("button");
      switchButton.type = "button";
      switchButton.className = "switch-recipe-button";
      switchButton.textContent = "\u6362";
      switchButton.title = "Switch the recipe used for this material";
      switchButton.setAttribute("aria-label", `Switch recipe for ${node.recipe.primaryOutput?.name || node.recipe.name || node.title}`);
      switchButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openRecipeSwitchDialog(node.recipe);
      });
      card.appendChild(switchButton);
    }

    if (node.type === "recipe") {
      const handle = document.createElement("div");
      handle.className = "graph-drag-handle";
      handle.textContent = "拖动";
      handle.title = "按住拖动配方节点";
      bindGraphDragStart(handle, node, graph);
      card.appendChild(handle);
    }

    const kind = document.createElement("div");
    kind.className = "graph-node-kind";
    kind.textContent = graphNodeKindText(node);
    if (node.type === "recipe") {
      kind.title = "按住这里拖动配方节点";
      bindGraphDragStart(kind, node, graph);
    }

    const title = document.createElement("div");
    title.className = "graph-node-title";
    title.textContent = node.title;

    const meta = document.createElement("div");
    meta.className = "graph-node-meta";
    meta.textContent = node.meta;

    card.append(kind, title, meta);

    const balance = node.item ? graph.balanceByClass.get(node.item.className) : null;
    if (node.alternate || node.type === "surplus" || (balance && isPositive(Number(balance.surplus)))) {
      const badges = document.createElement("div");
      badges.className = "graph-node-badges";
      if (node.alternate) badges.appendChild(makeBadge("替代", "alt"));
      if (node.type === "surplus") badges.appendChild(makeBadge("剩余"));
      if (node.type !== "surplus" && balance && isPositive(Number(balance.surplus))) {
        badges.appendChild(makeBadge(`余 ${formatNumber(balance.surplus)}`));
      }
      card.appendChild(badges);
    }

    return card;
  }

  function canSwitchRecipe(recipe) {
    return Boolean(
      recipe?.primaryOutput?.className
        && Array.isArray(recipe.replacementOptions)
        && recipe.replacementOptions.length > 1,
    );
  }

  function openRecipeSwitchDialog(recipe) {
    if (!canSwitchRecipe(recipe)) {
      return;
    }
    closeRecipeSwitchDialog();

    const overlay = document.createElement("div");
    overlay.className = "recipe-switch-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeRecipeSwitchDialog();
      }
    });

    const dialog = document.createElement("section");
    dialog.className = "recipe-switch-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "recipe-switch-header";

    const title = document.createElement("h3");
    title.textContent = `Switch recipe for ${recipe.primaryOutput.name || recipe.primaryOutput.className}`;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "recipe-switch-close";
    closeButton.textContent = "\u00d7";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", closeRecipeSwitchDialog);

    header.append(title, closeButton);
    dialog.appendChild(header);

    const list = document.createElement("div");
    list.className = "recipe-switch-list";
    recipe.replacementOptions.forEach((option) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = `recipe-switch-option${option.id === recipe.id ? " current" : ""}`;
      if (option.id === recipe.id) {
        optionButton.disabled = true;
      }

      const name = document.createElement("span");
      name.className = "recipe-switch-name";
      name.textContent = option.name || option.id;

      const formula = document.createElement("span");
      formula.className = "recipe-switch-formula";
      formula.textContent = recipeOptionFormula(option);

      optionButton.append(name, formula);
      optionButton.addEventListener("click", () => {
        closeRecipeSwitchDialog();
        selectRecipeForOutput(recipe, option);
      });
      list.appendChild(optionButton);
    });
    dialog.appendChild(list);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function closeRecipeSwitchDialog() {
    document.querySelector(".recipe-switch-overlay")?.remove();
  }

  function recipeOptionFormula(option) {
    return `${recipeOptionSide(option.inputs)} = ${recipeOptionSide(option.outputs)}`;
  }

  function recipeOptionSide(items) {
    if (!Array.isArray(items) || !items.length) {
      return "None";
    }
    return items
      .map((item) => `${item.item?.name || ""} (${formatNumber(item.rate)})`)
      .join(" + ");
  }

  function bindGraphDragStart(element, node, graph) {
    element.classList.add("graph-drag-zone");
    element.addEventListener("pointerdown", (event) => startGraphNodeDrag(event, node, graph));
    element.addEventListener("mousedown", (event) => startGraphNodeDrag(event, node, graph));
    element.addEventListener("touchstart", (event) => startGraphNodeDrag(event, node, graph), { passive: false });
  }

  function startGraphNodeDrag(event, node, graph) {
    const target = event.target;
    if (activeGraphDrag || (target instanceof Element && target.closest("button"))) {
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
  }

  function renderEdgeLabel(edge) {
    const label = document.createElement("div");
    label.className = "graph-edge-label";
    label.style.left = `${edge.labelX}px`;
    label.style.top = `${edge.labelY}px`;
    label.textContent = `${edge.item.name} ${formatNumber(edge.rate)}/min`;
    label.title = `${edge.item.name}: ${formatNumber(edge.rate)} ${edge.item.unit}/min`;
    return label;
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
      const horizontal = Math.max(120, Math.min(260, backtrack * 0.22 + 120));
      const direction = edge.y2 >= edge.y1 ? 1 : -1;
      const vertical = Math.min(46, Math.abs(edge.y2 - edge.y1) * 0.12 + 18);
      return {
        c1: { x: edge.x1 + horizontal, y: edge.y1 + direction * vertical },
        c2: { x: edge.x2 - horizontal, y: edge.y2 - direction * vertical },
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
    if (node.type === "raw") return "原材料";
    if (node.type === "target") return "输出";
    if (node.type === "surplus") return "剩余";
    return "配方";
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
      tableView.replaceChildren(makeEmptyMessage("所选目标没有下游材料需求。"));
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "merged-table-wrap";

    const table = document.createElement("table");
    table.className = "merged-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["物品", "需求 / 分钟", "单位", "类型", "使用配方"].forEach((label) => {
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
      appendCell(tr, row.raw ? "原材料" : "中间材料");
      appendCell(tr, Array.isArray(row.recipes) ? row.recipes.join(", ") : "");
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    wrap.appendChild(table);
    tableView.replaceChildren(wrap);
  }

  function summaryText(summary) {
    const parts = [
      `${formatInteger(summary.recipeCount)} 条配方`,
      `${formatInteger(summary.itemCount)} 个物品`,
    ];
    if (summary.generatedAt) {
      parts.push(`Excel 生成于 ${formatTimestamp(summary.generatedAt)}`);
    }
    return parts.join(" · ");
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function makeBadge(text, extraClass = "") {
    const badge = document.createElement("span");
    badge.className = `badge${extraClass ? ` ${extraClass}` : ""}`;
    badge.textContent = text;
    return badge;
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
  }

  function setStatus(text, isError) {
    statusMessage.textContent = text;
    statusMessage.classList.toggle("error", Boolean(isError));
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "";
    }
    if (Math.abs(number - Math.round(number)) < 1e-9) {
      return String(Math.round(number));
    }
    return number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatInteger(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function roundGraphCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
  }
})();
