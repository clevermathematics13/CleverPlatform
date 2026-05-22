/**
 * ==============================================================================
 * 📊 STATS SERVICE (STRICT DISPLAY, INCLUSIVE CALCULATION)
 * - Columns (Syllabus Codes) only appear if they exist in a STANDARD exam (K or F).
 * - Scores include points from ALL exams (Standard + Special).
 * - Natural Sort ensures 1.3 comes before 1.12.
 * ==============================================================================
 */

function getStudentStats(studentEmail) {
  var activeUser = Session.getActiveUser().getEmail().toLowerCase().trim();
  if (!studentEmail) studentEmail = activeUser;
  
  var classData = processStatsLogic(studentEmail); 
  return classData.students[0] ? classData.students[0].topics : [];
}

function getClassStats() {
  var activeUser = Session.getActiveUser().getEmail().toLowerCase().trim();
  var isTeacher = CONFIG.TEACHERS.some(function(t) { return t.toLowerCase().trim() === activeUser; });

  if (!isTeacher) {
    throw new Error("⛔ Access Denied: Teachers Only.");
  }

  return processStatsLogic(null); 
}

function processStatsLogic(targetStudentEmail) {
  var ss = SpreadsheetApp.openById(DB_ID);
  var syllabusMap = getSyllabusMap(); 
  var examList = getExamList(); 
  
  // Read Students sheet ONCE (instead of per-exam)
  var studentSheet = ss.getSheetByName("Students");
  var allStudentData = studentSheet.getDataRange().getValues();
  
  var stats = {};
  var allCodes = {}; 
  var drillDownMap = {}; 

  examList.forEach(function(exam) {
    try {
      var examId = String(exam.sheetId).trim().toUpperCase();
      // Define Standard Exams (K or F) vs Special Exams
      var isStandardExam = (examId.startsWith("K") || examId.startsWith("F"));

      var dashboardName = "";
      for(var i=0; i<allStudentData.length; i++) {
        if(String(allStudentData[i][6]) === exam.sheetId) { dashboardName = allStudentData[i][6]; break; }
      }
      
      var dashSheet = ss.getSheetByName(dashboardName);
      if(!dashSheet) return;

      var dData = dashSheet.getDataRange().getValues();
      if(dData.length < 5) return;

      var labelRow = dData[0]; // Q1, Q2, etc.
      var maxPointsRow = dData[2];
      var syllabusRow = dData[3];

      // 1. BUILD THE MAP OF QUESTIONS & COLUMNS
      for(var c=2; c<syllabusRow.length; c++) {
         var code = String(syllabusRow[c]).trim();
         if(!code || code === "-") continue;

         // === CRITICAL CHANGE ===
         // Only Register the Syllabus Code (Column) and Drill Down info
         // if this is a STANDARD exam. This hides "1.3" if it's only in Special exams.
         if (isStandardExam) {
             if(!drillDownMap[code]) drillDownMap[code] = [];
             
             var cleanName = exam.displayName.replace(/^[A-Z0-9]+\s+/, "");

             drillDownMap[code].push({
                uniqueId: exam.sheetId + "_" + c,
                examName: cleanName, 
                questionLabel: labelRow[c],
                max: maxPointsRow[c]
             });
             
             // Only add to the "Master List" of headers if it's a Standard Exam
             allCodes[code] = syllabusMap[code] || "";
         }
      }

      // 2. PROCESS STUDENT SCORES (INCLUDES ALL EXAMS)
      // We still run this loop for ALL exams (Standard OR Special)
      // so the mastery % calculation includes the special data for topics that DO appear.
      for(var r=5; r<dData.length; r++) {
        var email = String(dData[r][0]).toLowerCase().trim();
        var name = dData[r][1];

        if (!email || email === "") continue;
        if (targetStudentEmail && email !== targetStudentEmail) continue;

        if (!stats[email]) {
          stats[email] = { name: name || email.split("@")[0], codes: {}, drill: {} };
        }

        for(var c=2; c<syllabusRow.length; c++) {
          var code = String(syllabusRow[c]).trim();
          if(!code || code === "-") continue; 

          var rawScore = dData[r][c];
          var max = maxPointsRow[c];
          
          if (!isStandardExam) {
             if (rawScore === "" || rawScore === "-") continue;
          }

          var score = 0; 
          if (typeof rawScore === 'number' && !isNaN(rawScore)) {
             score = rawScore; 
          }

          if(typeof max === 'number' && !isNaN(max) && max > 0) {
            if (!stats[email].codes[code]) {
              stats[email].codes[code] = { earned: 0, max: 0 };
            }
            stats[email].codes[code].earned += score; 
            stats[email].codes[code].max += max;      
            
            var uniqueId = exam.sheetId + "_" + c;
            if (!stats[email].drill[uniqueId]) stats[email].drill[uniqueId] = score;
          }
        }
      }
    } catch(err) {
      console.error("Error in exam " + exam.sheetId + ": " + err);
    }
  });

  // NATURAL SORT
  var syllabusList = Object.keys(allCodes).sort(function(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  var studentList = [];

  for (var email in stats) {
    var sObj = stats[email];
    var topicArray = [];
    
    // We only build the student topic list based on "syllabusList"
    // Since 1.3 is not in syllabusList (because no Std exam had it),
    // it will simply be skipped here, effectively removing it from the heatmap.
    syllabusList.forEach(code => {
      var data = sObj.codes[code];
      if (data && data.max > 0) {
        var pct = ((data.earned / data.max) * 100).toFixed(1);
        topicArray.push({ code: code, pct: pct, description: allCodes[code] });
      } else {
        topicArray.push({ code: code, pct: null, description: allCodes[code] }); 
      }
    });

    studentList.push({
      name: sObj.name,
      email: email,
      topics: topicArray,
      drillData: sObj.drill 
    });
  }

  studentList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    syllabusList: syllabusList, 
    drillDownMap: drillDownMap, 
    students: studentList       
  };
}