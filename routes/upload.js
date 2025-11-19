const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Accrual = require("../models/Accrual");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_PATH || "./uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
  },
  fileFilter: (req, file, cb) => {
    // Allow CSV, Excel, and common document types
    const allowedTypes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Allowed types: CSV, Excel, PDF, Word documents"
        ),
        false
      );
    }
  },
});

// Bulk upload accruals from CSV/Excel
router.post("/bulk-import", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let records = [];

    try {
      if (fileExt === ".csv") {
        // Parse CSV file
        records = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", (data) => results.push(data))
            .on("end", () => resolve(results))
            .on("error", reject);
        });
      } else if (fileExt === ".xlsx" || fileExt === ".xls") {
        // Parse Excel file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        records = XLSX.utils.sheet_to_json(worksheet);
      } else {
        throw new Error("Unsupported file format");
      }

      // Validate and process records
      const results = {
        success: 0,
        errors: [],
        warnings: [],
      };

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const rowNum = i + 2; // Account for header row

        try {
          // Map CSV/Excel columns to accrual fields
          const accrualData = {
            businessUnit: record["Business Unit"] || record.businessUnit,
            department: record["Department"] || record.department,
            amount: parseFloat(record["Amount"] || record.amount),
            currency: record["Currency"] || record.currency || "USD",
            accountCode: record["Account Code"] || record.accountCode,
            costCenter: record["Cost Center"] || record.costCenter,
            accrualDate: new Date(record["Accrual Date"] || record.accrualDate),
            periodStart: new Date(record["Period Start"] || record.periodStart),
            periodEnd: new Date(record["Period End"] || record.periodEnd),
            description: record["Description"] || record.description,
            category: record["Category"] || record.category,
            subcategory: record["Subcategory"] || record.subcategory,
            submittedBy: req.user._id,
            createdBy: req.user._id,
          };

          // Validate required fields
          const requiredFields = [
            "businessUnit",
            "department",
            "amount",
            "accountCode",
            "costCenter",
            "accrualDate",
            "periodStart",
            "periodEnd",
            "description",
            "category",
          ];
          const missingFields = requiredFields.filter(
            (field) => !accrualData[field]
          );

          if (missingFields.length > 0) {
            results.errors.push({
              row: rowNum,
              error: `Missing required fields: ${missingFields.join(", ")}`,
            });
            continue;
          }

          // Validate data types
          if (isNaN(accrualData.amount) || accrualData.amount < 0) {
            results.errors.push({
              row: rowNum,
              error: "Invalid amount value",
            });
            continue;
          }

          if (
            isNaN(accrualData.accrualDate.getTime()) ||
            isNaN(accrualData.periodStart.getTime()) ||
            isNaN(accrualData.periodEnd.getTime())
          ) {
            results.errors.push({
              row: rowNum,
              error: "Invalid date format",
            });
            continue;
          }

          // Generate unique accrual ID
          const currentYear = new Date().getFullYear();
          const count = (await Accrual.countDocuments()) + results.success + 1;
          accrualData.accrualId = `AFB-${currentYear}-${count
            .toString()
            .padStart(5, "0")}`;

          // Create accrual
          const accrual = new Accrual(accrualData);
          await accrual.save();
          results.success++;
        } catch (error) {
          results.errors.push({
            row: rowNum,
            error: error.message,
          });
        }
      }

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      res.json({
        message: "Bulk import completed",
        results: {
          totalProcessed: records.length,
          successful: results.success,
          errors: results.errors.length,
          details: results,
        },
      });
    } catch (parseError) {
      // Clean up uploaded file on parse error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw parseError;
    }
  } catch (error) {
    console.error("Bulk import error:", error);
    res.status(500).json({
      message: "Bulk import failed",
      error: error.message,
    });
  }
});

// Process CSV payload and make Alaska Airlines API calls
router.post(
  "/process-payload-api",
  auth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt !== ".csv") {
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        return res
          .status(400)
          .json({ message: "Only CSV files are supported for this operation" });
      }

      try {
        // Parse CSV file and extract payload column with record locators
        const processedData = await new Promise((resolve, reject) => {
          const results = [];
          const recordLocators = [];

          fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", (data) => {
              results.push(data);

              // Extract payload column (try different possible column names)
              const payload =
                data.payload ||
                data.Payload ||
                data.PAYLOAD ||
                data.Payload_Data ||
                data.payload_data ||
                data.data ||
                data.Data ||
                data.content ||
                data.Content;

              if (payload !== undefined && payload !== null && payload !== "") {
                try {
                  // Parse JSON payload
                  const parsedPayload = JSON.parse(payload);

                  // Extract record locator from various possible locations
                  let recordLocator = null;
                  let bookingDate = null;
                  let departureDate = null;
                  let passengerInfo = null;
                  let flightInfo = null;
                  let nonAirAccrualData = null;

                  // Extract record locator
                  if (
                    parsedPayload.Passenger &&
                    parsedPayload.Passenger.recordLocator
                  ) {
                    recordLocator = parsedPayload.Passenger.recordLocator;
                  } else if (parsedPayload.recordLocator) {
                    recordLocator = parsedPayload.recordLocator;
                  } else if (parsedPayload.record_locator) {
                    recordLocator = parsedPayload.record_locator;
                  } else if (parsedPayload.RecordLocator) {
                    recordLocator = parsedPayload.RecordLocator;
                  }

                  // Extract booking date from various possible locations
                  if (parsedPayload.bookingDate) {
                    bookingDate = parsedPayload.bookingDate;
                  } else if (parsedPayload.booking_date) {
                    bookingDate = parsedPayload.booking_date;
                  } else if (parsedPayload.BookingDate) {
                    bookingDate = parsedPayload.BookingDate;
                  } else if (
                    parsedPayload.Passenger &&
                    parsedPayload.Passenger.bookingDate
                  ) {
                    bookingDate = parsedPayload.Passenger.bookingDate;
                  } else if (
                    parsedPayload.ticketDetails &&
                    parsedPayload.ticketDetails[0] &&
                    parsedPayload.ticketDetails[0].dateTicketIssuedCT
                  ) {
                    bookingDate =
                      parsedPayload.ticketDetails[0].dateTicketIssuedCT;
                  }

                  // Extract departure date
                  if (parsedPayload.departureDateStnLocal) {
                    departureDate = parsedPayload.departureDateStnLocal;
                  } else if (parsedPayload.departure_date) {
                    departureDate = parsedPayload.departure_date;
                  } else if (parsedPayload.DepartureDate) {
                    departureDate = parsedPayload.DepartureDate;
                  }

                  // Extract passenger information
                  if (parsedPayload.Passenger) {
                    passengerInfo = {
                      firstName: parsedPayload.Passenger.firstName,
                      lastName: parsedPayload.Passenger.lastName,
                      marketingAirline:
                        parsedPayload.Passenger.marketingAirline,
                      marketingFlightNumber:
                        parsedPayload.Passenger.marketingFlightNumber,
                      boardingStatus: parsedPayload.Passenger.boardingStatus,
                    };
                  }

                  // Extract flight information
                  flightInfo = {
                    flightNumber: parsedPayload.flightNumber,
                    operatingAirline: parsedPayload.operatingAirline,
                    originStation: parsedPayload.originStation,
                    destinationStation: parsedPayload.destinationStation,
                    processType: parsedPayload.processType,
                  };

                  // Extract non-air accrual specific data
                  nonAirAccrualData = {
                    eventBusinessKey: parsedPayload.eventBusinessKey,
                    voEventType: parsedPayload.voEventType,
                    voOpsType: parsedPayload.voOpsType,
                    voEventBusinessKey: parsedPayload.voEventBusinessKey,
                    voDestination: parsedPayload.voDestination,
                    voOrigin: parsedPayload.voOrigin,
                    voSchedDestination: parsedPayload.voSchedDestination,
                    voSchedOrigin: parsedPayload.voSchedOrigin,
                    voFlightNumber: parsedPayload.voFlightNumber,
                    IsEasyBiz: parsedPayload.IsEasyBiz,
                    Id: parsedPayload.Id,
                  };

                  if (recordLocator) {
                    recordLocators.push({
                      row: results.length,
                      recordLocator: recordLocator,
                      bookingDate: bookingDate,
                      departureDate: departureDate,
                      passengerInfo: passengerInfo,
                      flightInfo: flightInfo,
                      nonAirAccrualData: nonAirAccrualData,
                      fullPayload: parsedPayload,
                      originalPayload: payload,
                    });
                  }
                } catch (jsonError) {
                  console.warn(
                    `Failed to parse JSON payload in row ${results.length}:`,
                    jsonError.message
                  );
                }
              }
            })
            .on("end", () => {
              resolve({
                totalRows: results.length,
                recordLocators: recordLocators,
                headers: results.length > 0 ? Object.keys(results[0]) : [],
              });
            })
            .on("error", reject);
        });

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        if (processedData.recordLocators.length === 0) {
          return res.json({
            message: "No record locators found in payload data",
            totalRows: processedData.totalRows,
            headers: processedData.headers,
            recordLocators: [],
            apiResults: [],
          });
        }

        // Make API calls for each record locator
        const apiResults = [];
        const API_KEY = "8fa1ef7cdaff40a6afa90ead0b9d8dc4"; // Alaska Airlines API key

        for (const item of processedData.recordLocators) {
          try {
            const apiUrl = `https://apis.alaskaair.com/aag/1/guestServices/bookings/search/byrecordlocator?includeInActive=true&recordlocator=${item.recordLocator}`;

            const apiResponse = await axios.get(apiUrl, {
              headers: {
                recordlocator: item.recordLocator,
                "Ocp-Apim-Subscription-Key": API_KEY,
              },
              timeout: 30000, // 30 second timeout
            });

            apiResults.push({
              row: item.row,
              recordLocator: item.recordLocator,
              apiSuccess: true,
              apiResponse: apiResponse.data,
              statusCode: apiResponse.status,
            });
          } catch (apiError) {
            apiResults.push({
              row: item.row,
              recordLocator: item.recordLocator,
              apiSuccess: false,
              apiError: {
                message: apiError.message,
                statusCode: apiError.response?.status,
                statusText: apiError.response?.statusText,
                data: apiError.response?.data,
              },
            });
          }

          // Small delay between API calls to be respectful
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        res.json({
          message: "CSV payload processing completed",
          totalRows: processedData.totalRows,
          recordLocatorsFound: processedData.recordLocators.length,
          apiCallsCompleted: apiResults.length,
          results: {
            recordLocators: processedData.recordLocators.map((item) => ({
              row: item.row,
              recordLocator: item.recordLocator,
            })),
            apiResults: apiResults,
          },
          summary: {
            successful: apiResults.filter((r) => r.apiSuccess).length,
            failed: apiResults.filter((r) => !r.apiSuccess).length,
          },
        });
      } catch (parseError) {
        // Clean up uploaded file on parse error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw parseError;
      }
    } catch (error) {
      console.error("CSV payload processing error:", error);
      res.status(500).json({
        message: "CSV payload processing failed",
        error: error.message,
      });
    }
  }
);

// Upload attachment for accrual
router.post(
  "/attachment/:accrualId",
  auth,
  upload.single("attachment"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const accrual = await Accrual.findById(req.params.accrualId);
      if (!accrual) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Accrual not found" });
      }

      // Check if user can attach files to this accrual
      if (
        accrual.submittedBy.toString() !== req.user._id.toString() &&
        !req.user.hasPermission("edit_accruals")
      ) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ message: "Access denied" });
      }

      // Add attachment to accrual
      const attachment = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
        uploadDate: new Date(),
      };

      accrual.attachments.push(attachment);
      await accrual.save();

      res.json({
        message: "Attachment uploaded successfully",
        attachment: attachment,
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error("Attachment upload error:", error);
      res.status(500).json({ message: "Attachment upload failed" });
    }
  }
);

// Download attachment
router.get("/attachment/:accrualId/:attachmentId", auth, async (req, res) => {
  try {
    const accrual = await Accrual.findById(req.params.accrualId);
    if (!accrual) {
      return res.status(404).json({ message: "Accrual not found" });
    }

    // Check access permissions
    if (
      !req.user.hasPermission("view_all_accruals") &&
      accrual.submittedBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const attachment = accrual.attachments.id(req.params.attachmentId);
    if (!attachment) {
      return res.status(404).json({ message: "Attachment not found" });
    }

    // Check if file exists
    if (!fs.existsSync(attachment.path)) {
      return res.status(404).json({ message: "File not found on server" });
    }

    // Set appropriate headers
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.originalName}"`
    );
    res.setHeader("Content-Type", "application/octet-stream");

    // Stream file to response
    const fileStream = fs.createReadStream(attachment.path);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ message: "Download failed" });
  }
});

// Delete attachment
router.delete(
  "/attachment/:accrualId/:attachmentId",
  auth,
  async (req, res) => {
    try {
      const accrual = await Accrual.findById(req.params.accrualId);
      if (!accrual) {
        return res.status(404).json({ message: "Accrual not found" });
      }

      // Check permissions
      if (
        accrual.submittedBy.toString() !== req.user._id.toString() &&
        !req.user.hasPermission("edit_accruals")
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const attachment = accrual.attachments.id(req.params.attachmentId);
      if (!attachment) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      // Delete file from filesystem
      if (fs.existsSync(attachment.path)) {
        fs.unlinkSync(attachment.path);
      }

      // Remove attachment from accrual
      accrual.attachments.pull(req.params.attachmentId);
      await accrual.save();

      res.json({ message: "Attachment deleted successfully" });
    } catch (error) {
      console.error("Delete attachment error:", error);
      res.status(500).json({ message: "Delete attachment failed" });
    }
  }
);

// Read CSV file and extract payload column
router.post(
  "/read-csv-payload",
  auth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt !== ".csv") {
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        return res
          .status(400)
          .json({ message: "Only CSV files are supported for this operation" });
      }

      try {
        // Parse CSV file and extract payload column
        const payloadData = await new Promise((resolve, reject) => {
          const results = [];
          const payloads = [];

          fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", (data) => {
              results.push(data);

              // Extract payload column (try different possible column names)
              const payload =
                data.payload ||
                data.Payload ||
                data.PAYLOAD ||
                data.Payload_Data ||
                data.payload_data ||
                data.data ||
                data.Data ||
                data.content ||
                data.Content;

              if (payload !== undefined && payload !== null && payload !== "") {
                payloads.push({
                  row: results.length,
                  payload: payload,
                  originalData: data,
                });
              }
            })
            .on("end", () => {
              resolve({
                totalRows: results.length,
                payloadRows: payloads,
                headers: results.length > 0 ? Object.keys(results[0]) : [],
                rawData: results,
              });
            })
            .on("error", reject);
        });

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        // Check if payload column was found
        if (payloadData.payloadRows.length === 0) {
          return res.json({
            message: "No payload column found",
            totalRows: payloadData.totalRows,
            headers: payloadData.headers,
            suggestion:
              "Make sure your CSV has a column named 'payload', 'Payload', 'PAYLOAD', 'data', 'Data', 'content', or 'Content'",
            payloads: [],
          });
        }

        res.json({
          message: "CSV payload extraction completed successfully",
          totalRows: payloadData.totalRows,
          payloadCount: payloadData.payloadRows.length,
          headers: payloadData.headers,
          payloads: payloadData.payloadRows.map((item) => ({
            row: item.row,
            payload: item.payload,
          })),
          // Include full data for debugging if needed
          fullData:
            req.query.includeFullData === "true"
              ? payloadData.payloadRows
              : undefined,
        });
      } catch (parseError) {
        // Clean up uploaded file on parse error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw parseError;
      }
    } catch (error) {
      console.error("CSV payload extraction error:", error);
      res.status(500).json({
        message: "CSV payload extraction failed",
        error: error.message,
      });
    }
  }
);

// Parse CSV and get all available columns
router.post("/analyze-csv", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    if (fileExt !== ".csv") {
      // Clean up uploaded file
      fs.unlinkSync(filePath);
      return res
        .status(400)
        .json({ message: "Only CSV files are supported for this operation" });
    }

    try {
      // Parse CSV file to analyze structure
      const csvAnalysis = await new Promise((resolve, reject) => {
        const results = [];
        let headers = [];

        fs.createReadStream(filePath)
          .pipe(csv())
          .on("headers", (headerList) => {
            headers = headerList;
          })
          .on("data", (data) => {
            results.push(data);
          })
          .on("end", () => {
            // Analyze the data structure
            const columnAnalysis = {};

            if (results.length > 0) {
              const sampleData = results[0];
              Object.keys(sampleData).forEach((key) => {
                columnAnalysis[key] = {
                  sampleValue: sampleData[key],
                  dataType: isNaN(sampleData[key]) ? "string" : "number",
                  hasData:
                    sampleData[key] !== null &&
                    sampleData[key] !== undefined &&
                    sampleData[key] !== "",
                };
              });
            }

            resolve({
              totalRows: results.length,
              headers: Object.keys(results[0] || {}),
              columnAnalysis: columnAnalysis,
              sampleRows: results.slice(0, 5), // First 5 rows as sample
              possiblePayloadColumns: Object.keys(columnAnalysis).filter(
                (key) =>
                  key.toLowerCase().includes("payload") ||
                  key.toLowerCase().includes("data") ||
                  key.toLowerCase().includes("content")
              ),
            });
          })
          .on("error", reject);
      });

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      res.json({
        message: "CSV analysis completed successfully",
        analysis: csvAnalysis,
      });
    } catch (parseError) {
      // Clean up uploaded file on parse error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw parseError;
    }
  } catch (error) {
    console.error("CSV analysis error:", error);
    res.status(500).json({
      message: "CSV analysis failed",
      error: error.message,
    });
  }
});

// Download bulk import template
router.get("/template/:format", auth, (req, res) => {
  try {
    const { format } = req.params;

    const templateData = [
      {
        "Business Unit": "AFB",
        Department: "Finance",
        Amount: "1000.00",
        Currency: "USD",
        "Account Code": "4000-001",
        "Cost Center": "CC-001",
        "Accrual Date": "2024-01-15",
        "Period Start": "2024-01-01",
        "Period End": "2024-01-31",
        Description: "Monthly accrual for office supplies",
        Category: "Operations",
        Subcategory: "Office Supplies",
      },
    ];

    if (format === "csv") {
      const csvHeaders = Object.keys(templateData[0]).join(",");
      const csvRow = Object.values(templateData[0]).join(",");
      const csvContent = `${csvHeaders}\n${csvRow}`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=accruals_import_template.csv"
      );
      res.send(csvContent);
    } else if (format === "xlsx") {
      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Accruals");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=accruals_import_template.xlsx"
      );
      res.send(buffer);
    } else {
      res.status(400).json({ message: "Invalid format. Use csv or xlsx" });
    }
  } catch (error) {
    console.error("Template download error:", error);
    res.status(500).json({ message: "Template download failed" });
  }
});

// Test Alaska Airlines API with a specific record locator
router.get("/test-api/:recordLocator", auth, async (req, res) => {
  try {
    const { recordLocator } = req.params;
    const API_KEY = "8fa1ef7cdaff40a6afa90ead0b9d8dc4";

    const apiUrl = `https://apis.alaskaair.com/aag/1/guestServices/bookings/search/byrecordlocator?includeInActive=true&recordlocator=${recordLocator}`;

    const apiResponse = await axios.get(apiUrl, {
      headers: {
        recordlocator: recordLocator,
        "Ocp-Apim-Subscription-Key": API_KEY,
      },
      timeout: 30000,
    });

    res.json({
      message: "API call successful",
      recordLocator: recordLocator,
      statusCode: apiResponse.status,
      data: apiResponse.data,
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      message: "API call failed",
      recordLocator: req.params.recordLocator,
      error: {
        message: error.message,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      },
    });
  }
});

// Process CSV payload specifically for non-air accruals with booking dates and external codes
router.post(
  "/process-non-air-accruals",
  auth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt !== ".csv") {
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        return res
          .status(400)
          .json({ message: "Only CSV files are supported for this operation" });
      }

      try {
        // Parse CSV file and extract payload column for non-air accruals
        const processedData = await new Promise((resolve, reject) => {
          const results = [];
          const nonAirAccruals = [];

          fs.createReadStream(filePath)
            .pipe(csv())
            .on("data", (data) => {
              results.push(data);

              // Extract payload column
              const payload =
                data.payload ||
                data.Payload ||
                data.PAYLOAD ||
                data.Payload_Data ||
                data.payload_data ||
                data.data ||
                data.Data ||
                data.content ||
                data.Content;

              if (payload !== undefined && payload !== null && payload !== "") {
                try {
                  // Parse JSON payload
                  const parsedPayload = JSON.parse(payload);

                  // Extract non-air accrual specific information
                  const nonAirData = {
                    row: results.length,
                    recordLocator: null,
                    bookingDate: null,
                    departureDate: null,
                    externalCode: null,
                    processType: parsedPayload.processType,
                    eventBusinessKey: parsedPayload.eventBusinessKey,
                    voEventType: parsedPayload.voEventType,
                    voOpsType: parsedPayload.voOpsType,
                    voEventBusinessKey: parsedPayload.voEventBusinessKey,
                    isEasyBiz: parsedPayload.IsEasyBiz,
                    id: parsedPayload.Id,
                    originalPayload: payload,
                  };

                  // Extract record locator
                  if (
                    parsedPayload.Passenger &&
                    parsedPayload.Passenger.recordLocator
                  ) {
                    nonAirData.recordLocator =
                      parsedPayload.Passenger.recordLocator;
                  } else if (parsedPayload.recordLocator) {
                    nonAirData.recordLocator = parsedPayload.recordLocator;
                  }

                  // Extract booking date
                  if (parsedPayload.bookingDate) {
                    nonAirData.bookingDate = parsedPayload.bookingDate;
                  } else if (
                    parsedPayload.Passenger &&
                    parsedPayload.Passenger.bookingDate
                  ) {
                    nonAirData.bookingDate =
                      parsedPayload.Passenger.bookingDate;
                  } else if (
                    parsedPayload.ticketDetails &&
                    parsedPayload.ticketDetails[0]
                  ) {
                    nonAirData.bookingDate =
                      parsedPayload.ticketDetails[0].dateTicketIssuedCT;
                  }

                  // Extract departure date
                  if (parsedPayload.departureDateStnLocal) {
                    nonAirData.departureDate =
                      parsedPayload.departureDateStnLocal;
                  }

                  // Extract external code (could be from various fields)
                  if (parsedPayload.externalCode) {
                    nonAirData.externalCode = parsedPayload.externalCode;
                  } else if (parsedPayload.external_code) {
                    nonAirData.externalCode = parsedPayload.external_code;
                  } else if (parsedPayload.ExternalCode) {
                    nonAirData.externalCode = parsedPayload.ExternalCode;
                  } else if (parsedPayload.eventBusinessKey) {
                    nonAirData.externalCode = parsedPayload.eventBusinessKey; // Use eventBusinessKey as external code
                  }

                  // Add flight and passenger info
                  nonAirData.flightInfo = {
                    flightNumber: parsedPayload.flightNumber,
                    operatingAirline: parsedPayload.operatingAirline,
                    originStation: parsedPayload.originStation,
                    destinationStation: parsedPayload.destinationStation,
                  };

                  if (parsedPayload.Passenger) {
                    nonAirData.passengerInfo = {
                      firstName: parsedPayload.Passenger.firstName,
                      lastName: parsedPayload.Passenger.lastName,
                      marketingAirline:
                        parsedPayload.Passenger.marketingAirline,
                      marketingFlightNumber:
                        parsedPayload.Passenger.marketingFlightNumber,
                      boardingStatus: parsedPayload.Passenger.boardingStatus,
                    };
                  }

                  nonAirAccruals.push(nonAirData);
                } catch (jsonError) {
                  console.warn(
                    `Failed to parse JSON payload in row ${results.length}:`,
                    jsonError.message
                  );
                }
              }
            })
            .on("end", () => {
              resolve({
                totalRows: results.length,
                nonAirAccruals: nonAirAccruals,
                headers: results.length > 0 ? Object.keys(results[0]) : [],
              });
            })
            .on("error", reject);
        });

        // Clean up uploaded file
        fs.unlinkSync(filePath);

        if (processedData.nonAirAccruals.length === 0) {
          return res.json({
            message: "No non-air accrual data found in payload",
            totalRows: processedData.totalRows,
            headers: processedData.headers,
            nonAirAccruals: [],
          });
        }

        // Process non-air accruals and extract relevant data
        const processedAccruals = processedData.nonAirAccruals.map(
          (accrual) => ({
            row: accrual.row,
            recordLocator: accrual.recordLocator,
            bookingDate: accrual.bookingDate,
            departureDate: accrual.departureDate,
            externalCode: accrual.externalCode,
            processType: accrual.processType,
            eventBusinessKey: accrual.eventBusinessKey,
            voEventType: accrual.voEventType,
            voOpsType: accrual.voOpsType,
            isEasyBiz: accrual.isEasyBiz,
            flightInfo: accrual.flightInfo,
            passengerInfo: accrual.passengerInfo,
            hasRecordLocator: !!accrual.recordLocator,
            hasBookingDate: !!accrual.bookingDate,
            hasExternalCode: !!accrual.externalCode,
          })
        );

        res.json({
          message: "Non-air accrual CSV processing completed",
          totalRows: processedData.totalRows,
          nonAirAccrualsFound: processedData.nonAirAccruals.length,
          results: processedAccruals,
          summary: {
            withRecordLocators: processedAccruals.filter(
              (a) => a.hasRecordLocator
            ).length,
            withBookingDates: processedAccruals.filter((a) => a.hasBookingDate)
              .length,
            withExternalCodes: processedAccruals.filter(
              (a) => a.hasExternalCode
            ).length,
            processTypes: [
              ...new Set(
                processedAccruals.map((a) => a.processType).filter(Boolean)
              ),
            ],
            voEventTypes: [
              ...new Set(
                processedAccruals.map((a) => a.voEventType).filter(Boolean)
              ),
            ],
          },
        });
      } catch (parseError) {
        // Clean up uploaded file on parse error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw parseError;
      }
    } catch (error) {
      console.error("Non-air accrual CSV processing error:", error);
      res.status(500).json({
        message: "Non-air accrual CSV processing failed",
        error: error.message,
      });
    }
  }
);

module.exports = router;
