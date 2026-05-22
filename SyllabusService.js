/**
 * ==============================================================================
 * 📚 SYLLABUS SERVICE
 * - Fetches and caches syllabus descriptions from external sheets.
 * - Includes robust fallback logic for sheet names.
 * ==============================================================================
 */

function getSyllabusMap() {
  // Check cache first (avoids opening PPQ spreadsheet on every call)
  var cache = CacheService.getScriptCache();
  var cached = cache.get("syllabusMap");
  if (cached) {
    try { return JSON.parse(cached); } catch(e) { /* fall through to fresh read */ }
  }

  var map = {};
  try {
    var ss = SpreadsheetApp.openById(PPQ_ID);
    
    // 1. Try exact name 'matching'
    var sheet = ss.getSheetByName("matching"); 
    
    // 2. Fallback to 'Section Code' or First Sheet
    if (!sheet) {
        sheet = ss.getSheetByName("Section Code"); 
        if (!sheet) {
            var allSheets = ss.getSheets();
            if (allSheets.length > 0) {
                sheet = allSheets[0]; 
                logToDebugSheet("SYLLABUS WARN", "Sheet 'matching' not found. Using: " + sheet.getName());
            }
        }
    }

    if (!sheet) {
        logToDebugSheet("SYLLABUS ERROR", "No sheets found in PPQ Storage.");
        return map;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return map;

    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); 
    
    for (var i = 0; i < data.length; i++) {
      var code = String(data[i][0]).trim();
      var desc = String(data[i][1]).trim();
      if (code) {
        map[code] = desc;
      }
    }
    logToDebugSheet("SYLLABUS", "Loaded " + Object.keys(map).length + " entries from " + sheet.getName());
  } catch (e) {
    logToDebugSheet("SYLLABUS ERROR", "Fetch Failed: " + e.toString());
  }

  // Cache for 10 minutes (600 seconds)
  try { cache.put("syllabusMap", JSON.stringify(map), 600); } catch(e) { /* cache write failure is non-fatal */ }

  return map;
}