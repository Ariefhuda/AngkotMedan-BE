const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_PATH = path.join(DATA_DIR, "trayek_angkot_medan.csv");
const COORDS_PATH = path.join(DATA_DIR, "stop_coords.json");

async function main() {
  const records = parse(fs.readFileSync(CSV_PATH, "utf-8"), { columns: true, skip_empty_lines: true });
  const coords = JSON.parse(fs.readFileSync(COORDS_PATH, "utf-8"));
  console.log(`${records.length} trayek di CSV, ${Object.keys(coords).length} halte punya koordinat`);

  // Halte dicari lewat nama, jadi disimpan di Map supaya tidak query berulang.
  const stopIds = new Map((await prisma.stop.findMany()).map((s) => [s.name, s.id]));

  for (const record of records) {
    const waypoints = record.waypoints_joined
      ? record.waypoints_joined.split(" | ").map((w) => w.trim()).filter(Boolean)
      : [];

    // Kode memakai kolom id (R001, ...). Nomor angkot tidak unik: dua operator bisa memakai nomor yang sama.
    const data = {
      operator: record.operator,
      number: record.nomor || record.id,
      color: record.warna === "-" ? null : record.warna,
      origin: record.asal,
      destination: record.tujuan,
      roundTrip: record.pulang_pergi === "True",
      waypoints,
    };
    const route = await prisma.route.upsert({
      where: { code: record.id },
      update: data,
      create: { code: record.id, ...data },
    });

    await prisma.routeStop.deleteMany({ where: { routeId: route.id } });
    const seen = new Set();
    for (let i = 0; i < waypoints.length; i++) {
      const name = waypoints[i];
      const [latitude, longitude] = coords[name] || [null, null];

      let stopId = stopIds.get(name);
      if (stopId) {
        await prisma.stop.update({ where: { id: stopId }, data: { latitude, longitude } });
      } else {
        stopId = (await prisma.stop.create({ data: { name, latitude, longitude } })).id;
        stopIds.set(name, stopId);
      }

      // Halte yang muncul dua kali di satu trayek (rute memutar) hanya dicatat sekali.
      if (seen.has(stopId)) continue;
      seen.add(stopId);
      await prisma.routeStop.create({ data: { routeId: route.id, stopId, order: i } });
    }
  }

  const [routes, stops, withCoords] = await Promise.all([
    prisma.route.count(),
    prisma.stop.count(),
    prisma.stop.count({ where: { latitude: { not: null } } }),
  ]);
  console.log(`Selesai. Trayek: ${routes}, halte: ${stops} (${withCoords} dengan koordinat)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
