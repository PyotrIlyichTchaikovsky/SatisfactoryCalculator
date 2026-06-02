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
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));

  let items = [];
  const itemsByClass = new Map();
  let activeTab = "tree";

  addTargetButton.addEventListener("click", () => addTargetRow());
  plannerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });

  addTargetRow();
  loadInitialData();

  async function loadInitialData() {
    try {
      const [summary, itemPayload] = await Promise.all([fetchJson("/api/summary"), fetchJson("/api/items")]);
      items = Array.isArray(itemPayload.items) ? itemPayload.items : [];
      itemsByClass.clear();
      items.forEach((item) => itemsByClass.set(item.className, item));
      dataSummary.textContent = summaryText(summary);
      setStatus("已从服务端加载 Excel 配方数据。请选择一个或多个物品，并输入每分钟需要生产的数量。", false);
    } catch (error) {
      dataSummary.textContent = "无法连接生产规划服务";
      setStatus(`无法加载服务端数据：${error.message}。请通过 python recipe_web/production_planner_server.py 启动服务后访问页面。`, true);
    }
  }

  async function calculate() {
    const targets = collectTargets();
    if (!targets.length) {
      return;
    }

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
        }),
      });
      renderTree(result.roots || []);
      renderMergedTable(result.totals || []);
      selectTab("tree");
      const targetCount = result.summary?.targetCount ?? targets.length;
      const totalRows = result.summary?.totalRows ?? 0;
      setStatus(`已计算 ${formatInteger(targetCount)} 个生产目标，合并得到 ${formatInteger(totalRows)} 行材料。`, false);
    } catch (error) {
      setStatus(`计算失败：${error.message}`, true);
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

  function renderTree(roots) {
    if (!roots.length) {
      treeView.replaceChildren(makeEmptyMessage("尚未计算生产目标。"));
      return;
    }

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

  function nodeMetaText(node) {
    if (node.cycle) {
      return "检测到循环，已停止展开。";
    }
    if (node.raw) {
      return node.item.isRawResource ? "原材料，已停止展开。" : "Excel 数据中没有可生产该物品的配方。";
    }
    const producedIn = node.recipe.producedIn.length ? node.recipe.producedIn.join(", ") : "未知生产设备";
    const extra = node.choiceCount > 1 ? ` · 默认排序第 1 / ${node.choiceCount} 个候选配方` : "";
    return `默认配方：${node.recipe.name} · ${producedIn}${extra}`;
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