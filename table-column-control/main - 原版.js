"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TableColumnResizePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/types.ts
var DEFAULT_SETTINGS = {
  columnWidths: {},
  minColumnWidth: 50
};

// src/resize-handler.ts
function tableFingerprint(headerCells) {
  const texts = [];
  headerCells.forEach((cell) => {
    var _a;
    texts.push(((_a = cell.textContent) != null ? _a : "").trim());
  });
  return texts.join("|");
}
function getAvailableWidth(table) {
  const tw = table.getBoundingClientRect().width;
  if (tw > 0)
    return tw;
  const parent = table.parentElement;
  if (parent) {
    const pw = parent.getBoundingClientRect().width;
    if (pw > 0)
      return pw;
    return parent.clientWidth;
  }
  return 0;
}
function setupTableResize(plugin, table, filePath) {
  var _a;
  if (table.hasAttribute("data-tcr"))
    return;
  table.setAttribute("data-tcr", "1");
  const headerRow = (_a = table.querySelector("thead tr")) != null ? _a : table.querySelector("tr");
  if (!headerRow)
    return;
  const headerCells = headerRow.querySelectorAll("th, td");
  const colCount = headerCells.length;
  if (colCount === 0)
    return;
  const fingerprint = tableFingerprint(headerCells);
  const fileKey = `${filePath}::${fingerprint}`;
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) {
    colgroup.appendChild(document.createElement("col"));
  }
  const cols = colgroup.querySelectorAll("col");
  const applyWidth = (i, widthPx) => {
    cols[i].style.setProperty("width", `${widthPx}px`, "important");
    headerCells[i].style.setProperty("width", `${widthPx}px`, "important");
    headerCells[i].style.setProperty("min-width", `${widthPx}px`, "important");
    headerCells[i].style.setProperty("max-width", `${widthPx}px`, "important");
  };
  const savedWidths = new Array(colCount);
  let savedSum = 0;
  let savedCount = 0;
  for (let i = 0; i < colCount; i++) {
    const saved = plugin.settings.columnWidths[`${fileKey}::${i}`];
    if (saved !== void 0) {
      savedWidths[i] = saved;
      savedSum += saved;
      savedCount++;
    }
  }
  if (savedCount > 0) {
    let scale = 1;
    if (savedCount === colCount) {
      const available = getAvailableWidth(table);
      if (available > 0 && savedSum > available) {
        scale = available / savedSum;
      }
    }
    for (let i = 0; i < colCount; i++) {
      const w = savedWidths[i];
      if (w !== void 0)
        applyWidth(i, w * scale);
    }
  }
  for (let i = 0; i < colCount; i++) {
    const th = headerCells[i];
    const handle = document.createElement("div");
    handle.className = "tcr-handle";
    th.appendChild(handle);
    attachDragBehavior(plugin, handle, cols, headerCells, i, fileKey, colCount, applyWidth);
  }
}
function attachDragBehavior(plugin, handle, cols, headerCells, colIndex, fileKey, colCount, applyWidth) {
  const onPointerDown = (e) => {
    if (e.button !== 0)
      return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    for (let i = 0; i < colCount; i++) {
      const w = headerCells[i].getBoundingClientRect().width;
      if (w > 0)
        applyWidth(i, w);
    }
    const startX = e.clientX;
    const th = headerCells[colIndex];
    const startWidth = th.getBoundingClientRect().width;
    handle.classList.add("tcr-dragging");
    document.body.classList.add("tcr-resizing");
    const onMove = (ev) => {
      ev.preventDefault();
      const delta = ev.clientX - startX;
      const newWidth = Math.max(
        plugin.settings.minColumnWidth,
        startWidth + delta
      );
      applyWidth(colIndex, newWidth);
    };
    const onUp = () => {
      handle.classList.remove("tcr-dragging");
      document.body.classList.remove("tcr-resizing");
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      for (let i = 0; i < colCount; i++) {
        const c = cols[i];
        const w = parseFloat(c.style.width);
        if (!isNaN(w)) {
          plugin.settings.columnWidths[`${fileKey}::${i}`] = Math.round(w);
        }
      }
      plugin.debouncedSave();
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  };
  handle.addEventListener("pointerdown", onPointerDown, true);
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  }, true);
}

// src/reading-view.ts
var tableResizePostProcessor = (plugin) => (el, ctx) => {
  const tables = el.querySelectorAll("table");
  if (tables.length === 0)
    return;
  tables.forEach((table) => {
    setupTableResize(plugin, table, ctx.sourcePath);
  });
};

// src/editing-view.ts
var import_view = require("@codemirror/view");
var tableResizeEditorExtension = (plugin) => import_view.ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.observer = new MutationObserver(() => {
        this.instrumentTables();
      });
      this.observer.observe(view.dom, { childList: true, subtree: true });
      this.instrumentTables();
    }
    update() {
      this.instrumentTables();
    }
    instrumentTables() {
      var _a, _b;
      const tables = this.view.dom.querySelectorAll(
        "table:not([data-tcr])"
      );
      if (tables.length === 0)
        return;
      const filePath = (_b = (_a = plugin.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "_unknown";
      tables.forEach((table) => {
        setupTableResize(plugin, table, filePath);
      });
    }
    destroy() {
      this.observer.disconnect();
    }
  }
);

// src/settings.ts
var import_obsidian = require("obsidian");
var TableResizeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Minimum column width").setDesc("The minimum width (in pixels) a column can be resized to.").addText(
      (text) => text.setPlaceholder("50").setValue(String(this.plugin.settings.minColumnWidth)).onChange(async (value) => {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) {
          this.plugin.settings.minColumnWidth = num;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reset all saved widths").setDesc(
      "Clear all saved column widths. Tables will return to their default widths."
    ).addButton(
      (btn) => btn.setButtonText("Reset").setWarning().onClick(async () => {
        this.plugin.settings.columnWidths = {};
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var TableColumnResizePlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.saveTimeout = null;
  }
  async onload() {
    await this.loadSettings();
    this.registerMarkdownPostProcessor(tableResizePostProcessor(this));
    this.registerEditorExtension(tableResizeEditorExtension(this));
    this.addSettingTab(new TableResizeSettingTab(this.app, this));
  }
  onunload() {
    if (this.saveTimeout !== null) {
      window.clearTimeout(this.saveTimeout);
      void this.saveSettings();
    }
    document.body.classList.remove("tcr-resizing");
  }
  async loadSettings() {
    var _a, _b;
    const data = await this.loadData();
    this.settings = {
      columnWidths: (_a = data == null ? void 0 : data.columnWidths) != null ? _a : {},
      minColumnWidth: (_b = data == null ? void 0 : data.minColumnWidth) != null ? _b : DEFAULT_SETTINGS.minColumnWidth
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Debounced save - writes at most once per 500ms during drag operations */
  debouncedSave() {
    if (this.saveTimeout !== null)
      window.clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => {
      void this.saveSettings();
      this.saveTimeout = null;
    }, 500);
  }
};

/* nosourcemap */
