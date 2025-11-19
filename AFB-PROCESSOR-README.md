# AFB Customer Accrual Processor

## Overview

This tool processes CSV files containing passenger booking data, filters for Alaska for Business (AFB) customers, and creates non-flight accrual records for business travel rewards.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Prepare Input Data

Place your CSV file with passenger records in the root directory as `sample-payload.csv`.

### 3. Run the Processor

```bash
npm run process-afb
```

## Configuration

Edit the `CONFIG` object in `csv-api-processor.js` to customize:

- **Input File**: `csvFile` - Path to CSV with passenger data
- **API Settings**: `apiBaseUrl`, `subscriptionKey` - Alaska Airlines API configuration
- **OAuth2 Settings**: `oauth` object with token URL and credentials
- **Output Files**: `outputFiles` - Where to save processed data
- **Accrual Settings**: `productCode`, `partnerCode` - Business rules

### OAuth2 Authentication

The system now uses OAuth2 client credentials flow for secure API access:

```javascript
oauth: {
  tokenUrl: "https://www.auth.alaskaair.com/oauth2/default/v1/token",
  authHeader: "Basic <encoded_credentials>",
  grantType: "client_credentials",
  scope: "guest_profile.search"
}
```

**Features:**

- ✅ Automatic token retrieval and caching
- ✅ Token refresh before expiration
- ✅ Secure Bearer token authentication
- ✅ Fallback to subscription key if needed

## Output Files

### 1. `afb-customers-only.json`

Complete booking data for AFB customers only, including:

- Passenger information
- Company details
- Flight segments
- Booking history

### 2. `afb-accrual-records.json`

Structured accrual records ready for mileage plan processing:

```json
{
  "summary": {
    "totalAFBCustomers": 2,
    "totalAccrualRecords": 4,
    "processedDate": "2025-11-17T18:32:20.488Z",
    "productCode": "EZEZP",
    "partnerCode": "AFB"
  },
  "accrualRecords": [
    {
      "MileagePlanNumber": "135134812",
      "LastName": "PEREZ",
      "FirstName": "DOMINGO",
      "ProductCode": "EZEZP",
      "PartnerCode": "AFB",
      "PartnerRefCD": "AJCLRU0272122016026",
      "TransactionDate": "2025-10-27",
      "NoOfPoints": "200"
    }
  ]
}
```

### 3. `accrual-summary-report.md`

Human-readable summary report with statistics and issues.

## Features

- ✅ **OAuth2 Authentication** - Secure token-based API access with automatic refresh
- ✅ **AFB Customer Detection** - Automatically identifies AFB customers from booking remarks
- ✅ **Mileage Plan Integration** - Extracts loyalty numbers and creates accrual records
- ✅ **Error Handling** - Identifies missing data and validation issues
- ✅ **Rate Limiting** - Respectful API usage with delays between requests
- ✅ **Token Caching** - Efficient OAuth2 token management
- ✅ **Comprehensive Logging** - Detailed processing logs and summaries## Data Flow

1. **CSV Input** → Read passenger records with booking payloads
2. **API Calls** → Retrieve full booking data from Alaska Airlines API
3. **AFB Filtering** → Keep only bookings with "AFB CUSTOMER" remarks
4. **Data Extraction** → Extract mileage plan numbers, tickets, fare amounts
5. **Accrual Creation** → Generate non-flight accrual records
6. **Output** → Save structured data and reports

## Common Issues

### Missing Mileage Plan Numbers

Some passengers may not have Alaska Airlines mileage plan accounts. These are flagged with:

```
Issues: ["NO_MILEAGE_PLAN_NUMBER"]
```

### Multiple Bookings

Record locators may have multiple bookings with different dates - each is processed separately.

### Fare Calculation

Currently uses placeholder amounts (100-200 points per ticket). Update `extractTicketInfo()` function for real fare calculation.

## API Requirements

- Valid Alaska Airlines OAuth2 client credentials
- API subscription key for Alaska Airlines booking search API
- Network access to:
  - `www.auth.alaskaair.com` (OAuth2 token endpoint)
  - `apis.alaskaair.com` (Booking search API)
- Proper authentication headers and scopes

### Authentication Flow

1. **OAuth2 Token Request** - Gets Bearer token using client credentials
2. **Token Caching** - Stores token until 90% of expiration time
3. **API Calls** - Uses Bearer token + subscription key for API requests
4. **Auto Refresh** - Automatically gets new token when needed

## Support

For issues or questions:

1. Check the console output for error messages
2. Verify CSV file format matches expected structure
3. Confirm API credentials and network connectivity
4. Review the generated summary report for processing details
