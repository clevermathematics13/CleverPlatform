/**
 * ==============================================================================
 * 🚀 MAIN CONTROLLER
 * - Handles routing between Reflection Tool and Stats Tool.
 * ==============================================================================
 */

// 🔑 CENTRALIZED CONFIGURATION
var CONFIG = {
  DB_ID: "1sONUu-uxPHsp-VuNxa3d1pM7x_HdNBjftRjLE0BI9KA",
  PPQ_ID: "1DMnmURWX1A1F8gQU1-VGmB-ne5CHbwUCgprUOW--DWw",
  PDF_LINK_COL: 50,
  UPLOAD_FOLDER_ID: "1cZa77euPdeDmFnxWQMFO2Vp-VKtr8dwK",
  TEACHERS: [
    "pcleveng@amersol.edu.pe",
    "clevermathematics@gmail.com"
  ]
};

// Convenience aliases (keep existing references working)
var DB_ID = CONFIG.DB_ID;
var PPQ_ID = CONFIG.PPQ_ID;
var PDF_LINK_COL = CONFIG.PDF_LINK_COL;

function doGet(e) {
  var page = e.parameter.page;

  if (page === 'stats') {
    return HtmlService.createTemplateFromFile('Stats')
        .evaluate()
        .setTitle('CleverMastery 📊')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // Default to Index (Reflection)
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('CleverReflection Portal')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}