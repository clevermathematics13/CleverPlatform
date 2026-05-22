/**
 * ==============================================================================
 * 🛠️ UTILITIES & HELPERS (FIXED: CALCULATION OFFSETS)
 * - Shared functions for logging, math, and sanitization.
 * ==============================================================================
 */

function onStudentSubmission(e) {
  if (!e || !e.range) return;
  sanitizeBlanks(e);
  calculateDisagreement(e);
}

function calculateDisagreement(e) {
  try {
      var sheet = e.range.getSheet();
      if (!sheet.getName().endsWith("_R")) return -1;
      
      var examName = sheet.getName().substring(0, sheet.getName().lastIndexOf("_R"));
      var ss = SpreadsheetApp.openById(DB_ID);
      var examSheet = ss.getSheetByName(examName);
      if (!examSheet) return -1;

      var examData = examSheet.getDataRange().getValues();
      var maxPointsRow = examData[2]; 
      
      var studentEmail = "";
      if (e.namedValues && e.namedValues['Email Address']) studentEmail = e.namedValues['Email Address'][0];
      else if (e.values) studentEmail = e.values[1]; 

      if (!studentEmail) return -1;
      
      var teacherRowData = null;
      for (var r = 4; r < examData.length; r++) { 
        if (String(examData[r][0]).toLowerCase().trim() === String(studentEmail).toLowerCase().trim()) {
          teacherRowData = examData[r];
          break;
        }
      }

      if (teacherRowData) {
        var totalDiff = 0;
        var totalMax = 0;
        for (var i = 2; i < teacherRowData.length; i++) {
          // 🛠️ FIXED: Changed from e.values[i+1] to e.values[i]
          var studentScore = (i < e.values.length) ? e.values[i] : "";
          var teacherScore = teacherRowData[i]; 
          var max = maxPointsRow[i];
          
          var sIsNum = (studentScore !== "" && studentScore !== "-" && !isNaN(studentScore));
          var tIsNum = (teacherScore !== "" && !isNaN(teacherScore));
          
          if (sIsNum && tIsNum) {
            totalDiff += Math.abs(Number(teacherScore) - Number(studentScore));
            totalMax += Number(max);
          } else if (sIsNum || tIsNum) {
             totalDiff += Number(max);
             totalMax += Number(max);
          }
        }
        var disagreementVal = (totalMax > 0) ? ((totalDiff / totalMax) * 100) : 0;
        sheet.getRange(e.range.getRow(), e.values.length + 1).setValue(disagreementVal.toFixed(1) + "%");
        return disagreementVal;
      }
      return -1;
  } catch(err) { console.error(err); }
}

function sanitizeBlanks(e) {
  var range = e.range;
  var values = range.getValues()[0]; 
  var modified = false;
  for (var i = 2; i < values.length; i++) {
    if (values[i] === "") { values[i] = "-"; modified = true; }
  }
  if (modified) range.setValues([values]);
}

function logToDebugSheet(status, message) {
  try {
    var ss = SpreadsheetApp.openById(DB_ID);
    var sheet = ss.getSheetByName("Debug_Log");
    if (!sheet) {
      sheet = ss.insertSheet("Debug_Log");
      sheet.appendRow(["Timestamp", "User", "Status", "Message"]);
    }
    var time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var user = Session.getActiveUser().getEmail();
    sheet.appendRow([time, user, status, message]);
  } catch (err) { console.log(err); }
}

function forceAuthorization() { 
  console.log("Drive is listening."); 
  var test = SpreadsheetApp.openById(PPQ_ID).getName();
  console.log("Access confirmed to: " + test);
}