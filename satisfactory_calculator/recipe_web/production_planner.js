(() => {
  "use strict";

  const data = window.SATISFACTORY_PLANNER_DATA;
  const targetRows = document.getElementById("targetRows");
  const targetTemplate = document.getElementById("targetRowTemplate");
  const addTargetButton = document.getElementById("addTargetButton");
  const plannerForm = document.getElementById("plannerForm");
  const dataSummary = document.getElementById("dataSummary");
  const statusMessage = document.getElementById("statusMessage");
  const treeView = document.getElementById("treeView");
  const tableView = document.getElementById("tableView");
  const syncRecipesToggle = document.getElementById("syncRecipesToggle");
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  const globalRecipeSelections = new Map();
  const localRecipeSelections = new Map();
  let lastTargets = [];
  let activeTab = "tree";

  if (!data || !Array.isArray(data.items) || !Array.isArray(data.recipes)) {
    setStatus("缺少页面数据。请先运行 py .\\recipe_exporter\\satisfactory_recipes_export.py。", true);
    return;
  }

  const items = [...data.items].sort((a, b) => {
    if (a.producible !== b.producible) {
      return a.producible ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const itemsByClass = new Map(items.map((item) => [item.className, item]));
  const recipesByOutput = new Map();

  for (const recipe of data.recipes) {
    for (const output of recipe.outputs) {
      if (!recipesByOutput.has(output.itemClass)) {
        recipesByOutput.set(output.itemClass, []);
      }
      recipesByOutput.get(output.itemClass).push({ recipe, output });
    }
  }

  for (const choices of recipesByOutput.values()) {
    choices.sort(compareRecipeChoices);
  }

  dataSummary.textContent = `${formatInteger(data.recipeCount)} 条配方 · ${formatInteger(items.length)} 个物品 · ${data.sourceDocsJson}`;

  addTargetButton.addEventListener("click", () => addTargetRow());
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  syncRecipesToggle.addEventListener("change", () => {
    if (lastTargets.length) {
      recalculateFromTargets("已更新配方同步设置。", false);
    }
  });
  treeView.addEventListener("change", (event) => {
    const select = event.target.closest(".recipe-select");
    if (!select) {
      return;
    }
    if (syncRecipesToggle.checked) {
      globalRecipeSelections.set(select.dataset.itemClass, select.value);
    } else {
      localRecipeSelections.set(select.dataset.nodeKey, select.value);
    }
    recalculateFromTargets("已更新配方选择。", false);
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });

  addTargetRow();

  function addTargetRow(initialItem = null, initialRate = "") {
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
    });
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
      }
    });

    removeButton.addEventListener("click", () => {
      row.remove();
      updateRemoveButtons();
    });

    targetRows.appendChild(fragment);
    updateRemoveButtons();
    itemInput.focus();
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

  function calculate() {
    const targets = collectTargets();
    if (!targets.length) {
      return;
    }

    lastTargets = targets;
    recalculateFromTargets(null, true);
  }

  function recalculateFromTargets(message, focusTree) {
    if (!lastTargets.length) {
      return;
    }

    const roots = lastTargets.map((target, index) => buildTree(target.item.className, target.rate, [], `root-${index}`));
    const totals = new Map();
    roots.forEach((root) => collectTotals(root, totals, true));

    renderTree(roots);
    renderMergedTable(totals);
    if (focusTree) {
      selectTab("tree");
    } else {
      selectTab(activeTab);
    }
    setStatus(
      message || `已计算 ${formatInteger(lastTargets.length)} 个生产目标，合并得到 ${formatInteger(totals.size)} 行材料。`,
      false,
    );
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

  function buildTree(itemClass, rate, path, nodeKey) {
    const item = itemForClass(itemClass);
    const node = {
      key: nodeKey,
      item,
      rate,
      children: [],
      recipe: null,
      choices: [],
      choiceCount: 0,
      raw: false,
      cycle: false,
    };

    if (path.includes(itemClass)) {
      node.cycle = true;
      return node;
    }

    if (item.isRawResource) {
      node.raw = true;
      return node;
    }

    const choices = recipesByOutput.get(itemClass) || [];
    node.choices = choices;
    node.choiceCount = choices.length;
    if (!choices.length) {
      node.raw = true;
      return node;
    }

    const choice = selectedRecipeChoice(itemClass, nodeKey, choices);
    const outputRate = Number(choice.output.perMin);
    if (!Number.isFinite(outputRate) || outputRate <= 0) {
      node.raw = true;
      return node;
    }

    const scale = rate / outputRate;
    node.recipe = choice.recipe;
    const nextPath = [...path, itemClass];
    node.children = choice.recipe.inputs.map((input, index) => {
      const childRate = Number(input.perMin) * scale;
      return buildTree(input.itemClass, childRate, nextPath, `${nodeKey}.${index}-${input.itemClass}`);
    });
    return node;
  }

  function selectedRecipeChoice(itemClass, nodeKey, choices) {
    const selectedRecipeId = recipeSelectionFor(itemClass, nodeKey);
    if (selectedRecipeId) {
      const selectedChoice = choices.find((choice) => choice.recipe.id === selectedRecipeId);
      if (selectedChoice) {
        return selectedChoice;
      }
    }
    return choices[0];
  }

  function recipeSelectionFor(itemClass, nodeKey) {
    if (syncRecipesToggle.checked) {
      return globalRecipeSelections.get(itemClass);
    }
    return localRecipeSelections.get(nodeKey) || globalRecipeSelections.get(itemClass);
  }

  function collectTotals(node, totals, isRoot) {
    if (!isRoot) {
      const key = node.item.className;
      const current = totals.get(key) || {
        item: node.item,
        rate: 0,
        raw: isTerminalRaw(node.item),
        recipes: new Set(),
      };
      current.rate += node.rate;
      current.raw = current.raw || node.raw;
      if (node.recipe) {
        current.recipes.add(node.recipe.name);
      }
      totals.set(key, current);
    }
    node.children.forEach((child) => collectTotals(child, totals, false));
  }

  function renderTree(roots) {
    const list = document.createElement("ol");
    list.className = "tree-list";
    roots.forEach((root) => list.appendChild(renderNode(root, true)));
    treeView.replaceChildren(list);
  }

  function renderNode(node, isRoot) {
    const li = document.createElement("li");
    li.className = "tree-node";

    const card = document.createElement("div");
    card.className = `tree-card${node.raw ? " raw" : ""}${node.cycle ? " cycle" : ""}`;

    const main = document.createElement("div");
    main.className = "node-main";

    const title = document.createElement("div");
    title.className = "node-title";

    const name = document.createElement("span");
    name.className = "node-name";
    name.textContent = node.item.name;

    const rate = document.createElement("span");
    rate.className = "node-rate";
    rate.textContent = `${formatNumber(node.rate)} ${node.item.unit}/min`;

    title.append(name, rate);

    if (isRoot) {
      title.appendChild(makeBadge("目标"));
    }
    if (node.cycle) {
      title.appendChild(makeBadge("循环", "raw"));
    } else if (node.raw) {
      title.appendChild(makeBadge("原材料", "raw"));
    } else if (node.recipe?.isAlternate) {
      title.appendChild(makeBadge("替代", "alt"));
    }

    const meta = document.createElement("div");
    meta.className = "node-meta";
    meta.textContent = nodeMetaText(node);

    main.append(title, meta);
    if (!node.raw && !node.cycle && node.choices.length > 1) {
      main.appendChild(renderRecipeSelector(node));
    }
    card.appendChild(main);
    li.appendChild(card);

    if (node.children.length) {
      const children = document.createElement("ol");
      children.className = "tree-list";
      node.children.forEach((child) => children.appendChild(renderNode(child, false)));
      li.appendChild(children);
    }

    return li;
  }

  function renderRecipeSelector(node) {
    const row = document.createElement("div");
    row.className = "recipe-select-row";

    const label = document.createElement("label");
    label.textContent = "配方";
    label.setAttribute("for", `recipe-${node.key}`);

    const select = document.createElement("select");
    select.className = "recipe-select";
    select.id = `recipe-${node.key}`;
    select.dataset.nodeKey = node.key;
    select.dataset.itemClass = node.item.className;

    node.choices.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice.recipe.id;
      option.textContent = recipeOptionText(choice);
      option.selected = node.recipe && choice.recipe.id === node.recipe.id;
      select.appendChild(option);
    });

    row.append(label, select);
    return row;
  }

  function renderMergedTable(totals) {
    if (!totals.size) {
      tableView.replaceChildren(makeEmptyMessage("所选目标没有下游材料需求。"));
      return;
    }

    const rows = Array.from(totals.values()).sort((a, b) => {
      if (a.raw !== b.raw) {
        return a.raw ? 1 : -1;
      }
      return a.item.name.localeCompare(b.item.name);
    });

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
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      appendCell(tr, row.item.name);
      appendCell(tr, formatNumber(row.rate), "number-cell");
      appendCell(tr, row.item.unit);
      appendCell(tr, row.raw ? "原材料" : "中间材料");
      appendCell(tr, Array.from(row.recipes).join(", "));
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    wrap.appendChild(table);
    tableView.replaceChildren(wrap);
  }

  function nodeMetaText(node) {
    if (node.cycle) {
      return "检测到循环，已停止展开。";
    }
    if (node.raw) {
      return node.item.isRawResource ? "原材料，已停止展开。" : "导出的数据中没有可生产该物品的配方。";
    }
    const producedIn = node.recipe.producedIn.length ? node.recipe.producedIn.join(", ") : "未知生产设备";
    const extra = node.choiceCount > 1 ? ` · 可选 ${node.choiceCount} 个配方` : "";
    return `当前配方：${node.recipe.name} · ${producedIn}${extra}`;
  }

  function recipeOptionText(choice) {
    const parts = [choice.recipe.name, `${formatNumber(Number(choice.output.perMin))} ${choice.output.unit}/min`];
    if (choice.recipe.isAlternate) {
      parts.push("替代配方");
    }
    if (choice.recipe.producedIn.length) {
      parts.push(choice.recipe.producedIn.join(", "));
    }
    return parts.join(" · ");
  }

  function compareRecipeChoices(a, b) {
    const scoreA = recipeScore(a);
    const scoreB = recipeScore(b);
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    return a.recipe.name.localeCompare(b.recipe.name);
  }

  function recipeScore(choice) {
    const recipeName = normalize(choice.recipe.name);
    const itemName = normalize(choice.output.itemName);
    let score = 0;
    if (choice.recipe.isAlternate) score += 1000;
    if (recipeName === itemName) score -= 80;
    if (recipeName.includes(itemName)) score -= 30;
    score += choice.recipe.inputs.length * 4;
    return score;
  }

  function isTerminalRaw(item) {
    return item.isRawResource || !(recipesByOutput.get(item.className) || []).length;
  }

  function itemForClass(itemClass) {
    return itemsByClass.get(itemClass) || {
      className: itemClass,
      name: itemClass,
      unit: "items",
      producible: false,
      isRawResource: false,
    };
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
    if (!Number.isFinite(value)) {
      return "";
    }
    if (Math.abs(value - Math.round(value)) < 1e-9) {
      return String(Math.round(value));
    }
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatInteger(value) {
    return Number(value || 0).toLocaleString("en-US");
  }
})();
