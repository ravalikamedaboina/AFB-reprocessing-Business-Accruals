const axios = require("axios");

async function testMRGESV() {
  console.log("Testing MRGESV record locator...");

  const url =
    "https://apis.alaskaair.com/aag/1/guestServices/bookings/search/byrecordlocator";
  const params = {
    includeInActive: true,
    recordlocator: "MRGESV",
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: {
        "Ocp-Apim-Subscription-Key": "8fa1ef7cdaff40a6afa90ead0b9d8dc4",
        Accept: "application/json",
      },
    });

    console.log("✅ API Success: 200 OK");
    console.log("Number of bookings:", response.data.bookings?.length || 0);

    if (response.data.bookings) {
      response.data.bookings.forEach((booking, index) => {
        console.log(`\nBooking ${index}:`);
        console.log(`  BookingDateTimeCt: ${booking.bookingDateTimeCt}`);
        console.log(`  BookingStatus: ${booking.bookingStatus}`);

        // Check for AFB remarks
        let hasAFB = false;
        if (booking.remarks) {
          booking.remarks.forEach((remark, remarkIndex) => {
            if (remark.remarkLines?.toLowerCase().includes("afb customer")) {
              hasAFB = true;
              console.log(
                `  ✅ AFB CUSTOMER found at remark ${remarkIndex}: ${remark.remarkLines}`
              );
            }
          });
        }

        if (!hasAFB) {
          console.log(`  ❌ No AFB customer remarks found`);
        }
      });

      // Determine which booking should be used for AFB
      let afbBookingIndex = null;
      response.data.bookings.forEach((booking, index) => {
        booking.remarks?.forEach((remark) => {
          if (remark.remarkLines?.toLowerCase().includes("afb customer")) {
            if (afbBookingIndex === null) {
              afbBookingIndex = index;
            }
          }
        });
      });

      console.log(`\n🎯 AFB Booking Index: ${afbBookingIndex}`);
      if (afbBookingIndex !== null) {
        const afbBooking = response.data.bookings[afbBookingIndex];
        console.log(`🗓️ AFB Booking Date: ${afbBooking.bookingDateTimeCt}`);

        // Convert to UTC
        const { parseISO } = require("date-fns");
        const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");
        try {
          const centralDate = parseISO(afbBooking.bookingDateTimeCt);
          const utcDate = fromZonedTime(centralDate, "America/Chicago");
          const formattedUtcDate = formatInTimeZone(
            utcDate,
            "UTC",
            "yyyy-MM-dd"
          );
          console.log(`🌍 Converted to UTC: ${formattedUtcDate}`);
        } catch (error) {
          console.error(`❌ UTC conversion failed: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error("❌ API Error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
  }
}

testMRGESV()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
