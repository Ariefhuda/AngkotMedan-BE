const express = require("express");
const router = express.Router();
const {
  findNearbyRoutes,
  getRouteDetail,
  searchStops,
  getAllRoutes,
  findRouteBetween,
} = require("../controllers/angkot.js");

// Ambil angka dari query string; null kalau kosong atau bukan angka.
function num(value) {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

router.get("/routes", async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    if (lat === undefined && lng === undefined) {
      return res.json(await getAllRoutes());
    }
    const la = num(lat), ln = num(lng), r = radius === undefined ? 500 : num(radius);
    if (la === null || ln === null || r === null || r <= 0) {
      return res.status(400).json({ error: "lat, lng, dan radius harus berupa angka" });
    }
    res.json(await findNearbyRoutes(la, ln, r));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mencari rute" });
  }
});

router.get("/routes/:code", async (req, res) => {
  try {
    const route = await getRouteDetail(req.params.code);
    if (!route) return res.status(404).json({ error: "Rute tidak ditemukan" });
    res.json(route);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil detail rute" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (typeof q !== "string" || q.trim().length < 2) return res.json([]);
    res.json(await searchStops(q.trim()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mencari lokasi" });
  }
});

router.get("/navigate", async (req, res) => {
  try {
    const coords = ["from_lat", "from_lng", "to_lat", "to_lng"].map((key) => num(req.query[key]));
    if (coords.includes(null)) {
      return res.status(400).json({ error: "from_lat, from_lng, to_lat, dan to_lng wajib diisi dengan angka" });
    }
    res.json(await findRouteBetween(...coords));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mencari rute" });
  }
});

module.exports = router;