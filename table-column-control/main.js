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
  minColumnWidth: 50,
  debugMode: false
};

// ===== 全局调试开关 =====
let debugMode = false;

// ===== 日志工具 =====
function dataLog(...args) {
  if (!debugMode) return;
  console.log("[TCR-DATA]", ...args);
}

// ===== 工具函数 =====
function getCellText(cell) {
  const input = cell.querySelector("input, textarea");
  if (input) return input.value || "";
  return cell.textContent?.trim() || "";
}

function fingerprintD(headerCells) {
  const arr = [];
  const rawTexts = [];
  headerCells.forEach((cell) => {
    const t = getCellText(cell);
    rawTexts.push(t);
    arr.push(t === "" ? null : t);
  });
  dataLog("fingerprintD:", rawTexts, "->", arr);
  return arr;
}

function fingerprintB(fpd) {
  const processed = fpd.map(t => t === null ? null : t.slice(0, 5));
  const nonNull = processed.filter(t => t !== null);
  nonNull.sort();
  const nulls = processed.filter(t => t === null);
  const result = [...nonNull, ...nulls];
  dataLog("fingerprintB input fpd:", fpd, "output fpb:", result);
  return result;
}

function shortFingerprintC(fpb) {
  if (fpb.every(t => t === null)) return fpb;
  const fpc = fpb.filter(t => t !== null);
  dataLog("shortFingerprintC input fpb:", fpb, "output fpc:", fpc);
  return fpc;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// 从源文本中解析表格标题行（根据分隔行号）
function getTableHeaderCellsFromSource(content, separatorLineIndex) {
  const lines = content.split('\n');
  if (separatorLineIndex <= 0 || separatorLineIndex >= lines.length) return [];
  const headerLine = lines[separatorLineIndex - 1].trim();
  let cellPart = headerLine;
  if (headerLine.startsWith("> |")) {
    cellPart = headerLine.slice(2).trim();
  }
  const cells = cellPart.split('|').map(c => c.trim());
  const start = cells[0] === "" ? 1 : 0;
  const end = cells[cells.length - 1] === "" ? cells.length - 1 : cells.length;
  const headerCells = cells.slice(start, end);
  return headerCells.map(t => t === "" ? null : t);
}

// 根据 widths 映射重建顺序列宽数组
function rebuildColWidthsFromWidthsMap(fpd, widthsMap) {
  const newColWidths = [];
  const occurrenceCount = {};
  for (let i = 0; i < fpd.length; i++) {
    const title = fpd[i] === null ? "null" : fpd[i];
    const widthList = widthsMap[title] || [];
    const cnt = occurrenceCount[title] || 0;
    const width = cnt < widthList.length ? widthList[cnt] : 1;
    newColWidths.push(width);
    occurrenceCount[title] = cnt + 1;
  }
  return newColWidths;
}

// ===== 宽度应用与内存更新 =====
function buildColWidthsFromMemory(mem, fpd) {
  if (!mem || !mem.colWidths) return fpd.map(() => 1);
  const result = mem.colWidths.slice(0, fpd.length);
  while (result.length < fpd.length) result.push(1);
  return result;
}

function updateMemoryWidths(mem, fpd, colIndex, newWidth) {
  if (!mem) return;
  if (!mem.colWidths) mem.colWidths = [];
  while (mem.colWidths.length <= colIndex) mem.colWidths.push(1);
  mem.colWidths[colIndex] = newWidth;
  if (!mem.widths) mem.widths = {};
  const key = fpd[colIndex] === null ? "null" : fpd[colIndex];
  if (!mem.widths[key]) mem.widths[key] = [];
  let occurrence = 0;
  for (let i = 0; i <= colIndex; i++) {
    const k = fpd[i] === null ? "null" : fpd[i];
    if (k === key) occurrence++;
  }
  occurrence--;
  while (mem.widths[key].length <= occurrence) mem.widths[key].push(1);
  mem.widths[key][occurrence] = newWidth;
}

function syncFileMemoryToData(plugin, filePath) {
  const fileData = {};
  plugin.tableMemory.forEach((mem, key) => {
    if (key.startsWith(`${filePath}::`)) {
      const indexStr = key.slice(filePath.length + 2);
      fileData[indexStr] = {
        fingerprintB: mem.fingerprintB || [],
        colWidths: mem.colWidths || [],
        widths: mem.widths || {}
      };
    }
  });
  dataLog("syncFileMemoryToData for", filePath, "data:", JSON.parse(JSON.stringify(fileData)));
  plugin.settings.columnWidths[filePath] = fileData;
  plugin.saveSettings();
}

// ===== 核心：表格数据匹配与迁移 =====
function matchAndMigrateTablesForFile(plugin, filePath, currentTables) {
  dataLog("MATCH START", filePath);
  const memPrefix = `${filePath}::`;
  const memKeys = [];
  plugin.tableMemory.forEach((_, key) => {
    if (key.startsWith(memPrefix)) memKeys.push(key);
  });

  let authorityMap = new Map();
  let authoritySource = "none";
  if (memKeys.length > 0) {
    authoritySource = "memory";
    memKeys.forEach(key => {
      const index = parseInt(key.slice(memPrefix.length));
      const mem = plugin.tableMemory.get(key);
      if (mem) authorityMap.set(index, mem);
    });
  } else {
    const fileData = plugin.settings.columnWidths[filePath] || {};
    authoritySource = "disk";
    for (const idxStr in fileData) {
      const index = parseInt(idxStr);
      const saved = fileData[idxStr];
      authorityMap.set(index, {
        fingerprintB: saved.fingerprintB || [],
        colWidths: saved.colWidths || [],
        widths: saved.widths || {}
      });
    }
  }

  dataLog("Authority source:", authoritySource);
  authorityMap.forEach((mem, idx) => {
    dataLog(`  [Auth ${idx}] fpb=${JSON.stringify(mem.fingerprintB)} fpc=${JSON.stringify(shortFingerprintC(mem.fingerprintB))} widths=${JSON.stringify(mem.colWidths)}`);
  });

  const authList = [];
  authorityMap.forEach((mem, index) => {
    authList.push({ authIndex: index, fpc: shortFingerprintC(mem.fingerprintB) });
  });

  dataLog("Current tables:");
  currentTables.forEach(info => {
    dataLog(`  [Doc ${info.index}] fpd=${JSON.stringify(info.fpd)} fpb=${JSON.stringify(info.fpb)} fpc=${JSON.stringify(info.fpc)}`);
  });

  const matchedAuthIndices = new Set();
  const newMemories = new Map();

  currentTables.forEach(info => {
    const newIndex = info.index;
    let matchedIndex = null;

    for (const auth of authList) {
      if (arraysEqual(info.fpc, auth.fpc)) {
        matchedIndex = auth.authIndex;
        break;
      }
    }

    if (matchedIndex === null) {
      const orphanMap = plugin.orphanedTableData.get(filePath);
      if (orphanMap && info.fpc.length > 0) {
        const fpKey = JSON.stringify(info.fpc);
        const orphan = orphanMap.get(fpKey);
        if (orphan) {
          const rebuiltColWidths = rebuildColWidthsFromWidthsMap(info.fpd, orphan.widths || {});
          newMemories.set(newIndex, {
            fingerprintB: info.fpb,
            colWidths: rebuiltColWidths,
            widths: orphan.widths ? JSON.parse(JSON.stringify(orphan.widths)) : {}
          });
          orphanMap.delete(fpKey);
          dataLog(`  ORPHAN MATCH: docIndex ${newIndex} reused orphan data`);
          return;
        }
      }
    }

    if (matchedIndex === null) {
      if (authorityMap.has(newIndex) && !matchedAuthIndices.has(newIndex)) {
        matchedIndex = newIndex;
        dataLog(`  FALLBACK: docIndex ${newIndex} -> authIndex ${newIndex} by index`);
      }
    }

    if (matchedIndex !== null) {
      matchedAuthIndices.add(matchedIndex);
      const authMem = authorityMap.get(matchedIndex);
      const rebuiltColWidths = rebuildColWidthsFromWidthsMap(info.fpd, authMem.widths || {});
      newMemories.set(newIndex, {
        fingerprintB: info.fpb,
        colWidths: rebuiltColWidths,
        widths: authMem.widths ? JSON.parse(JSON.stringify(authMem.widths)) : {}
      });
      dataLog(`  MATCH: docIndex ${newIndex} -> authIndex ${matchedIndex}, rebuilt colWidths=${JSON.stringify(rebuiltColWidths)}`);
    } else {
      newMemories.set(newIndex, {
        fingerprintB: info.fpb,
        colWidths: info.fpd.map(() => 1),
        widths: {}
      });
      dataLog(`  NO MATCH: docIndex ${newIndex} -> default`);
    }
  });

  const unmatchedAuth = new Map(authorityMap);
  for (const idx of matchedAuthIndices) {
    unmatchedAuth.delete(idx);
  }

  if (unmatchedAuth.size > 0) {
    if (!plugin.orphanedTableData) plugin.orphanedTableData = new Map();
    let orphanMap = plugin.orphanedTableData.get(filePath);
    if (!orphanMap) {
      orphanMap = new Map();
      plugin.orphanedTableData.set(filePath, orphanMap);
    }
    const now = Date.now();
    unmatchedAuth.forEach((mem) => {
      const fpKey = JSON.stringify(shortFingerprintC(mem.fingerprintB));
      const existing = orphanMap.get(fpKey);
      if (existing) {
        existing.timestamp = now;
        existing.fingerprintB = mem.fingerprintB || [];
        existing.colWidths = mem.colWidths || [];
        existing.widths = mem.widths || {};
        dataLog(`  ORPHAN REFRESHED: fpb=${JSON.stringify(mem.fingerprintB)}`);
      } else {
        orphanMap.set(fpKey, {
          fingerprintB: mem.fingerprintB || [],
          colWidths: mem.colWidths || [],
          widths: mem.widths || {},
          timestamp: now
        });
        dataLog(`  ORPHAN ADDED: fpb=${JSON.stringify(mem.fingerprintB)}`);
      }
    });
  }

  const expireTime = Date.now() - 5 * 60 * 1000;
  if (plugin.orphanedTableData) {
    for (const [fp, orphanMap] of plugin.orphanedTableData.entries()) {
      for (const [key, val] of orphanMap) {
        if (val.timestamp <= expireTime) {
          orphanMap.delete(key);
          dataLog(`  ORPHAN CLEANUP: ${fp} key=${key}`);
        }
      }
    }
  }

  plugin.tableMemory.forEach((_, key) => {
    if (key.startsWith(memPrefix)) plugin.tableMemory.delete(key);
  });
  newMemories.forEach((mem, idx) => {
    plugin.tableMemory.set(`${filePath}::${idx}`, mem);
  });
  dataLog("MATCH END", filePath);
}

// ===== 刷新并同步文件数据（优先使用传入的最新内容）=====
async function refreshAndSyncFile(plugin, filePath, latestContent) {
  let content = latestContent;
  if (!content) {
    const file = plugin.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof import_obsidian2.TFile)) return;
    content = await plugin.app.vault.read(file);
  }
  if (!content) return;

  const rowNumbers = plugin.scanTableRowNumbers(content);

  plugin.tableMemory.forEach((mem, key) => {
    if (!key.startsWith(`${filePath}::`)) return;
    const index = parseInt(key.split('::')[1]);
    if (index <= 0 || index > rowNumbers.length) return;

    const separatorLine = rowNumbers[index - 1];
    const fpd = getTableHeaderCellsFromSource(content, separatorLine);
    if (fpd.length === 0) return;

    const newFpb = fingerprintB(fpd);

    if (mem.colWidths.length > fpd.length) {
      mem.colWidths = mem.colWidths.slice(0, fpd.length);
    } else {
      while (mem.colWidths.length < fpd.length) mem.colWidths.push(1);
    }

    const newWidths = {};
    for (let i = 0; i < fpd.length; i++) {
      const title = fpd[i] === null ? "null" : fpd[i];
      if (!newWidths[title]) newWidths[title] = [];
      newWidths[title].push(mem.colWidths[i] || 1);
    }

    mem.fingerprintB = newFpb;
    mem.widths = newWidths;
    dataLog(`refreshAndSyncFile: table ${index} fingerprint updated, colWidths kept as [${mem.colWidths}]`);
  });

  syncFileMemoryToData(plugin, filePath);
}

// ===== 表格大小调整核心 =====
function setupTableResize(plugin, table, filePath, tableIndex, locked, sourceFpd = null, sourceFpb = null, allowFingerprintUpdate = true) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  if (!headerRow) return;
  const headerCells = headerRow.querySelectorAll("th, td");
  const colCount = headerCells.length;
  if (colCount === 0) return;

  const fpd = sourceFpd || fingerprintD(headerCells);
  const fpb = sourceFpb || fingerprintB(fpd);
  const fpbJson = JSON.stringify(fpb);

  const isInitialized = table.hasAttribute("data-tcr");
  const prevLocked = table.getAttribute("data-tcr-locked");
  const prevIndex = table.getAttribute("data-tcr-index");
  const prevFingerprint = table.getAttribute("data-tcr-fingerprint");

  const memKey = `${filePath}::${tableIndex}`;
  let mem = plugin.tableMemory.get(memKey);

  if (!mem) {
    mem = {
      fingerprintB: fpb,
      colWidths: fpd.map(() => 1),
      widths: {}
    };
    plugin.tableMemory.set(memKey, mem);
    dataLog("setupTableResize: created fresh memory for", memKey);
  } else {
    dataLog("setupTableResize: existing mem fpb", JSON.stringify(mem.fingerprintB));
  }

  const colCountMismatch = isInitialized && mem.colWidths.length !== colCount;
  const needsInit = !isInitialized || prevLocked !== String(locked) || prevIndex !== String(tableIndex) || colCountMismatch;
  const fingerprintChanged = isInitialized && prevFingerprint !== fpbJson;

  if (fingerprintChanged && !colCountMismatch) {
    mem.fingerprintB = fpb;
    const newWidths = {};
    for (let i = 0; i < fpd.length; i++) {
      const key = fpd[i] === null ? "null" : fpd[i];
      if (!newWidths[key]) newWidths[key] = [];
      newWidths[key].push(mem.colWidths[i] || 1);
    }
    mem.widths = newWidths;
    dataLog("setupTableResize: fingerprint updated (colCount unchanged, widths rebuilt)");
  }
  else if (colCountMismatch) {
    mem.colWidths = rebuildColWidthsFromWidthsMap(fpd, mem.widths || {});
    mem.fingerprintB = fpb;
    const newWidths = {};
    for (let i = 0; i < fpd.length; i++) {
      const key = fpd[i] === null ? "null" : fpd[i];
      if (!newWidths[key]) newWidths[key] = [];
      newWidths[key].push(mem.colWidths[i] || 1);
    }
    mem.widths = newWidths;
    dataLog("setupTableResize: colCount changed, rebuilt colWidths from widths map");
  }
  else if (allowFingerprintUpdate && fingerprintChanged) {
    mem.colWidths = rebuildColWidthsFromWidthsMap(fpd, mem.widths || {});
    mem.fingerprintB = fpb;
    const newWidths = {};
    for (let i = 0; i < fpd.length; i++) {
      const key = fpd[i] === null ? "null" : fpd[i];
      if (!newWidths[key]) newWidths[key] = [];
      newWidths[key].push(mem.colWidths[i] || 1);
    }
    mem.widths = newWidths;
    dataLog("setupTableResize: structure changed, fingerprint & colWidths updated");
  }

  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement("col"));
  while (colgroup.children.length > colCount) colgroup.removeChild(colgroup.lastChild);
  const cols = colgroup.querySelectorAll("col");

  const applyWidth = (i, widthPx) => {
    if (widthPx === 1) {
      cols[i].style.removeProperty("width");
      headerCells[i].style.removeProperty("width");
      headerCells[i].style.removeProperty("min-width");
      headerCells[i].style.removeProperty("max-width");
    } else {
      cols[i].style.setProperty("width", `${widthPx}px`, "important");
      headerCells[i].style.setProperty("width", `${widthPx}px`, "important");
      headerCells[i].style.setProperty("min-width", `${widthPx}px`, "important");
      headerCells[i].style.setProperty("max-width", `${widthPx}px`, "important");
    }
  };

  if (!isInitialized) {
    table.setAttribute("data-tcr", "1");
    table.style.setProperty("width", "auto", "important");
  }

  const widthArray = buildColWidthsFromMemory(mem, fpd);
  for (let i = 0; i < colCount; i++) applyWidth(i, widthArray[i]);

  if (needsInit) {
    table.querySelectorAll(".tcr-handle").forEach(h => h.remove());
    if (!locked) {
      for (let i = 0; i < colCount; i++) {
        const th = headerCells[i];
        const handle = document.createElement("div");
        handle.className = "tcr-handle";
        th.appendChild(handle);
        attachDragBehavior(plugin, handle, cols, headerCells, i, filePath, tableIndex, fpd, applyWidth);
      }
    }
  }

  table.setAttribute("data-tcr-locked", String(locked));
  table.setAttribute("data-tcr-index", String(tableIndex));
  table.setAttribute("data-tcr-fingerprint", fpbJson);
}

function attachDragBehavior(plugin, handle, cols, headerCells, colIndex, filePath, tableIndex, fpd, applyWidth) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const startX = e.clientX;
    const th = headerCells[colIndex];
    const startWidth = th.getBoundingClientRect().width;
    handle.classList.add("tcr-dragging");
    document.body.classList.add("tcr-resizing");
    const onMove = (ev) => {
      ev.preventDefault();
      const delta = ev.clientX - startX;
      const newWidth = Math.max(plugin.settings.minColumnWidth, startWidth + delta);
      applyWidth(colIndex, newWidth);
    };
    const onUp = () => {
      handle.classList.remove("tcr-dragging");
      document.body.classList.remove("tcr-resizing");
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      const c = cols[colIndex];
      const w = parseFloat(c.style.width);
      if (!isNaN(w)) {
        const memKey = `${filePath}::${tableIndex}`;
        let mem = plugin.tableMemory.get(memKey);
        if (!mem) {
          mem = { fingerprintB: fingerprintB(fpd), colWidths: fpd.map(() => 1), widths: {} };
          plugin.tableMemory.set(memKey, mem);
        }
        updateMemoryWidths(mem, fpd, colIndex, Math.round(w));
        dataLog("Drag end: save width", Math.round(w), "to", memKey);
        scheduleFileSave(plugin, filePath);
      }
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  };
  handle.addEventListener("pointerdown", onPointerDown, true);
  handle.addEventListener("mousedown", (e) => { e.stopPropagation(); }, true);
}

// ===== 文件级防抖保存（支持传入最新内容）=====
function scheduleFileSave(plugin, filePath, latestContent) {
  const existing = plugin.fileSaveTimers.get(filePath);
  if (existing) {
    window.clearTimeout(existing.timer);
  }
  const timer = window.setTimeout(() => {
    const record = plugin.fileSaveTimers.get(filePath);
    const content = record?.content;
    plugin.fileSaveTimers.delete(filePath);
    refreshAndSyncFile(plugin, filePath, content);
  }, 1000);
  plugin.fileSaveTimers.set(filePath, { timer, content: latestContent });
  dataLog("scheduleFileSave:", filePath, "timer set");
}

// ===== 阅读视图处理（仅应用列宽，不修改内存）=====
var tableResizePostProcessor = (plugin) => async (el, ctx) => {
  const tables = el.querySelectorAll("table");
  if (tables.length === 0) return;

  const rowNumbers = await plugin.getTableRowNumbers(ctx.sourcePath, tables.length);
  const filePath = ctx.sourcePath;

  tables.forEach((table, index) => {
    const tableIndex = index + 1;
    if (tableIndex > rowNumbers.length) return;

    const memKey = `${filePath}::${tableIndex}`;
    let colWidths = plugin.tableMemory.get(memKey)?.colWidths;
    if (!colWidths) {
      const fileData = plugin.settings.columnWidths[filePath];
      const tableData = fileData?.[String(tableIndex)];
      colWidths = tableData?.colWidths;
    }

    if (!colWidths || colWidths.length === 0) return;

    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    if (!headerRow) return;
    const headerCells = headerRow.querySelectorAll("th, td");
    const colCount = headerCells.length;
    if (colCount === 0) return;

    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      table.insertBefore(colgroup, table.firstChild);
    }
    while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement("col"));
    const cols = colgroup.querySelectorAll("col");

    for (let i = 0; i < colCount; i++) {
      const w = (i < colWidths.length && colWidths[i] !== 1) ? colWidths[i] : undefined;
      if (w) {
        cols[i].style.setProperty("width", `${w}px`, "important");
        headerCells[i].style.setProperty("width", `${w}px`, "important");
        headerCells[i].style.setProperty("min-width", `${w}px`, "important");
        headerCells[i].style.setProperty("max-width", `${w}px`, "important");
      } else {
        cols[i].style.removeProperty("width");
        headerCells[i].style.removeProperty("width");
        headerCells[i].style.removeProperty("min-width");
        headerCells[i].style.removeProperty("max-width");
      }
    }
  });
};

// ===== 编辑视图处理（使用 Obsidian 事件）=====
function processEditorTables(plugin, cmView, mdView) {
  const filePath = mdView.file?.path;
  if (!filePath) return;

  const doc = cmView.state.doc;
  const content = doc.toString();
  const lineCount = doc.lines;
  const tables = cmView.dom.querySelectorAll("table");

  if (tables.length === 0) {
    const memPrefix = `${filePath}::`;
    const memKeys = [];
    plugin.tableMemory.forEach((_, key) => {
      if (key.startsWith(memPrefix)) memKeys.push(key);
    });

    if (memKeys.length > 0) {
      const now = Date.now();
      let orphanMap = plugin.orphanedTableData.get(filePath);
      if (!orphanMap) {
        orphanMap = new Map();
        plugin.orphanedTableData.set(filePath, orphanMap);
      }
      memKeys.forEach(key => {
        const mem = plugin.tableMemory.get(key);
        if (mem) {
          const fpKey = JSON.stringify(shortFingerprintC(mem.fingerprintB || []));
          orphanMap.set(fpKey, {
            fingerprintB: mem.fingerprintB || [],
            colWidths: mem.colWidths || [],
            widths: mem.widths || {},
            timestamp: now
          });
          dataLog(`No tables: orphaned ${fpKey}`);
        }
      });
      memKeys.forEach(key => plugin.tableMemory.delete(key));
      syncFileMemoryToData(plugin, filePath);
    }

    if (!plugin._lastEditState) plugin._lastEditState = new Map();
    plugin._lastEditState.set(filePath, {
      tableCount: 0,
      colCounts: []
    });
    return;
  }

  let rowNumbers;
  const cached = plugin.tableIndexCache.get(filePath);
  if (cached && cached.tableCount === tables.length && cached.rowNumbers.length === tables.length) {
    rowNumbers = cached.rowNumbers;
  } else {
    rowNumbers = plugin.scanTableRowNumbers(content);
    plugin.tableIndexCache.set(filePath, { rowNumbers, tableCount: tables.length });
  }

  const fm = plugin.app.metadataCache.getCache(filePath);
  const locked = !!(fm && fm.frontmatter && (fm.frontmatter.table === 0 || fm.frontmatter.table === "0"));

  const currentInfos = [];
  const sourceInfosMap = new Map();
  const currentColCounts = [];
  tables.forEach((table, index) => {
    const tableIndex = index + 1;
    if (tableIndex > rowNumbers.length) return;
    const separatorLine = rowNumbers[tableIndex - 1];
    const fpd = getTableHeaderCellsFromSource(content, separatorLine);
    if (fpd.length === 0) return;
    const fpb = fingerprintB(fpd);
    const fpc = shortFingerprintC(fpb);
    currentInfos.push({ index: tableIndex, fpd, fpb, fpc });
    sourceInfosMap.set(tableIndex, { fpd, fpb });
    currentColCounts.push(fpd.length);
  });

  const prevState = plugin._lastEditState?.get(filePath);
  let structureChanged = false;
  if (!prevState) {
    structureChanged = true;
  } else {
    if (prevState.tableCount !== tables.length ||
        !arraysEqual(prevState.colCounts, currentColCounts)) {
      structureChanged = true;
    }
  }

  if (structureChanged) {
    matchAndMigrateTablesForFile(plugin, filePath, currentInfos);
  }

  if (!plugin._lastEditState) plugin._lastEditState = new Map();
  plugin._lastEditState.set(filePath, {
    tableCount: tables.length,
    colCounts: currentColCounts
  });

  tables.forEach((table, index) => {
    const tableIndex = index + 1;
    if (tableIndex > rowNumbers.length) return;
    const info = sourceInfosMap.get(tableIndex);
    setupTableResize(plugin, table, filePath, tableIndex, locked, info?.fpd, info?.fpb, structureChanged);
  });

  scheduleFileSave(plugin, filePath, content);
}

function setupEditorEvents(plugin) {
  plugin.registerEvent(
    plugin.app.workspace.on('editor-change', (editor, info) => {
      const mdView = info?.view ?? info ?? plugin.app.workspace.getActiveViewOfType?.(require('obsidian').MarkdownView);
      if (mdView && mdView.file && mdView.editor) {
        const cmView = mdView.editor.cm;
        if (cmView && cmView.dom) {
          requestAnimationFrame(() => {
            if (cmView.dom.isConnected) {
              processEditorTables(plugin, cmView, mdView);
            }
          });
        }
      }
    })
  );
  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf && leaf.view && leaf.view.getViewType() === 'markdown') {
        const mdView = leaf.view;
        const cmView = mdView.editor?.cm;
        if (cmView && cmView.dom) {
          requestAnimationFrame(() => {
            if (cmView.dom.isConnected) {
              processEditorTables(plugin, cmView, mdView);
            }
          });
        }
      }
    })
  );
}

// ===== 设置界面 =====
var import_obsidian = require("obsidian");
var TableResizeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Enable verbose console logging for debugging.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          debugMode = value; // 同步全局开关
          await this.plugin.saveSettings();
        }));
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
        this.plugin.tableMemory.clear();
        await this.plugin.saveSettings();
      })
    );
  }
};

// ===== 主插件 =====
var TableColumnResizePlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.saveTimeout = null;
    this.tableIndexCache = new Map();
    this.tableMemory = new Map();
    this.fileSaveTimers = new Map();
    this.orphanedTableData = new Map();
  }
  async onload() {
    await this.loadSettings();
    debugMode = this.settings.debugMode; // 初始化全局开关

    this._lastEditState = new Map();
    this.registerMarkdownPostProcessor(tableResizePostProcessor(this));
    setupEditorEvents(this);
    this.addSettingTab(new TableResizeSettingTab(this.app, this));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const newPath = file.path;
        if (this.settings.columnWidths[oldPath]) {
          this.settings.columnWidths[newPath] = this.settings.columnWidths[oldPath];
          delete this.settings.columnWidths[oldPath];
        }
        const newMemory = new Map();
        this.tableMemory.forEach((value, key) => {
          if (key.startsWith(`${oldPath}::`)) {
            const suffix = key.slice(oldPath.length + 2);
            newMemory.set(`${newPath}::${suffix}`, value);
          } else {
            newMemory.set(key, value);
          }
        });
        this.tableMemory = newMemory;
        this.saveSettings();
      })
    );
  }
  onunload() {
    if (this.saveTimeout !== null) {
      window.clearTimeout(this.saveTimeout);
      void this.saveSettings();
    }
    this.fileSaveTimers.forEach((record, filePath) => {
      window.clearTimeout(record.timer);
      refreshAndSyncFile(this, filePath, record.content);
    });
    this.fileSaveTimers.clear();
    this.orphanedTableData.clear();
    document.body.classList.remove("tcr-resizing");
  }
  async loadSettings() {
    const data = await this.loadData();
    const columnWidths = data?.columnWidths ?? {};
    const debugModeSetting = data?.debugMode ?? false;
    const migrated = {};
    for (const key in columnWidths) {
      const match = key.match(/^(.+)::(\d+)$/);
      if (match) {
        const filePath = match[1];
        const tableIndex = match[2];
        if (!migrated[filePath]) migrated[filePath] = {};
        migrated[filePath][tableIndex] = columnWidths[key];
      } else {
        migrated[key] = columnWidths[key];
      }
    }
    this.settings = {
      columnWidths: migrated,
      minColumnWidth: data?.minColumnWidth ?? DEFAULT_SETTINGS.minColumnWidth,
      debugMode: debugModeSetting
    };
    debugMode = this.settings.debugMode; // 同步全局开关
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  debouncedSave() {
    if (this.saveTimeout !== null) window.clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => {
      void this.saveSettings();
      this.saveTimeout = null;
    }, 500);
  }
  scanTableRowNumbers(content) {
    const lines = content.split("\n");
    const rowNumbers = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prefix3 = line.slice(0, 3);
      if (prefix3 === "| :" || prefix3 === "|:-" || prefix3 === "| -" || prefix3 === "|--") {
        rowNumbers.push(i);
      } else if (prefix3 === "> |") {
        const prefix6 = line.slice(0, 6);
        if (prefix6 === "> | :-" || prefix6 === "> |:--" || prefix6 === "> | --" || prefix6 === "> |---") {
          rowNumbers.push(i);
        }
      }
    }
    return rowNumbers;
  }
  async getTableRowNumbers(filePath, expectedTableCount) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof import_obsidian2.TFile)) return [];
    const cached = this.tableIndexCache.get(filePath);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const lineCount = lines.length;
    if (cached && Math.abs(cached.lineCount - lineCount) <= 2) {
      if (expectedTableCount !== undefined && cached.rowNumbers.length !== expectedTableCount) {
        const rowNumbers = this.scanTableRowNumbers(content);
        this.tableIndexCache.set(filePath, { lineCount, rowNumbers, tableCount: expectedTableCount });
        return rowNumbers;
      }
      return cached.rowNumbers;
    }
    const rowNumbers = this.scanTableRowNumbers(content);
    this.tableIndexCache.set(filePath, { lineCount, rowNumbers, tableCount: expectedTableCount });
    return rowNumbers;
  }
};

/* nosourcemap */