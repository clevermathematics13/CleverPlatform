/**
 * ==============================================================================
 * 📂 DRIVE SERVICE
 * - Handles file uploads, renaming, and clearing links (soft delete).
 * ==============================================================================
 */

function processDirectUpload(formObject) {
  var currentUser = Session.getActiveUser().getEmail();
  
  try {
    logToDebugSheet("START", "Upload started for: " + currentUser);
    if (!formObject.fileData) return { success: false, error: "No file data received" };

    var ss = SpreadsheetApp.openById(DB_ID);
    var targetEmail = formObject.studentEmail; 
    if (!targetEmail || targetEmail === "") targetEmail = currentUser;
    
    var studentName = targetEmail.split("@")[0]; 
    try {
      var studentsTab = ss.getSheetByName("Students");
      var sData = studentsTab.getDataRange().getValues();
      for (var i = 1; i < sData.length; i++) {
         if (String(sData[i][0]).toLowerCase().trim() === targetEmail.toLowerCase().trim()) {
             if (sData[i][1]) studentName = sData[i][1];
             break;
         }
      }
    } catch(err) { console.log("Name lookup failed"); }

    var safeExam = String(formObject.examName).replace(/\s+/g, "_");
    var safeName = String(studentName).replace(/\s+/g, "_");
    var newFileName = safeExam + "_" + safeName + ".pdf";

    var data = Utilities.base64Decode(formObject.fileData);
    var blob = Utilities.newBlob(data, formObject.mimeType, newFileName);
    
    var folder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID);
    var file = folder.createFile(blob);
    var fileUrl = file.getUrl();
    logToDebugSheet("STEP 4", "File created: " + fileUrl);
    
    var responseSheetName = formObject.examName + "_R"; 
    var sheet = ss.getSheetByName(responseSheetName);
    
    if (!sheet) return { success: false, error: "Sheet '" + responseSheetName + "' not found." };
    
    var rData = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 0; i < rData.length; i++) {
      if (String(rData[i][1]).toLowerCase().trim() === targetEmail.toLowerCase().trim()) {
        rowIndex = i + 1; 
        break;
      }
    }
    
    if (rowIndex !== -1) {
      sheet.getRange(rowIndex, PDF_LINK_COL).setValue(fileUrl); 
      logToDebugSheet("SUCCESS", "Url written to row " + rowIndex);
    } else {
      return { success: false, error: "Student row not found." };
    }

    return { success: true, url: fileUrl };

  } catch (e) {
    logToDebugSheet("CRITICAL EXCEPTION", e.toString());
    return { success: false, error: "Server Error: " + e.toString() };
  }
}

function clearPdfLink(payload) {
  var currentUser = Session.getActiveUser().getEmail();
  try {
      var ss = SpreadsheetApp.openById(DB_ID);
      var sheetName = payload.examName + "_R";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return { success: false, error: "Sheet not found" };

      var rData = sheet.getDataRange().getValues();
      var targetEmail = payload.studentEmail; 
      if (!targetEmail || targetEmail === "") targetEmail = currentUser;

      var rowIndex = -1;
      for (var i = 0; i < rData.length; i++) {
        if (String(rData[i][1]).toLowerCase().trim() === targetEmail.toLowerCase().trim()) {
          rowIndex = i + 1; 
          break;
        }
      }

      if (rowIndex !== -1) {
          sheet.getRange(rowIndex, PDF_LINK_COL).clearContent();
          logToDebugSheet("RESET", "PDF Link cleared for: " + targetEmail);
          return { success: true };
      }
      return { success: false, error: "User not found" };

  } catch(e) {
      return { success: false, error: e.toString() };
  }
}