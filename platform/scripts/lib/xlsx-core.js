'use strict';
/**
 * Shared utilities for parsing extracted XLSX files.
 *
 * All parse-xlsx-*.js scripts operate on an XLSX archive that has been
 * unzipped to a base directory (default /tmp/xlsx_extract). This module
 * centralises the boilerplate that was previously duplicated across every
 * script: loading shared strings, parsing cell maps, converting column
 * letters, and resolving hyperlinks.
 *
 * Usage:
 *   const { loadSharedStrings, parseCells, loadSheet, loadHyperlinks,
 *           getCellsInRow, colToNum, numToCol, extractDocId,
 *           IB_CODE_RE } = require('./lib/xlsx-core');
 */

const fs = require('fs');

/** Default XLSX extract directory used by all scripts. */
const DEFAULT_BASE = '/tmp/xlsx_extract';

/**
 * Load and parse the shared-strings table from an extracted XLSX directory.
 * @param {string} [base] - Path to the extracted XLSX root.
 * @returns {string[]} Ordered array of string values.
 */
function loadSharedStrings(base = DEFAULT_BASE) {
  const xml = fs.readFileSync(`${base}/xl/sharedStrings.xml`, 'utf8');
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map((m) => {
    const parts = [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)];
    return parts.map((p) => p[1]).join('');
  });
}

/**
 * Read a worksheet XML string from the extracted XLSX directory.
 * @param {number} sheetNum - 1-based sheet index.
 * @param {string} [base]
 * @returns {string}
 */
function loadSheet(sheetNum, base = DEFAULT_BASE) {
  return fs.readFileSync(`${base}/xl/worksheets/sheet${sheetNum}.xml`, 'utf8');
}

/**
 * Parse all cells from a worksheet XML string into a flat cell map.
 * Handles both shared-string cells (t="s") and numeric/inline cells.
 *
 * @param {string} sheetXml - Raw worksheet XML.
 * @param {string[]} strings - Shared strings array (from loadSharedStrings).
 * @returns {Object.<string, string>} Map of "COL+ROW" → display value, e.g. { "A1": "hello" }.
 */
function parseCells(sheetXml, strings) {
  const cellMap = {};
  const regex = /<c\s+r="([A-Z]+)(\d+)"([^>]*)(?:\/>|>(.*?)<\/c>)/gs;
  let match;
  while ((match = regex.exec(sheetXml)) !== null) {
    const [, col, row, attrs, content] = match;
    if (!content) continue;
    const vMatch = content.match(/<v>(.*?)<\/v>/);
    if (!vMatch) continue;
    const raw = vMatch[1];
    const isStr = attrs.includes('t="s"');
    const display = isStr ? strings[parseInt(raw)] : raw;
    if (display !== undefined && display !== '') {
      cellMap[`${col}${row}`] = display;
    }
  }
  return cellMap;
}

/**
 * Extract all cells belonging to a specific row from an already-parsed cell map.
 * Returns a map of column letter → value, e.g. { "A": "hello", "B": "world" }.
 *
 * @param {Object.<string, string>} cellMap - From parseCells().
 * @param {number} row - 1-based row number.
 * @returns {Object.<string, string>}
 */
function getCellsInRow(cellMap, row) {
  const suffix = String(row);
  const result = {};
  for (const [key, val] of Object.entries(cellMap)) {
    const colPart = key.slice(0, key.length - suffix.length);
    if (key.slice(colPart.length) === suffix && /^[A-Z]+$/.test(colPart)) {
      result[colPart] = val;
    }
  }
  return result;
}

/**
 * Load the relationship and hyperlink tables for a given worksheet.
 * Returns a map of cell reference → resolved URL (external links only).
 *
 * @param {number} sheetNum - 1-based sheet index.
 * @param {string} [base]
 * @returns {Object.<string, string>} cellToUrl map.
 */
function loadHyperlinks(sheetNum, base = DEFAULT_BASE) {
  const relsPath = `${base}/xl/worksheets/_rels/sheet${sheetNum}.xml.rels`;
  const relsXml = fs.readFileSync(relsPath, 'utf8');

  const ridToUrl = {};
  const relsRe = /Id="(rId\d+)"[^>]*Target="([^"]*)"/g;
  let m;
  while ((m = relsRe.exec(relsXml)) !== null) ridToUrl[m[1]] = m[2];

  const sheetXml = fs.readFileSync(`${base}/xl/worksheets/sheet${sheetNum}.xml`, 'utf8');
  const cellToUrl = {};
  const hlRe = /<hyperlink[^>]*r:id="(rId\d+)"[^>]*ref="([^"]+)"[^>]*\/?>/g;
  while ((m = hlRe.exec(sheetXml)) !== null) {
    if (ridToUrl[m[1]]) cellToUrl[m[2]] = ridToUrl[m[1]];
  }

  return cellToUrl;
}

/**
 * Convert an Excel column letter string (e.g. "A", "AB", "AFA") to a
 * 1-based column number.
 * @param {string} col
 * @returns {number}
 */
function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + col.charCodeAt(i) - 64;
  return n;
}

/**
 * Convert a 1-based column number to an Excel column letter string.
 * @param {number} n
 * @returns {string}
 */
function numToCol(n) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/**
 * Extract the Google Drive file ID from a Drive/Docs/Slides URL.
 * Returns null if the URL does not contain a recognisable /d/<id> segment.
 * @param {string} url
 * @returns {string|null}
 */
function extractDocId(url) {
  const m = url.match(/\/d\/([^/]+)/);
  return m ? m[1] : null;
}

/** Regex that matches a standard IB question code (e.g. "22M.2.AHL.TZ2"). */
const IB_CODE_RE = /\d{2}[MN]\.\d\.\w+\.TZ\d/;

module.exports = {
  DEFAULT_BASE,
  loadSharedStrings,
  loadSheet,
  parseCells,
  getCellsInRow,
  loadHyperlinks,
  colToNum,
  numToCol,
  extractDocId,
  IB_CODE_RE,
};
