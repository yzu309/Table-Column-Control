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
  debugMode: false,
  enableAutoFit: false
};

// ===== 全局调试开关 =====
let debugMode = false;

// ===== 日志工具 =====
function dataLog(...args) {
  if (!debugMode) return;
  console.log("[TCR-DATA]", ...args);
}
function cacheLog(...args) {
  if (!debugMode) return;
  console.log("[TCR-CACHE]", ...args);
}
function securityLog(...args) {
  console.log("[TCR-SECURITY]", ...args);
}

// ===== 窗口身份判断 =====
function isMainWindowLeaf(plugin, leaf) {
  return leaf.getRoot() === plugin.app.workspace.rootSplit;
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
  return arr;
}

function fingerprintB(fpd) {
  const processed = fpd.map(t => t === null ? null : t);
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

function getTableHeaderCellsFromSource(content, separatorLineIndex) {
  const lines = content.split('\n');
  if (separatorLineIndex < 0 || separatorLineIndex >= lines.length) return [];

  const separatorLine = lines[separatorLineIndex];
  let sepPart = separatorLine;
  const pipeIdx = sepPart.indexOf('|');
  if (pipeIdx > 0) {
    sepPart = sepPart.slice(pipeIdx);
  }
  const sepCells = sepPart.split('|').map(c => c.trim());
  const sepStart = sepCells[0] === "" ? 1 : 0;
  const sepEnd = sepCells[sepCells.length - 1] === "" ? sepCells.length - 1 : sepCells.length;
  const colCount = Math.max(0, sepEnd - sepStart);

  if (separatorLineIndex <= 0) {
    return new Array(colCount).fill(null);
  }

  const headerLine = lines[separatorLineIndex - 1];
  if (!headerLine || headerLine.trim() === '') {
    return new Array(colCount).fill(null);
  }

  let cellPart = headerLine;
  const headerPipeIdx = cellPart.indexOf('|');
  if (headerPipeIdx > 0) {
    cellPart = cellPart.slice(headerPipeIdx);
  }
  const cells = cellPart.split('|').map(c => c.trim());
  const start = cells[0] === "" ? 1 : 0;
  const end = cells[cells.length - 1] === "" ? cells.length - 1 : cells.length;
  const headerCells = cells.slice(start, end);

  while (headerCells.length < colCount) headerCells.push(null);
  if (headerCells.length > colCount) headerCells.splice(colCount);

  return headerCells.map(t => t === "" ? null : t);
}

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

function buildWidthsFromColWidths(fpd, colWidths) {
  const widths = {};
  for (let i = 0; i < fpd.length; i++) {
    const title = fpd[i] === null ? "null" : fpd[i];
    if (!widths[title]) widths[title] = [];
    widths[title].push(colWidths[i] || 1);
  }
  return widths;
}

function getFileCssClasses(plugin, filePath) {
  if (!filePath) return [];
  const cache = plugin.app.metadataCache.getCache(filePath);
  if (!cache?.frontmatter) return [];
  const cssclasses = cache.frontmatter.cssclasses;
  return Array.isArray(cssclasses) ? cssclasses : [];
}

function isDragLocked(plugin, filePath) {
  if (!filePath) return false;
  const cache = plugin.app.metadataCache.getCache(filePath);
  if (!cache) return false;
  const frontmatter = cache.frontmatter;
  if (!frontmatter) return false;
  // table: 0 或 table: 2 或 cssclasses 中含 "0" 或 "2" 均禁止拖拽
  if (frontmatter.table === 0 || frontmatter.table === "0") return true;
  if (frontmatter.table === 2 || frontmatter.table === "2") return true;
  const cssclasses = frontmatter.cssclasses;
  if (Array.isArray(cssclasses)) {
    if (cssclasses.includes("0") || cssclasses.includes("2")) return true;
  }
  return false;
}

function shouldAutoFit(plugin, filePath) {
  if (plugin.settings.enableAutoFit) return true;
  if (!filePath) return false;
  return getFileCssClasses(plugin, filePath).includes("1");
}

function isPluginFullyDisabled(plugin, filePath) {
  if (!filePath) return false;
  const cache = plugin.app.metadataCache.getCache(filePath);
  if (!cache) return false;
  const frontmatter = cache.frontmatter;
  if (!frontmatter) return false;
  const cssclasses = frontmatter.cssclasses || [];
  const hasZero = (frontmatter.table === 0 || frontmatter.table === "0") || cssclasses.includes("0");
  if (!hasZero) return false;
  const hasOne = cssclasses.includes("1");
  const hasTwo = (frontmatter.table === 2 || frontmatter.table === "2") || cssclasses.includes("2");
  // 若存在“1”或“2”，则“0”不再完全禁用，而是降级为仅禁止拖拽
  if (hasOne || hasTwo) return false;
  return true;
}

function updateMemoryWidths(mem, fpd, colIndex, newWidth) {
  if (!mem) return;
  if (!mem.colWidths) mem.colWidths = [];
  while (mem.colWidths.length <= colIndex) mem.colWidths.push(1);
  mem.colWidths[colIndex] = Math.round(newWidth);
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
  mem.widths[key][occurrence] = Math.round(newWidth);
}

function resetTableDOM(table) {
  if (!table) return;
  table.querySelectorAll(".tcr-handle").forEach(h => h.remove());
  table.removeAttribute("data-tcr");
  table.removeAttribute("data-tcr-locked");
  table.removeAttribute("data-tcr-index");
  table.removeAttribute("data-tcr-fingerprint");
  table.style.removeProperty("width");
  table.style.removeProperty("min-width");
  table.style.removeProperty("table-layout");
  const colgroup = table.querySelector("colgroup");
  if (colgroup) colgroup.remove();
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  if (headerRow) {
    headerRow.querySelectorAll("th, td").forEach(cell => {
      cell.style.removeProperty("width");
      cell.style.removeProperty("min-width");
      cell.style.removeProperty("max-width");
    });
  }
}

function matchAndMigrateTablesForFile(plugin, filePath, currentTables) {
  const isFirstMigration = !plugin._migrationLoggedFiles.has(filePath);
  if (isFirstMigration) {
    dataLog("MATCH START", filePath);
  }

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

  if (isFirstMigration) {
    dataLog("Authority source:", authoritySource);
    authorityMap.forEach((mem, idx) => {
      dataLog(`  [Auth ${idx}] fpb=${JSON.stringify(mem.fingerprintB)} fpc=${JSON.stringify(shortFingerprintC(mem.fingerprintB))} widths=${JSON.stringify(mem.colWidths)}`);
    });
  }

  const authList = [];
  authorityMap.forEach((mem, index) => {
    authList.push({ authIndex: index, fpc: shortFingerprintC(mem.fingerprintB) });
  });

  if (isFirstMigration) {
    dataLog("Current tables:");
    currentTables.forEach(info => {
      dataLog(`  [Doc ${info.index}] fpd=${JSON.stringify(info.fpd)} fpb=${JSON.stringify(info.fpb)} fpc=${JSON.stringify(info.fpc)}`);
    });
  }

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
          const newColWidths = (orphan.colWidths || []).slice(0, info.fpd.length);
          while (newColWidths.length < info.fpd.length) newColWidths.push(1);
          newMemories.set(newIndex, {
            fingerprintB: info.fpb,
            colWidths: newColWidths,
            widths: orphan.widths ? JSON.parse(JSON.stringify(orphan.widths)) : {},
            lastFpd: info.fpd.slice()
          });
          orphanMap.delete(fpKey);
          if (isFirstMigration) dataLog(`  ORPHAN MATCH: docIndex ${newIndex} reused orphan data`);
          return;
        }
      }
    }

    if (matchedIndex === null) {
      if (authorityMap.has(newIndex) && !matchedAuthIndices.has(newIndex)) {
        matchedIndex = newIndex;
        if (isFirstMigration) dataLog(`  FALLBACK: docIndex ${newIndex} -> authIndex ${newIndex} by index`);
      }
    }

    if (matchedIndex !== null) {
      matchedAuthIndices.add(matchedIndex);
      const authMem = authorityMap.get(matchedIndex);
      if (authMem) {
        const newColWidths = (authMem.colWidths || []).slice(0, info.fpd.length);
        while (newColWidths.length < info.fpd.length) newColWidths.push(1);
        // 使用当前表格的标题顺序（fpd）和匹配到的列宽重建 widths 映射，确保一致性
        const rebuiltWidths = buildWidthsFromColWidths(info.fpd, newColWidths);
        newMemories.set(newIndex, {
          fingerprintB: info.fpb,
          colWidths: newColWidths,
          widths: rebuiltWidths,
          lastFpd: info.fpd.slice()
        });
        if (isFirstMigration) dataLog(`  MATCH: docIndex ${newIndex} -> authIndex ${matchedIndex}, copied colWidths=${JSON.stringify(newColWidths)}`);
      } else {
        newMemories.set(newIndex, {
          fingerprintB: info.fpb,
          colWidths: info.fpd.map(() => 1),
          widths: {},
          lastFpd: info.fpd.slice()
        });
      }
    } else {
      newMemories.set(newIndex, {
        fingerprintB: info.fpb,
        colWidths: info.fpd.map(() => 1),
        widths: {},
        lastFpd: info.fpd.slice()
      });
      if (isFirstMigration) dataLog(`  NO MATCH: docIndex ${newIndex} -> default`);
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
        if (isFirstMigration) dataLog(`  ORPHAN REFRESHED: fpb=${JSON.stringify(mem.fingerprintB)}`);
      } else {
        orphanMap.set(fpKey, {
          fingerprintB: mem.fingerprintB || [],
          colWidths: mem.colWidths || [],
          widths: mem.widths || {},
          timestamp: now
        });
        if (isFirstMigration) dataLog(`  ORPHAN ADDED: fpb=${JSON.stringify(mem.fingerprintB)}`);
      }
    });
  }

  const expireTime = Date.now() - 5 * 60 * 1000;
  if (plugin.orphanedTableData) {
    for (const [fp, orphanMap] of plugin.orphanedTableData.entries()) {
      for (const [key, val] of orphanMap) {
        if (val.timestamp <= expireTime) {
          orphanMap.delete(key);
          if (isFirstMigration) dataLog(`  ORPHAN CLEANUP: ${fp} key=${key}`);
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

  plugin._perfStats.matchMigrate++;

  if (isFirstMigration) {
    dataLog("MATCH END", filePath);
    plugin._migrationLoggedFiles.add(filePath);
  }
}

function applyWidthsToTable(table, widthArray, totalFixedWidth, autoFitEnabled = false, editorWidth = 0) {
  const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
  const headerCells = headerRow ? headerRow.querySelectorAll("th, td") : [];
  const colCount = headerCells.length;

  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement("col"));
  while (colgroup.children.length > colCount) colgroup.removeChild(colgroup.lastChild);
  const cols = colgroup.querySelectorAll("col");

  for (let i = 0; i < colCount; i++) {
    let w = widthArray[i] !== undefined ? widthArray[i] : 1;
    if (w !== 1) w = Math.round(w);
    const current = cols[i].style.getPropertyValue('width').trim();
    const currentInt = current ? parseInt(current) : null;
    if (debugMode) {
      if (w === 1 && currentInt !== null) {
        dataLog(`applyWidthsToTable: table column ${i} current=${currentInt}px, setting to auto`);
      } else if (w !== 1 && currentInt !== w) {
        dataLog(`applyWidthsToTable: table column ${i} current=${currentInt ? currentInt+'px' : 'auto'}, setting to ${w}px`);
      }
    }

    if (w === 1) {
      if (current !== '') {
        cols[i].style.removeProperty("width");
        if (headerCells[i]) {
          headerCells[i].style.removeProperty("width");
          headerCells[i].style.removeProperty("min-width");
          headerCells[i].style.removeProperty("max-width");
        }
      }
    } else {
      if (currentInt !== w) {
        cols[i].style.setProperty("width", `${w}px`, "important");
        if (headerCells[i]) {
          headerCells[i].style.setProperty("width", `${w}px`, "important");
          headerCells[i].style.setProperty("min-width", `${w}px`, "important");
          headerCells[i].style.setProperty("max-width", `${w}px`, "important");
        }
      }
    }
  }

  if (table.style.getPropertyValue("table-layout") !== "fixed" ||
      table.style.getPropertyPriority("table-layout") !== "important") {
    table.style.setProperty("table-layout", "fixed", "important");
  }

  if (totalFixedWidth > 0) {
    const tw = Math.round(totalFixedWidth);
    const finalWidth = (autoFitEnabled && editorWidth > tw) ? editorWidth : tw;
    table.style.setProperty('min-width', tw + 'px', 'important');
    table.style.setProperty('width', Math.round(finalWidth) + 'px', 'important');
  }
}

function attachDragBehavior(plugin, handle, table, colIndex, filePath, tableIndex, fpd, isTemporary = false, mdView) {
  const onPointerDown = (e) => {
    // 使用传入的 mdView.leaf 进行精确窗口身份判断，避免全局变量污染
    if (mdView && !isMainWindowLeaf(plugin, mdView.leaf)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    const headerCells = headerRow ? headerRow.querySelectorAll("th, td") : [];
    const th = headerCells[colIndex];
    if (!th) return;
    const initialWidth = Math.round(th.getBoundingClientRect().width);

    plugin._isDragging = true;
    const cmView = mdView.editor.cm;
    plugin._dragLock = { cmView, tableIndex };
    plugin._setApplyScanMode(cmView, mdView, 'high');

    const startX = e.clientX;
    const colgroup = table.querySelector("colgroup");
    const cols = colgroup ? colgroup.querySelectorAll("col") : [];

    handle.classList.add("tcr-dragging");
    document.body.classList.add("tcr-resizing");

    const onMove = (ev) => {
      ev.preventDefault();
      const delta = ev.clientX - startX;
      const newWidth = Math.max(plugin.settings.minColumnWidth, initialWidth + delta);
      const rounded = Math.round(newWidth);
      if (cols[colIndex]) {
        cols[colIndex].style.setProperty("width", `${rounded}px`, "important");
        if (headerCells[colIndex]) {
          headerCells[colIndex].style.setProperty("width", `${rounded}px`, "important");
          headerCells[colIndex].style.setProperty("min-width", `${rounded}px`, "important");
          headerCells[colIndex].style.setProperty("max-width", `${rounded}px`, "important");
        }
      }
      table.style.setProperty('min-width', '0', 'important');
      table.style.setProperty('width', 'auto', 'important');
    };

    const onUp = () => {
      handle.classList.remove("tcr-dragging");
      document.body.classList.remove("tcr-resizing");

      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);

      const cmView = mdView.editor.cm;

      try {
        if (!isTemporary && filePath && isMainWindowLeaf(plugin, mdView.leaf)) {
          if (isDragLocked(plugin, filePath)) {
            dataLog("Drag end: file locked, skip saving width");
          } else {
            const colgroupNow = table.querySelector("colgroup");
            const colsNow = colgroupNow ? colgroupNow.querySelectorAll("col") : [];
            const c = colsNow[colIndex];
            if (c) {
              const w = Math.round(parseFloat(c.style.width));
              if (!isNaN(w)) {
                const memKey = `${filePath}::${tableIndex}`;
                let mem = plugin.tableMemory.get(memKey);
                if (!mem) {
                  mem = { fingerprintB: fingerprintB(fpd), colWidths: fpd.map(() => 1), widths: {}, lastFpd: fpd.slice() };
                  plugin.tableMemory.set(memKey, mem);
                }
                let finalWidth = w;
                if (finalWidth < plugin.settings.minColumnWidth) finalWidth = plugin.settings.minColumnWidth;
                if (Math.abs(finalWidth - Math.round(initialWidth)) >= 1) {
                  updateMemoryWidths(mem, fpd, colIndex, finalWidth);
                  dataLog("Drag end: save width", finalWidth, "to", memKey);
                  dataLog(`Mem write: ${filePath} table ${tableIndex} titles: [${fpd.map(t => t ?? 'null').join(', ')}]`);

                  plugin.syncTableMemoryToSettings(filePath);
                  plugin.scheduleFileSave(filePath);

                  plugin._overwritePackages.delete(cmView);
                  invalidateOverwritePackageForFile(plugin, filePath);
                }
              }
            }
          }
        }
      } finally {
        plugin._dragLock = null;
        plugin._isDragging = false;
      }

      requestAnimationFrame(() => {
        if (cmView.dom.isConnected) {
          plugin.processEditorTables(cmView, mdView, true).catch(() => {});
        }
      });
      plugin._setApplyScanMode(cmView, mdView, 'high');
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  };

  handle.addEventListener("pointerdown", onPointerDown, true);
  handle.addEventListener("mousedown", (e) => { e.stopPropagation(); }, true);
}

// ===== 阅读模式后处理器 (已注释，不再维持阅读模式列宽) =====
/*
var tableResizePostProcessor = (plugin) => async (el, ctx) => {
  ...
};
*/

function getFilePathFromCmView(plugin, cmView) {
  const leaves = plugin.app.workspace.getLeavesOfType('markdown');
  for (const leaf of leaves) {
    if (leaf.view?.editor?.cm === cmView) {
      return leaf.view.file?.path || null;
    }
  }
  return null;
}

function getTableIndexByStartLine(plugin, cmView, startLine) {
  const filePath = getFilePathFromCmView(plugin, cmView);
  if (!filePath) return -1;
  const rowNumbers = plugin._rowNumbersCache.get(filePath);
  if (!rowNumbers || rowNumbers.length === 0) return -1;
  for (let i = rowNumbers.length - 1; i >= 0; i--) {
    if (rowNumbers[i].rowNumber <= startLine) return i + 1;
  }
  return -1;
}

function getTableIndexFromDOM(plugin, cmView, table) {
  try {
    const pos = cmView.posAtDOM(table);
    const doc = cmView.state.doc;
    const line = doc.lineAt(pos).number;
    return getTableIndexByStartLine(plugin, cmView, line);
  } catch (e) {}
  return -1;
}

async function fetchActualColumnWidth(plugin, cmView, tableIndex, colIndex) {
  const tables = cmView.dom.querySelectorAll("table");
  for (const table of tables) {
    const idx = getTableIndexFromDOM(plugin, cmView, table);
    if (idx === tableIndex) {
      const colgroup = table.querySelector("colgroup");
      if (colgroup) {
        const cols = colgroup.querySelectorAll("col");
        if (cols.length > colIndex && cols[colIndex]) {
          const width = cols[colIndex].getBoundingClientRect().width;
          if (width > 0) {
            const rounded = Math.round(width);
            dataLog(`fetchActualColumnWidth: table ${tableIndex} col ${colIndex} width=${rounded}`);
            return rounded;
          }
        }
      }
      const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
      if (headerRow) {
        const headerCells = headerRow.querySelectorAll("th, td");
        if (headerCells.length > colIndex && headerCells[colIndex]) {
          const width = headerCells[colIndex].getBoundingClientRect().width;
          if (width > 0) {
            const rounded = Math.round(width);
            dataLog(`fetchActualColumnWidth (fallback): table ${tableIndex} col ${colIndex} width=${rounded}`);
            return rounded;
          }
        }
      }
    }
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const tables = cmView.dom.querySelectorAll("table");
      for (const table of tables) {
        const idx = getTableIndexFromDOM(plugin, cmView, table);
        if (idx === tableIndex) {
          const colgroup = table.querySelector("colgroup");
          if (colgroup) {
            const cols = colgroup.querySelectorAll("col");
            if (cols.length > colIndex && cols[colIndex]) {
              const width = cols[colIndex].getBoundingClientRect().width;
              if (width > 0) {
                observer.disconnect();
                const rounded = Math.round(width);
                dataLog(`fetchActualColumnWidth (waited): table ${tableIndex} col ${colIndex} width=${rounded}`);
                resolve(rounded);
                return;
              }
            }
          }
          const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
          if (headerRow) {
            const headerCells = headerRow.querySelectorAll("th, td");
            if (headerCells.length > colIndex && headerCells[colIndex]) {
              const width = headerCells[colIndex].getBoundingClientRect().width;
              if (width > 0) {
                observer.disconnect();
                const rounded = Math.round(width);
                dataLog(`fetchActualColumnWidth (waited fallback): table ${tableIndex} col ${colIndex} width=${rounded}`);
                resolve(rounded);
                return;
              }
            }
          }
        }
      }
    });
    observer.observe(cmView.dom, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(100);
    }, 30000);
  });
}

async function getOrComputeOverwritePackage(plugin, cmView, tableIndex, filePath, autoFit, isMainWin) {
  let viewPackage = plugin._overwritePackages.get(cmView);
  if (!viewPackage) {
    viewPackage = new Map();
    plugin._overwritePackages.set(cmView, viewPackage);
  }
  if (viewPackage.has(tableIndex)) {
    return viewPackage.get(tableIndex);
  }

  const memKey = `${filePath}::${tableIndex}`;
  let mem = plugin.tableMemory.get(memKey);
  if (!mem) {
    const fileData = plugin.settings.columnWidths[filePath];
    if (fileData && fileData[String(tableIndex)]) {
      for (const idxStr in fileData) {
        const idx = parseInt(idxStr);
        const saved = fileData[idxStr];
        const key = `${filePath}::${idx}`;
        if (!plugin.tableMemory.has(key)) {
          plugin.tableMemory.set(key, {
            fingerprintB: saved.fingerprintB || [],
            colWidths: (saved.colWidths || []).map(w => Math.round(w)),
            widths: saved.widths ? JSON.parse(JSON.stringify(saved.widths)) : {},
            lastFpd: saved.lastFpd ? saved.lastFpd.slice() : new Array(saved.colWidths?.length || 0).fill(null)
          });
        }
      }
      mem = plugin.tableMemory.get(memKey);
      if (!mem) {
        if (!plugin._missingLogged.has(filePath)) plugin._missingLogged.set(filePath, new Set());
        const loggedSet = plugin._missingLogged.get(filePath);
        if (!loggedSet.has(tableIndex)) {
          cacheLog("Overwrite cache MISS for", filePath, "table", tableIndex, "(no memory after batch load)");
          loggedSet.add(tableIndex);
        }
        return null;
      }
    } else {
      if (!plugin._missingLogged.has(filePath)) plugin._missingLogged.set(filePath, new Set());
      const loggedSet = plugin._missingLogged.get(filePath);
      if (!loggedSet.has(tableIndex)) {
        cacheLog("Overwrite cache MISS for", filePath, "table", tableIndex, "(no memory)");
        loggedSet.add(tableIndex);
      }
      return null;
    }
  }

  const loggedSet = plugin._missingLogged?.get(filePath);
  if (loggedSet) {
    loggedSet.delete(tableIndex);
    if (loggedSet.size === 0) plugin._missingLogged.delete(filePath);
  }

  const editorWidth = cmView.dom.querySelector('.cm-sizer')?.clientWidth || cmView.dom.clientWidth;

  for (let i = 0; i < (mem.colWidths || []).length; i++) {
    if (mem.colWidths[i] === 1) {
      const actual = await fetchActualColumnWidth(plugin, cmView, tableIndex, i);
      if (actual > 0) {
        mem.colWidths[i] = actual;
      } else {
        mem.colWidths[i] = 100;
      }
    } else {
      mem.colWidths[i] = Math.round(mem.colWidths[i]);
    }
  }

  // 放宽：无论窗口身份，只要文件路径有效就保存自适应替换结果
  if (filePath) {
    plugin.syncTableMemoryToSettings(filePath);
    plugin.scheduleFileSave(filePath);
  }

  let widthArray = (mem.colWidths || []).slice().map(w => Math.round(w));

  if (autoFit && editorWidth && editorWidth >= 100) {
    const total = widthArray.reduce((a,b)=>a+b,0);
    const comp = Math.max(0, editorWidth - total);
    if (comp > 0 && widthArray.length > 0) {
      widthArray[widthArray.length-1] += comp;
    }
  }

  const fixedSum = (mem.colWidths || []).reduce((a, b) => a + b, 0);

  let totalFixed;
  if (autoFit && editorWidth > fixedSum) {
    totalFixed = editorWidth;
  } else {
    totalFixed = fixedSum;
  }

  const data = { widths: widthArray, totalFixedWidth: Math.round(totalFixed) };
  viewPackage.set(tableIndex, data);
  cacheLog("Overwrite cache computed for", filePath, "table", tableIndex, "data", data);
  return data;
}

function clearOverwritePackageForView(plugin, cmView) {
  plugin._overwritePackages.delete(cmView);
  cacheLog("Cleared overwrite package for a view");
}

function clearOverwritePackageForFile(plugin, filePath) {
  const leaves = plugin.app.workspace.getLeavesOfType('markdown');
  const cmViewsToDelete = [];
  for (const cmView of plugin._overwritePackages.keys()) {
    const leaf = leaves.find(l => l.view?.editor?.cm === cmView);
    if (leaf && leaf.view.file?.path === filePath) {
      cmViewsToDelete.push(cmView);
    }
  }
  for (const cmView of cmViewsToDelete) {
    plugin._overwritePackages.delete(cmView);
  }
  cacheLog("Cleared overwrite packages for file:", filePath);
}

function invalidateOverwritePackageForFile(plugin, filePath) {
  const affectedViews = [];
  const leaves = plugin.app.workspace.getLeavesOfType('markdown');
  
  for (const [cmView, pkg] of plugin._overwritePackages.entries()) {
    if (cmView === plugin._currentCmView) continue;
    const leaf = leaves.find(l => l.view?.editor?.cm === cmView);
    if (leaf && leaf.view && leaf.view.file?.path === filePath) {
      affectedViews.push({ cmView, mdView: leaf.view });
      plugin._overwritePackages.delete(cmView);
    }
  }
  
  if (affectedViews.length > 0) {
    cacheLog("Invalidated overwrite packages for file:", filePath);
    requestAnimationFrame(() => {
      for (const { cmView, mdView } of affectedViews) {
        if (cmView.dom?.isConnected) {
          plugin.processEditorTables(cmView, mdView).catch(() => {});
        }
      }
    });
  }
}

function isTableDragging(plugin, cmView, tableIndex) {
  if (!plugin._dragLock) return false;
  return plugin._dragLock.tableIndex === tableIndex && plugin._currentCmView === cmView;
}

function removeAllTableMinWidth(cmView) {
  const tables = cmView.dom.querySelectorAll("table");
  tables.forEach(table => {
    table.style.removeProperty("min-width");
    table.style.removeProperty("width");
  });
}

// ===== 主插件类 =====
var TableColumnResizePlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.tableMemory = new Map();
    this.fileSaveTimers = new Map();
    this.orphanedTableData = new Map();
    this._activeFilePaths = new Set();
    this._pendingCloseTimers = new Map();
    this._resizeObservers = new Map();
    this._resizeDebounceTimers = new Map();
    this._isDragging = false;
    this._overwritePackages = new Map();
    this._dragLock = null;
    this._rowNumbersCache = new Map();
    this._applyScanStates = new Map();
    this._sourceScanStates = new Map();
    this._dormantStates = new Map();
    this._regularModeLoaded = false;
    this._currentMainWin = false;
    this._currentCmView = null;
    this._migrationLoggedFiles = new Set();
    this._lastDynamicInfo = new Map();
    this._missingLogged = new Map();
    this._sourceScanBusy = false;
    this._perfStats = {
      scanCycle: 0,
      processEditorTables: 0,
      fileSaveScheduled: 0,
      matchMigrate: 0,
      autoFitReplace: 0,
    };
    this._perfInterval = null;
  }

  async onload() {
    await this.loadSettings();
    debugMode = this.settings.debugMode;
    securityLog("Plugin loaded, starting in maintenance mode");

    if (debugMode) {
      this._perfInterval = setInterval(() => {
        if (!debugMode) return;
        const s = this._perfStats;
        if (s.scanCycle > 0 || s.processEditorTables > 0 || s.fileSaveScheduled > 0 || s.matchMigrate > 0 || s.autoFitReplace > 0) {
          dataLog(`[PERF] scan=${s.scanCycle} process=${s.processEditorTables} save=${s.fileSaveScheduled} migrate=${s.matchMigrate} autoFit=${s.autoFitReplace}`);
        }
        s.scanCycle = 0;
        s.processEditorTables = 0;
        s.fileSaveScheduled = 0;
        s.matchMigrate = 0;
        s.autoFitReplace = 0;
      }, 5000);
      this.registerInterval(this._perfInterval);
    }

    // 阅读模式后处理器已注释，不再注册
    // this.registerMarkdownPostProcessor(tableResizePostProcessor(this));

    startSidebarTableObserver(this);
    this.addSettingTab(new TableResizeSettingTab(this.app, this));

    setupEditorEvents(this);

    // 文件重命名：移除窗口身份检查，对所有窗口生效
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

    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
        const mdView = leaf.view;
        const cmView = mdView?.editor?.cm;
        if (cmView && cmView.dom) {
          const isMainWin = isMainWindowLeaf(this, leaf);
          this._currentMainWin = isMainWin;
          securityLog(isMainWin ? "Main Window" : "New Window", "- onLayoutReady initial processing");
          if (isMainWin && !this._regularModeLoaded) {
            loadRegularModeFeatures(this);
          }
          if (cmView.state.doc.lines >= 3) {
            this.initSourceScan(cmView, mdView, false);
            this.initApplyScan(cmView, mdView);
          } else {
            dataLog(`Document has less than 3 lines, skip scan init for ${mdView.file?.path}`);
          }
        }
      });
    });
  }

  initSourceScan(cmView, mdView, skipInitialScan = false) {
    if (this._sourceScanStates.has(cmView)) return;
    const state = {
      lastRowNumbers: null,
      lastTotalLines: cmView.state.doc.lines,
      lastTotalChars: cmView.state.doc.length,
      initialMatchDone: false,
      firstEditOccurred: false,
      lastCursorLine: null,
      _lastContentHash: null,
    };
    this._sourceScanStates.set(cmView, state);
    if (!skipInitialScan) {
      this.performSourceScan(cmView, mdView);
    }
  }

  performSourceScan(cmView, mdView) {
    if (this._isDragging) return;
    
    // 严格限制：仅活跃窗口的 CodeMirror 实例可执行源码扫描，符合设计“源码扫描器只在激活窗口工作”
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !(activeLeaf.view instanceof import_obsidian2.MarkdownView) || activeLeaf.view.editor?.cm !== cmView) {
      return;
    }
    
    const filePath = mdView.file?.path;
    if (!filePath) return;
    const state = this._sourceScanStates.get(cmView);
    if (!state) return;

    this._sourceScanBusy = true;
    try {
      const content = cmView.state.doc.toString();
      const rowNumbers = this.scanTableRowNumbers(content);
      const prevRowNumbers = state.lastRowNumbers || [];
      const structureChanged = rowNumbers.length !== prevRowNumbers.length;

      this._rowNumbersCache.set(filePath, rowNumbers);
      state.lastRowNumbers = rowNumbers;
      state.lastTotalLines = cmView.state.doc.lines;
      state.lastTotalChars = content.length;

      const currentTables = [];
      for (let i = 0; i < rowNumbers.length; i++) {
        const fpd = getTableHeaderCellsFromSource(content, rowNumbers[i].rowNumber);
        const fpb = fingerprintB(fpd);
        const fpc = shortFingerprintC(fpb);
        currentTables.push({ index: i + 1, fpd, fpb, fpc });
      }

      const titlesMatrix = currentTables.map(t => t.fpd.map(c => c ?? 'null'));
      const prevInfo = this._lastDynamicInfo.get(filePath);
      const prevTitles = prevInfo?.titles || [];
      let logChanged = false;
      if (prevTitles.length !== titlesMatrix.length) logChanged = true;
      else {
        for (let i = 0; i < titlesMatrix.length; i++) {
          if (!arraysEqual(titlesMatrix[i], prevTitles[i])) { logChanged = true; break; }
        }
      }
      if (logChanged) {
        dataLog(`Dynamic index changed for ${filePath}:`);
        titlesMatrix.forEach((titles, idx) => dataLog(`  table ${idx + 1}: [${titles.join(', ')}]`));
        this._lastDynamicInfo.set(filePath, { tableCount: rowNumbers.length, titles: titlesMatrix });
      }

      // 放宽：无论主窗口还是新窗口，只要文件路径有效，都允许更新内存数据
      if (filePath) {
        if (structureChanged || !state.initialMatchDone) {
          if (currentTables.length > 0 || Object.keys(this.settings.columnWidths[filePath] || {}).length > 0) {
            matchAndMigrateTablesForFile(this, filePath, currentTables);
            this.syncTableMemoryToSettings(filePath);
            this.scheduleFileSave(filePath);
          }
          state.initialMatchDone = true;

          removeAllTableMinWidth(cmView);
          this._overwritePackages.delete(cmView);
          invalidateOverwritePackageForFile(this, filePath);
        } else {
          let anyColCountChanged = false;
          let anyOrderChanged = false;
          for (const ct of currentTables) {
            const memKey = `${filePath}::${ct.index}`;
            const mem = this.tableMemory.get(memKey);
            if (!mem) continue;

            if (!mem.lastFpd) mem.lastFpd = new Array(ct.fpd.length).fill(null);

            const oldLen = mem.fingerprintB.length;
            const newLen = ct.fpd.length;
            let needRebuild = false;

            if (newLen !== oldLen) {
              needRebuild = true;
              anyColCountChanged = true;
            } else if (arraysEqual(mem.fingerprintB, ct.fpb)) {
              if (!arraysEqual(mem.lastFpd, ct.fpd)) {
                needRebuild = true;
                anyOrderChanged = true;
              }
            }

            if (needRebuild) {
              mem.colWidths = rebuildColWidthsFromWidthsMap(ct.fpd, mem.widths);
            }

            if (!arraysEqual(mem.fingerprintB, ct.fpb) || needRebuild) {
              mem.fingerprintB = ct.fpb;
              mem.widths = buildWidthsFromColWidths(ct.fpd, mem.colWidths);
            }
            mem.lastFpd = ct.fpd.slice();
          }

          if (anyColCountChanged || anyOrderChanged) {
            removeAllTableMinWidth(cmView);
            this._overwritePackages.delete(cmView);
            invalidateOverwritePackageForFile(this, filePath);
            this.syncTableMemoryToSettings(filePath);
            this.scheduleFileSave(filePath);
          }
        }

        // 数据完整性保证：为所有当前表格补全缺失的内存数据块
        let completedTables = false;
        for (const ct of currentTables) {
          const key = `${filePath}::${ct.index}`;
          if (!this.tableMemory.has(key)) {
            this.tableMemory.set(key, {
              fingerprintB: ct.fpb,
              colWidths: ct.fpd.map(() => 1),
              widths: {},
              lastFpd: ct.fpd.slice()
            });
            completedTables = true;
          }
        }
        if (completedTables) {
          this.syncTableMemoryToSettings(filePath);
          this.scheduleFileSave(filePath);
          removeAllTableMinWidth(cmView);
          this._overwritePackages.delete(cmView);
          invalidateOverwritePackageForFile(this, filePath);
        }
      }

      let dormantState = this._dormantStates.get(filePath);
      if (!dormantState) {
        dormantState = { mode: 'active', dormantBaseLines: 0, accumulatedChange: 0 };
        this._dormantStates.set(filePath, dormantState);
      }
      if (rowNumbers.length === 0) {
        if (dormantState.mode === 'active') {
          dormantState.mode = 'dormant';
          dormantState.dormantBaseLines = cmView.state.doc.lines;
          dormantState.accumulatedChange = 0;
        } else {
          dormantState.dormantBaseLines = cmView.state.doc.lines;
          dormantState.accumulatedChange = 0;
        }
      } else {
        dormantState.mode = 'active';
      }

      this._perfStats.scanCycle++;
      return rowNumbers.length;
    } finally {
      this._sourceScanBusy = false;
    }
  }

  initApplyScan(cmView, mdView) {
    if (this._applyScanStates.has(cmView)) return;
    const state = {
      mode: 'high',
      timer: null,
      emptyTableCount: 0,
      lastActiveTime: Date.now(),
      lastWinIdentity: undefined,
      _highTimer: null,
      _cleanup: null,
      _lastContentHash: null,
      stableCount: 0,
      _pendingLowMode: false,
      _lastTotalCharsForLow: 0,
      _lowModeCheckCount: 0,
    };
    this._applyScanStates.set(cmView, state);
    this._currentCmView = cmView;
    this._startApplyScanTimer(cmView, mdView);
    state._cleanup = bindScanModeTriggers(this, cmView, mdView);

    const sizer = cmView.dom.querySelector('.cm-sizer');
    if (sizer && !this._resizeObservers.has(sizer)) {
      let initialWidth = sizer.clientWidth;
      const observer = new ResizeObserver(() => {
        if (!cmView.dom.isConnected || this._isDragging) return;
        const currentWidth = sizer.clientWidth;
        if (!currentWidth || currentWidth < 100) return;
        if (Math.abs(initialWidth - currentWidth) < 2) return;
        initialWidth = currentWidth;

        const existingTimer = this._resizeDebounceTimers.get(sizer);
        if (existingTimer) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          this._resizeDebounceTimers.delete(sizer);
          if (cmView.dom.isConnected && !this._isDragging) {
            clearOverwritePackageForView(this, cmView);
            this.processEditorTables(cmView, mdView, isMainWindowLeaf(this, mdView.leaf)).catch(() => {});
          }
        }, 100);
        this._resizeDebounceTimers.set(sizer, timer);
      });
      observer.observe(sizer);
      this._resizeObservers.set(sizer, observer);
    }
  }

  _startApplyScanTimer(cmView, mdView) {
    const state = this._applyScanStates.get(cmView);
    if (!state || state.mode === 'idle') return;
    if (state.timer) clearInterval(state.timer);
    let interval = 3000;
    if (state.mode === 'high') interval = 100;
    else if (state.mode === 'normal') interval = 1000;
    else if (state.mode === 'low') interval = 3000;
    state.timer = setInterval(() => {
      if (!cmView.dom.isConnected) {
        this.cleanupView(cmView);
        return;
      }
      this._applyScanTick(cmView, mdView);
    }, interval);
  }

  cleanupView(cmView) {
    this._overwritePackages.delete(cmView);
    this._sourceScanStates.delete(cmView);
    const applyState = this._applyScanStates.get(cmView);
    if (applyState) {
      if (applyState.timer) clearInterval(applyState.timer);
      if (applyState._cleanup) applyState._cleanup();
      if (applyState._highTimer) clearTimeout(applyState._highTimer);
      this._applyScanStates.delete(cmView);
    }
    const sizer = cmView.dom.querySelector('.cm-sizer');
    if (sizer) {
      const observer = this._resizeObservers.get(sizer);
      if (observer) {
        observer.disconnect();
        this._resizeObservers.delete(sizer);
      }
      const timer = this._resizeDebounceTimers.get(sizer);
      if (timer) {
        clearTimeout(timer);
        this._resizeDebounceTimers.delete(sizer);
      }
    }
  }

  _setApplyScanMode(cmView, mdView, newMode) {
    const state = this._applyScanStates.get(cmView);
    if (!state) return;
    
    if (newMode === 'high') {
      if (state.mode === 'high') {
        if (state._highTimer) clearTimeout(state._highTimer);
        state._highTimer = setTimeout(() => {
          if (this._applyScanStates.has(cmView)) {
            const s = this._applyScanStates.get(cmView);
            if (s.mode === 'high') {
              this._setApplyScanMode(cmView, mdView, 'normal');
            }
          }
        }, 1000);
        this._startApplyScanTimer(cmView, mdView);
        return;
      }
    }

    if (state.mode === newMode) return;
    
    state.mode = newMode;
    dataLog(`Apply scan mode changed to ${newMode} for ${mdView.file?.path}`);
    if (newMode === 'high' || newMode === 'idle') {
      state._pendingLowMode = false;
      state._lowModeCheckCount = 0;
    }
    if (newMode === 'idle') {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      return;
    }
    if (newMode === 'high') {
      if (state._highTimer) clearTimeout(state._highTimer);
      state._highTimer = setTimeout(() => {
        if (this._applyScanStates.has(cmView)) {
          const s = this._applyScanStates.get(cmView);
          if (s.mode === 'high') {
            this._setApplyScanMode(cmView, mdView, 'normal');
          }
        }
      }, 1000);
    }
    this._startApplyScanTimer(cmView, mdView);
  }

  _applyScanTick(cmView, mdView) {
    this._perfStats.processEditorTables++;
    this.processEditorTables(cmView, mdView).catch(e => dataLog("processEditorTables error:", e));

    const state = this._applyScanStates.get(cmView);
    if (state && state._pendingLowMode && state.mode !== 'low') {
      const currentTotalChars = cmView.state.doc.length;
      const delta = Math.abs(currentTotalChars - state._lastTotalCharsForLow);
      if (delta < 13) {
        state._lowModeCheckCount++;
        if (state._lowModeCheckCount >= 2) {
          this._setApplyScanMode(cmView, mdView, 'low');
          state._pendingLowMode = false;
          state._lowModeCheckCount = 0;
        } else {
          state._lastTotalCharsForLow = currentTotalChars;
        }
      } else {
        state._lowModeCheckCount = 0;
        state._lastTotalCharsForLow = currentTotalChars;
      }
    }
  }

  async processEditorTables(cmView, mdView, isMainWinPassed) {
    if (this._isDragging) return;

    const filePath = mdView.file?.path;
    const isMainWin = isMainWinPassed !== undefined ? isMainWinPassed : isMainWindowLeaf(this, mdView.leaf);
    this._currentMainWin = isMainWin;
    this._currentCmView = cmView;

    const applyState = this._applyScanStates.get(cmView);
    if (applyState && filePath) {
      if (applyState.lastWinIdentity !== isMainWin) {
        securityLog(isMainWin ? "Main Window" : "New Window", "- processing:", filePath);
        applyState.lastWinIdentity = isMainWin;
      }
    } else if (!applyState && filePath) {
      securityLog(isMainWin ? "Main Window" : "New Window", "- processing:", filePath);
    }

    if (isMainWin && !this._regularModeLoaded) {
      loadRegularModeFeatures(this);
    }

    if (cmView.state.doc.lines < 3) return;

    const fullyDisabled = isPluginFullyDisabled(this, filePath);
    const tables = cmView.dom.querySelectorAll("table");

    if (fullyDisabled) {
      tables.forEach(table => resetTableDOM(table));
      return;
    }

    const dragLocked = isDragLocked(this, filePath);
    const autoFit = shouldAutoFit(this, filePath);
    const editorWidth = cmView.dom.querySelector('.cm-sizer')?.clientWidth || cmView.dom.clientWidth;
    let foundTableCount = 0;

    for (const table of tables) {
      if (table.closest('.markdown-source-view') === null && table.closest('.markdown-preview-view') === null) continue;
      foundTableCount++;

      const tableIndex = getTableIndexFromDOM(this, cmView, table);
      if (tableIndex < 1) continue;

      if (isMainWin && !dragLocked) {
        if (!table.querySelector('.tcr-handle')) {
          const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
          if (headerRow) {
            const fpd = fingerprintD(headerRow.querySelectorAll("th, td"));
            addHandlesToTable(this, table, filePath, tableIndex, fpd, mdView);
          }
        }
      } else {
        removeHandlesFromTable(table);
      }

      if (this._sourceScanBusy) continue;

      const pkg = await getOrComputeOverwritePackage(this, cmView, tableIndex, filePath, autoFit, isMainWin);
      if (!pkg) continue;
      const { widths: displayWidths, totalFixedWidth } = pkg;

      if (isTableDragging(this, cmView, tableIndex)) continue;

      applyWidthsToTable(table, displayWidths, totalFixedWidth, autoFit, editorWidth);
      table.setAttribute("data-tcr", "1");
      table.setAttribute("data-tcr-locked", String(dragLocked));
    }

    if (applyState) {
      if (foundTableCount === 0) {
        applyState.emptyTableCount++;
        if (applyState.emptyTableCount >= 10 && applyState.mode !== 'idle') {
          this._setApplyScanMode(cmView, mdView, 'idle');
        }
      } else {
        applyState.emptyTableCount = 0;
      }

      if (!isMainWin) {
        const content = cmView.state.doc.toString();
        const contentHash = content.length;
        const allApplied = cmView.dom.querySelectorAll("table:not([data-tcr])").length === 0;
        if (allApplied && contentHash === applyState._lastContentHash) {
          applyState.stableCount = (applyState.stableCount || 0) + 1;
        } else {
          applyState.stableCount = 0;
        }
        applyState._lastContentHash = contentHash;
        if (applyState.stableCount >= 20 && applyState.mode !== 'idle') {
          this._setApplyScanMode(cmView, mdView, 'idle');
        }
      }
    }
  }

  syncTableMemoryToSettings(filePath) {
    const fileData = {};
    const memPrefix = `${filePath}::`;
    this.tableMemory.forEach((mem, key) => {
      if (key.startsWith(memPrefix)) {
        const indexStr = key.slice(filePath.length + 2);
        fileData[indexStr] = {
          fingerprintB: mem.fingerprintB || [],
          colWidths: mem.colWidths || [],
          widths: mem.widths || {}
        };
      }
    });
    this.settings.columnWidths[filePath] = fileData;
  }

  scheduleFileSave(filePath) {
    this._perfStats.fileSaveScheduled++;
    const existing = this.fileSaveTimers.get(filePath);
    if (existing) window.clearTimeout(existing.timer);
    const timer = window.setTimeout(() => {
      this.fileSaveTimers.delete(filePath);
      this.saveSettings();
    }, 6000);
    this.fileSaveTimers.set(filePath, { timer });
    dataLog("scheduleFileSave:", filePath, "timer set");
  }

  async releaseFileMemory(filePath) {
    const timer = this.fileSaveTimers.get(filePath);
    if (timer) {
      window.clearTimeout(timer.timer);
      this.fileSaveTimers.delete(filePath);
    }

    const memPrefix = `${filePath}::`;
    let hasData = false;
    this.tableMemory.forEach((_, key) => { if (key.startsWith(memPrefix)) hasData = true; });
    if (hasData) {
      this.syncTableMemoryToSettings(filePath);
      await this.saveSettings();
      dataLog(`releaseFileMemory: saved data for ${filePath}`);
    }

    const keysToDelete = [];
    this.tableMemory.forEach((_, key) => { if (key.startsWith(memPrefix)) keysToDelete.push(key); });
    keysToDelete.forEach(k => this.tableMemory.delete(k));
    this.orphanedTableData.delete(filePath);
    clearOverwritePackageForFile(this, filePath);
    this._rowNumbersCache.delete(filePath);
    this._migrationLoggedFiles.delete(filePath);
    this._lastDynamicInfo.delete(filePath);
    this._dormantStates.delete(filePath);
    this._missingLogged.delete(filePath);
    dataLog(`Memory released for closed file: ${filePath}`);
  }

  async onunload() {
    if (this._perfInterval) {
      clearInterval(this._perfInterval);
      this._perfInterval = null;
    }

    this._pendingCloseTimers.forEach(timer => window.clearTimeout(timer));
    this._pendingCloseTimers.clear();

    this._resizeDebounceTimers.forEach(timer => window.clearTimeout(timer));
    this._resizeDebounceTimers.clear();

    this._resizeObservers.forEach(observer => observer.disconnect());
    this._resizeObservers.clear();

    const cmViews = Array.from(this._applyScanStates.keys());
    for (const cmView of cmViews) {
      this.cleanupView(cmView);
    }
    this._applyScanStates.clear();
    this._sourceScanStates.clear();

    const allFilePaths = new Set();
    this.tableMemory.forEach((_, key) => {
      const idx = key.lastIndexOf('::');
      if (idx !== -1) allFilePaths.add(key.substring(0, idx));
    });

    const releasePromises = [];
    allFilePaths.forEach(fp => releasePromises.push(this.releaseFileMemory(fp)));
    await Promise.all(releasePromises);

    this.fileSaveTimers.clear();
    this.orphanedTableData.clear();
    this._overwritePackages.clear();

    document.body.classList.remove("tcr-resizing");
  }

  async loadSettings() {
    const data = await this.loadData();
    const columnWidths = data?.columnWidths ?? {};
    const debugModeSetting = data?.debugMode ?? false;
    const enableAutoFit = data?.enableAutoFit ?? false;
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
      debugMode: debugModeSetting,
      enableAutoFit: enableAutoFit
    };
    debugMode = this.settings.debugMode;
    securityLog("Data loaded from disk, files:", Object.keys(this.settings.columnWidths).length);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  scanTableRowNumbers(content) {
    const lines = content.split("\n");
    const rowNumbers = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pipeIdx = line.indexOf('|');
      if (pipeIdx === -1) continue;
      const afterPipe = line.slice(pipeIdx + 1).trimStart();
      if (afterPipe.startsWith(':-') || afterPipe.startsWith(':--') || afterPipe.startsWith('--') || afterPipe.startsWith('---')) {
        const isNormalTable = line[0] === '|';
        rowNumbers.push({ rowNumber: i, isNormalTable });
      }
    }
    return rowNumbers;
  }

  // 阅读模式辅助方法已注释，不再使用
  /*
  async getTableRowNumbers(filePath, expectedTableCount) {
    ...
  }
  */
};

function addHandlesToTable(plugin, table, filePath, tableIndex, fpd, mdView) {
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

  table.querySelectorAll(".tcr-handle").forEach(h => h.remove());

  for (let i = 0; i < colCount; i++) {
    const th = headerCells[i];
    const handle = document.createElement("div");
    handle.className = "tcr-handle";
    th.appendChild(handle);

    attachDragBehavior(plugin, handle, table, i, filePath, tableIndex, fpd, false, mdView);
  }
}

function removeHandlesFromTable(table) {
  table.querySelectorAll(".tcr-handle").forEach(h => h.remove());
}

function bindScanModeTriggers(plugin, cmView, mdView) {
  const activateHigh = () => {
    plugin._setApplyScanMode(cmView, mdView, 'high');
  };

  const wheelHandler = activateHigh;
  const scrollHandler = activateHigh;
  const pointerdownHandler = () => {
    const state = plugin._applyScanStates.get(cmView);
    if (!state) return;
    try {
      const pos = cmView.state.selection.main.head;
      const cursorLine = cmView.state.doc.lineAt(pos).number;
      const filePath = mdView.file?.path;
      if (!filePath) return;
      const rowNumbers = plugin._rowNumbersCache.get(filePath);
      if (rowNumbers) {
        const inTable = rowNumbers.some(rn => rn.rowNumber + 1 === cursorLine);
        if (inTable) {
          activateHigh();
        }
      }
    } catch (e) {}
  };

  cmView.dom.addEventListener('wheel', wheelHandler, { passive: true });
  cmView.scrollDOM.addEventListener('scroll', scrollHandler, { passive: true });
  cmView.dom.addEventListener('pointerdown', pointerdownHandler);

  return () => {
    cmView.dom.removeEventListener('wheel', wheelHandler);
    cmView.scrollDOM.removeEventListener('scroll', scrollHandler);
    cmView.dom.removeEventListener('pointerdown', pointerdownHandler);
  };
}

function setupEditorEvents(plugin) {
  plugin.registerEvent(
    plugin.app.workspace.on('editor-change', (editor, info) => {
      let mdView = info?.view;
      if (!mdView) mdView = plugin.app.workspace.getActiveViewOfType?.(import_obsidian2.MarkdownView);
      if (!mdView || !mdView.editor) return;
      const cmView = mdView.editor.cm;
      if (!cmView?.dom) return;
      if (cmView.state.doc.lines < 3) return;

      const filePath = mdView.file?.path;
      if (!filePath) return;

      const dormantState = plugin._dormantStates.get(filePath);
      if (dormantState && dormantState.mode === 'dormant') {
        const lines = cmView.state.doc.lines;
        const delta = Math.abs(lines - dormantState.dormantBaseLines);
        dormantState.accumulatedChange += delta;
        dormantState.dormantBaseLines = lines;
        if (dormantState.accumulatedChange >= 3) {
          dormantState.accumulatedChange = 0;
          if (!plugin._sourceScanStates.has(cmView)) {
            plugin.initSourceScan(cmView, mdView, true);
          }
          requestAnimationFrame(() => {
            if (cmView.dom.isConnected) {
              plugin.performSourceScan(cmView, mdView);
            }
          });
        }
        requestAnimationFrame(() => {
          if (cmView.dom.isConnected) {
            plugin.processEditorTables(cmView, mdView).catch(() => {});
          }
        });
        return;
      }

      const applyState = plugin._applyScanStates.get(cmView);
      if (applyState) {
        if (!applyState._pendingLowMode) {
          applyState._pendingLowMode = true;
          applyState._lastTotalCharsForLow = cmView.state.doc.length;
          applyState._lowModeCheckCount = 0;
        } else {
          applyState._lastTotalCharsForLow = cmView.state.doc.length;
          applyState._lowModeCheckCount = 0;
        }
      }

      if (!plugin._sourceScanStates.has(cmView)) {
        plugin.initSourceScan(cmView, mdView, false);
      }
      requestAnimationFrame(() => {
        if (cmView.dom.isConnected) {
          plugin.performSourceScan(cmView, mdView);
        }
      });
      requestAnimationFrame(() => {
        if (cmView.dom.isConnected) {
          plugin.processEditorTables(cmView, mdView).catch(() => {});
        }
      });
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view?.getViewType() === 'markdown') {
        const mdView = leaf.view;
        const cmView = mdView.editor?.cm;
        if (cmView?.dom?.isConnected) {
          const isMainWin = isMainWindowLeaf(plugin, leaf);
          plugin._currentMainWin = isMainWin;
          if (cmView.state.doc.lines < 3) {
            dataLog(`Document has less than 3 lines, skip scan init for ${mdView.file?.path}`);
            return;
          }
          const filePath = mdView.file?.path;
          const dormantState = filePath ? plugin._dormantStates.get(filePath) : null;
          const isDormant = dormantState && dormantState.mode === 'dormant';
          if (!plugin._sourceScanStates.has(cmView)) {
            plugin.initSourceScan(cmView, mdView, isDormant);
          }
          if (!plugin._applyScanStates.has(cmView)) {
            plugin.initApplyScan(cmView, mdView);
          }
          plugin._setApplyScanMode(cmView, mdView, 'high');
          plugin.processEditorTables(cmView, mdView, isMainWin).catch(() => {});

          plugin.app.workspace.getLeavesOfType('markdown').forEach(otherLeaf => {
            if (otherLeaf !== leaf && otherLeaf.view?.editor?.cm) {
              const otherCm = otherLeaf.view.editor.cm;
              if (plugin._applyScanStates.has(otherCm)) {
                const otherState = plugin._applyScanStates.get(otherCm);
                if (otherState.mode === 'high' || otherState.mode === 'normal') {
                  plugin._setApplyScanMode(otherCm, otherLeaf.view, 'low');
                }
              }
            }
          });
        }
      }
    })
  );
}

function loadRegularModeFeatures(plugin) {
  if (plugin._regularModeLoaded) return;
  plugin._regularModeLoaded = true;
  securityLog("Regular mode features loaded");

  plugin._activeFilePaths = new Set();
  plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
    if (isMainWindowLeaf(plugin, leaf)) {
      const view = leaf.view;
      if (view?.file) plugin._activeFilePaths.add(view.file.path);
    }
  });

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () => {
      if (!plugin._regularModeLoaded) return;
      const newPaths = new Set();
      plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
        if (isMainWindowLeaf(plugin, leaf)) {
          const view = leaf.view;
          if (view?.file) newPaths.add(view.file.path);
        }
      });

      const closedPaths = new Set([...plugin._activeFilePaths].filter(p => !newPaths.has(p)));
      closedPaths.forEach(filePath => {
        const existingTimer = plugin._pendingCloseTimers.get(filePath);
        if (existingTimer) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          plugin._pendingCloseTimers.delete(filePath);
          const currentPaths = new Set();
          plugin.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
            if (isMainWindowLeaf(plugin, leaf)) {
              const view = leaf.view;
              if (view?.file) currentPaths.add(view.file.path);
            }
          });
          if (!currentPaths.has(filePath)) {
            plugin.releaseFileMemory(filePath);
          }
        }, 3000);
        plugin._pendingCloseTimers.set(filePath, timer);
      });

      for (const [fp, timer] of plugin._pendingCloseTimers.entries()) {
        if (newPaths.has(fp)) {
          window.clearTimeout(timer);
          plugin._pendingCloseTimers.delete(fp);
        }
      }
      plugin._activeFilePaths = newPaths;
    })
  );
}

function startSidebarTableObserver(plugin) {
  const processSidebarTables = (root) => {
    const tables = root.querySelectorAll ? Array.from(root.querySelectorAll('table')) : [];
    tables.forEach(table => {
      if (table.hasAttribute("data-tcr")) return;
      if (table.closest('.markdown-source-view') || table.closest('.markdown-preview-view')) return;
      const viewContent = table.closest('.view-content');
      if (viewContent) {
        applyWidthsToTable(table, [], 0, false, 0);
      }
    });
  };
  processSidebarTables(document.body);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) processSidebarTables(node);
      }
      if (mutation.type === 'childList' && mutation.target.nodeType === Node.ELEMENT_NODE) {
        processSidebarTables(mutation.target);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  plugin.register(() => observer.disconnect());
}

var TableResizeSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl)
      .setName("调试模式")
      .setDesc("开启后在控制台输出详细调试信息。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          debugMode = value;
          await this.plugin.saveSettings();
        }));
    new import_obsidian2.Setting(containerEl)
      .setName("启用自适应铺满")
      .setDesc("全局自动扩展最后一列以填满编辑器宽度。可在文件 frontmatter 的 cssclasses 中添加 \"1\" 单独开启。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableAutoFit)
        .onChange(async (value) => {
          this.plugin.settings.enableAutoFit = value;
          await this.plugin.saveSettings();
        }));
    new import_obsidian2.Setting(containerEl)
      .setName("最小列宽")
      .setDesc("拖动调整列宽时的最小宽度限制（像素）。")
      .addText(text => text
        .setPlaceholder("50")
        .setValue(String(this.plugin.settings.minColumnWidth))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.minColumnWidth = num;
            await this.plugin.saveSettings();
          }
        }));
    new import_obsidian2.Setting(containerEl)
      .setName("重置所有列宽")
      .setDesc("清除所有已保存的列宽数据，表格将恢复默认宽度。")
      .addButton(btn => btn
        .setButtonText("重置")
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.columnWidths = {};
          this.plugin.tableMemory.clear();
          this.plugin._overwritePackages.clear();
          await this.plugin.saveSettings();
        }));
  }
};