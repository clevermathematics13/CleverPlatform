/********************************
 * ApiEndpoint.js
 *
 * HTTP entry-point for CleverPlatform → GAS communication.
 *
 * Deploy this GAS project as a Web App:
 *   Execute as: Me (owner)
 *   Who has access: Anyone with Google Account
 *
 * CleverPlatform calls:
 *   GET  ?action=health
 *   POST { "action": "gradeStudentWork", "payload": { "driveFileId": "...", "examId": "..." } }
 *
 * All responses are JSON with Content-Type application/json.
 ********************************/

/**
 * doGet – handles health-check requests from CleverPlatform.
 * GET <web-app-url>?action=health
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";

  if (action === "health") {
    return _jsonResponse(apiHealthCheck());
  }

  // Default: forward to the Exam Management UI (existing behaviour)
  return HtmlService.createHtmlOutputFromFile("ExamUI")
    .setTitle("Exam Management System")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * doPost – JSON API dispatcher for CleverPlatform server-side calls.
 *
 * Expected request body (application/json):
 * {
 *   "action": "gradeStudentWork" | "healthCheck",
 *   "payload": { ... action-specific fields ... }
 * }
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return _jsonResponse({ ok: false, error: "Invalid JSON body: " + err.message }, 400);
  }

  const action = body.action || "";
  const payload = body.payload || {};

  try {
    switch (action) {
      case "healthCheck":
        return _jsonResponse(apiHealthCheck());

      case "gradeStudentWork": {
        const { driveFileId, examId } = payload;
        if (!driveFileId) {
          return _jsonResponse({ ok: false, error: "payload.driveFileId is required" }, 400);
        }
        const result = gradeStudentWorkForApi_(driveFileId, examId);
        return _jsonResponse(result);
      }

      default:
        return _jsonResponse({ ok: false, error: "Unknown action: " + action }, 400);
    }
  } catch (err) {
    msaErr_("doPost error for action=" + action + ": " + err.message + "\n" + (err.stack || ""));
    return _jsonResponse({ ok: false, error: err.message }, 500);
  }
}

/**
 * gradeStudentWorkForApi_
 *
 * Orchestrates the grading pipeline for a single student's work file
 * stored in Google Drive. Called from doPost when action=gradeStudentWork.
 *
 * @param {string} driveFileId  Drive file ID of the student's PDF/image.
 * @param {string} examId       Optional: folder ID or identifier of the exam
 *                              (used to locate the pre-processed markscheme).
 * @returns {{ ok: boolean, marks: Array, totalScore: number, maxScore: number }}
 */
function gradeStudentWorkForApi_(driveFileId, examId) {
  msaLog_("gradeStudentWorkForApi_ start — driveFileId=" + driveFileId + " examId=" + (examId || "(none)"));

  const cfg = msaGetConfig_();

  // 1. OCR the student's file
  const ocrResult = performOcrOnImage(DriveApp.getFileById(driveFileId).getBlob(), driveFileId);
  if (!ocrResult || !ocrResult.text) {
    throw new Error("OCR returned no text for file " + driveFileId);
  }
  const studentText = ocrResult.text;
  msaLog_("OCR complete — " + studentText.length + " chars");

  // 2. Locate the markscheme for this exam
  let markschemePoints = null;

  if (examId) {
    // examId may be a Drive folder ID containing the pre-processed markscheme JSON
    let msFolder = null;
    try {
      msFolder = DriveApp.getFolderById(examId);
    } catch (_) {
      // examId might be a question doc ID instead
      msFolder = msaFindQuestionFolderByDocId_(cfg, examId);
    }

    if (msFolder) {
      const parsed = msaReadJsonFileIfExists_(msFolder, MSA_FN_POINTS_BEST_JSON);
      if (parsed && parsed.points) {
        markschemePoints = parsed.points;
        msaLog_("Loaded " + markschemePoints.length + " markscheme points from folder " + msFolder.getName());
      }
    }
  }

  if (!markschemePoints) {
    throw new Error(
      "No pre-processed markscheme found for examId=" + (examId || "(none)") +
      ". Run MSA atomization first."
    );
  }

  // 3. Grade
  const gradingResult = gradeStudentResponse(driveFileId, null, markschemePoints, studentText);

  // 4. Build a flat marks array for CleverPlatform to upsert into student_marks
  const marksArray = (gradingResult.breakdown || []).map(function (entry) {
    return {
      questionNumber: entry.questionNumber || null,
      partLabel: entry.partLabel || entry.part || "",
      score: entry.awardedScore || 0,
      maxScore: entry.possibleScore || 0,
      autoGraded: true,
    };
  });

  msaLog_("Grading complete — " + marksArray.length + " parts graded");

  return {
    ok: true,
    marks: marksArray,
    totalScore: gradingResult.awardedScore || 0,
    maxScore: gradingResult.possibleScore || 0,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Wrap any JS object as a JSON ContentService response.
 * @param {object} data
 * @param {number} [statusCode] - ignored by GAS (always 200), kept for documentation
 */
function _jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
