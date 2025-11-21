/**
 * Test MRGESV record processing with the main processor
 * This tests the multi-booking AFB fix end-to-end
 */

const fs = require("fs");
const csv = require("csv-parser");
const processor = require("./csv-api-processor");

async function testMRGESVProcessing() {
  console.log("🧪 Testing MRGESV record processing...\n");

  // Create a minimal CSV with just the MRGESV record
  const mrgesvRecord = {
    operation_Id: "TEST",
    "timestamp [UTC]": "2025-01-03T20:00:00Z",
    payload: `{"Passenger":{"recordLocator":"MRGESV","ticketDetails":[{"ticketNumber":"0274425237176","dateTicketIssuedCT":"2025-09-26T22:37:00"}]}}`,
  };

  // Create temporary CSV file
  const testCsvPath = "./test-mrgesv.csv";
  const headers = "operation_Id,timestamp [UTC],payload";
  const csvContent = `${headers}\n${mrgesvRecord.operation_Id},"${
    mrgesvRecord["timestamp [UTC]"]
  }","${mrgesvRecord.payload.replace(/"/g, '""')}"`;

  fs.writeFileSync(testCsvPath, csvContent);
  console.log(`📄 Created test CSV: ${testCsvPath}`);

  try {
    // Override the CONFIG to use our test file
    const originalConfig = require("./csv-api-processor").CONFIG;
    if (originalConfig) {
      originalConfig.csvFiles = [testCsvPath];
      originalConfig.testMode = true;
      originalConfig.testModeLimit = 1;
    }

    console.log("🚀 Starting processor test...\n");

    // Call the main processor
    await processor.processCsvAndCallAPI();
  } catch (error) {
    console.error("💥 Error during processing:", error.message);
  } finally {
    // Clean up
    if (fs.existsSync(testCsvPath)) {
      fs.unlinkSync(testCsvPath);
      console.log(`🗑️ Cleaned up test file: ${testCsvPath}`);
    }
  }
}

// Run the test
if (require.main === module) {
  testMRGESVProcessing()
    .then(() => {
      console.log("\n✅ MRGESV processing test complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 MRGESV processing test failed:", error.message);
      process.exit(1);
    });
}
