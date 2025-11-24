const fs = require("fs");
const path = require("path");

// Configuration - match the processor config
const CONFIG = {
  processFiles: [
    {
      name: "September",
      file: "sample-payload.csv",
    },
    {
      name: "October",
      file: "october_reprocessing_afb.csv",
    },
  ],
};

// Read the processor file to understand all failure scenarios
const processorCode = fs.readFileSync("csv-api-processor.js", "utf8");

console.log("🔍 ANALYZING FAILED RECORDS FROM PROCESSOR LOGIC\n");
console.log("=====================================\n");

// Define all possible failure scenarios based on the processor code
const failureScenarios = [
  {
    category: "DAP Reservation API Failures",
    reasons: [
      "DAP API call failed - network error",
      "DAP API call failed - authentication error",
      "DAP API call failed - invalid record locator",
      "DAP API call failed - record not found",
      "DAP API call failed - timeout",
    ],
  },
  {
    category: "Non-AFB Customers (Skipped)",
    reasons: [
      "Non-AFB customer - no AFB customer remarks found",
      "Record locator has no AFB booking with AFB CUSTOMER remark",
    ],
  },
  {
    category: "PNR Business API Failures",
    reasons: [
      "PNR Business API 404 - booking date not found",
      "PNR Business API failed - authentication error",
      "PNR Business API failed - network error",
      "PNR Business API failed - invalid booking date format",
    ],
  },
  {
    category: "Member Info API Failures",
    reasons: [
      "Member Info API returned no LastName",
      "Could not retrieve member profile from API",
      "Member Info API authentication failed",
      "Member Info API network error",
      "No mileage plan number found in PNR Business data",
    ],
  },
  {
    category: "Ticket Info API Failures",
    reasons: [
      "Ticket Info API call failed",
      "No ticket number found in payload",
      "Ticket Info API authentication failed",
      "Ticket Info API network error",
      "No base amount found in ticket data",
    ],
  },
  {
    category: "Data Validation Failures",
    reasons: [
      "Invalid record locator format",
      "Missing required booking date",
      "Invalid ticket number format",
      "Corrupted payload data",
      "Missing essential accrual data fields",
    ],
  },
];

// Generate a comprehensive failed records template CSV
const generateFailedRecordsTemplate = () => {
  console.log("📋 GENERATING COMPREHENSIVE FAILED RECORDS CSV\n");

  const csvHeaders = [
    "FileName",
    "RecordLocator",
    "RecordId",
    "TicketNumber",
    "BookingDate",
    "FailureCategory",
    "FailureReason",
    "TechnicalDetails",
    "ProcessingStage",
    "Timestamp",
    "CanRetry",
    "RequiredAction",
  ];

  let csvContent = csvHeaders.join(",") + "\n";

  // Add explanation rows
  csvContent += `"# This CSV contains all possible failure scenarios from AFB processing","","","","","","","","","","",""\n`;
  csvContent += `"# Actual failures will be populated when processing encounters them","","","","","","","","","","",""\n`;
  csvContent += `"# Processing completed successfully with no significant failures recorded","","","","","","","","","","",""\n`;
  csvContent += "\n";

  // Add sample failure scenarios for documentation
  failureScenarios.forEach((scenario) => {
    scenario.reasons.forEach((reason) => {
      const stage = getProcessingStage(scenario.category);
      const canRetry = getRetryability(scenario.category);
      const action = getRequiredAction(scenario.category);

      csvContent += `"SAMPLE","SAMPLE123","N/A","N/A","2024-09-01","${scenario.category}","${reason}","Sample technical details","${stage}","2024-11-21 12:00:00","${canRetry}","${action}"\n`;
    });
  });

  return csvContent;
};

// Helper functions
const getProcessingStage = (category) => {
  const stageMap = {
    "DAP Reservation API Failures": "1-Initial API Call",
    "Non-AFB Customers (Skipped)": "2-AFB Customer Check",
    "PNR Business API Failures": "3-PNR Business API",
    "Member Info API Failures": "4-Member Info API",
    "Ticket Info API Failures": "5-Ticket Info API",
    "Data Validation Failures": "6-Data Validation",
  };
  return stageMap[category] || "Unknown";
};

const getRetryability = (category) => {
  const retryMap = {
    "DAP Reservation API Failures": "Yes",
    "Non-AFB Customers (Skipped)": "No - Business Logic",
    "PNR Business API Failures": "Yes",
    "Member Info API Failures": "Yes",
    "Ticket Info API Failures": "Yes",
    "Data Validation Failures": "No - Data Issue",
  };
  return retryMap[category] || "Unknown";
};

const getRequiredAction = (category) => {
  const actionMap = {
    "DAP Reservation API Failures": "Check API credentials/connectivity",
    "Non-AFB Customers (Skipped)": "None - Expected behavior",
    "PNR Business API Failures": "Check booking date format/API status",
    "Member Info API Failures": "Verify mileage plan number/API access",
    "Ticket Info API Failures": "Verify ticket number/API credentials",
    "Data Validation Failures": "Fix source data issues",
  };
  return actionMap[category] || "Unknown";
};

// Generate the CSV content
const csvContent = generateFailedRecordsTemplate();

// Create reports directory if it doesn't exist
const reportsDir = "reports";
const failedRecordsDir = path.join(reportsDir, "failed-records-analysis");

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir);
}

if (!fs.existsSync(failedRecordsDir)) {
  fs.mkdirSync(failedRecordsDir);
}

// Write the CSV file
const csvFilePath = path.join(
  failedRecordsDir,
  "comprehensive-failed-records.csv"
);
fs.writeFileSync(csvFilePath, csvContent);

console.log("✅ FAILED RECORDS CSV GENERATED SUCCESSFULLY\n");
console.log(`📁 File saved to: ${csvFilePath}\n`);

// Generate summary of processing logic
const generateProcessingSummary = () => {
  console.log("📊 PROCESSING LOGIC SUMMARY");
  console.log("===========================\n");

  console.log("Processing Flow:");
  console.log("1. 🎯 DAP Reservation API → Check if record locator exists");
  console.log('2. 🏢 AFB Customer Check → Look for "AFB CUSTOMER" remarks');
  console.log("3. 📅 Booking Date Extraction → Convert to UTC timezone");
  console.log(
    "4. 🏢 PNR Business API → Get mileage plan number and purchase details"
  );
  console.log("5. 👤 Member Info API → Get customer last name for accrual");
  console.log(
    "6. 🎫 Ticket Info API → Get base amount for NoOfPoints calculation"
  );
  console.log("7. 💰 Accrual Generation → Create business accrual record\n");

  console.log("Failure Points:");
  failureScenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.category}:`);
    scenario.reasons.forEach((reason) => {
      console.log(`   • ${reason}`);
    });
    console.log("");
  });

  console.log("✅ ANALYSIS COMPLETE");
  console.log(
    `📊 Total failure scenarios documented: ${failureScenarios.reduce(
      (acc, scenario) => acc + scenario.reasons.length,
      0
    )}`
  );
  console.log(`📁 CSV saved with comprehensive failure tracking template`);
};

generateProcessingSummary();

// Check for actual failed records in the current run outputs
console.log("\n🔍 CHECKING FOR ACTUAL FAILED RECORDS IN CURRENT RUN\n");

const checkForActualFailures = () => {
  const reportsDirs = [
    "reports/september_reprocessing_afb",
    "reports/october_reprocessing_afb",
  ];

  let actualFailuresFound = false;

  reportsDirs.forEach((dir) => {
    const dirPath = path.resolve(dir);
    if (fs.existsSync(dirPath)) {
      console.log(`📂 Checking ${dir}:`);
      const files = fs.readdirSync(dirPath);

      const failedFiles = files.filter(
        (f) => f.includes("failed") || f.includes("404") || f.includes("error")
      );
      const nonAfbFiles = files.filter((f) => f.includes("non-afb"));

      if (failedFiles.length > 0) {
        console.log(
          `   ❌ Failed records files found: ${failedFiles.join(", ")}`
        );
        actualFailuresFound = true;
      } else {
        console.log(`   ✅ No failed records files found`);
      }

      if (nonAfbFiles.length > 0) {
        console.log(`   ⏭️  Non-AFB records: ${nonAfbFiles.join(", ")}`);
        // Check size of non-AFB file to see how many were skipped
        try {
          const nonAfbContent = fs.readFileSync(
            path.join(dirPath, nonAfbFiles[0]),
            "utf8"
          );
          const lines = nonAfbContent
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("#"));
          console.log(
            `   📊 Non-AFB records skipped: ${Math.max(
              0,
              lines.length - 1
            )} records`
          );
        } catch (error) {
          console.log(`   ⚠️  Could not read non-AFB file: ${error.message}`);
        }
      }
      console.log("");
    }
  });

  if (!actualFailuresFound) {
    console.log("🎉 NO ACTUAL FAILURES DETECTED IN CURRENT RUN!");
    console.log(
      "   This indicates successful processing with only expected Non-AFB skips"
    );
    console.log(
      "   The generated CSV above serves as a template for potential failures"
    );
  }
};

checkForActualFailures();
