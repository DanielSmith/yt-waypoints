// Order intentionally retains the original shared-page scenarios. Expectations
// belong to each feature; adding coverage can update its count without a cap.
module.exports = [
  { name: "seeking", expectedCases: 15, run: require("./cases/seeking.cjs") },
  { name: "markers", expectedCases: 8, run: require("./cases/markers.cjs") },
  { name: "help", expectedCases: 9, run: require("./cases/help.cjs") },
  { name: "dialogs", expectedCases: 2, run: require("./cases/dialogs.cjs") },
  { name: "settings", expectedCases: 10, run: require("./cases/settings.cjs") },
  { name: "editor", expectedCases: 3, run: require("./cases/editor.cjs") },
  { name: "annotations", expectedCases: 3, run: require("./cases/annotation-preview.cjs") },
  { name: "customThemes", expectedCases: 3, run: require("./cases/theme-library.cjs") },
];
