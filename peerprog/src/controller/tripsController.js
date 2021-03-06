const { pool } = require('../dao');
const { findVehicleWithId, findUserWithId } = require('../utils/helper');
const { deleteSensitive } = require('../utils/utility');

exports.addVehicleAvailability = async (req, res) => {
  const {
    fromDate,
    toDate,
    fromLocation,
    toLocation,
    userId,
    vehicleId,
    orgId,
    price
  } = req.body;
  if (
    !fromDate ||
    !toDate ||
    !fromLocation ||
    !toLocation ||
    !userId ||
    !vehicleId ||
    !orgId ||
    !price
  )
    return res.status(404).json({ message: 'insufficient data' });

  try {
    const user = await findUserWithId(userId);
    if (user.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }
    const vehicle = await pool.query(
      'SELECT * FROM "VEHICLE" LEFT JOIN "VEHICLE_IMAGES" ON "VEHICLE_IMAGES"."VEHICLE_ID" = "VEHICLE"."ID" WHERE "ORG_ID" = $1 AND "VEHICLE"."ID" = $2 AND "DELETED" = $3',
      [orgId, vehicleId, false]
    );
    if (vehicle.rowCount === 0) {
      return res.status(200).json({
        message: 'This profile does not contain any vehicles',
        vehicles: []
      });
    }
    const tripsCheck = await pool.query(
      'SELECT * FROM "TRIPS" WHERE "VEHICLE_ID" = $1 AND "TRIPS"."DELETED" = $2',
      [vehicleId, false]
    );
    if (tripsCheck.rowCount !== 0) {
      for (let i = 0; i < tripsCheck.rows.length; i++) {
        const expiresAt = new Date(tripsCheck.rows[i].TO_DATE);
        const today = new Date();
        expiresAt.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        if (expiresAt >= today) {
          return res.status(400).json({
            message: 'This trip already exists',
            vehicles: []
          });
        }
      }
    }

    await pool.query(
      'INSERT INTO "TRIPS" ("FROM_LOCATION", "TO_LOCATION", "DRIVER_ID", "ORG_ID", "VEHICLE_ID", "FROM_DATE", "TO_DATE" , "PRICE", "STATUS") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [
        fromLocation,
        toLocation,
        userId,
        orgId,
        vehicleId,
        fromDate,
        toDate,
        price,
        true
      ]
    );
    const IS_AVAILABLE = true;
    const vehicleResponse = await pool.query(
      'UPDATE "VEHICLE" SET "IS_AVAILABLE" = $1 WHERE "ID" = $2  RETURNING *',
      [IS_AVAILABLE, vehicleId]
    );
    res.json({
      vehicleDetails: vehicleResponse.rows[0],
      message: 'You have successfully added availability to the vehicle'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.removeVehicleAvailability = async (req, res) => {
  const { id } = req.params;
  const { vehicleId, orgId } = req.body;
  if (!id || !vehicleId || !orgId)
    return res.status(404).json({ message: 'insufficient data' });

  try {
    const vehicle = await pool.query(
      'SELECT * FROM "VEHICLE" LEFT JOIN "VEHICLE_IMAGES" ON "VEHICLE_IMAGES"."VEHICLE_ID" = "VEHICLE"."ID" WHERE "ORG_ID" = $1 AND "VEHICLE"."ID" = $2 AND "DELETED" = $3',
      [orgId, vehicleId, false]
    );
    if (vehicle.rowCount === 0) {
      return res.status(200).json({
        message: 'This profile does not possess this vehicle',
        vehicles: []
      });
    }
    const tripsCheck = await pool.query(
      'SELECT * FROM "TRIPS" WHERE "ID" = $1 AND "TRIPS"."DELETED" = $2',
      [id, false]
    );
    if (tripsCheck.rowCount === 0) {
      return res.status(200).json({
        message: 'This trip does not exist',
        vehicles: []
      });
    }
    if (tripsCheck.rows[0].ORG_ID !== orgId)
      return res
        .status(403)
        .json({ message: 'This trip is not created by this user' });

    if (tripsCheck.rows[0].VEHICLE_ID !== vehicleId)
      return res
        .status(403)
        .json({ message: 'This trip is not created with this vehicle' });

    // await pool.query('DELETE FROM "TRIPS" WHERE "ID" = $1 ', [id]);

    await pool.query('UPDATE "TRIPS" SET "DELETED" = $1 WHERE "ID" = $2 ', [
      true,
      id
    ]);

    const IS_AVAILABLE = false;
    const vehicleResponse = await pool.query(
      'UPDATE "VEHICLE" SET "IS_AVAILABLE" = $1 WHERE "ID" = $2  RETURNING *',
      [IS_AVAILABLE, vehicleId]
    );
    res.json({
      vehicleDetails: vehicleResponse.rows[0],
      message: 'The trip has been successfully removed'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTripDetails = async (req, res) => {
  const { id } = req.params;
  if (!id) res.status(404).json({ message: 'insufficient data' });

  try {
    const trips = await pool.query(
      'SELECT * FROM "TRIPS" WHERE "VEHICLE_ID" = $1 AND "TRIPS"."DELETED" = $2 ',
      [id, false]
    );
    res.status(200).json({ trip: trips.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.editTripDetails = async (req, res) => {
  const {
    fromDate,
    toDate,
    fromLocation,
    toLocation,
    userId,
    vehicleId,
    orgId,
    price
  } = req.body;
  if (
    !fromDate ||
    !toDate ||
    !fromLocation ||
    !toLocation ||
    !userId ||
    !vehicleId ||
    !orgId ||
    !price
  )
    return res.status(404).json({ message: 'insufficient data' });

  try {
    const tripExist = await pool.query(
      'SELECT "ID" FROM "TRIPS" WHERE "VEHICLE_ID" = $1 AND "TRIPS"."DELETED" = $2',
      [vehicleId, false]
    );
    if (tripExist.rowCount === 0) {
      return res.status(404).json({ message: 'Trip Does not exist' });
    }

    const trips = await pool.query(
      'UPDATE "TRIPS" SET "FROM_LOCATION" = $1, "TO_LOCATION" = $2, "DRIVER_ID" = $3, "ORG_ID" = $4, "VEHICLE_ID" = $5, "FROM_DATE" = $6, "TO_DATE" = $7 , "PRICE" = $8 WHERE "VEHICLE_ID" = $9',
      [
        fromLocation,
        toLocation,
        userId,
        orgId,
        vehicleId,
        fromDate,
        toDate,
        price,
        vehicleId
      ]
    );
    res.status(200).json({ trip: trips.rows[0] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
exports.getSpecificTripDetails = async (req, res) => {
  const { vehicleId, userId } = req.body;
  if (!vehicleId) res.status(404).json({ message: 'insufficient data' });

  try {
    const trips = await pool.query(
      `SELECT "T"."ID" as "TRIP_ID", "T"."FROM_LOCATION" as "FROM_LOCATION", "T"."TO_LOCATION" AS "TO_LOCATION",
      "T"."CAPACITY" AS "CAPACITY", "T"."FROM_DATE" AS "FROM_DATE", "T"."TO_DATE" AS "TO_DATE", "T"."PRICE" AS "PRICE",
      "U"."ID" AS "USER_ID", "U"."NAME" AS "NAME", "U"."EMAIL" AS "EMAIL", "U"."MOBILE" AS "MOBILE", "U"."ROLE" AS "ROLE",
      "U"."ROLE_CODE" AS "ROLE_CODE", "U"."DRIVER_LICENCE_NO" AS "DRIVER_LICENCE_NO", "U"."YEAR_OF_EXPERIENCE" AS "YEAR_OF_EXPERIENCE",
      "U"."DRIVER_LICENCE_VALIDITY" AS "DRIVER_LICENCE_VALIDITY", "V"."REG_NO" AS "REG_NO", "V"."CAPACITY_UNIT" AS "CAPACITY_UNIT",
      "V"."TYPE" AS "TYPE" , "V"."VEHICLE_NAME" AS "VEHICLE_NAME", "V"."CATEGORY_CODE" AS "CATEGORY_CODE", "V"."MODEL_YEAR" AS "MODEL_YEAR",
      "V"."RC_VALIDITY" AS "RC_VALIDITY" , "V"."OWNERSHIP" AS "OWNERSHIP", "V"."OWNER_NAME" AS "OWNERNAME", "V"."CITY" AS "CITY",
      "V"."IS_AVAILABLE" AS "IS_AVAILABLE", "V"."ID" AS "ID" , "VI"."IMAGE" AS "IMAGE", "V"."ID" AS "ID" 
	  , "B"."CUSTOMER_ID" AS "CUSTOMER_ID", "O"."NAME" AS "ORG_NAME"
      FROM "TRIPS" "T" LEFT JOIN "USERS" "U" ON "T"."DRIVER_ID" = "U"."ID"
      LEFT JOIN "VEHICLE" "V" ON "T"."VEHICLE_ID" = "V"."ID" AND "V"."DELETED" = false 
      LEFT JOIN "ORGANIZATION" "O" ON "T"."ORG_ID" = "O"."ID"
      LEFT JOIN "BOOKING" "B" ON "T"."ID" = "B"."TRIP_ID" AND "B"."CUSTOMER_ID" = $1
      LEFT JOIN "VEHICLE_IMAGES" "VI" ON "V"."ID" = "VI"."VEHICLE_ID" WHERE "T"."VEHICLE_ID" = $2 AND "T"."DELETED" = $3`,
      [userId, vehicleId, false]
    );

    if (trips.rowCount === 0)
      return res.status(404).json({ message: 'Trip Not found' });

    let isBooked = trips.rows[0]?.CUSTOMER_ID ? true : false;

    res.status(200).json({ trip: trips.rows[0], isBooked: isBooked });
  } catch (error) {
    res.status(500).json({ message: error.message, trip: {} });
  }
};
