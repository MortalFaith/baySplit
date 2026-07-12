const state = {
  voyages: [],
  currentVoyageId: null,
  data: null,
  movesPerHour: 25,
  activeSheet: "bay",
  bayFilterEnabled: false,
  holderViewHolder: null,
  sort: {
    key: null,
    direction: null,
  },
  selectedBays: new Set(),
  active: {
    holders: true,
    decks: true,
    heights: true,
    sizes: true,
    statuses: true,
  },
  selected: {
    holders: new Set(),
    decks: new Set(),
    heights: new Set(),
    sizes: new Set(),
    statuses: new Set(),
  },
};

const ROOT_PATH = (window.BAY_SPLIT_ROOT_PATH || "").replace(/\/$/, "");
const FILTER_KEYS = ["holders", "decks", "heights", "sizes", "statuses"];
const SHEETS = [
  {
    key: "bay",
    label: "按贝位",
    description: "行维度为贝位，列维度为 持箱人 / 仓上仓下 / 尺寸 / 箱高。",
  },
  {
    key: "holderBay",
    label: "持箱人 x 贝位",
    description: "列名为各个贝位，纵轴为持箱人，可快速对比各持箱人的贝位分布。",
  },
  {
    key: "holderLoadPort",
    label: "装货港 x 贝位",
    description: "单一持箱人视图：列名为装货港，纵轴为贝位，并分别显示舱上 / 舱下箱量。",
  },
];

function withRootPath(path) {
  return `${ROOT_PATH}${path}`;
}

const homeView = document.getElementById("home-view");
const voyageView = document.getElementById("voyage-view");
const homeUploadForm = document.getElementById("home-upload-form");
const homeFileInput = document.getElementById("home-file-input");
const voyageList = document.getElementById("voyage-list");
const voyageCardTemplate = document.getElementById("voyage-card-template");
const filterTemplate = document.getElementById("filter-group-template");
const ticketItemTemplate = document.getElementById("ticket-item-template");
const backHomeButton = document.getElementById("back-home-button");
const createTicketButton = document.getElementById("create-ticket-button");
const resetFiltersButton = document.getElementById("reset-filters");
const heroTitle = document.getElementById("hero-title");
const sidebarTitle = document.getElementById("sidebar-title");
const filterPanel = document.getElementById("filter-panel");
const ticketList = document.getElementById("ticket-list");
const baseFilterTags = document.getElementById("base-filter-tags");
const pivotTable = document.getElementById("pivot-table");
const matrixDescription = document.getElementById("matrix-description");
const sheetTabs = document.getElementById("sheet-tabs");
const toggleBayFilterButton = document.getElementById("toggle-bay-filter-button");
const holderViewControls = document.getElementById("holder-view-controls");
const holderViewSelect = document.getElementById("holder-view-select");
const settingsButton = document.getElementById("settings-button");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsButton = document.getElementById("close-settings");
const saveSettingsButton = document.getElementById("save-settings");
const movesPerHourInput = document.getElementById("moves-per-hour-input");

homeUploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const [file] = homeFileInput.files;
  if (!file) {
    window.alert("请先选择一个 Excel 文件。");
    return;
  }

  let voyageName = "";
  const stem = file.name.replace(/\.[^.]+$/, "");
  if (!stem.includes("_")) {
    voyageName = window.prompt("文件名中未包含航次，请输入航次名称：", "") || "";
    if (!voyageName.trim()) {
      window.alert("未输入航次名称，已取消导入。");
      return;
    }
  }

  const formData = new FormData();
  formData.append("file", file);
  if (voyageName.trim()) {
    formData.append("voyage_name", voyageName.trim());
  }

  const response = await fetch(withRootPath("/api/voyages"), { method: "POST", body: formData });
  const payload = await readJson(response);
  if (!response.ok) {
    window.alert(payload.detail || "导入失败");
    return;
  }

  await loadVoyages();
  await openVoyage(payload.voyageId);
  homeFileInput.value = "";
});

backHomeButton?.addEventListener("click", () => {
  state.currentVoyageId = null;
  updateRoute();
  renderLayout();
});

resetFiltersButton?.addEventListener("click", async () => {
  if (!state.data) {
    return;
  }

  state.active = {
    holders: true,
    decks: true,
    heights: true,
    sizes: true,
    statuses: true,
  };
  resetSelectionsToDefaults();
  state.selectedBays.clear();
  state.bayFilterEnabled = false;
  state.sort = { key: null, direction: null };
  state.holderViewHolder = null;
  await refreshDashboard();
});

createTicketButton?.addEventListener("click", async () => {
  if (!state.currentVoyageId) {
    return;
  }

  if (state.selectedBays.size === 0) {
    window.alert("请先在矩阵中勾选至少一个贝位。");
    return;
  }

  const response = await fetch(withRootPath(`/api/voyages/${state.currentVoyageId}/tickets`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      active_holders: state.active.holders,
      active_decks: state.active.decks,
      active_heights: state.active.heights,
      active_sizes: state.active.sizes,
      active_statuses: state.active.statuses,
      selected_holders: [...state.selected.holders],
      selected_decks: [...state.selected.decks],
      selected_heights: [...state.selected.heights],
      selected_sizes: [...state.selected.sizes],
      selected_statuses: [...state.selected.statuses],
      selected_bays: [...state.selectedBays],
    }),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    window.alert(payload.detail || "生成分票失败");
    return;
  }

  state.selectedBays.clear();
  state.bayFilterEnabled = false;
  await refreshDashboard();
});

toggleBayFilterButton?.addEventListener("click", () => {
  toggleBayFilter();
});

holderViewSelect?.addEventListener("change", (event) => {
  state.holderViewHolder = event.target.value || null;
  state.sort = { key: null, direction: null };
  renderTable();
});

settingsButton?.addEventListener("click", () => {
  movesPerHourInput.value = String(state.movesPerHour);
  settingsModal.classList.remove("hidden");
  settingsModal.setAttribute("aria-hidden", "false");
});

closeSettingsButton?.addEventListener("click", closeSettingsModal);
saveSettingsButton?.addEventListener("click", () => {
  const value = Number(movesPerHourInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    window.alert("每小时关数必须是大于 0 的数字。");
    return;
  }

  state.movesPerHour = value;
  closeSettingsModal();
  renderTable();
});

settingsModal?.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal === "true") {
    closeSettingsModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "s" || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (isTypingTarget(event.target) || !state.currentVoyageId || !state.data) {
    return;
  }
  event.preventDefault();
  toggleBayFilter();
});

async function init() {
  await loadVoyages();
  const voyageId = new URLSearchParams(window.location.search).get("voyage");
  if (voyageId && state.voyages.some((item) => item.id === voyageId)) {
    await openVoyage(voyageId);
    return;
  }
  renderLayout();
}

async function loadVoyages() {
  const response = await fetch(withRootPath("/api/voyages"));
  const payload = await readJson(response);
  state.voyages = payload.voyages || [];
  renderVoyageCards();
}

async function openVoyage(voyageId) {
  state.currentVoyageId = voyageId;
  updateRoute();
  state.activeSheet = "bay";
  state.bayFilterEnabled = false;
  state.holderViewHolder = null;
  state.sort = { key: null, direction: null };
  state.selectedBays.clear();
  state.active = {
    holders: true,
    decks: true,
    heights: true,
    sizes: true,
    statuses: true,
  };
  state.selected = {
    holders: new Set(),
    decks: new Set(),
    heights: new Set(),
    sizes: new Set(),
    statuses: new Set(),
  };
  await refreshDashboard(true);
  renderLayout();
}

async function refreshDashboard(initialize = false) {
  if (!state.currentVoyageId) {
    return;
  }

  const params = new URLSearchParams();
  params.set("active_holders", String(state.active.holders));
  params.set("active_decks", String(state.active.decks));
  params.set("active_heights", String(state.active.heights));
  params.set("active_sizes", String(state.active.sizes));
  params.set("active_statuses", String(state.active.statuses));

  FILTER_KEYS.forEach((group) => {
    if (!initialize) {
      params.set(`${group}_specified`, "true");
    }
    if (!state.active[group]) {
      return;
    }
    [...state.selected[group]].forEach((value) => params.append(group, value));
  });

  const response = await fetch(
    withRootPath(`/api/voyages/${state.currentVoyageId}/dashboard?${params.toString()}`)
  );
  state.data = await readJson(response);
  if (initialize) {
    syncInitialFilters();
  } else {
    clampSelectionsToAvailable();
  }
  clampSelectedBaysToRecords();
  syncBayFilterState();
  syncHolderViewState();
  renderVoyageView();
}

function syncInitialFilters() {
  FILTER_KEYS.forEach((group) => {
    state.active[group] = state.data.filters.active[group];
    state.selected[group] = new Set(state.data.filters.selected[group]);
  });
}

function clampSelectionsToAvailable() {
  FILTER_KEYS.forEach((group) => {
    const available = new Set(state.data.filters.available[group]);
    state.selected[group] = new Set([...state.selected[group]].filter((value) => available.has(value)));
  });
}

function resetSelectionsToDefaults() {
  FILTER_KEYS.forEach((group) => {
    state.selected[group] = new Set(
      state.data.filters.defaults[group] || state.data.filters.available[group]
    );
  });
}

function clampSelectedBaysToRecords() {
  if (!state.data) {
    return;
  }

  const visibleBays = new Set((state.data.records || []).map((record) => record.bay));
  state.selectedBays = new Set([...state.selectedBays].filter((bay) => visibleBays.has(bay)));
}

function syncBayFilterState() {
  if (state.selectedBays.size === 0) {
    state.bayFilterEnabled = false;
  }
}

function syncHolderViewState() {
  if (!hasRecordViewData()) {
    state.holderViewHolder = null;
    return;
  }

  const holders = getAvailableHolders(getDisplayedRecords({ applyBayFilter: false }));
  if (holders.length === 0) {
    state.holderViewHolder = null;
    return;
  }

  if (holders.length === 1) {
    state.holderViewHolder = holders[0];
    return;
  }

  if (!state.holderViewHolder || !holders.includes(state.holderViewHolder)) {
    state.holderViewHolder = holders[0];
  }
}

function renderLayout() {
  const showingVoyage = Boolean(state.currentVoyageId && state.data);
  homeView.classList.toggle("hidden", showingVoyage);
  voyageView.classList.toggle("hidden", !showingVoyage);
  if (!showingVoyage) {
    renderVoyageCards();
  }
}

function renderVoyageCards() {
  if (!voyageList || !voyageCardTemplate) {
    return;
  }

  voyageList.innerHTML = "";
  state.voyages.forEach((voyage) => {
    const fragment = voyageCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".voyage-card");
    const deleteButton = fragment.querySelector(".voyage-card__delete");
    fragment.querySelector(".voyage-card__eyebrow").textContent = voyage.voyageName;
    fragment.querySelector(".voyage-card__title").textContent = voyage.shipName;
    fragment.querySelector(".voyage-card__meta").textContent =
      `${voyage.boxCount} 箱 · ${voyage.bayCount} 贝 · ${voyage.ticketCount} 票`;

    const openCard = async () => {
      await openVoyage(voyage.id);
    };
    card.addEventListener("click", openCard);
    card.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        await openCard();
      }
    });
    deleteButton?.addEventListener("click", async (event) => {
      event.stopPropagation();
      const confirmed = window.confirm(`确认删除航次“${voyage.displayName}”吗？已生成的分票也会一并删除。`);
      if (!confirmed) {
        return;
      }

      const response = await fetch(withRootPath(`/api/voyages/${voyage.id}`), { method: "DELETE" });
      const payload = await readJson(response);
      if (!response.ok) {
        window.alert(payload.detail || "删除失败");
        return;
      }

      if (state.currentVoyageId === voyage.id) {
        state.currentVoyageId = null;
        state.data = null;
        updateRoute();
        renderLayout();
      }
      await loadVoyages();
    });
    voyageList.appendChild(fragment);
  });
}

function renderVoyageView() {
  renderLayout();
  renderHero();
  renderFilters();
  renderTickets();
  renderTags();
  renderMatrixChrome();
  renderTable();
}

function renderHero() {
  if (!heroTitle || !sidebarTitle) {
    return;
  }
  const { voyage } = state.data;
  heroTitle.textContent = voyage.displayName;
  sidebarTitle.textContent = voyage.shipName;
}

function renderFilters() {
  if (!filterPanel || !filterTemplate) {
    return;
  }

  const groups = [
    ["holders", "持箱人", "开启后按持箱人筛选和分类，关闭后全部视为一类。"],
    ["decks", "仓上 / 仓下", "开启后按仓位属性筛选，关闭后不区分仓上和仓下。"],
    ["heights", "箱高", "开启后按箱高筛选和分类，关闭后全部视为一类。"],
    ["sizes", "尺寸", "开启后按尺寸筛选，关闭后不限制尺寸。"],
    ["statuses", "箱状态", "开启后按箱状态筛选，关闭后不限制箱状态。"],
  ];

  filterPanel.innerHTML = "";
  groups.forEach(([key, title, hint]) => {
    const fragment = filterTemplate.content.cloneNode(true);
    fragment.querySelector("h3").textContent = title;
    fragment.querySelector(".filter-group__hint").textContent = hint;

    const toggle = fragment.querySelector(".filter-toggle");
    const options = fragment.querySelector(".filter-options");
    toggle.checked = state.active[key];
    if (!state.active[key]) {
      options.classList.add("hidden");
    }

    toggle.addEventListener("change", async (event) => {
      state.active[key] = event.target.checked;
      if (state.active[key] && state.selected[key].size === 0) {
        state.selected[key] = new Set(
          state.data.filters.defaults[key] || state.data.filters.available[key]
        );
      }
      await refreshDashboard();
    });

    state.data.filters.available[key].forEach((value) => {
      const chip = document.createElement("label");
      chip.className = "chip";
      chip.innerHTML = `
        <input type="checkbox" ${state.selected[key].has(value) ? "checked" : ""} />
        <span>${value}</span>
      `;
      chip.querySelector("input").addEventListener("change", async (event) => {
        if (event.target.checked) {
          state.selected[key].add(value);
        } else {
          state.selected[key].delete(value);
        }
        await refreshDashboard();
      });
      options.appendChild(chip);
    });

    filterPanel.appendChild(fragment);
  });
}

function renderTickets() {
  if (!ticketList || !createTicketButton || !ticketItemTemplate) {
    return;
  }

  ticketList.innerHTML = "";
  createTicketButton.disabled = state.selectedBays.size === 0;
  createTicketButton.textContent =
    state.selectedBays.size === 0 ? "增加分票" : `增加分票（${state.selectedBays.size} 贝）`;

  if (state.data.tickets.length === 0) {
    ticketList.innerHTML = '<p class="muted">暂未生成分票。</p>';
    return;
  }

  state.data.tickets.forEach((ticket) => {
    const fragment = ticketItemTemplate.content.cloneNode(true);
    fragment.querySelector(".ticket-item__title").textContent = ticket.displayName;
    fragment.querySelector(".ticket-item__meta").textContent =
      `${ticket.boxCount} 箱 · ${ticket.bayCount} 贝 · ${ticket.createdAt}`;
    const link = fragment.querySelector(".ticket-item__link");
    link.href = withRootPath(ticket.downloadUrl);
    link.textContent = "下载";
    ticketList.appendChild(fragment);
  });
}

function renderTags() {
  if (!baseFilterTags) {
    return;
  }
  baseFilterTags.innerHTML = Object.entries(state.data.meta.baseFilters)
    .map(([key, value]) => `<span class="tag">${key}: ${value}</span>`)
    .join("");
}

function renderMatrixChrome() {
  if (!matrixDescription || !sheetTabs || !toggleBayFilterButton || !holderViewControls || !holderViewSelect) {
    return;
  }

  const availableSheets = hasRecordViewData() ? SHEETS : [SHEETS[0]];
  if (!availableSheets.some((sheet) => sheet.key === state.activeSheet)) {
    state.activeSheet = "bay";
  }

  const currentSheet = availableSheets.find((sheet) => sheet.key === state.activeSheet) || SHEETS[0];
  matrixDescription.textContent = currentSheet.description;

  sheetTabs.innerHTML = availableSheets.map(
    (sheet) => `
      <button
        type="button"
        class="sheet-tab${sheet.key === state.activeSheet ? " sheet-tab--active" : ""}"
        data-sheet-tab="${sheet.key}"
      >
        ${sheet.label}
      </button>
    `
  ).join("");

  document.querySelectorAll("[data-sheet-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSheet = button.dataset.sheetTab;
      if (!nextSheet || nextSheet === state.activeSheet) {
        return;
      }
      state.activeSheet = nextSheet;
      state.sort = { key: null, direction: null };
      syncHolderViewState();
      renderMatrixChrome();
      renderTable();
    });
  });

  const selectedCount = state.selectedBays.size;
  toggleBayFilterButton.disabled = selectedCount === 0 && !state.bayFilterEnabled;
  toggleBayFilterButton.classList.toggle("matrix-action-button--active", state.bayFilterEnabled);
  toggleBayFilterButton.textContent = state.bayFilterEnabled
    ? "显示全部贝位（S）"
    : selectedCount > 0
      ? `筛选贝位（${selectedCount}）（S）`
      : "筛选贝位（S）";

  const holders = getAvailableHolders(getDisplayedRecords());
  const shouldShowHolderSelect = state.activeSheet === "holderLoadPort" && holders.length > 0;
  holderViewControls.classList.toggle("hidden", !shouldShowHolderSelect);

  if (shouldShowHolderSelect) {
    syncHolderViewState();
    holderViewSelect.innerHTML = holders
      .map(
        (holder) => `
          <option value="${escapeHtml(holder)}" ${
            holder === state.holderViewHolder ? "selected" : ""
          }>
            ${escapeHtml(holder)}
          </option>
        `
      )
      .join("");
  } else {
    holderViewSelect.innerHTML = "";
  }
}

function renderTable() {
  if (!state.data || !pivotTable) {
    return;
  }

  try {
    if (state.activeSheet === "holderBay") {
      renderHolderBayTable();
      return;
    }

    if (state.activeSheet === "holderLoadPort") {
      renderHolderLoadPortTable();
      return;
    }

    renderBayTable();
  } catch (error) {
    console.error("Pivot render failed, falling back to bay matrix.", error);
    state.activeSheet = "bay";
    state.sort = { key: null, direction: null };
    renderMatrixChrome();
    renderLegacyBayTable();
  }
}

function renderBayTable() {
  const columns = state.data.matrix.columns || [];
  const rows = getBayMatrixRows();

  if (columns.length === 0 || rows.length === 0) {
    renderEmptyTable({ primaryLabel: "贝位", selectable: true });
    return;
  }

  const holderGroups = groupBy(columns, "holder");
  const holderRow = holderGroups
    .map(([holder, items]) => `<th colspan="${items.length}">${escapeHtml(holder)}</th>`)
    .join("");
  const deckRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([deck, subItems]) => `<th colspan="${subItems.length}">${escapeHtml(deck)}</th>`)
        .join("")
    )
    .join("");
  const sizeRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([, deckItems]) =>
          groupBy(deckItems, "size")
            .map(([size, subItems]) => `<th colspan="${subItems.length}">${escapeHtml(size)}</th>`)
            .join("")
        )
        .join("")
    )
    .join("");
  const heightRow = columns.map((column) => `<th>${escapeHtml(column.height)}</th>`).join("");
  const allSelected = rows.length > 0 && rows.every((row) => state.selectedBays.has(row.bay));

  const bodyRows = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${row.values[column.key] || ""}</td>`).join("");
      return `
        <tr data-bay-row="${row.bay}">
          <td>
            <input type="checkbox" data-bay-checkbox="${row.bay}" ${
              state.selectedBays.has(row.bay) ? "checked" : ""
            } />
          </td>
          <td class="row-label">${renderBayCell(row)}</td>
          ${cells}
          <td>${row.total}</td>
        </tr>
      `;
    })
    .join("");

  const totals = buildMatrixTotals(rows, columns);
  const totalCells = columns.map((column) => `<td>${totals.values[column.key] || ""}</td>`).join("");

  pivotTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="4"><input id="toggle-all-bays" type="checkbox" ${allSelected ? "checked" : ""} /></th>
        <th rowspan="4">${renderSortHeaderLabel("贝位", "primary")}</th>
        ${holderRow}
        <th rowspan="4">${renderSortHeaderLabel("总计", "total")}</th>
      </tr>
      <tr>${deckRow}</tr>
      <tr>${sizeRow}</tr>
      <tr>${heightRow}</tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="grand-total">
        <td></td>
        <td class="total-label">${totals.label}</td>
        ${totalCells}
        <td>${totals.total}</td>
      </tr>
    </tbody>
  `;

  bindTableSortEvents();
  bindBaySelectionEvents(rows);
}

function renderHolderBayTable() {
  const records = getDisplayedRecords();
  const bays = uniqueSorted(records.map((record) => record.bay), compareNatural);
  const holders = uniqueSorted(records.map((record) => record.holder), compareNatural);

  if (bays.length === 0 || holders.length === 0) {
    renderEmptyTable({ primaryLabel: "持箱人" });
    return;
  }

  const counts = new Map();
  records.forEach((record) => {
    const key = `${record.holder}|${record.bay}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const rows = sortRows(
    holders.map((holder) => {
      const values = {};
      bays.forEach((bay) => {
        values[bay] = counts.get(`${holder}|${bay}`) || 0;
      });
      return {
        label: holder,
        sortValue: holder,
        values,
        total: Object.values(values).reduce((sum, value) => sum + value, 0),
      };
    })
  );

  const allTotals = {};
  bays.forEach((bay) => {
    allTotals[bay] = rows.reduce((sum, row) => sum + (row.values[bay] || 0), 0);
  });

  const bodyRows = rows
    .map((row) => {
      const cells = bays.map((bay) => `<td>${row.values[bay] || ""}</td>`).join("");
      return `
        <tr>
          <td class="row-label">${escapeHtml(row.label)}</td>
          ${cells}
          <td>${row.total}</td>
        </tr>
      `;
    })
    .join("");

  const totalCells = bays.map((bay) => `<td>${allTotals[bay] || ""}</td>`).join("");

  pivotTable.innerHTML = `
    <thead>
      <tr>
        <th>${renderSortHeaderLabel("持箱人", "primary")}</th>
        ${bays.map((bay) => `<th>${escapeHtml(bay)}</th>`).join("")}
        <th>${renderSortHeaderLabel("总计", "total")}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="grand-total">
        <td class="total-label">总计</td>
        ${totalCells}
        <td>${Object.values(allTotals).reduce((sum, value) => sum + value, 0)}</td>
      </tr>
    </tbody>
  `;

  bindTableSortEvents();
}

function renderHolderLoadPortTable() {
  const records = getDisplayedRecords();
  const holders = getAvailableHolders(records);
  if (holders.length === 0) {
    renderEmptyTable({ primaryLabel: "贝位", selectable: true });
    return;
  }

  syncHolderViewState();
  const holderRecords = records.filter((record) => record.holder === state.holderViewHolder);
  const bays = uniqueSorted(holderRecords.map((record) => record.bay), compareNatural);
  const ports = uniqueSorted(
    holderRecords.map((record) => record.loadPort || "未知"),
    compareNatural
  );

  if (bays.length === 0 || ports.length === 0) {
    renderEmptyTable({ primaryLabel: "贝位", selectable: true });
    return;
  }

  const warningMap = buildWarningMap();
  const counts = new Map();
  holderRecords.forEach((record) => {
    const key = `${record.bay}|${record.loadPort || "未知"}|${record.deck}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const bayGroups = sortBayGroups(
    bays.map((bay) => {
      const deckRows = ["舱上", "舱下"].map((deck) => {
        const values = {};
        ports.forEach((port) => {
          values[port] = counts.get(`${bay}|${port}|${deck}`) || 0;
        });
        return {
          bay,
          deck,
          values,
          total: Object.values(values).reduce((sum, value) => sum + value, 0),
        };
      });
      return {
        bay,
        warnings: warningMap[bay] || [],
        total: deckRows.reduce((sum, row) => sum + row.total, 0),
        rows: deckRows,
      };
    })
  );

  const allSelected =
    bayGroups.length > 0 && bayGroups.every((group) => state.selectedBays.has(group.bay));
  const totalCells = ports.map(
    (port) =>
      `<td>${bayGroups.reduce(
        (sum, group) => sum + group.rows.reduce((deckSum, row) => deckSum + (row.values[port] || 0), 0),
        0
      )}</td>`
  );

  const bodyRows = bayGroups
    .map((group) =>
      group.rows
        .map((row, index) => {
          const cells = ports.map((port) => `<td>${row.values[port] || ""}</td>`).join("");
          return `
            <tr data-bay-row="${group.bay}">
              ${
                index === 0
                  ? `
                <td rowspan="${group.rows.length}">
                  <input type="checkbox" data-bay-checkbox="${group.bay}" ${
                    state.selectedBays.has(group.bay) ? "checked" : ""
                  } />
                </td>
                <td rowspan="${group.rows.length}" class="row-label">${renderBayCell({
                  bay: group.bay,
                  warnings: group.warnings,
                  total: group.total,
                })}</td>
              `
                  : ""
              }
              <td class="deck-label">${row.deck}</td>
              ${cells}
              <td>${row.total}</td>
            </tr>
          `;
        })
        .join("")
    )
    .join("");

  pivotTable.innerHTML = `
    <thead>
      <tr>
        <th><input id="toggle-all-bays" type="checkbox" ${allSelected ? "checked" : ""} /></th>
        <th>${renderSortHeaderLabel("贝位", "primary")}</th>
        <th>仓位</th>
        ${ports.map((port) => `<th>${escapeHtml(port)}</th>`).join("")}
        <th>${renderSortHeaderLabel("总计", "total")}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="grand-total">
        <td></td>
        <td class="total-label">总计</td>
        <td></td>
        ${totalCells.join("")}
        <td>${bayGroups.reduce((sum, group) => sum + group.total, 0)}</td>
      </tr>
    </tbody>
  `;

  bindTableSortEvents();
  bindBaySelectionEvents(bayGroups.map((group) => ({ bay: group.bay })));
}

function renderEmptyTable({ primaryLabel, selectable = false }) {
  pivotTable.innerHTML = `
    <thead>
      <tr>
        ${selectable ? "<th>选择</th>" : ""}
        <th>${escapeHtml(primaryLabel)}</th>
        <th>总计</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        ${selectable ? "<td></td>" : ""}
        <td class="row-label">-</td>
        <td class="no-data">当前筛选没有匹配箱量，请调整开关、筛选项或贝位范围。</td>
      </tr>
    </tbody>
  `;
}

function renderLegacyBayTable() {
  const columns = state.data?.matrix?.columns || [];
  const rows = state.data?.matrix?.rows || [];

  if (columns.length === 0 || rows.length === 0) {
    renderEmptyTable({ primaryLabel: "贝位", selectable: true });
    return;
  }

  const holderGroups = groupBy(columns, "holder");
  const holderRow = holderGroups
    .map(([holder, items]) => `<th colspan="${items.length}">${escapeHtml(holder)}</th>`)
    .join("");
  const deckRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([deck, subItems]) => `<th colspan="${subItems.length}">${escapeHtml(deck)}</th>`)
        .join("")
    )
    .join("");
  const sizeRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([, deckItems]) =>
          groupBy(deckItems, "size")
            .map(([size, subItems]) => `<th colspan="${subItems.length}">${escapeHtml(size)}</th>`)
            .join("")
        )
        .join("")
    )
    .join("");
  const heightRow = columns.map((column) => `<th>${escapeHtml(column.height)}</th>`).join("");
  const allSelected = rows.length > 0 && rows.every((row) => state.selectedBays.has(row.bay));

  const bodyRows = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${row.values[column.key] || ""}</td>`).join("");
      return `
        <tr data-bay-row="${row.bay}">
          <td>
            <input type="checkbox" data-bay-checkbox="${row.bay}" ${
              state.selectedBays.has(row.bay) ? "checked" : ""
            } />
          </td>
          <td class="row-label">${renderBayCell(row)}</td>
          ${cells}
          <td>${row.total}</td>
        </tr>
      `;
    })
    .join("");

  const totals = state.data.matrix.totals || { values: {}, total: 0, bay: "总计" };
  const totalCells = columns.map((column) => `<td>${totals.values[column.key] || ""}</td>`).join("");

  pivotTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="4"><input id="toggle-all-bays" type="checkbox" ${allSelected ? "checked" : ""} /></th>
        <th rowspan="4">${renderSortHeaderLabel("贝位", "primary")}</th>
        ${holderRow}
        <th rowspan="4">${renderSortHeaderLabel("总计", "total")}</th>
      </tr>
      <tr>${deckRow}</tr>
      <tr>${sizeRow}</tr>
      <tr>${heightRow}</tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="grand-total">
        <td></td>
        <td class="total-label">${totals.bay || "总计"}</td>
        ${totalCells}
        <td>${totals.total || 0}</td>
      </tr>
    </tbody>
  `;

  bindTableSortEvents();
  bindBaySelectionEvents(rows.map((row) => ({ bay: row.bay })));
}

function getBayMatrixRows() {
  const sourceRows = state.data.matrix.rows || [];
  const filteredRows =
    state.bayFilterEnabled && state.selectedBays.size > 0
      ? sourceRows.filter((row) => state.selectedBays.has(row.bay))
      : sourceRows;

  return sortRows(
    filteredRows.map((row) => ({
      ...row,
      sortValue: row.bay,
    }))
  );
}

function buildMatrixTotals(rows, columns) {
  const values = {};
  columns.forEach((column) => {
    values[column.key] = rows.reduce((sum, row) => sum + (row.values[column.key] || 0), 0);
  });
  return {
    label: "总计",
    values,
    total: Object.values(values).reduce((sum, value) => sum + value, 0),
  };
}

function sortBayGroups(groups) {
  if (!state.sort.key || !state.sort.direction) {
    return groups;
  }

  const direction = state.sort.direction === "desc" ? -1 : 1;
  return [...groups].sort((left, right) => {
    if (state.sort.key === "total") {
      return (left.total - right.total) * direction;
    }
    return compareNatural(left.bay, right.bay) * direction;
  });
}

function renderSortHeaderLabel(label, key) {
  const isActive = state.sort.key === key;
  const directionLabel =
    !isActive || !state.sort.direction
      ? ""
      : state.sort.direction === "asc"
        ? "（升序）"
        : "（降序）";

  return `
    <button
      type="button"
      class="table-sort${isActive ? " table-sort--active" : ""}"
      data-sort-key="${key}"
    >
      ${label}${directionLabel}
    </button>
  `;
}

function bindTableSortEvents() {
  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    button.addEventListener("click", (event) => {
      cycleSort(event.currentTarget.dataset.sortKey);
      renderTable();
    });
  });
}

function cycleSort(key) {
  const sequence = key === "total" ? ["desc", "asc", null] : ["asc", "desc", null];

  if (state.sort.key !== key) {
    state.sort = { key, direction: sequence[0] };
    return;
  }

  const nextIndex = (sequence.indexOf(state.sort.direction) + 1) % sequence.length;
  const nextDirection = sequence[nextIndex];
  state.sort = nextDirection ? { key, direction: nextDirection } : { key: null, direction: null };
}

function bindBaySelectionEvents(rows) {
  const toggleAll = document.getElementById("toggle-all-bays");
  if (toggleAll) {
    toggleAll.addEventListener("change", (event) => {
      if (event.target.checked) {
        rows.forEach((row) => state.selectedBays.add(row.bay));
      } else {
        rows.forEach((row) => state.selectedBays.delete(row.bay));
      }
      afterBaySelectionChange();
    });
  }

  document.querySelectorAll("[data-bay-checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const bay = event.target.dataset.bayCheckbox;
      if (event.target.checked) {
        state.selectedBays.add(bay);
      } else {
        state.selectedBays.delete(bay);
      }
      afterBaySelectionChange();
    });
  });

  document.querySelectorAll("[data-bay-row]").forEach((tableRow) => {
    tableRow.addEventListener("click", (event) => {
      if (event.target.closest("input, button, a, label, select")) {
        return;
      }

      const bay = tableRow.dataset.bayRow;
      if (!bay) {
        return;
      }

      if (state.selectedBays.has(bay)) {
        state.selectedBays.delete(bay);
      } else {
        state.selectedBays.add(bay);
      }
      afterBaySelectionChange();
    });
  });
}

function afterBaySelectionChange() {
  syncBayFilterState();
  renderTickets();
  renderMatrixChrome();
  renderTable();
}

function toggleBayFilter() {
  if (state.selectedBays.size === 0 && !state.bayFilterEnabled) {
    window.alert("请先勾选至少一个贝位，再使用筛选贝位。");
    return;
  }

  state.bayFilterEnabled = !state.bayFilterEnabled;
  syncHolderViewState();
  renderMatrixChrome();
  renderTable();
}

function sortRows(rows) {
  if (!state.sort.key || !state.sort.direction) {
    return rows;
  }

  const direction = state.sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    if (state.sort.key === "total") {
      return (left.total - right.total) * direction;
    }

    return compareNatural(left.sortValue, right.sortValue) * direction;
  });
}

function compareNatural(left, right) {
  if (left === right) {
    return 0;
  }
  const leftValue = left == null ? "" : String(left);
  const rightValue = right == null ? "" : String(right);
  if (/^\d+$/.test(leftValue) && /^\d+$/.test(rightValue)) {
    return Number(leftValue) - Number(rightValue);
  }
  return leftValue.localeCompare(rightValue, "zh-CN");
}

function renderBayCell(row) {
  const warnings = (row.warnings || [])
    .map(
      (warning) =>
        `<span class="warning-pill warning-pill--${warning.kind}">${escapeHtml(warning.label)} ${
          warning.count
        }</span>`
    )
    .join("");

  return `
    <div class="bay-cell">
      <div class="bay-cell__head">
        <div class="bay-cell__title">${escapeHtml(row.bay)}</div>
        ${warnings ? `<div class="warning-list">${warnings}</div>` : ""}
      </div>
      <div class="bay-cell__eta">预估 ${formatDuration(row.total)}</div>
    </div>
  `;
}

function formatDuration(total) {
  if (!Number.isFinite(state.movesPerHour) || state.movesPerHour <= 0) {
    return "--";
  }
  const hours = total / state.movesPerHour;
  if (hours === 0) {
    return "0.0 小时";
  }
  if (hours < 0.1) {
    return "<0.1 小时";
  }
  return `${hours.toFixed(1)} 小时`;
}

function groupBy(items, key) {
  const groups = [];
  items.forEach((item) => {
    const current = groups[groups.length - 1];
    if (current && current[0] === item[key]) {
      current[1].push(item);
      return;
    }
    groups.push([item[key], [item]]);
  });
  return groups;
}

function updateRoute() {
  const url = new URL(window.location.href);
  if (state.currentVoyageId) {
    url.searchParams.set("voyage", state.currentVoyageId);
  } else {
    url.searchParams.delete("voyage");
  }
  window.history.replaceState({}, "", url);
}

function closeSettingsModal() {
  settingsModal.classList.add("hidden");
  settingsModal.setAttribute("aria-hidden", "true");
}

function getDisplayedRecords({ applyBayFilter = true } = {}) {
  const records = hasRecordViewData() ? state.data.records : [];
  if (!applyBayFilter || !state.bayFilterEnabled || state.selectedBays.size === 0) {
    return records;
  }
  return records.filter((record) => state.selectedBays.has(record.bay));
}

function hasRecordViewData() {
  return Array.isArray(state.data?.records) && state.data.records.length > 0;
}

function getAvailableHolders(records) {
  return uniqueSorted(
    records.map((record) => record.holder).filter(Boolean),
    compareNatural
  );
}

function buildWarningMap() {
  const warningMap = {};
  (state.data.matrix.rows || []).forEach((row) => {
    warningMap[row.bay] = row.warnings || [];
  });
  return warningMap;
}

function uniqueSorted(values, comparator) {
  return [...new Set(values)].sort(comparator);
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

init();
