const express = require("express");
const router = express.Router();
const {
  findNearbyRoutes,
  getRouteDetail,
  searchStops,
  getAllRoutes,
  findRouteBetween,
} = require("../controllers/angkot.js");

router.get("/routes", async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    if (!lat || !lng) {
      return res.json(await getAllRoutes());
    }
    res.json(await findNearbyRoutes(parseFloat(lat), parseFloat(lng), radius ? parseFloat(radius) : 500));
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
    if (!q || q.length < 2) return res.json([]);
    res.json(await searchStops(q));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mencari lokasi" });
  }
});

router.get("/navigate", async (req, res) => {
  try {
    const { from_lat, from_lng, to_lat, to_lng } = req.query;
    if (!from_lat || !from_lng || !to_lat || !to_lng) {
      return res.status(400).json({ error: "Parameter tidak lengkap" });
    }
    const result = await findRouteBetween(
      parseFloat(from_lat), parseFloat(from_lng),
      parseFloat(to_lat), parseFloat(to_lng)
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mencari rute" });
  }
});

module.exports = router;