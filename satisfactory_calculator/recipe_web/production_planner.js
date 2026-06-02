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
  const disabledRecipesDropdown = document.getElementById("disabledRecipesDropdown");
  const disabledRecipeList = document.getElementById("disabledRecipeList");
  const disabledRecipeCount = document.getElementById("disabledRecipeCount");
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const STORAGE_KEY = "satisfactoryProductionPlanner.v1";

  let items = [];
  const itemsByClass = new Map();
  const disabledRecipes = new Map();
  let activeTab = "tree";
  let savedState = loadPlannerState();
  let suppressStateSave = false;

  addTargetButton.addEventListener("click", () => addTargetRow());
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });

  restoreDisabledRecipes(savedState.disabledRecipes);
  renderDisabledRecipes();
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
      setStatus("已从服务端加载 Excel 配方数据。请选择一个或多个物品，并输入每分钟需要生产的数量。", false);
    } catch (error) {
      if (!targetRows.querySelector(".target-row")) {
        addTargetRow(null, "", { focus: false, save: false });
      }
      dataSummary.textContent = "无法连接生产规划服务";
      setStatus(`无法加载服务端数据：${error.message}。请通过 python recipe_web/production_planner_server.py 启动服务后访问页面。`, true);
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
          disabledRecipeIds: Array.from(disabledRecipes.keys()),
        }),
      });
      renderGraphView(result);
      renderMergedTable(result.totals || []);
      selectTab("tree");
      const targetCount = result.summary?.targetCount ?? targets.length;
      const totalRows = result.summary?.totalRows ?? 0;
      const recipeRunCount = result.summary?.recipeRunCount ?? 0;
      const objectiveValue = result.summary?.objectiveValue ?? 0;
      setStatus(
        `已优化 ${formatInteger(targetCount)} 个生产目标，使用 ${formatInteger(recipeRunCount)} 个配方，外部原材料消耗 ${formatNumber(objectiveValue)} /min，合并得到 ${formatInteger(totalRows)} 行材料。`,
        false,
      );
    } catch (error) {
      setStatus(`计算失败：${error.message}`, true);
      treeView.replaceChildren(makeEmptyMessage("当前条件下没有可显示的生产方案。"));
      tableView.replaceChildren(makeEmptyMessage("当前条件下没有可显示的合并表格。"));
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
      disabledRecipes: Array.from(disabledRecipes.values()),
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

  function restoreDisabledRecipes(disabledRecipeEntries) {
    disabledRecipes.clear();
    if (!Array.isArray(disabledRecipeEntries)) {
      return;
    }

    disabledRecipeEntries.forEach((entry) => {
      const id = String(typeof entry === "string" ? entry : entry?.id || "").trim();
      if (!id) {
        return;
      }
      const name = String(typeof entry === "string" ? entry : entry?.name || id).trim() || id;
      disabledRecipes.set(id, { id, name });
    });
  }

  function renderDisabledRecipes() {
    if (!disabledRecipeList || !disabledRecipeCount) {
      return;
    }

    disabledRecipeCount.textContent = formatInteger(disabledRecipes.size);
    disabledRecipeList.replaceChildren();
    disabledRecipesDropdown?.classList.toggle("empty", disabledRecipes.size === 0);

    if (!disabledRecipes.size) {
      const empty = document.createElement("div");
      empty.className = "disabled-recipe-empty";
      empty.textContent = "没有禁用的替代配方";
      disabledRecipeList.appendChild(empty);
      return;
    }

    const entries = Array.from(disabledRecipes.values()).sort((a, b) => a.name.localeCompare(b.name));
    entries.forEach((recipe) => {
      const row = document.createElement("div");
      row.className = "disabled-recipe-row";

      const name = document.createElement("span");
      name.className = "disabled-recipe-name";
      name.textContent = recipe.name;

      const restoreButton = document.createElement("button");
      restoreButton.type = "button";
      restoreButton.className = "restore-recipe-button";
      restoreButton.textContent = "恢复";
      restoreButton.addEventListener("click", () => restoreRecipe(recipe.id));

      row.append(name, restoreButton);
      disabledRecipeList.appendChild(row);
    });
  }

  function disableRecipe(recipe) {
    if (!recipe?.id) {
      return;
    }
    disabledRecipes.set(recipe.id, {
      id: recipe.id,
      name: recipe.name || recipe.id,
    });
    renderDisabledRecipes();
    savePlannerState();
    recalculateIfTargetsExist();
  }

  function restoreRecipe(recipeId) {
    disabledRecipes.delete(recipeId);
    renderDisabledRecipes();
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
      });
      addEndpoint(producersByMaterial, raw.item.className, {
        nodeId: node.id,
        item: raw.item,
        rate,
        remaining: rate,
      });
    });

    recipeRuns.forEach((run) => {
      const node = addGraphNode(nodes, {
        id: run.id,
        type: "recipe",
        column: recipeColumns.get(run.id) || 1,
        title: run.recipe.name,
        meta: `x ${formatNumber(run.scale)}`,
        alternate: Boolean(run.recipe.isAlternate),
        recipe: run.recipe,
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
    const maxRate = Math.max(1, ...edges.map((edge) => Number(edge.rate) || 0));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    edges.forEach((edge) => {
      edge.width = flowWidth(edge.rate, maxRate);
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
    const width = constants.marginX * 2 + constants.nodeWidth + maxColumn * (constants.nodeWidth + constants.columnGap);
    const height = Math.max(constants.minHeight, constants.marginY * 2 + maxColumnHeight);

    routeEdges(edges, nodeById);
    return { nodes, width, height };
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
      edge.labelX = (edge.x1 + edge.x2) / 2;
      edge.labelY = (edge.y1 + edge.y2) / 2;
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

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "graph-svg");
    svg.setAttribute("width", String(graph.width));
    svg.setAttribute("height", String(graph.height));
    svg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);

    graph.edges.forEach((edge) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", `graph-flow${edge.feedback ? " feedback" : ""}`);
      path.setAttribute("d", edgePath(edge));
      path.setAttribute("stroke", edge.color);
      path.setAttribute("stroke-width", String(edge.width));
      svg.appendChild(path);
    });
    canvas.appendChild(svg);

    graph.edges.forEach((edge) => {
      if (!edge.x1 && !edge.x2) return;
      canvas.appendChild(renderEdgeLabel(edge));
    });

    graph.nodes.forEach((node) => {
      canvas.appendChild(renderGraphNode(node, graph.balanceByClass));
    });

    viewport.appendChild(canvas);
    return viewport;
  }

  function renderGraphNode(node, balanceByClass) {
    const card = document.createElement("article");
    card.className = `graph-node ${node.type}${node.alternate ? " alternate" : ""}`;
    if (node.type === "recipe" && node.alternate && node.recipe?.id) {
      card.classList.add("has-disable-button");
    }
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.width}px`;
    card.style.height = `${node.height}px`;

    if (node.type === "recipe" && node.alternate && node.recipe?.id) {
      const disableButton = document.createElement("button");
      disableButton.type = "button";
      disableButton.className = "disable-recipe-button";
      disableButton.textContent = "X";
      disableButton.title = "临时禁用这个替代配方";
      disableButton.setAttribute("aria-label", `临时禁用 ${node.recipe.name || node.title}`);
      disableButton.addEventListener("click", (event) => {
        event.stopPropagation();
        disableRecipe(node.recipe);
      });
      card.appendChild(disableButton);
    }

    const kind = document.createElement("div");
    kind.className = "graph-node-kind";
    kind.textContent = graphNodeKindText(node);

    const title = document.createElement("div");
    title.className = "graph-node-title";
    title.textContent = node.title;

    const meta = document.createElement("div");
    meta.className = "graph-node-meta";
    meta.textContent = node.meta;

    card.append(kind, title, meta);

    const balance = node.item ? balanceByClass.get(node.item.className) : null;
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

  function renderEdgeLabel(edge) {
    const label = document.createElement("div");
    label.className = "graph-edge-label";
    label.style.left = `${edge.labelX}px`;
    label.style.top = `${edge.labelY}px`;
    label.textContent = `${edge.item.name} ${formatNumber(edge.rate)}/min`;
    label.title = `${edge.item.name}: ${formatNumber(edge.rate)} ${edge.item.unit}/min`;
    return label;
  }

  function edgePath(edge) {
    const distance = Math.abs(edge.x2 - edge.x1);
    const curve = Math.max(80, Math.min(220, distance * 0.45));
    if (edge.feedback) {
      return `M ${edge.x1} ${edge.y1} C ${edge.x1 + 90} ${edge.y1 - 90}, ${edge.x2 - 90} ${edge.y2 - 90}, ${edge.x2} ${edge.y2}`;
    }
    return `M ${edge.x1} ${edge.y1} C ${edge.x1 + curve} ${edge.y1}, ${edge.x2 - curve} ${edge.y2}, ${edge.x2} ${edge.y2}`;
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

  function flowWidth(rate, maxRate) {
    const normalized = Math.sqrt(Math.max(0, Number(rate)) / maxRate);
    return Math.max(4, Math.min(34, normalized * 30));
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
})();
