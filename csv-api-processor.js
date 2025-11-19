// Generate AFB Accrual CSV file
async function generateAccrualCSV(records, outputPath) {
  const headers = [
    "PartnerRefCD",
    "NoOfPoints",
    "CompanyMileagePlanNumber",
    "TransactionDate",
    "LastName",
  ];
  const csvRows = [headers.join(",")];
  for (const record of records) {
    csvRows.push(
      [
        record.PartnerRefCD || "",
        record.NoOfPoints || "",
        record.CompanyMileagePlan || record.CompanyMileagePlanNumber || "",
        record.TransactionDate || "",
        record.LastName || "",
      ].join(",")
    );
  }
  fs.writeFileSync(outputPath, csvRows.join("\n"));
}
/**
 * Deduplicate accrual records based on key fields
 * @param {Array} records - Array of accrual records
 * @returns {Object} { deduplicatedData, duplicatesRemoved }
 */
function deduplicateAccrualRecords(records) {
  const seen = new Set();
  const deduplicatedData = [];
  let duplicatesRemoved = 0;
  for (const record of records) {
    const key = [
      record.TicketNumber,
      record.MileagePlanNumber,
      record.TransactionDate,
      record.PartnerRefCD,
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      deduplicatedData.push(record);
    } else {
      duplicatesRemoved++;
    }
  }
  return { deduplicatedData, duplicatesRemoved };
}
/**
 * AFB Customer Accrual Processor
 *
 * This script processes CSV files containing passenger records, calls Alaska Airlines API
 * to retrieve booking data, filters for AFB (Alaska for Business) customers, and creates
 * non-flight accrual records for business travel rewards.
 *
 * @author AFB Team
 * @version 1.0.0
 */

const fs = require("fs");
const csv = require("csv-parser");
const axios = require("axios");

// Configuration
const CONFIG = {
  csvFiles: [
    "./september_reprocessing_afb.csv",
    "./october_reprocessing_afb.csv",
  ],
  apiBaseUrl:
    "https://apis.alaskaair.com/aag/1/guestServices/bookings/search/byrecordlocator",
  subscriptionKey: "8fa1ef7cdaff40a6afa90ead0b9d8dc4",

  // PNR Business API
  pnrApi: {
    baseUrl: "https://apis.alaskaair.com",
    endpoint: "business/1/purchase/lookup",
    subscriptionKey: "c0cfd8edb27f4443bc33f7fe17520434",
    // Note: This Basic auth is from the cURL example - may need different credentials
    basicAuth:
      "Basic MG9hMjg4bnhwb0ZOemRwUTIxZDc6SUVSbU1rUmxkSWU5Wk1XTHo3MU1pMG4yVFBsRTdCdklwUmM2TlRyTw==",
  },

  // Ticket Info API
  ticketApi: {
    baseUrl:
      "https://apis.alaskaair.com/aag/1/guestServices/ticketing/reservations/tickets",
    subscriptionKey: "8fa1ef7cdaff40a6afa90ead0b9d8dc4",
    appId: "milepost",
  },

  // Member Info API (v3)
  memberInfoApi: {
    tokenUrl: "https://www.auth.alaskaair.com/oauth2/default/v1/token",
    authHeader:
      "Basic MG9hM2h3amM1aU44VjlXVEc1ZDc6RU5FR3I0NW82OV9UTzc1SDMtenFmUS1KY3g0cWFGY3h3MGZtb1FqSg==",
    scope: "loyalty.getmember",
    baseUrl: "https://apis.alaskaair.com",
    endpoint: "mileagePlan/nonFlight/memberInfo/v3.0.0",
    subscriptionKey: "8fa1ef7cdaff40a6afa90ead0b9d8dc4", // May need different subscription key
  },

  // OAuth2 Authentication
  oauth: {
    tokenUrl: "https://www.auth.alaskaair.com/oauth2/default/v1/token",
    authHeader:
      "Basic MG9hM2h3amM1aU44VjlXVEc1ZDc6RU5FR3I0NW82OV9UTzc1SDMtenFmUS1KY3g0cWFGY3h3MGZtb1FqSg==",
    grantType: "client_credentials",
    scope: "guest_profile.search",
  },

  productCode: "EZEZP", // Product code for non-flight accrual
  partnerCode: "AFB", // Partner code for Alaska for Business
  requestDelay: 1000, // Delay between API requests (ms)
  testMode: false, // Process all records
  testModeLimit: null, // No limit

  // Dynamic output files - will be set based on input CSV filename
  getOutputFiles: function (csvFile = null) {
    const path = require("path");
    const fs = require("fs");

    // Use provided csvFile or fall back to the first file in the array
    const currentFile =
      csvFile || (this.csvFiles ? this.csvFiles[0] : this.csvFile);

    // Extract filename without extension from csvFile
    const csvBaseName = path.basename(currentFile, ".csv");
    const testSuffix = this.testMode ? "_TEST" : "";
    const outputDir = `./reports/${csvBaseName}${testSuffix}`;

    // Create directory if it doesn't exist
    if (!fs.existsSync("./reports")) {
      fs.mkdirSync("./reports", { recursive: true });
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    return {
      customers: `${outputDir}/afb-customers-only.json`,
      accruals: `${outputDir}/afb-accrual-records.json`,
      accrualsCsv: `${outputDir}/afb-accrual-records.csv`,
      nonAfbCsv: `${outputDir}/non-afb-records.csv`,
      pnr404Csv: `${outputDir}/pnr-404-records.csv`,
      summary: `${outputDir}/accrual-summary-report.md`,
    };
  },

  // Legacy outputFiles for backward compatibility
  outputFiles: {
    customers: "./afb-customers-only.json",
    accruals: "./afb-accrual-records.json",
    accrualsCsv: "./afb-accrual-records.csv",
    nonAfbCsv: "./non-afb-records.csv",
    pnr404Csv: "./pnr-404-records.csv",
    summary: "./accrual-summary-report.md",
  },
};

// Token cache
let authToken = null;
let tokenExpiry = null;

/**
 * Gets a valid OAuth2 access token (cached or new)
 * @returns {Promise<string>} Valid access token
 */
async function getAccessToken() {
  // Check if we have a valid cached token
  if (authToken && tokenExpiry && Date.now() < tokenExpiry) {
    return authToken;
  }

  console.log("ðŸ” Requesting new OAuth2 token...");

  try {
    const response = await axios.post(
      CONFIG.oauth.tokenUrl,
      new URLSearchParams({
        grant_type: CONFIG.oauth.grantType,
        scope: CONFIG.oauth.scope,
      }),
      {
        headers: {
          accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: CONFIG.oauth.authHeader,
        },
        timeout: 10000,
      }
    );

    if (response.data.access_token) {
      authToken = response.data.access_token;
      // Set expiry to 90% of actual expiry to ensure refresh before expiration
      const expiresInMs = (response.data.expires_in || 3600) * 1000 * 0.9;
      tokenExpiry = Date.now() + expiresInMs;

      console.log("âœ… OAuth2 token obtained successfully");
      console.log(
        `ðŸ•’ Token expires in: ${Math.round(expiresInMs / 1000 / 60)} minutes`
      );

      return authToken;
    } else {
      throw new Error("No access token in response");
    }
  } catch (error) {
    console.error("âŒ Failed to obtain OAuth2 token:");
    if (error.response) {
      console.error(
        `   Status: ${error.response.status} ${error.response.statusText}`
      );
      console.error(
        `   Response: ${JSON.stringify(error.response.data, null, 2)}`
      );
    } else {
      console.error(`   Error: ${error.message}`);
    }
    throw new Error("OAuth2 authentication failed");
  }
}

/**
 * Gets OAuth2 access token specifically for member info API
 * @returns {string} Access token for member info API
 */
async function getMemberInfoAccessToken() {
  try {
    console.log("ðŸ” Requesting member info OAuth2 token...");

    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("scope", CONFIG.memberInfoApi.scope);

    const response = await axios.post(CONFIG.memberInfoApi.tokenUrl, params, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: CONFIG.memberInfoApi.authHeader,
      },
    });

    if (response.status === 200 && response.data.access_token) {
      const expiresInMinutes = Math.floor(response.data.expires_in / 60);
      console.log(`âœ… Member info OAuth2 token obtained successfully`);
      console.log(`ðŸ•’ Token expires in: ${expiresInMinutes} minutes`);
      return response.data.access_token;
    }

    throw new Error(
      `Failed to obtain member info token: ${response.status} ${response.statusText}`
    );
  } catch (error) {
    console.error(
      "ðŸ’¥ Error obtaining member info OAuth2 token:",
      error.response?.data || error.message
    );
    throw new Error("Member info OAuth2 authentication failed");
  }
}

/**
 * Calls the Member Info v3 API to get member profile information
 * @param {string} mileagePlanNumber - Mileage plan member number
 * @returns {Object} API response with member profile data
 */
async function callMemberInfoAPI(mileagePlanNumber) {
  try {
    console.log(`ðŸ‘¤ Calling Member Info v3 API for: ${mileagePlanNumber}`);

    const accessToken = await getMemberInfoAccessToken();
    const url = `${CONFIG.memberInfoApi.baseUrl}/${CONFIG.memberInfoApi.endpoint}`;

    // Create the request payload based on the C# code
    const requestPayload = {
      LoyaltyNumber: mileagePlanNumber,
    };

    console.log(`ðŸŒ Member Info API URL: ${url}`);

    const response = await axios.post(url, requestPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.memberInfoApi.subscriptionKey,
      },
      timeout: 10000,
    });

    if (response.status === 200 && response.data) {
      console.log(
        `âœ… Member Info API Success: ${response.status} ${response.statusText}`
      );
      console.log(`ðŸ‘¤ Member data retrieved for: ${mileagePlanNumber}`);

      return {
        mileagePlanNumber,
        success: true,
        status: response.status,
        data: response.data,
      };
    }

    return {
      mileagePlanNumber,
      success: false,
      error: "No data in response",
      status: response.status,
      data: null,
    };
  } catch (error) {
    console.log(`âŒ Member Info API Error for ${mileagePlanNumber}:`);
    console.log(
      `   Status: ${error.response?.status || "Network Error"} ${
        error.response?.statusText || error.message
      }`
    );

    if (error.response?.data) {
      console.log(
        `   Response: ${JSON.stringify(error.response.data, null, 2)}`
      );
    }

    return {
      mileagePlanNumber,
      success: false,
      error: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    };
  }
}

/**
 * Extracts specific ticket number from CSV payload JSON string
 * @param {string} payloadString - JSON string containing passenger data
 * @returns {string|null} Specific ticket number from the CSV row or null if not found
 */
function extractTicketNumberFromPayload(payloadString) {
  try {
    const payload = JSON.parse(payloadString);

    // Extract the specific ticket number from this CSV row
    if (
      payload.Passenger?.ticketDetails &&
      payload.Passenger.ticketDetails.length > 0
    ) {
      const ticketNumber = payload.Passenger.ticketDetails[0].ticketNumber;
      console.log(
        `ðŸŽ« Extracted specific ticket number from CSV: ${ticketNumber}`
      );
      return ticketNumber;
    }

    console.log(`âš ï¸ No ticket number found in CSV payload`);
    return null;
  } catch (error) {
    console.error(
      "Error parsing payload JSON for ticket number:",
      error.message
    );
    return null;
  }
}

/**
 * Extracts record locator from CSV payload JSON string
 * @param {string} payloadString - JSON string containing passenger data
 * @returns {string|null} Record locator or null if not found
 */
function extractRecordLocator(payloadString) {
  try {
    const payload = JSON.parse(payloadString);
    return payload.Passenger?.recordLocator || null;
  } catch (error) {
    console.error("Error parsing payload JSON:", error.message);
    return null;
  }
}

/**
 * Extracts booking date from CSV payload JSON
 * @param {string} payloadString - JSON payload string from CSV
 * @returns {string|null} Booking date or null
 */
function extractBookingDateFromPayload(payloadString) {
  try {
    const payload = JSON.parse(payloadString);

    // Try to get date from ticket details first (most accurate)
    if (
      payload.Passenger?.ticketDetails &&
      payload.Passenger.ticketDetails.length > 0
    ) {
      const ticketDate = payload.Passenger.ticketDetails[0].dateTicketIssuedCT;
      if (ticketDate) {
        console.log(`ðŸ“… Found ticket issue date: ${ticketDate}`);
        return ticketDate;
      }
    }

    // Fallback to departure date
    if (payload.departureDateStnLocal) {
      console.log(
        `ðŸ“… Using departure date: ${payload.departureDateStnLocal}`
      );
      return payload.departureDateStnLocal;
    }

    return null;
  } catch (error) {
    console.error(
      "Error parsing payload JSON for booking date:",
      error.message
    );
    return null;
  }
}

/**
 * Extracts ticket info from booking data (handles both string and object input)
 * @param {string|Object} payloadData - JSON payload string from CSV or parsed object from API
 * @returns {Object} Ticket information including numbers and marketing airline
 */
function extractTicketInfoFromPayload(payloadData) {
  try {
    // Handle both string and object inputs
    const payload =
      typeof payloadData === "string" ? JSON.parse(payloadData) : payloadData;

    const ticketInfo = {
      ticketNumbers: [],
      marketingAirline: null,
    };

    // Look for ticket info in the booking data structure (API format)
    if (payload.bookings && payload.bookings.length > 0) {
      const booking = payload.bookings[0];

      // Extract marketing airline from first passenger if available
      if (booking.passengers && booking.passengers.length > 0) {
        const passenger = booking.passengers[0];
        if (passenger.ticketDetails && passenger.ticketDetails.length > 0) {
          // Get marketing airline from ticket details
          const firstTicket = passenger.ticketDetails[0];
          if (firstTicket.marketingAirline) {
            ticketInfo.marketingAirline = firstTicket.marketingAirline;
          }

          // Extract all ticket numbers
          ticketInfo.ticketNumbers = passenger.ticketDetails
            .map((ticket) => ticket.ticketNumber)
            .filter(Boolean); // Remove any null/undefined values
        }
      }
    }

    // Fallback: look for direct Passenger structure (CSV payload format)
    if (ticketInfo.ticketNumbers.length === 0 && payload.Passenger) {
      if (payload.Passenger.marketingAirline) {
        ticketInfo.marketingAirline = payload.Passenger.marketingAirline;
      }

      if (
        payload.Passenger.ticketDetails &&
        payload.Passenger.ticketDetails.length > 0
      ) {
        ticketInfo.ticketNumbers = payload.Passenger.ticketDetails
          .map((ticket) => ticket.ticketNumber)
          .filter(Boolean);
      }
    }

    console.log(
      `[TICKET] Extracted ${
        ticketInfo.ticketNumbers.length
      } ticket(s), marketing airline: ${ticketInfo.marketingAirline || "AS"}`
    );
    return ticketInfo;
  } catch (error) {
    console.error("[ERROR] Error extracting ticket info:", error.message);
    return { ticketNumbers: [], marketingAirline: null };
  }
}

/**
 * Checks if booking data contains AFB customer remarks
 * @param {Object} bookingData - Booking response data from API
 * @returns {Object} { hasAFB: boolean, afbRemarks: Array, companyNames: Array }
 */
function checkAFBCustomer(bookingData) {
  if (!bookingData?.bookings) {
    return { hasAFB: false, afbRemarks: [], companyNames: [] };
  }

  const afbRemarks = [];
  const companyNames = [];
  let hasAFB = false;

  bookingData.bookings.forEach((booking, bookingIndex) => {
    booking.remarks?.forEach((remark, remarkIndex) => {
      if (remark.remarkLines?.toLowerCase().includes("afb customer")) {
        hasAFB = true;
        const remarkData = {
          bookingIndex,
          remarkIndex,
          remarkType: remark.type,
          remarkText: remark.remarkLines,
        };
        afbRemarks.push(remarkData);

        // Extract company name from remark
        const match = remark.remarkLines.match(/AFB CUSTOMER[.\s]*(.+)/i);
        if (match) {
          companyNames.push(match[1].trim());
        }
      }
    });
  });

  return { hasAFB, afbRemarks, companyNames };
}

/**
 * Format date to yyyy-MM-dd string format
 * @param {string|Date} dateValue - Date value to format
 * @returns {string} - Formatted date string
 */
function formatDateToYYYYMMDD(dateValue) {
  if (!dateValue) return "";

  let date;
  if (typeof dateValue === "string") {
    date = new Date(dateValue);
  } else {
    date = dateValue;
  }

  // Check if date is valid
  if (isNaN(date.getTime())) {
    console.log(`âš ï¸ Invalid date: ${dateValue}`);
    return "";
  }

  // Format as yyyy-MM-dd
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Function to extract accrual data from booking
async function extractAccrualData(
  bookingData,
  recordLocator,
  pnrBusinessData = null,
  ticketData = [],
  specificTicketNumber = null
) {
  const accrualRecords = [];

  if (!bookingData || !bookingData.bookings) {
    return accrualRecords;
  }

  // Determine the best date to use for transactions
  let transactionDate = null;

  // Priority 1: Use CreationTimestamp from PNR Business data if available
  if (pnrBusinessData?.BookingDetails?.CreationTimestamp) {
    transactionDate = formatDateToYYYYMMDD(
      pnrBusinessData.BookingDetails.CreationTimestamp
    );
    console.log(
      `ðŸ“… Using PNR Business Creation Timestamp: ${transactionDate}`
    );
  }

  // Store member data to avoid duplicate API calls
  const memberDataCache = {};

  for (const booking of bookingData.bookings) {
    // Priority 2: Fall back to booking date from main API if no PNR business date
    if (!transactionDate) {
      transactionDate = formatDateToYYYYMMDD(booking.bookingDateCt);
      console.log(`ðŸ“… Using booking date from main API: ${transactionDate}`);
    }

    if (booking.passengersInfo) {
      for (const passenger of booking.passengersInfo) {
        // Prioritize CompanyMileagePlan from PNR Business data for member info
        let memberInfoMileagePlan = null;
        let mileagePlanNumber = null;

        // First check if we have CompanyMileagePlan from PNR Business data
        if (pnrBusinessData?.CompanyMileagePlan) {
          memberInfoMileagePlan = pnrBusinessData.CompanyMileagePlan;
          console.log(
            `[MEMBER] Using CompanyMileagePlan for member lookup: ${memberInfoMileagePlan}`
          );
        } else {
          // Fall back to individual passenger's mileage plan number
          if (passenger.loyaltyInfo && passenger.loyaltyInfo.length > 0) {
            const asLoyalty = passenger.loyaltyInfo.find(
              (loyalty) => loyalty.loyaltyAirlineCode === "AS"
            );
            if (asLoyalty) {
              memberInfoMileagePlan = asLoyalty.loyaltyNumber;
              mileagePlanNumber = asLoyalty.loyaltyNumber;
              console.log(
                `[MEMBER] Using individual MileagePlan for member lookup: ${memberInfoMileagePlan}`
              );
            }
          }
        }

        // Get member profile data for LastName - ONLY from API, no defaults
        let memberLastName = null;
        if (memberInfoMileagePlan && memberInfoMileagePlan !== "NO_MP_NUMBER") {
          // Check cache first
          if (memberDataCache[memberInfoMileagePlan]) {
            memberLastName = memberDataCache[memberInfoMileagePlan].lastName;
          } else {
            // Call Member Info API
            const memberResult = await callMemberInfoAPI(memberInfoMileagePlan);
            if (memberResult.success && memberResult.data) {
              // Try multiple possible LastName fields from Member Info API response
              const apiLastName =
                memberResult.data.MemberProfile?.LastName ||
                memberResult.data.LastName ||
                memberResult.data.lastname ||
                memberResult.data.Surname ||
                memberResult.data.surname ||
                memberResult.data.FamilyName ||
                memberResult.data.familyName;

              if (apiLastName) {
                memberLastName = apiLastName;
                memberDataCache[memberInfoMileagePlan] = {
                  lastName: memberLastName,
                  memberData: memberResult.data,
                };
                console.log(
                  `ðŸ‘¤ Using member profile LastName: ${memberLastName} for MP #${mileagePlanNumber}`
                );
              } else {
                console.log(
                  `âŒ Member Info API returned no LastName for MP #${mileagePlanNumber} - skipping passenger`
                );
                memberDataCache[mileagePlanNumber] = {
                  lastName: null,
                };
                continue; // Skip this passenger - no API LastName available
              }
            } else {
              console.log(
                `âŒ Could not retrieve member profile for MP #${mileagePlanNumber} - skipping passenger`
              );
              memberDataCache[mileagePlanNumber] = {
                lastName: null,
              };
              continue; // Skip this passenger - no API data available
            }
          }
        } else {
          console.log(
            `âŒ No mileage plan number available - skipping passenger`
          );
          continue; // Skip passengers without mileage plan numbers
        }

        // If we don't have a valid LastName from API, skip this passenger
        if (!memberLastName) {
          console.log(`âŒ No valid LastName from API for passenger - skipping`);
          continue;
        }

        // Extract ticket information and calculate base amount - ONLY for the specific ticket
        let totalBaseAmount = 0;
        let matchingTicketNumber = null;
        let foundSpecificTicket = false;

        if (passenger.ticketDetails && passenger.ticketDetails.length > 0) {
          if (specificTicketNumber) {
            matchingTicketNumber = specificTicketNumber;
            // Print all ticket numbers in ticketData for debug
            console.log("[DEBUG] All ticket numbers in ticketData:");
            ticketData.forEach((td, idx) => {
              if (td.TicketDetails) {
                console.log(
                  `  [${idx}] ` +
                    td.TicketDetails.map((t) => t.TicketNumber).join(", ")
                );
              }
            });
            // Find Ticket Info API response for this ticket
            const ticketApiData = ticketData.find(
              (td) => td.TicketDetails && td.TicketDetails.length > 0
            );
            let baseAmountFromApi = 0;
            if (
              ticketApiData &&
              ticketApiData.TicketDetails &&
              ticketApiData.TicketDetails.length > 0
            ) {
              // Always use the first TicketDetails entry for base amount
              const ticketDetail = ticketApiData.TicketDetails[0];
              if (
                ticketDetail.Ticket &&
                ticketDetail.Ticket.Amounts &&
                ticketDetail.Ticket.Amounts.New &&
                ticketDetail.Ticket.Amounts.New.Base &&
                ticketDetail.Ticket.Amounts.New.Base.Amount &&
                ticketDetail.Ticket.Amounts.New.Base.Amount.Value != null
              ) {
                baseAmountFromApi =
                  ticketDetail.Ticket.Amounts.New.Base.Amount.Value;
                console.log(
                  `[DEBUG] Extracted base amount from API response: ${baseAmountFromApi}`
                );
              } else {
                console.log(
                  "[DEBUG] No base amount found in first TicketDetails entry."
                );
              }
            } else {
              console.log("[DEBUG] No TicketDetails found in ticketData.");
            }
            if (baseAmountFromApi > 0) {
              totalBaseAmount = Math.ceil(baseAmountFromApi);
            } else {
              // No base amount, skip record
              continue;
            }
          }
        }

        // Determine the mileage plan number to use for accrual
        let accrualMileagePlan = mileagePlanNumber; // Default to passenger's MP number
        let accrualLastName = memberLastName; // Default to passenger's lastName

        // Priority 1: Use CompanyMileagePlan from PNR Business data if available
        if (pnrBusinessData?.CompanyMileagePlan) {
          accrualMileagePlan = pnrBusinessData.CompanyMileagePlan;
          console.log(
            `ðŸ¢ Using CompanyMileagePlan from PNR Business: ${accrualMileagePlan}`
          );

          // Get member profile data for CompanyMileagePlan LastName
          if (memberDataCache[accrualMileagePlan]) {
            accrualLastName =
              memberDataCache[accrualMileagePlan].lastName || memberLastName;
            console.log(
              `ðŸ‘¤ Using cached CompanyMileagePlan LastName: ${accrualLastName}`
            );
          } else {
            // Call Member Info API for CompanyMileagePlan
            const companyMemberResult = await callMemberInfoAPI(
              accrualMileagePlan
            );
            if (companyMemberResult.success && companyMemberResult.data) {
              // Try multiple possible LastName fields from Member Info API response
              const apiLastName =
                companyMemberResult.data.LastName ||
                companyMemberResult.data.lastname ||
                companyMemberResult.data.Surname ||
                companyMemberResult.data.surname ||
                companyMemberResult.data.FamilyName ||
                companyMemberResult.data.familyName;

              if (apiLastName) {
                accrualLastName = apiLastName;
                memberDataCache[accrualMileagePlan] = {
                  lastName: accrualLastName,
                  memberData: companyMemberResult.data,
                };
                console.log(
                  `ðŸ‘¤ Using CompanyMileagePlan member profile LastName: ${accrualLastName} for MP #${accrualMileagePlan}`
                );
              } else {
                console.log(
                  `âš ï¸ CompanyMileagePlan Member Info API returned data but no LastName field for MP #${accrualMileagePlan}`
                );
                console.log(
                  `ðŸ“‹ CompanyMileagePlan API Response: ${JSON.stringify(
                    companyMemberResult.data,
                    null,
                    2
                  )}`
                );
                console.log(
                  `âš ï¸ Using passenger lastName: ${memberLastName}`
                );
                accrualLastName = memberLastName;
                memberDataCache[accrualMileagePlan] = {
                  lastName: memberLastName,
                };
              }
            } else {
              console.log(
                `âš ï¸ Could not retrieve CompanyMileagePlan member profile for MP #${accrualMileagePlan}, using passenger lastName: ${memberLastName}`
              );
              accrualLastName = memberLastName;
              memberDataCache[accrualMileagePlan] = {
                lastName: memberLastName,
              };
            }
          }
        } else if (mileagePlanNumber) {
          console.log(
            `ðŸ‘¤ Using passenger's MileagePlan: ${mileagePlanNumber}`
          );
        }

        // Create accrual record for the specific ticket only (one record per CSV row)
        if (
          accrualMileagePlan &&
          matchingTicketNumber &&
          (specificTicketNumber ? foundSpecificTicket : true)
        ) {
          accrualRecords.push({
            MileagePlanNumber: accrualMileagePlan,
            CompanyMileagePlan: pnrBusinessData?.CompanyMileagePlan || "",
            LastName: accrualLastName, // Use the appropriate lastName (CompanyMileagePlan or passenger)
            FirstName: passenger.firstName,
            ProductCode: CONFIG.productCode,
            PartnerCode: CONFIG.partnerCode,
            PartnerRefCD: recordLocator + matchingTicketNumber,
            TransactionDate: transactionDate,
            NoOfPoints: totalBaseAmount.toString(),
            RecordLocator: recordLocator,
            TicketNumber: matchingTicketNumber,
            BookingStatus: booking.bookingStatus,
            CompanyInfo: extractCompanyInfo(bookingData),
          });

          // Log creation of the specific accrual record
          console.log(
            `âœ… Created accrual record for specific ticket: ${matchingTicketNumber} - ${passenger.firstName} ${accrualLastName}`
          );
        } else if (matchingTicketNumber) {
          // Create record even without mileage plan for tracking (only for the specific ticket)
          accrualRecords.push({
            MileagePlanNumber: accrualMileagePlan || "NO_MP_NUMBER",
            CompanyMileagePlan: pnrBusinessData?.CompanyMileagePlan || "",
            LastName: accrualLastName,
            FirstName: passenger.firstName,
            ProductCode: CONFIG.productCode,
            PartnerCode: CONFIG.partnerCode,
            PartnerRefCD: recordLocator + matchingTicketNumber,
            TransactionDate: transactionDate,
            NoOfPoints: totalBaseAmount.toString(),
            RecordLocator: recordLocator,
            TicketNumber: matchingTicketNumber,
            BookingStatus: booking.bookingStatus,
            CompanyInfo: extractCompanyInfo(bookingData),
            Issues: accrualMileagePlan ? [] : ["NO_MILEAGE_PLAN_NUMBER"],
          });

          console.log(
            `âš ï¸ Created tracking record for specific ticket: ${matchingTicketNumber} - ${passenger.firstName} ${accrualLastName} (No MP #)`
          );
        } else if (specificTicketNumber && !foundSpecificTicket) {
          console.log(
            `âŒ Specific ticket ${specificTicketNumber} not found for passenger ${passenger.firstName} ${passenger.lastName}`
          );
        }
      }
    }
  }

  return accrualRecords;
}

// Function to extract company information from AFB remarks
function extractCompanyInfo(bookingData) {
  let companyInfo = [];

  if (bookingData && bookingData.bookings) {
    bookingData.bookings.forEach((booking) => {
      if (booking.remarks) {
        booking.remarks.forEach((remark) => {
          if (
            remark.remarkLines &&
            remark.remarkLines.toLowerCase().includes("afb customer")
          ) {
            // Extract company name after "AFB CUSTOMER..."
            const match = remark.remarkLines.match(/AFB CUSTOMER[.\s]*(.+)/i);
            if (match) {
              companyInfo.push(match[1].trim());
            }
          }
        });
      }
    });
  }
  return companyInfo;

  // Create CSV content
  let csvContent = headers.join(",") + "\n";

  // Process each accrual record
  accrualData.forEach((record) => {
    if (record.accrualRecords && record.accrualRecords.length > 0) {
      record.accrualRecords.forEach((accrual) => {
        const row = [
          `"${accrual.PartnerRefCD || ""}"`,
          `"${accrual.TransactionDate || ""}"`,
          `"${accrual.NoOfPoints || ""}"`,
          `"${accrual.MileagePlanNumber || ""}"`,
          `"${accrual.CompanyMileagePlan || ""}"`,
          `"${accrual.LastName || ""}"`,
          `"${accrual.FirstName || ""}"`,
          `"${accrual.RecordLocator || ""}"`,
          `"${accrual.TicketNumber || ""}"`,
          `"${accrual.CompanyInfo?.join("; ") || ""}"`,
        ];
        csvContent += row.join(",") + "\n";
      });
    }
  });

  // Write CSV file
  fs.writeFileSync(csvPath, csvContent);

  // Count actual accrual records in CSV
  let totalAccrualRecordsInCSV = 0;
  accrualData.forEach((record) => {
    if (record.accrualRecords && record.accrualRecords.length > 0) {
      totalAccrualRecordsInCSV += record.accrualRecords.length;
    }
  });

  console.log(
    `âœ… CSV file generated with ${totalAccrualRecordsInCSV} accrual records from ${accrualData.length} AFB customers`
  );
}

/**
 * Makes API call to retrieve booking data for a record locator
 * @param {string} recordLocator - PNR record locator
 * @returns {Object} API response with booking data and AFB status
 */
async function callAPIForRecord(recordLocator) {
  try {
    console.log(`\nðŸ” Processing Record Locator: ${recordLocator}`);

    // Get valid access token
    const accessToken = await getAccessToken();

    const response = await axios.get(CONFIG.apiBaseUrl, {
      params: {
        includeInActive: true,
        recordlocator: recordLocator,
      },
      headers: {
        recordlocator: recordLocator,
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.subscriptionKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log(`âœ… API Success: ${response.status} ${response.statusText}`);

    // Check for AFB customer status
    const afbCheck = checkAFBCustomer(response.data);
    console.log(`ðŸ¢ AFB Customer: ${afbCheck.hasAFB ? "âœ… YES" : "âŒ NO"}`);

    if (afbCheck.hasAFB && afbCheck.companyNames.length > 0) {
      console.log(`ðŸ¢ Companies: ${afbCheck.companyNames.join(", ")}`);
    }

    return {
      recordLocator,
      success: true,
      status: response.status,
      data: response.data,
      afbCustomer: afbCheck,
    };
  } catch (error) {
    console.log(`âŒ API Error for ${recordLocator}:`);

    if (error.response) {
      console.log(
        `   Status: ${error.response.status} ${error.response.statusText}`
      );
    } else if (error.request) {
      console.log(`   Network error: No response received`);
    } else {
      console.log(`   Error: ${error.message}`);
    }

    return {
      recordLocator,
      success: false,
      error: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    };
  }
}

/**
 * Test different OAuth scopes for PNR Business API access
 * @returns {Promise<Object>} Test results with different scopes
 */
async function testBusinessAPIScopes() {
  console.log(
    `\nðŸ” Testing different OAuth scopes for Business API access...`
  );

  const testScopes = [
    "guest_profile.search", // Current scope
    "business.purchase.read",
    "purchase.lookup",
    "business.read",
    "pnr.read",
    "booking.read",
    "guest_profile.search business.purchase.read", // Multiple scopes
    "guest_profile.search purchase.lookup",
  ];

  for (const scope of testScopes) {
    console.log(`\nðŸ§ª Testing scope: "${scope}"`);

    try {
      const response = await axios.post(
        CONFIG.oauth.tokenUrl,
        `grant_type=${CONFIG.oauth.grantType}&scope=${encodeURIComponent(
          scope
        )}`,
        {
          headers: {
            Authorization: CONFIG.oauth.authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 10000,
        }
      );

      if (response.data?.access_token) {
        console.log(`   âœ… Token obtained successfully`);
        console.log(`   Token type: ${response.data.token_type}`);
        console.log(
          `   Expires in: ${Math.floor(response.data.expires_in / 60)} minutes`
        );

        // Try a simple business API call with this token
        const testUrl = `${CONFIG.pnrApi.baseUrl}/${CONFIG.pnrApi.endpoint}?confirmationCode=TEST123&bookingDate=2025-01-01`;

        try {
          const testCall = await axios.get(testUrl, {
            headers: {
              Authorization: `Bearer ${response.data.access_token}`,
              "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
              Accept: "application/json",
            },
            timeout: 5000,
          });

          console.log(`   âœ… Business API test call successful!`);
          return {
            success: true,
            workingScope: scope,
            token: response.data.access_token,
          };
        } catch (apiError) {
          const status = apiError.response?.status;
          if (status === 404) {
            console.log(
              `   âœ… Business API accessible (404 expected for test data)`
            );
            return {
              success: true,
              workingScope: scope,
              token: response.data.access_token,
            };
          } else if (status === 401 || status === 403) {
            console.log(`   âŒ Business API authorization failed: ${status}`);
          } else {
            console.log(
              `   âš ï¸  Business API test call failed: ${status} (may still work with real data)`
            );
          }
        }
      } else {
        console.log(`   âŒ No access token in response`);
      }
    } catch (error) {
      console.log(
        `   âŒ OAuth failed: ${error.response?.status || error.message}`
      );
      if (error.response?.data) {
        console.log(`   Error: ${JSON.stringify(error.response.data)}`);
      }
    }
  }

  return { success: false, message: "No working scope found" };
}

/**
 * Test function to debug PNR Business API with different approaches
 * @param {string} confirmationCode - Booking confirmation code
 * @param {string} bookingDate - Booking date
 * @returns {Object} Test results
 */
async function debugPNRBusinessAPI(confirmationCode, bookingDate) {
  console.log(
    `\nðŸ”¬ DEBUG: Testing PNR Business API approaches for ${confirmationCode}`
  );

  const accessToken = await getAccessToken();

  // Convert ISO date to simple date format
  let simpleDate = bookingDate;
  if (bookingDate.includes("T")) {
    simpleDate = bookingDate.split("T")[0]; // Get just YYYY-MM-DD part
  }

  const testConfigs = [
    // Different base URLs and authentication approaches
    {
      name: "Standard Business API with OAuth",
      baseUrl: "https://apis.alaskaair.com/business/1/purchase/lookup",
      params: `?confirmationCode=${confirmationCode}&bookingDate=${encodeURIComponent(
        simpleDate
      )}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    {
      name: "Business API without OAuth (subscription key only)",
      baseUrl: "https://apis.alaskaair.com/business/1/purchase/lookup",
      params: `?confirmationCode=${confirmationCode}&bookingDate=${encodeURIComponent(
        simpleDate
      )}`,
      headers: {
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    {
      name: "Try with recordLocator parameter",
      baseUrl: "https://apis.alaskaair.com/business/1/purchase/lookup",
      params: `?recordLocator=${confirmationCode}&purchaseDate=${encodeURIComponent(
        simpleDate
      )}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        Accept: "application/json",
      },
    },
    {
      name: "Path-based approach",
      baseUrl: "https://apis.alaskaair.com/business/1/purchase/lookup",
      params: `/${confirmationCode}/${encodeURIComponent(simpleDate)}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        Accept: "application/json",
      },
    },
    {
      name: "Different endpoint version",
      baseUrl: "https://apis.alaskaair.com/business/v2/purchase/lookup",
      params: `?confirmationCode=${confirmationCode}&bookingDate=${encodeURIComponent(
        simpleDate
      )}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        Accept: "application/json",
      },
    },
  ];

  for (let i = 0; i < testConfigs.length; i++) {
    const config = testConfigs[i];
    const url = `${config.baseUrl}${config.params}`;

    console.log(`\nðŸ§ª Test ${i + 1}: ${config.name}`);
    console.log(`   URL: ${url}`);
    console.log(`   Headers: ${JSON.stringify(config.headers, null, 2)}`);

    try {
      const response = await axios.get(url, {
        headers: config.headers,
        timeout: 10000,
      });

      console.log(`   âœ… SUCCESS! Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      return { success: true, config, response: response.data };
    } catch (error) {
      console.log(
        `   âŒ Failed: ${error.response?.status || "Network Error"} ${
          error.response?.statusText || error.message
        }`
      );
      if (error.response?.data) {
        console.log(
          `   Error details: ${JSON.stringify(error.response.data, null, 2)}`
        );
      }
    }
  }

  return { success: false, message: "All test configurations failed" };
}

/**
 * Gets actual booking date from Alaska Airlines booking search API
 * @param {string} recordLocator - Booking confirmation code
 * @returns {string} Actual booking date from the API
 */
async function getActualBookingDate(recordLocator) {
  try {
    console.log(`ðŸ“… Getting actual booking date for: ${recordLocator}`);

    const accessToken = await getAccessToken();
    const url = `https://apis.alaskaair.com/aag/1/guestServices/bookings/search/byrecordlocator?includeInActive=true&recordlocator=${recordLocator}`;

    console.log(`ðŸŒ Booking Date API URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.subscriptionKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    if (
      response.data &&
      response.data.bookings &&
      response.data.bookings.length > 0
    ) {
      const booking = response.data.bookings[0];
      // Look for booking date in various possible fields
      const bookingDate =
        booking.bookingDate ||
        booking.createdDate ||
        booking.dateCreated ||
        booking.purchaseDate ||
        booking.transactionDate;

      if (bookingDate) {
        console.log(`âœ… Found booking date: ${bookingDate}`);
        return bookingDate;
      }
    }

    console.log(`âš ï¸ No booking date found in response`);
    return null;
  } catch (error) {
    console.log(
      `âŒ Error getting booking date for ${recordLocator}: ${error.message}`
    );
    return null;
  }
}

/**
 * Calls PNR Business Purchase Lookup API
 * @param {string} confirmationCode - Booking confirmation code (record locator)
 * @param {string} bookingDate - Booking date in appropriate format
 * @returns {Object} API response with purchase/booking data
 */
async function callPNRBusinessAPI(confirmationCode, bookingDate) {
  try {
    console.log(
      `\nðŸ” Calling PNR Business API for: ${confirmationCode} (${bookingDate})`
    );

    // Convert booking date to simple YYYY-MM-DD format
    let formattedDate = bookingDate;
    if (bookingDate.includes("T")) {
      // Remove time component if present (e.g., "2025-10-27T00:00:00.0000000Z" -> "2025-10-27")
      formattedDate = bookingDate.split("T")[0];
    } else if (bookingDate.includes("/")) {
      // Convert MM/DD/YYYY to YYYY-MM-DD
      const parts = bookingDate.split("/");
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[0].padStart(
          2,
          "0"
        )}-${parts[1].padStart(2, "0")}`;
      }
    }

    console.log(`ðŸ“… Using formatted date: ${formattedDate}`);

    // Get the OAuth2 access token that we're already using for the main API
    const accessToken = await getAccessToken();

    // Use the correct URL format from the cURL example
    const url = `https://apis.alaskaair.com/business/1/purchase/lookup?confirmationCode=${confirmationCode}&bookingDate=${formattedDate}`;

    console.log(`ðŸŒ PNR Business API URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Ocp-Apim-Subscription-Key": CONFIG.pnrApi.subscriptionKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    if (response.status === 200 && response.data) {
      console.log(
        `âœ… PNR Business API Success: ${response.status} ${response.statusText}`
      );
      console.log(
        `ðŸ“‹ Response data: ${JSON.stringify(response.data, null, 2)}`
      );

      return {
        confirmationCode,
        bookingDate: formattedDate,
        success: true,
        status: response.status,
        data: response.data,
      };
    }

    return {
      confirmationCode,
      bookingDate: formattedDate,
      success: false,
      error: "No data in response",
      status: response.status,
      data: null,
    };
  } catch (error) {
    console.log(`âŒ PNR Business API Error for ${confirmationCode}:`);
    console.log(
      `   Status: ${error.response?.status} ${
        error.response?.statusText || error.message
      }`
    );

    if (error.response?.data) {
      console.log(
        `   Response: ${JSON.stringify(error.response.data, null, 2)}`
      );
    }

    return {
      confirmationCode,
      bookingDate,
      success: false,
      error: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    };
  }
}

/**
 * Calls Ticket Info API to get detailed ticket information
 * @param {string} ticketNumber - Ticket number from the event data
 * @param {string} ticketingProvider - Marketing airline code (e.g., "AS")
 * @returns {Object} API response with detailed ticket information
 */
async function callTicketInfoAPI(ticketNumber, ticketingProvider) {
  try {
    console.log(
      `\nðŸŽ« Calling Ticket Info API for: ${ticketNumber} (Provider: ${ticketingProvider})`
    );

    // Get OAuth2 access token
    const accessToken = await getAccessToken();

    const url = `${CONFIG.ticketApi.baseUrl}/${ticketNumber}?ticketingProvider=${ticketingProvider}`;

    console.log(`ðŸŒ Ticket Info API URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": CONFIG.ticketApi.subscriptionKey,
        "asgds-appid": CONFIG.ticketApi.appId,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    if (response.status === 200 && response.data) {
      console.log(
        `âœ… Ticket Info API Success: ${response.status} ${response.statusText}`
      );
      console.log(`ðŸ“‹ Ticket data retrieved for: ${ticketNumber}`);

      return {
        ticketNumber,
        ticketingProvider,
        success: true,
        status: response.status,
        data: response.data,
      };
    }

    return {
      ticketNumber,
      ticketingProvider,
      success: false,
      error: "No data in response",
      status: response.status,
      data: null,
    };
  } catch (error) {
    console.log(`âŒ Ticket Info API Error for ${ticketNumber}:`);
    console.log(
      `   Status: ${error.response?.status} ${
        error.response?.statusText || error.message
      }`
    );

    if (error.response?.data) {
      console.log(
        `   Response: ${JSON.stringify(error.response.data, null, 2)}`
      );
    }

    return {
      ticketNumber,
      ticketingProvider,
      success: false,
      error: error.message,
      status: error.response?.status || null,
      data: error.response?.data || null,
    };
  }
}

/**
 * Extracts booking date from booking data for PNR API calls
 * @param {Object} bookingData - Booking response data
 * @returns {string|null} Formatted booking date or null
 */
function extractBookingDate(bookingData) {
  if (!bookingData?.bookings?.length) return null;

  // Get the first booking's date
  const booking = bookingData.bookings[0];
  if (booking.bookingDateCt) {
    // Return date in YYYY-MM-DD format
    return booking.bookingDateCt;
  }

  return null;
}

/**
 * Main function to process CSV and create AFB accrual records
 * @returns {Promise<Array>} Array of AFB customer records with accrual data
 */
/**
 * Process a single CSV file
 */
async function processSingleCsvFile(csvFile) {
  console.log(`\nðŸ“– Processing: ${csvFile}`);
  console.log("==================================");

  // Set up dynamic output files based on CSV filename
  const outputFiles = CONFIG.getOutputFiles(csvFile);
  console.log(
    `ðŸ“ Output directory: ${require("path").dirname(outputFiles.accrualsCsv)}`
  );
  console.log(`ðŸ“„ Processing file: ${csvFile}`);

  const records = [];
  const results = [];
  const afbOnlyResults = [];
  const nonAfbRecords = [];
  const pnr404Records = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on("data", (row) => {
        const recordLocator = extractRecordLocator(row.payload);
        const bookingDate = extractBookingDateFromPayload(row.payload);
        const specificTicketNumber = extractTicketNumberFromPayload(
          row.payload
        );
        if (recordLocator) {
          records.push({
            id: row.operation_Id || row.id || "N/A",
            name: `Passenger Record ${records.length + 1}`,
            description: `Record from ${
              row["timestamp [UTC]"] || row.timestamp || "unknown time"
            }`,
            recordLocator: recordLocator,
            bookingDate: bookingDate,
            specificTicketNumber: specificTicketNumber,
            payload: row.payload,
          });
        }
      })
      .on("end", async () => {
        // Apply test mode limit if enabled
        const recordsToProcess = CONFIG.testMode
          ? records.slice(0, CONFIG.testModeLimit)
          : records;

        if (CONFIG.testMode) {
          console.log(
            `ðŸ§ª TEST MODE: Processing only ${recordsToProcess.length} of ${records.length} records`
          );
        }

        console.log(
          `Found ${records.length} records with valid record locators`
        );
        if (recordsToProcess.length > 0) {
          if (CONFIG.testMode) {
            console.log(
              `ðŸ§ª Processing ${recordsToProcess.length} records in test mode`
            );
          }
          console.log("\n");

          // Process each record sequentially to avoid overwhelming the API
          for (let i = 0; i < recordsToProcess.length; i++) {
            const record = recordsToProcess[i];

            console.log(`ðŸ“‹ Processing Record ${record.id}: ${record.name}`);
            console.log(`Description: ${record.description}\n`);

            try {
              const apiResult = await callAPIForRecord(record.recordLocator);
              const fullResult = {
                ...record,
                apiResult: apiResult,
              };
              results.push(fullResult);

              let allApiCallsSuccessful = apiResult.success;
              let pnrBusinessData = null;
              let ticketData = [];
              let skipReason = "";
              let isPnr404Error = false;

              // Check if this is an AFB customer
              const isAfbCustomer = checkAFBCustomer(apiResult.data);

              if (isAfbCustomer && apiResult.success) {
                console.log(`ðŸ¢ AFB Customer: âœ… YES`);
                console.log(
                  `ðŸ¢ Companies: ${extractCompanyInfo(apiResult.data).join(
                    ", "
                  )}`
                );
                console.log(`ðŸ’³ Processing AFB customer...`);

                // Call PNR Business API for purchase details
                console.log(
                  `ðŸ¢ Calling PNR Business API for purchase details...`
                );
                console.log(
                  `ðŸ“… Using booking date from payload: ${record.bookingDate}\n`
                );

                const pnrResult = await callPNRBusinessAPI(
                  record.recordLocator,
                  record.bookingDate
                );

                if (pnrResult.success) {
                  pnrBusinessData = pnrResult.data;
                  console.log(`âœ… PNR Business data retrieved successfully`);
                } else {
                  if (pnrResult.status === 404) {
                    skipReason = `PNR Business API 404: ${pnrResult.error}`;
                    isPnr404Error = true;
                    allApiCallsSuccessful = false;
                  } else {
                    skipReason = `PNR Business API failed: ${pnrResult.error}`;
                    allApiCallsSuccessful = false;
                  }
                }

                // Call ticket API if we have ticket info and PNR didn't fail with 404
                if (allApiCallsSuccessful || !isPnr404Error) {
                  console.log(
                    "[DEBUG] API payload for ticket info extraction:",
                    JSON.stringify(apiResult.data, null, 2)
                  );
                  // Use ticket number directly from payload for Ticket Info API
                  if (record.specificTicketNumber) {
                    console.log(
                      `ðŸŽ« Calling Ticket Info API for ticket: ${record.specificTicketNumber}`
                    );
                    let ticketResult = await callTicketInfoAPI(
                      record.specificTicketNumber,
                      "AS"
                    );
                    if (ticketResult.success) {
                      ticketData.push(ticketResult.data);
                      console.log(
                        `âœ… Ticket info retrieved for: ${record.specificTicketNumber}`
                      );
                    } else {
                      console.log(
                        `âš ï¸  Ticket info API call failed for: ${record.specificTicketNumber} with provider AS`
                      );
                    }
                  } else {
                    console.log(
                      `âš ï¸  No ticket number found in payload, skipping ticket API call`
                    );
                  }
                }

                // Handle AFB customer scenarios
                if (allApiCallsSuccessful) {
                  // Scenario 1: AFB customer with successful PNR response - add to main AFB results
                  console.log(
                    `ðŸŽ« Processing for specific ticket: ${
                      record.specificTicketNumber || "ALL TICKETS"
                    }`
                  );

                  const accrualData = await extractAccrualData(
                    apiResult.data,
                    record.recordLocator,
                    pnrBusinessData,
                    ticketData,
                    record.specificTicketNumber // Pass the specific ticket number
                  );

                  const enhancedResult = {
                    ...fullResult,
                    accrualRecords: accrualData,
                    pnrBusinessData: pnrBusinessData,
                    ticketData: ticketData,
                  };

                  afbOnlyResults.push(enhancedResult);
                  console.log(
                    `ðŸ¢ âœ… AFB ACCRUAL: Customer with ${accrualData.length} accrual record(s) for specific ticket`
                  );

                  // Display accrual summary
                  accrualData.forEach((accrual, index) => {
                    const issueFlag =
                      accrual.Issues?.length > 0 ? " âš ï¸" : "";
                    console.log(
                      `   ${index + 1}. ${accrual.FirstName} ${
                        accrual.LastName
                      } (MP #${accrual.MileagePlanNumber}) - Ticket: ${
                        accrual.TicketNumber
                      }${issueFlag}`
                    );
                  });
                } else if (isPnr404Error) {
                  // Scenario 3: AFB customer but PNR API returned 404 - add to PNR 404 records
                  pnr404Records.push({
                    ...fullResult,
                    reason: skipReason,
                  });
                  console.log(`ðŸ“ âœ… PNR 404: AFB customer - ${skipReason}`);
                } else {
                  console.log(`ðŸ¢ âŒ SKIPPED: AFB customer - ${skipReason}`);
                }
              } else if (apiResult.success) {
                // Scenario 2: Non-AFB customer - add to non-AFB records
                nonAfbRecords.push(fullResult);
                console.log(`ðŸ“ âœ… NON-AFB: Customer recorded`);
              } else {
                console.log(`âŒ API FAILED: ${apiResult.error}`);
              }

              // Add delay between requests to be respectful to the API
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error) {
              console.error(
                `ðŸ’¥ Error processing record ${record.id}:`,
                error.message
              );
              results.push({
                ...record,
                apiResult: { success: false, error: error.message },
              });
            }
          }

          // Summary - Show all record types
          console.log("\n\nðŸ“Š PROCESSING RESULTS SUMMARY");
          console.log("==========================================");
          if (CONFIG.testMode) {
            console.log(
              `ðŸ§ª TEST MODE: Processed ${recordsToProcess.length} of ${records.length} total records`
            );
          }

          const successful = results.filter((r) => r.apiResult.success);
          const failed = results.filter((r) => !r.apiResult.success);

          console.log(`Total records processed: ${results.length}`);
          console.log(`Successful API calls: ${successful.length}`);
          console.log(`Failed API calls: ${failed.length}`);
          console.log(`ðŸ¢ AFB Accrual records: ${afbOnlyResults.length}`);
          console.log(`ðŸ“ Non-AFB records: ${nonAfbRecords.length}`);
          console.log(`ðŸ“ PNR 404 records: ${pnr404Records.length}`);

          // Show details for AFB customers only
          if (afbOnlyResults.length > 0) {
            console.log("\nðŸ¢ ===== AFB CUSTOMER RECORDS ONLY =====\n");
            afbOnlyResults.forEach((customer, index) => {
              console.log(
                `${index + 1}. Record Locator: ${customer.recordLocator}`
              );
              console.log(`   Name: ${customer.name}`);
              console.log(`   Description: ${customer.description}`);
              console.log(`   AFB Company:`);
              const companies = extractCompanyInfo(customer.apiResult.data);
              companies.forEach((company) => {
                console.log(`     â€¢ AFB CUSTOMER...${company}`);
              });
              console.log("");
            });
          }

          // Flatten all accrual records from AFB customers
          const allAccrualRecords = afbOnlyResults.reduce((acc, customer) => {
            if (customer.accrualRecords) {
              acc.push(...customer.accrualRecords);
            }
            return acc;
          }, []);

          // Apply deduplication to accrual records
          console.log(`ðŸ§¹ Deduplicating accrual records...`);
          const { deduplicatedData, duplicatesRemoved } =
            deduplicateAccrualRecords(allAccrualRecords);
          console.log(`âœ… Deduplication complete:`);
          console.log(`   ðŸ“Š Original records: ${allAccrualRecords.length}`);
          console.log(`   ðŸ—‘ï¸ Duplicates removed: ${duplicatesRemoved}`);
          console.log(`   ✨ Unique records: ${deduplicatedData.length}`);

          // Generate CSV file
          console.log(`ðŸ“‹ Generating AFB Accrual CSV file...`);
          await generateAccrualCSV(deduplicatedData, outputFiles.accrualsCsv);
          console.log(
            `✅ CSV file generated with ${deduplicatedData.length} accrual records from ${afbOnlyResults.length} AFB customers\n`
          );

          // Save all data to JSON files
          try {
            fs.writeFileSync(
              outputFiles.customers,
              JSON.stringify(afbOnlyResults, null, 2)
            );
            console.log(
              `ðŸ’¾ AFB customers data saved to: ${outputFiles.customers}`
            );

            fs.writeFileSync(
              outputFiles.accruals,
              JSON.stringify(deduplicatedData, null, 2)
            );
            console.log(
              `ðŸ’° Accrual records saved to: ${outputFiles.accruals}`
            );

            console.log(
              `ðŸ“‹ Accrual CSV saved to: ${outputFiles.accrualsCsv}`
            );
            console.log(
              `ðŸ“Š Total accrual records created: ${deduplicatedRecords.length}`
            );

            // Generate CSV for non-AFB records
            if (nonAfbRecords.length > 0) {
              const nonAfbCsvData = nonAfbRecords.map((record) => ({
                RecordLocator: record.recordLocator,
                RecordId: record.id,
                Name: record.name,
                Description: record.description,
                BookingDate: record.bookingDate,
                APIStatus: record.apiResult.success ? "Success" : "Failed",
                APIError: record.apiResult.error || "",
              }));

              const nonAfbCsvContent = [
                Object.keys(nonAfbCsvData[0]).join(","),
                ...nonAfbCsvData.map((row) => Object.values(row).join(",")),
              ].join("\n");

              fs.writeFileSync(outputFiles.nonAfbCsv, nonAfbCsvContent);
            }
            console.log(
              `ðŸ“ Non-AFB records CSV saved to: ${outputFiles.nonAfbCsv}`
            );
            console.log(`ðŸ“Š Non-AFB records count: ${nonAfbRecords.length}`);

            // Generate CSV for PNR 404 records
            if (pnr404Records.length > 0) {
              const pnr404CsvData = pnr404Records.map((record) => ({
                RecordLocator: record.recordLocator,
                RecordId: record.id,
                Name: record.name,
                Description: record.description,
                BookingDate: record.bookingDate,
                Reason: record.reason,
                APIError: record.apiResult.error || "",
              }));

              const pnr404CsvContent = [
                Object.keys(pnr404CsvData[0]).join(","),
                ...pnr404CsvData.map((row) => Object.values(row).join(",")),
              ].join("\n");

              fs.writeFileSync(outputFiles.pnr404Csv, pnr404CsvContent);
            }
            console.log(
              `ðŸ“ PNR 404 records CSV saved to: ${outputFiles.pnr404Csv}`
            );
            console.log(`ðŸ“Š PNR 404 records count: ${pnr404Records.length}`);
          } catch (error) {
            console.error("ðŸ’¥ Error saving files:", error.message);
          }

          // Return results summary
          resolve({
            summary: {
              totalProcessed: results.length,
              successful: successful.length,
              failed: failed.length,
              afbCount: afbOnlyResults.length,
              nonAfbCount: nonAfbRecords.length,
              pnr404Count: pnr404Records.length,
            },
            allResults: results,
            afbCustomers: afbOnlyResults,
            nonAfbRecords: nonAfbRecords,
            pnr404Records: pnr404Records,
            accrualRecords: deduplicatedData,
          });
        } else {
          console.log("âŒ No valid records found in CSV file");
          resolve({
            summary: {
              totalProcessed: 0,
              successful: 0,
              failed: 0,
              afbCount: 0,
              nonAfbCount: 0,
              pnr404Count: 0,
            },
            allResults: [],
            afbCustomers: [],
            nonAfbRecords: [],
            pnr404Records: [],
            accrualRecords: [],
          });
        }
      })
      .on("error", (error) => {
        console.error("Error reading CSV file:", error);
        reject(error);
      });
  });
}

/**
 * Process multiple CSV files
 */
async function processCsvAndCallAPI() {
  console.log("ðŸ“– AFB Customer Accrual Processor - Multiple Files");
  console.log("==================================================");
  console.log("ðŸ¢ Filtering for AFB customers only\n");

  // Initialize authentication
  try {
    await getAccessToken();
  } catch (error) {
    console.error("ðŸ’¥ Failed to initialize authentication. Exiting.");
    throw error;
  }

  const allResults = {
    summary: {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      afbCount: 0,
      nonAfbCount: 0,
      pnr404Count: 0,
    },
    allResults: [],
    afbCustomers: [],
    nonAfbRecords: [],
    pnr404Records: [],
    accrualRecords: [],
  };

  // Process each CSV file
  for (const csvFile of CONFIG.csvFiles) {
    try {
      const fileResults = await processSingleCsvFile(csvFile);

      // Aggregate results
      allResults.summary.totalProcessed += fileResults.summary.totalProcessed;
      allResults.summary.successful += fileResults.summary.successful;
      allResults.summary.failed += fileResults.summary.failed;
      allResults.summary.afbCount += fileResults.summary.afbCount;
      allResults.summary.nonAfbCount += fileResults.summary.nonAfbCount;
      allResults.summary.pnr404Count += fileResults.summary.pnr404Count;

      allResults.allResults.push(...fileResults.allResults);
      allResults.afbCustomers.push(...fileResults.afbCustomers);
      allResults.nonAfbRecords.push(...fileResults.nonAfbRecords);
      allResults.pnr404Records.push(...fileResults.pnr404Records);
      allResults.accrualRecords.push(...fileResults.accrualRecords);
    } catch (error) {
      console.error(`ðŸ’¥ Error processing file ${csvFile}:`, error.message);
    }
  }

  return allResults;
}

/**
 * Entry point when script is run directly
 */
if (require.main === module) {
  processCsvAndCallAPI()
    .then((results) => {
      console.log(`\nðŸŽ‰ Multi-File Processing Complete!`);
      console.log(`ðŸ“Š OVERALL SUMMARY:`);
      console.log(
        `   Total records processed: ${results.summary.totalProcessed}`
      );
      console.log(`   Successful API calls: ${results.summary.successful}`);
      console.log(`   Failed API calls: ${results.summary.failed}`);
      console.log(`   ðŸ¢ AFB accrual records: ${results.summary.afbCount}`);
      console.log(`   ðŸ“ Non-AFB records: ${results.summary.nonAfbCount}`);
      console.log(`   ðŸ“ PNR 404 records: ${results.summary.pnr404Count}`);

      if (results.afbCustomers.length > 0) {
        const totalAccruals = results.accrualRecords.length;
        console.log(`ðŸ’° Total accrual records created: ${totalAccruals}`);
        console.log(
          `ðŸ“„ All output files generated successfully for each month`
        );
        console.log(`\nðŸ“‹ Next steps:`);
        console.log(`   1. Review AFB accrual records for accuracy`);
        console.log(`   2. Process non-AFB records as needed`);
        console.log(`   3. Investigate PNR 404 records for resolution`);
        console.log(`   4. Submit AFB records to mileage plan system`);

        // Test Member Info API if we have AFB customers
        console.log(`\nðŸ§ª Testing Member Info API...`);
        if (results.afbCustomers[0]?.accrualRecords?.[0]?.MileagePlanNumber) {
          const testMpNumber =
            results.afbCustomers[0].accrualRecords[0].MileagePlanNumber;
          console.log(`Testing with MP #${testMpNumber}...`);
          // We could add a test call here if needed
        }
      } else {
        console.log(`âš ï¸  No AFB customers found in the input data`);
      }

      process.exit(0);
    })
    .catch((error) => {
      console.error("\nðŸ’¥ Processing failed:", error.message);
      console.error("Please check the input data and API configuration");
      process.exit(1);
    });
}

module.exports = {
  processCsvAndCallAPI,
  callAPIForRecord,
  callPNRBusinessAPI,
  extractRecordLocator,
  extractBookingDate,
  checkAFBCustomer,
  extractAccrualData,
  extractCompanyInfo,
  getAccessToken,
};
