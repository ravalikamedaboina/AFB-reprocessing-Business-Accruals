# AFB Non-Flight Accrual Processing Report

## Summary

- **Processing Date:** 2025-11-17
- **Total AFB Customers Processed:** 2
- **Total Accrual Records Created:** 4
- **Product Code:** EZEZP
- **Partner Code:** AFB

## AFB Customer Records

### 1. Record Locator: AJCLRU

- **Customer:** BMK CONSTRUCTION LLC
- **Passenger:** DOMINGO PEREZ
- **Accrual Records:** 2

#### Accrual Record 1:

- **MileagePlanNumber:** 135134812
- **LastName:** PEREZ
- **FirstName:** DOMINGO
- **ProductCode:** EZEZP
- **PartnerCode:** AFB
- **PartnerRefCD:** AJCLRU0272122016026
- **TransactionDate:** 2025-10-27
- **NoOfPoints:** 200
- **TicketNumber:** 0272122016026

#### Accrual Record 2:

- **MileagePlanNumber:** 135134812
- **LastName:** PEREZ
- **FirstName:** DOMINGO
- **ProductCode:** EZEZP
- **PartnerCode:** AFB
- **PartnerRefCD:** AJCLRU0272121615901
- **TransactionDate:** 2025-10-27
- **NoOfPoints:** 200
- **TicketNumber:** 0272121615901

### 2. Record Locator: OKTHTR

- **Customer:** LYNDEN, INC.
- **Passengers:** DANIEL RIEHLE, JESSE HALL
- **Accrual Records:** 2

#### Accrual Record 1:

- **MileagePlanNumber:** NO_MP_NUMBER ⚠️
- **LastName:** RIEHLE
- **FirstName:** DANIEL
- **ProductCode:** EZEZP
- **PartnerCode:** AFB
- **PartnerRefCD:** OKTHTR0272115296080
- **TransactionDate:** 2025-08-23
- **NoOfPoints:** 100
- **TicketNumber:** 0272115296080
- **⚠️ Issues:** NO_MILEAGE_PLAN_NUMBER

#### Accrual Record 2:

- **MileagePlanNumber:** 131830300
- **LastName:** HALL
- **FirstName:** JESSE
- **ProductCode:** EZEZP
- **PartnerCode:** AFB
- **PartnerRefCD:** OKTHTR0272120072991
- **TransactionDate:** 2025-10-12
- **NoOfPoints:** 100
- **TicketNumber:** 0272120072991

## Data Mapping for Non-Flight Accrual

The following data mappings were implemented for accrual creation:

| Accrual Field     | Data Source                             | Notes                                                    |
| ----------------- | --------------------------------------- | -------------------------------------------------------- |
| MileagePlanNumber | purchaseRecord.CompanyMileagePlan       | Extracted from loyaltyInfo with airlineCode 'AS'         |
| LastName          | mpMemberResponse.MemberProfile.LastName | From passenger lastName                                  |
| FirstName         | N/A                                     | From passenger firstName                                 |
| ProductCode       | EZEZP                                   | Static value for non-flight accrual                      |
| PartnerCode       | AFB                                     | Static value for Alaska for Business                     |
| PartnerRefCD      | recordLocator + ticketNumber            | Concatenated unique identifier                           |
| TransactionDate   | purchaseRecord.BookingDate              | From booking date                                        |
| NoOfPoints        | totalBaseAmount                         | Calculated from ticket details (placeholder calculation) |

## Issues Identified

1. **Missing Mileage Plan Numbers:** 1 record (Daniel Riehle) has no mileage plan number
2. **Base Amount Calculation:** Currently using placeholder values (100-200 points per ticket)
3. **Multiple Bookings:** Record locator OKTHTR has multiple bookings with different dates

## Next Steps

1. **Resolve Missing MP Numbers:** Contact passengers without mileage plan numbers
2. **Implement Real Base Amount Calculation:** Extract actual fare amounts from ticket details
3. **Validation:** Verify company information matches AFB customer database
4. **Processing:** Submit accrual records to mileage plan system

## Files Generated

- `afb-customers-only.json` - Complete AFB customer booking data
- `afb-accrual-records.json` - Structured accrual records ready for processing
- `accrual-summary-report.md` - This summary report
