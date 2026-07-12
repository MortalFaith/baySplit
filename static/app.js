const state = {
  voyages: [],
  currentVoyageId: null,
  data: null,
  movesPerHour: 25,
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
const heroSubtitle = document.getElementById("hero-subtitle");
const sidebarTitle = document.getElementById("sidebar-title");
const summaryGrid = document.getElementById("summary-grid");
const filterPanel = document.getElementById("filter-panel");
const ticketList = document.getElementById("ticket-list");
const baseFilterTags = document.getElementById("base-filter-tags");
const pivotTable = document.getElementById("pivot-table");
const settingsButton = document.getElementById("settings-button");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsButton = document.getElementById("close-settings");
const saveSettingsButton = document.getElementById("save-settings");
const movesPerHourInput = document.getElementById("moves-per-hour-input");

homeUploadForm.addEventListener("submit", async (event) => {
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

backHomeButton.addEventListener("click", () => {
  state.currentVoyageId = null;
  updateRoute();
  renderLayout();
});

resetFiltersButton.addEventListener("click", async () => {
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
  state.sort = { key: null, direction: null };
  await refreshDashboard();
});

createTicketButton.addEventListener("click", async () => {
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
  await refreshDashboard();
});

settingsButton.addEventListener("click", () => {
  movesPerHourInput.value = String(state.movesPerHour);
  settingsModal.classList.remove("hidden");
  settingsModal.setAttribute("aria-hidden", "false");
});

closeSettingsButton.addEventListener("click", closeSettingsModal);
saveSettingsButton.addEventListener("click", () => {
  const value = Number(movesPerHourInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    window.alert("每小时关数必须是大于 0 的数字。");
    return;
  }

  state.movesPerHour = value;
  closeSettingsModal();
  renderTable();
});

settingsModal.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal === "true") {
    closeSettingsModal();
  }
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
  clampSelectedBaysToRows();
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

function clampSelectedBaysToRows() {
  if (!state.data) {
    return;
  }

  const visibleBays = new Set(state.data.matrix.rows.map((row) => row.bay));
  state.selectedBays = new Set([...state.selectedBays].filter((bay) => visibleBays.has(bay)));
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
  voyageList.innerHTML = "";
  state.voyages.forEach((voyage) => {
    const fragment = voyageCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".voyage-card");
    fragment.querySelector(".voyage-card__eyebrow").textContent = voyage.voyageName;
    fragment.querySelector(".voyage-card__title").textContent = voyage.shipName;
    fragment.querySelector(".voyage-card__meta").textContent =
      `${voyage.boxCount} 箱 · ${voyage.bayCount} 贝 · ${voyage.ticketCount} 票`;
    card.addEventListener("click", async () => {
      await openVoyage(voyage.id);
    });
    voyageList.appendChild(fragment);
  });
}

function renderVoyageView() {
  renderLayout();
  renderHero();
  renderSummary();
  renderFilters();
  renderTickets();
  renderTags();
  renderTable();
}

function renderHero() {
  const { voyage } = state.data;
  heroTitle.textContent = voyage.displayName;
  heroSubtitle.textContent = "页面会展示按 BAY 展开的箱量矩阵与贝位预警标签，预估作业时长默认隐藏。";
  sidebarTitle.textContent = voyage.shipName;
}

function renderSummary() {
  const { summary } = state.data;
  const cards = [
    ["箱量", summary.containers, "当前筛选后的集装箱数量"],
    ["贝位数", summary.bays, "去重后的 BAY 数量"],
    ["持箱人数", summary.holders, "当前筛选下的持箱人数量"],
    ["舱位分布", `${summary.deckCounts["舱上"]}/${summary.deckCounts["舱下"]}`, "舱上 / 舱下"],
  ];

  summaryGrid.innerHTML = cards
    .map(
      ([label, value, meta]) => `
        <article class="summary-card">
          <p class="metric__label">${label}</p>
          <p class="metric__value">${value}</p>
          <p class="metric__meta">${meta}</p>
        </article>
      `
    )
    .join("");
}

function renderFilters() {
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
      state.selectedBays.clear();
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
        state.selectedBays.clear();
        await refreshDashboard();
      });
      options.appendChild(chip);
    });

    filterPanel.appendChild(fragment);
  });
}

function renderTickets() {
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
  baseFilterTags.innerHTML = Object.entries(state.data.meta.baseFilters)
    .map(([key, value]) => `<span class="tag">${key}: ${value}</span>`)
    .join("");
}

function renderTable() {
  const matrix = {
    ...state.data.matrix,
    rows: sortRows(state.data.matrix.rows),
  };
  const { columns, rows, totals } = matrix;

  if (columns.length === 0) {
    pivotTable.innerHTML = `
      <thead>
        <tr>
          <th>选择</th>
          <th>贝位</th>
          <th>总计</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td></td>
          <td class="row-label">-</td>
          <td class="no-data">当前筛选没有匹配箱量，请调整开关或筛选项。</td>
        </tr>
      </tbody>
    `;
    return;
  }

  const holderGroups = groupBy(columns, "holder");
  const holderRow = holderGroups
    .map(([holder, items]) => `<th colspan="${items.length}">${holder}</th>`)
    .join("");
  const deckRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([deck, subItems]) => `<th colspan="${subItems.length}">${deck}</th>`)
        .join("")
    )
    .join("");
  const sizeRow = holderGroups
    .map(([, items]) =>
      groupBy(items, "deck")
        .map(([, deckItems]) =>
          groupBy(deckItems, "size")
            .map(([size, subItems]) => `<th colspan="${subItems.length}">${size}</th>`)
            .join("")
        )
        .join("")
    )
    .join("");
  const heightRow = columns.map((column) => `<th>${column.height}</th>`).join("");
  const allSelected = rows.length > 0 && rows.every((row) => state.selectedBays.has(row.bay));

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${row.values[column.key] || ""}</td>`)
        .join("");
      return `
        <tr data-bay-row="${row.bay}">
          <td>
            <input type="checkbox" data-bay-checkbox="${row.bay}" ${state.selectedBays.has(row.bay) ? "checked" : ""} />
          </td>
          <td class="row-label">${renderBayCell(row)}</td>
          ${cells}
          <td>${row.total}</td>
        </tr>
      `;
    })
    .join("");

  const totalCells = columns
    .map((column) => `<td>${totals.values[column.key] || ""}</td>`)
    .join("");

  pivotTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="4"><input id="toggle-all-bays" type="checkbox" ${allSelected ? "checked" : ""} /></th>
        <th rowspan="4">${renderSortHeaderLabel("贝位", "bay")}</th>
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
        <td class="total-label">${totals.bay}</td>
        ${totalCells}
        <td>${totals.total}</td>
      </tr>
    </tbody>
  `;

  bindTableSortEvents();
  bindBaySelectionEvents(rows);
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
      renderTickets();
      renderTable();
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
      renderTickets();
      renderTable();
    });
  });

  document.querySelectorAll("[data-bay-row]").forEach((tableRow) => {
    tableRow.addEventListener("click", (event) => {
      if (event.target.closest('input, button, a, label')) {
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
      renderTickets();
      renderTable();
    });
  });
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

    return compareNatural(left.bay, right.bay) * direction;
  });
}

function compareNatural(left, right) {
  if (left === right) {
    return 0;
  }
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return Number(left) - Number(right);
  }
  return left.localeCompare(right, "zh-CN");
}

function renderBayCell(row) {
  const warnings = row.warnings
    .map(
      (warning) =>
        `<span class="warning-pill warning-pill--${warning.kind}">${warning.label} ${warning.count}</span>`
    )
    .join("");

  return `
    <div class="bay-cell">
      <div class="bay-cell__head">
        <div class="bay-cell__title">${row.bay}</div>
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

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

init();
