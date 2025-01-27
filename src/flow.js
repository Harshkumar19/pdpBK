// flow.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const SCREEN_RESPONSES = {
  SCHEDULE: {
    screen: "SCHEDULE",
    data: {
      appointment_type: [
        { id: "online", title: "Online" },
        { id: "offline", title: "In-Store" },
      ],
      gender: [
        { id: "male", title: "Male" },
        { id: "female", title: "Female" },
        { id: "unisex", title: "Unisex" },
      ],
      appointment_time: [
        { id: "slot_00_01", title: "12:00 AM - 01:00 AM" },
        { id: "slot_03_04", title: "03:00 AM - 04:00 AM" },
        { id: "slot_06_07", title: "06:00 AM - 07:00 AM" },
        { id: "slot_09_10", title: "09:00 AM - 10:00 AM" },
        { id: "slot_12_13", title: "12:00 PM - 01:00 PM" },
        { id: "slot_15_16", title: "03:00 PM - 04:00 PM" },
        { id: "slot_18_19", title: "06:00 PM - 07:00 PM" },
        { id: "slot_21_22", title: "09:00 PM - 10:00 PM" },
      ],
    },
  },
  SUCCESS: {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token: "flows-builder-db50c614",
          appointment_confirmed: true,
          message: "",
        },
      },
    },
  },
};

export const getNextScreen = async (decryptedBody) => {
  const { action, screen, data, flow_token } = decryptedBody;

  // Handle health check
  if (action === "ping") {
    return {
      data: {
        status: "active",
      },
    };
  }

  // Handle error notification
  if (data?.error) {
    console.warn("Received client error:", data);
    return {
      data: {
        acknowledged: true,
      },
    };
  }

  // Handle initial request
  if (action === "INIT") {
    return {
      ...SCREEN_RESPONSES.SCHEDULE,
    };
  }

  if (action === "data_exchange") {
    switch (screen) {
      case "SCHEDULE":
        try {
          const timeSlot = SCREEN_RESPONSES.SCHEDULE.data.appointment_time.find(
            (slot) => slot.id === data.appointment_time
          );

          const appointmentData = {
            appointment_type: data.appointment_type,
            gender: data.gender,
            appointment_date: data.appointment_date,
            appointment_time: timeSlot ? timeSlot.title : data.appointment_time,
            notes: data.notes || "No additional notes provided.",
            created_at: new Date().toISOString(),
            flow_token: flow_token,
          };

          await pool.query(
            "INSERT INTO appointments (appointment_type, gender, appointment_date, appointment_time, notes) VALUES ($1, $2, $3, $4, $5)",
            [
              appointmentData.appointment_type,
              appointmentData.gender,
              appointmentData.appointment_date,
              appointmentData.appointment_time,
              appointmentData.notes,
            ]
          );

          console.log("Appointment saved to PostgreSQL:", appointmentData);

          const locationText =
            data.appointment_type === "online"
              ? "We'll send you the meeting link before the appointment."
              : "We look forward to seeing you at our store!";

          return {
            ...SCREEN_RESPONSES.SUCCESS,
            data: {
              extension_message_response: {
                params: {
                  flow_token,
                  appointment_confirmed: true,
                  message: `Your ${
                    data.appointment_type
                  } appointment has been scheduled for ${
                    data.appointment_date
                  } at ${
                    timeSlot ? timeSlot.title : data.appointment_time
                  }. ${locationText}`,
                },
              },
            },
          };
        } catch (error) {
          console.error("Error saving appointment:", error);
          throw error;
        }

      default:
        console.error("Unhandled screen:", screen);
        throw new Error(`Unhandled screen type: ${screen}`);
    }
  }

  console.error("Unhandled request body:", decryptedBody);
  throw new Error("Unhandled endpoint request.");
};
