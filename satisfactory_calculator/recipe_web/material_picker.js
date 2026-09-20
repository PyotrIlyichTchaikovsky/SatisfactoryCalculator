(() => {
  "use strict";

  const CATEGORY_ORDER = ["TierMaterial", "NormalMaterial", "RawMaterial", "PickupMaterial", "Power"];
  const CATEGORY_LABELS = {
    TierMaterial: "picker.tierMaterials",
    NormalMaterial: "picker.manufactured",
    RawMaterial: "picker.raw",
    PickupMaterial: "picker.collectibles",
    Power: "picker.power",
  };
  const RECENT_STORAGE_KEY = "satisfactoryMaterialPicker.recent.v1";
  const RECENT_LIMIT = 12;
  const ITEM_TIERS = Object.freeze({
    Desc_Cement_C: 1,
    Desc_IronPlate_C: 1,
    Desc_IronRod_C: 1,
    Desc_IronScrew_C: 1,
    Desc_Wire_C: 1,
    Desc_Cable_C: 2,
    Desc_IronPlateReinforced_C: 2,
    Desc_Rotor_C: 2,
    Desc_ModularFrame_C: 3,
    Desc_CopperSheet_C: 4,
    Desc_SteelPipe_C: 4,
    Desc_SteelPlateReinforced_C: 4,
    Desc_SteelPlate_C: 4,
    Desc_Motor_C: 5,
    Desc_Plastic_C: 5,
    Desc_Rubber_C: 5,
    Desc_Computer_C: 6,
    Desc_ModularFrameHeavy_C: 6,
    Desc_AluminumCasing_C: 7,
    Desc_AluminumPlate_C: 7,
    Desc_Filter_C: 7,
    Desc_HighSpeedWire_C: 7,
    Desc_ComputerSuper_C: 8,
    Desc_CoolingSystem_C: 8,
    Desc_ModularFrameFused_C: 8,
    Desc_ModularFrameLightweight_C: 8,
    Desc_MotorLightweight_C: 8,
    Desc_FicsiteMesh_C: 9,
    Desc_QuantumOscillator_C: 9,
    Desc_SAMFluctuator_C: 9,
    Desc_TemporalProcessor_C: 9,
    Desc_TimeCrystal_C: 9,
  });
  let activePicker = null;

  function open(options = {}) {
    close();
    const analytics = window.PlannerAnalytics || { track: () => false };
    analytics.track("material_picker_opened", { context: options.analyticsContext || "unknown" });
    const sourceItems = Array.isArray(options.items) ? options.items : [];
    const filter = typeof options.filter === "function" ? options.filter : () => true;
    const items = sourceItems
      .filter((item) => item?.className && filter(item))
      .sort((left, right) => i18n().compare(left.name || left.className, right.name || right.className));
    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "material-picker-overlay";

      const dialog = document.createElement("section");
      dialog.className = "material-picker-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const titleId = `material-picker-title-${Date.now()}`;
      dialog.setAttribute("aria-labelledby", titleId);

      const header = document.createElement("header");
      header.className = "material-picker-header";
      const heading = document.createElement("div");
      const title = document.createElement("h3");
      title.id = titleId;
      title.textContent = options.title || t("picker.title");
      const description = document.createElement("p");
      description.textContent = options.description || t("picker.help");
      heading.append(title, description);
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "material-picker-close";
      closeButton.setAttribute("aria-label", t("picker.close"));
      closeButton.textContent = "×";
      header.append(heading, closeButton);

      const searchWrap = document.createElement("div");
      searchWrap.className = "material-picker-search-wrap";
      const search = document.createElement("input");
      search.type = "search";
      search.className = "material-picker-search";
      search.placeholder = t("picker.search");
      search.setAttribute("aria-label", t("picker.searchAria"));
      const count = document.createElement("span");
      count.className = "material-picker-count";
      searchWrap.append(search, count);

      const body = document.createElement("div");
      body.className = "material-picker-body";
      const categories = document.createElement("nav");
      categories.className = "material-picker-categories";
      categories.setAttribute("aria-label", t("picker.categories"));
      const grid = document.createElement("div");
      grid.className = "material-picker-grid";
      grid.setAttribute("role", "listbox");
      grid.setAttribute("aria-label", t("picker.materials"));
      body.append(categories, grid);

      dialog.append(header, searchWrap, body);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      document.body.classList.add("material-picker-open");

      let recentIds = loadRecentIds();
      const recentItemIds = () => recentIds.filter((id) => items.some((item) => item.className === id));
      const isInCategory = (item, category) => (
        category === "recent"
          ? recentItemIds().includes(item.className)
          : category === "TierMaterial"
            ? Boolean(ITEM_TIERS[item.className])
            : item.materialCategory === category
      );
      const availableCategories = CATEGORY_ORDER.filter((category) => items.some((item) => isInCategory(item, category)));
      const initialItem = items.find((item) => item.className === options.initialId);
      let activeCategory = (initialItem && ITEM_TIERS[initialItem.className] ? "TierMaterial" : initialItem?.materialCategory)
        || (availableCategories.includes(options.preferredCategory) ? options.preferredCategory : "")
        || (availableCategories.includes("NormalMaterial") ? "NormalMaterial" : availableCategories[0] || "all");

      const finish = (selection = null) => {
        if (activePicker?.overlay !== overlay) return;
        document.removeEventListener("keydown", handleDocumentKeydown, true);
        overlay.remove();
        document.body.classList.remove("material-picker-open");
        activePicker = null;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(selection);
      };

      const renderCategories = () => {
        categories.replaceChildren();
        const definitions = [
          { id: "recent", label: t("picker.recent") },
          { id: "all", label: t("picker.all") },
          ...availableCategories.map((id) => ({ id, label: CATEGORY_LABELS[id] ? t(CATEGORY_LABELS[id]) : id })),
        ];
        definitions.forEach(({ id, label }) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "material-picker-category";
          button.classList.toggle("active", activeCategory === id);
          button.setAttribute("aria-pressed", String(activeCategory === id));
          const total = id === "all" ? items.length : items.filter((item) => isInCategory(item, id)).length;
          button.innerHTML = `<span>${escapeHtml(label)}</span><span class="material-picker-category-count">${total}</span>`;
          button.addEventListener("click", () => {
            activeCategory = id;
            renderCategories();
            renderGrid();
          });
          categories.appendChild(button);
        });
      };

      const renderGrid = () => {
        const query = normalize(search.value);
        const visible = items.filter((item) => (
          (activeCategory === "all" || isInCategory(item, activeCategory))
          && (!query || normalize(`${item.name} ${item.className}`).includes(query))
        )).sort((left, right) => {
          if (activeCategory === "recent") {
            return recentIds.indexOf(left.className) - recentIds.indexOf(right.className);
          }
          if (activeCategory === "TierMaterial") {
            const tierDifference = ITEM_TIERS[left.className] - ITEM_TIERS[right.className];
            if (tierDifference) return tierDifference;
          }
          return i18n().compare(left.name || left.className, right.name || right.className);
        });
        grid.replaceChildren();
        count.textContent = t("picker.count", { count: visible.length });
        if (!visible.length) {
          const empty = document.createElement("p");
          empty.className = "material-picker-empty";
          empty.textContent = t("picker.empty");
          grid.appendChild(empty);
          return;
        }
        visible.forEach((item) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "material-picker-card";
          card.dataset.itemId = item.className;
          card.setAttribute("role", "option");
          card.setAttribute("aria-label", t("picker.select", { name: item.name || item.className }));
          card.setAttribute("aria-selected", String(item.className === options.initialId));
          const icon = document.createElement("img");
          icon.className = "material-picker-card-icon";
          icon.alt = "";
          icon.loading = "lazy";
          if (item.iconPath) icon.src = item.iconPath;
          const name = document.createElement("span");
          name.className = "material-picker-card-name";
          name.textContent = item.name || item.className;
          card.append(icon, name);
          if (activeCategory === "TierMaterial") {
            const tier = document.createElement("span");
            tier.className = "material-picker-card-tier";
            tier.textContent = t("picker.tier", { tier: ITEM_TIERS[item.className] });
            card.appendChild(tier);
          }
          card.addEventListener("click", () => {
            recentIds = saveRecentId(item.className, recentIds);
            analytics.track("material_selected", {
              context: options.analyticsContext || "unknown",
              itemClass: item.className,
              category: activeCategory,
            });
            finish({ id: item.className, item });
          });
          grid.appendChild(card);
        });
      };

      const handleDocumentKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
        }
      };

      closeButton.addEventListener("click", () => finish());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish();
      });
      search.addEventListener("input", renderGrid);
      document.addEventListener("keydown", handleDocumentKeydown, true);
      activePicker = { overlay, finish };
      renderCategories();
      renderGrid();
      search.focus();
    });
  }

  function close() {
    activePicker?.finish();
  }

  function loadRecentIds() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
      return Array.isArray(stored)
        ? stored.map((id) => String(id || "").trim()).filter(Boolean).slice(0, RECENT_LIMIT)
        : [];
    } catch (_error) {
      return [];
    }
  }

  function saveRecentId(itemId, currentIds) {
    const next = [itemId, ...(currentIds || []).filter((id) => id !== itemId)].slice(0, RECENT_LIMIT);
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch (_error) {
      // localStorage can be unavailable in restrictive browser modes.
    }
    return next;
  }

  function normalize(value) {
    return i18n().normalizeSearch(value);
  }

  function i18n() {
    return window.PlannerI18n || {
      t: (key) => key,
      compare: (left, right) => String(left).localeCompare(String(right)),
      normalizeSearch: (value) => String(value || "").normalize("NFKD").toLowerCase(),
    };
  }

  function t(key, parameters) {
    return i18n().t(key, parameters);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  window.MaterialPicker = Object.freeze({ open, close });
})();
