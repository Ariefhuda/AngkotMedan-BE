const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const prisma = new PrismaClient();

const CSV_PATH = path.join(__dirname, "..", "..", "trayek_angkot_medan.csv");

async function main() {
  console.log("Reading CSV file...");
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const records = parse(csv, { columns: true, skip_empty_lines: true });

  console.log(`Found ${records.length} routes in CSV`);

  for (const record of records) {
    const waypoints = record.waypoints_joined
      ? record.waypoints_joined.split(" | ").map((w) => w.trim())
      : [];

    const route = await prisma.route.upsert({
      where: { code: record.nomor || record.id },
      update: {
        operator: record.operator,
        number: record.nomor || record.id,
        color: record.warna === "-" ? null : record.warna,
        origin: record.asal,
        destination: record.tujuan,
        roundTrip: record.pulang_pergi === "True",
        waypoints,
      },
      create: {
        code: record.nomor || record.id,
        operator: record.operator,
        number: record.nomor || record.id,
        color: record.warna === "-" ? null : record.warna,
        origin: record.asal,
        destination: record.tujuan,
        roundTrip: record.pulang_pergi === "True",
        waypoints,
      },
    });

    for (let i = 0; i < waypoints.length; i++) {
      const stopName = waypoints[i];

      let stop = await prisma.stop.findFirst({
        where: { name: stopName },
      });

      if (!stop) {
        stop = await prisma.stop.create({
          data: { name: stopName },
        });
      }

      await prisma.routeStop.upsert({
        where: {
          routeId_stopId: { routeId: route.id, stopId: stop.id },
        },
        update: { order: i },
        create: {
          routeId: route.id,
          stopId: stop.id,
          order: i,
        },
      });
    }

    console.log(`Seeded: ${record.id} - ${record.nomor} (${record.asal} -> ${record.tujuan})`);
  }

  const routeCount = await prisma.route.count();
  const stopCount = await prisma.stop.count();
  const routeStopCount = await prisma.routeStop.count();

  console.log(`\nDone! Routes: ${routeCount}, Stops: ${stopCount}, RouteStops: ${routeStopCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });