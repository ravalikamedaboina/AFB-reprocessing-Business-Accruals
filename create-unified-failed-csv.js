const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// Create unified failed records CSV by combining all failure categories
const createUnifiedFailedRecordsCSV = async () => {
  console.log("🔍 CREATING UNIFIED FAILED RECORDS CSV\n");
  console.log("=====================================\n");

  const unifiedFailedRecords = [];

  // Define CSV headers
  const headers = [
    "SourceFile",
    "RecordLocator",
    "RecordId",
    "TicketNumber",
    "BookingDate",
    "ProcessingStage",
    "FailureCategory",
    "FailureReason",
    "TechnicalDetails",
    "CanRetry",
    "RequiredAction",
    "Timestamp",
    "OriginalName",
    "OriginalDescription",
  ];

  // Function to add records to unified list
  const addFailedRecord = (
    sourceFile,
    record,
    stage,
    category,
    reason,
    technical = "",
    retry = "Unknown",
    action = "Unknown"
  ) => {
    unifiedFailedRecords.push({
      SourceFile: sourceFile,
      RecordLocator: record.RecordLocator || record.recordLocator || "N/A",
      RecordId: record.RecordId || record.id || "N/A",
      TicketNumber:
        record.TicketNumber ||
        record.ticketNumber ||
        record.specificTicketNumber ||
        "N/A",
      BookingDate: record.BookingDate || record.bookingDate || "N/A",
      ProcessingStage: stage,
      FailureCategory: category,
      FailureReason: reason,
      TechnicalDetails: technical,
      CanRetry: retry,
      RequiredAction: action,
      Timestamp: new Date().toISOString(),
      OriginalName: record.Name || record.name || "N/A",
      OriginalDescription: record.Description || record.description || "N/A",
    });
  };

  // 1. Read Non-AFB records from September
  console.log("📂 Processing September Non-AFB records...");
  const septNonAfbPath =
    "reports/september_reprocessing_afb/non-afb-records.csv";
  if (fs.existsSync(septNonAfbPath)) {
    const septNonAfbRecords = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(septNonAfbPath)
        .pipe(csv())
        .on("data", (row) => {
          septNonAfbRecords.push(row);
        })
        .on("end", () => {
          septNonAfbRecords.forEach((record) => {
            addFailedRecord(
              "September",
              record,
              "2-AFB Customer Check",
              "Non-AFB Customer (Expected Skip)",
              "No AFB CUSTOMER remark found in booking",
              "Record processed successfully but is not an AFB customer",
              "No - Business Logic",
              "None - Expected behavior for non-business customers"
            );
          });
          console.log(
            `   ✅ Added ${septNonAfbRecords.length} September Non-AFB records`
          );
          resolve();
        })
        .on("error", reject);
    });
  } else {
    console.log("   ⚠️  No September Non-AFB records file found");
  }

  // 2. Read Non-AFB records from October
  console.log("📂 Processing October Non-AFB records...");
  const octNonAfbPath = "reports/october_reprocessing_afb/non-afb-records.csv";
  if (fs.existsSync(octNonAfbPath)) {
    const octNonAfbRecords = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(octNonAfbPath)
        .pipe(csv())
        .on("data", (row) => {
          octNonAfbRecords.push(row);
        })
        .on("end", () => {
          octNonAfbRecords.forEach((record) => {
            addFailedRecord(
              "October",
              record,
              "2-AFB Customer Check",
              "Non-AFB Customer (Expected Skip)",
              "No AFB CUSTOMER remark found in booking",
              "Record processed successfully but is not an AFB customer",
              "No - Business Logic",
              "None - Expected behavior for non-business customers"
            );
          });
          console.log(
            `   ✅ Added ${octNonAfbRecords.length} October Non-AFB records`
          );
          resolve();
        })
        .on("error", reject);
    });
  } else {
    console.log("   ⚠️  No October Non-AFB records file found");
  }

  // 3. Check for other failure files (these would be actual failures)
  console.log("📂 Checking for other failure record files...");

  const failureFiles = [
    {
      path: "reports/september_reprocessing_afb/pnr-404-records.csv",
      type: "PNR 404 Error",
    },
    {
      path: "reports/september_reprocessing_afb/member-info-failed-records.csv",
      type: "Member Info Failed",
    },
    {
      path: "reports/september_reprocessing_afb/ticket-info-failed-records.csv",
      type: "Ticket Info Failed",
    },
    {
      path: "reports/october_reprocessing_afb/pnr-404-records.csv",
      type: "PNR 404 Error",
    },
    {
      path: "reports/october_reprocessing_afb/member-info-failed-records.csv",
      type: "Member Info Failed",
    },
    {
      path: "reports/october_reprocessing_afb/ticket-info-failed-records.csv",
      type: "Ticket Info Failed",
    },
  ];

  let actualFailuresFound = 0;

  for (const failureFile of failureFiles) {
    if (fs.existsSync(failureFile.path)) {
      console.log(`   📄 Found: ${failureFile.path}`);
      // Read and process failure file
      const failureRecords = [];

      await new Promise((resolve, reject) => {
        fs.createReadStream(failureFile.path)
          .pipe(csv())
          .on("data", (row) => {
            failureRecords.push(row);
          })
          .on("end", () => {
            const sourceFile = failureFile.path.includes("september")
              ? "September"
              : "October";
            const stage = getStageFromFileType(failureFile.type);
            const category = getCategoryFromFileType(failureFile.type);

            failureRecords.forEach((record) => {
              addFailedRecord(
                sourceFile,
                record,
                stage,
                category,
                record.reason || `${failureFile.type} - see technical details`,
                record.APIError ||
                  record.originalData ||
                  "See original record data",
                "Yes",
                getActionFromFileType(failureFile.type)
              );
            });

            actualFailuresFound += failureRecords.length;
            console.log(
              `   ✅ Added ${failureRecords.length} ${failureFile.type} records from ${sourceFile}`
            );
            resolve();
          })
          .on("error", reject);
      });
    }
  }

  if (actualFailuresFound === 0) {
    console.log(
      "   ✅ No actual failure files found - processing was highly successful!"
    );
  }

  // 4. Add summary of successful AFB processing for context
  console.log("📂 Adding successful AFB processing context...");

  // Read successful AFB accrual counts
  const septAccrualsPath =
    "reports/september_reprocessing_afb/afb-accrual-records.csv";
  const octAccrualsPath =
    "reports/october_reprocessing_afb/afb-accrual-records.csv";

  let septSuccessCount = 0;
  let octSuccessCount = 0;

  if (fs.existsSync(septAccrualsPath)) {
    const septContent = fs.readFileSync(septAccrualsPath, "utf8");
    septSuccessCount =
      septContent
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("﻿")).length - 1; // Subtract header
  }

  if (fs.existsSync(octAccrualsPath)) {
    const octContent = fs.readFileSync(octAccrualsPath, "utf8");
    octSuccessCount =
      octContent
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("﻿")).length - 1; // Subtract header
  }

  // Add summary records for context
  addFailedRecord(
    "SUMMARY",
    {
      RecordLocator: "PROCESSING_SUMMARY",
      RecordId: "CONTEXT",
      TicketNumber: "ALL",
      BookingDate: "2024-09-01 to 2024-10-31",
    },
    "7-Processing Complete",
    "Success Summary",
    `Successfully created ${septSuccessCount} September + ${octSuccessCount} October = ${
      septSuccessCount + octSuccessCount
    } total AFB accrual records`,
    `Processing completed with ${unifiedFailedRecords.length} non-AFB skips and ${actualFailuresFound} actual failures`,
    "N/A - Success",
    "None - Processing completed successfully"
  );

  // 5. Generate CSV content
  console.log("\n📝 Generating unified CSV file...");

  let csvContent = headers.join(",") + "\n";

  // Add all failed/skipped records
  unifiedFailedRecords.forEach((record) => {
    const row = headers
      .map((header) => {
        let value = record[header] || "";
        // Escape commas and quotes in CSV values
        if (
          typeof value === "string" &&
          (value.includes(",") || value.includes('"') || value.includes("\n"))
        ) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",");

    csvContent += row + "\n";
  });

  // 6. Save unified CSV file
  const outputDir = "reports/failed-records-analysis";
  if (!fs.existsSync("reports")) fs.mkdirSync("reports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const outputFile = path.join(outputDir, "unified-failed-records.csv");
  fs.writeFileSync(outputFile, csvContent);

  console.log("✅ UNIFIED FAILED RECORDS CSV CREATED SUCCESSFULLY\n");
  console.log(`📁 File saved to: ${outputFile}\n`);

  // 7. Generate summary statistics
  console.log("📊 PROCESSING SUMMARY STATISTICS");
  console.log("================================\n");

  const categoryStats = {};
  unifiedFailedRecords.forEach((record) => {
    const category = record.FailureCategory;
    if (!categoryStats[category]) {
      categoryStats[category] = 0;
    }
    categoryStats[category]++;
  });

  Object.entries(categoryStats).forEach(([category, count]) => {
    console.log(`${category}: ${count} records`);
  });

  console.log(`\nTotal records in unified CSV: ${unifiedFailedRecords.length}`);
  console.log(`Actual processing failures: ${actualFailuresFound}`);
  console.log(
    `Expected non-AFB skips: ${
      unifiedFailedRecords.length - actualFailuresFound - 1
    }`
  ); // -1 for summary record
  console.log(
    `Successful AFB accrual records: ${septSuccessCount + octSuccessCount}`
  );

  const totalRecordsProcessed =
    unifiedFailedRecords.length + septSuccessCount + octSuccessCount - 1; // -1 for summary
  const successRate = (
    ((septSuccessCount + octSuccessCount) / totalRecordsProcessed) *
    100
  ).toFixed(2);

  console.log(
    `\n🎯 SUCCESS RATE: ${successRate}% (${
      septSuccessCount + octSuccessCount
    } successful out of ${totalRecordsProcessed} total records)`
  );
  console.log(
    `📈 AFB DETECTION: ${
      septSuccessCount + octSuccessCount
    } AFB customers found and processed`
  );
  console.log(
    `⚡ FAILURE RATE: ${(
      (actualFailuresFound / totalRecordsProcessed) *
      100
    ).toFixed(2)}% (${actualFailuresFound} actual failures)`
  );
};

// Helper functions
const getStageFromFileType = (type) => {
  const stageMap = {
    "PNR 404 Error": "3-PNR Business API",
    "Member Info Failed": "4-Member Info API",
    "Ticket Info Failed": "5-Ticket Info API",
  };
  return stageMap[type] || "Unknown";
};

const getCategoryFromFileType = (type) => {
  const categoryMap = {
    "PNR 404 Error": "PNR Business API Failure",
    "Member Info Failed": "Member Info API Failure",
    "Ticket Info Failed": "Ticket Info API Failure",
  };
  return categoryMap[type] || "Unknown Failure";
};

const getActionFromFileType = (type) => {
  const actionMap = {
    "PNR 404 Error":
      "Check booking date format and PNR Business API availability",
    "Member Info Failed":
      "Verify mileage plan number and Member Info API access",
    "Ticket Info Failed":
      "Verify ticket number format and Ticket Info API credentials",
  };
  return actionMap[type] || "Unknown action required";
};

// Run the unified CSV generation
createUnifiedFailedRecordsCSV().catch(console.error);
