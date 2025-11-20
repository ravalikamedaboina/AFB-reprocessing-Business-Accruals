// Output file configuration for csv-api-processor.js
// This module provides dynamic output file paths for each CSV file processed
const path = require("path");

function getOutputFiles(csvFile) {
  // Extract month and year from CSV filename (e.g., 'october_reprocessing_afb.csv')
  const baseName = path.basename(csvFile, ".csv");
  const reportDir = path.join(__dirname, "reports", baseName);

  return {
    accrualsCsv: path.join(reportDir, "afb-accrual-records.csv"),
    failedCsv: path.join(reportDir, "failed-records.csv"),
    customers: path.join(reportDir, "afb-customers-only.json"),
    accruals: path.join(reportDir, "afb-accrual-records.json"),
  };
}

module.exports = {
  getOutputFiles,
};
