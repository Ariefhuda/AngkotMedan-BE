const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const WALK_RADIUS_M = 1000;
const NEAREST_STOPS = 5;
// Jalan kaki sejauh ini dihitung setara satu halte, supaya halte terdekat lebih diutamakan
// daripada halte yang lebih jauh tapi menghemat satu halte.
const WALK_PER_STOP_M = 200;
// Asal dan tujuan sedekat ini tidak perlu angkot.
const SAME_PLACE_M = 300;

const routeWithStops = {
  stops: { include: { stop: true }, orderBy: { order: "asc" } },
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bentuk trayek yang dikirim ke klien: halte diratakan, tanpa baris tabel penghubung.
function serializeRoute(route) {
  const { stops, ...rest } = route;
  return {
    ...rest,
    stops: stops.map((rs) => ({
      id: rs.stop.id,
      name: rs.stop.name,
      latitude: rs.stop.latitude,
      longitude: rs.stop.longitude,
      order: rs.order,
    })),
  };
}

async function getAllRoutes() {
  const routes = await prisma.route.findMany({ include: routeWithStops, orderBy: { code: "asc" } });
  return routes.map(serializeRoute);
}

async function getRouteDetail(code) {
  const route = await prisma.route.findUnique({ where: { code }, include: routeWithStops });
  return route ? serializeRoute(route) : null;
}

async function searchStops(query) {
  return prisma.stop.findMany({
    where: {
      name: { contains: query, mode: "insensitive" },
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: { name: "asc" },
    take: 10,
  });
}

function stopsNear(stops, lat, lng, radius, limit) {
  const near = stops
    .map((s) => ({ ...s, dist: getDistance(lat, lng, s.latitude, s.longitude) }))
    .filter((s) => s.dist <= radius)
    .sort((a, b) => a.dist - b.dist);
  return limit ? near.slice(0, limit) : near;
}

async function findNearbyRoutes(lat, lng, radius = 500) {
  const stops = await prisma.stop.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
  });
  const nearIds = stopsNear(stops, lat, lng, radius).map((s) => s.id);
  if (nearIds.length === 0) return [];

  const routes = await prisma.route.findMany({
    where: { stops: { some: { stopId: { in: nearIds } } } },
    include: routeWithStops,
    orderBy: { code: "asc" },
  });
  return routes.map(serializeRoute);
}

// Trayek satu arah hanya bisa dinaiki maju; trayek pulang-pergi ke dua arah.
function reachable(route, a, b) {
  return a !== b && (a < b || route.roundTrip);
}

// Potongan trayek dari indeks a ke b, dalam urutan perjalanan.
function leg(route, a, b) {
  const segment = route.stops.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (a > b) segment.reverse();
  const { stops, ...info } = route;
  return {
    route: info,
    boardStop: segment[0],
    alightStop: segment[segment.length - 1],
    intermediateStops: segment.slice(1, -1),
    totalStops: segment.length - 1,
  };
}

// Dari halte-halte terdekat yang dilewati sebuah trayek, kembalikan indeksnya di trayek itu.
function indexesOn(route, nearStops) {
  const result = [];
  for (const near of nearStops) {
    const idx = route.stops.findIndex((s) => s.id === near.id);
    if (idx !== -1) result.push({ idx, walk: near.dist });
  }
  return result;
}

async function findRouteBetween(fromLat, fromLng, toLat, toLng) {
  if (getDistance(fromLat, fromLng, toLat, toLng) < SAME_PLACE_M) return { routes: [], transfers: 0 };

  const routes = (await prisma.route.findMany({ include: routeWithStops })).map(serializeRoute);
  const stops = await prisma.stop.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
  });

  const fromStops = stopsNear(stops, fromLat, fromLng, WALK_RADIUS_M, NEAREST_STOPS);
  const toStops = stopsNear(stops, toLat, toLng, WALK_RADIUS_M, NEAREST_STOPS);
  if (fromStops.length === 0 || toStops.length === 0) return { routes: [], transfers: 0 };

  const candidates = routes.map((route) => ({
    route,
    from: indexesOn(route, fromStops),
    to: indexesOn(route, toStops),
  }));

  // Rute langsung: satu trayek melewati halte dekat asal dan halte dekat tujuan.
  const direct = [];
  for (const { route, from, to } of candidates) {
    let best = null;
    for (const f of from) {
      for (const t of to) {
        if (!reachable(route, f.idx, t.idx)) continue;
        const cost = Math.abs(t.idx - f.idx) + (f.walk + t.walk) / WALK_PER_STOP_M;
        if (!best || cost < best.cost) best = { cost, f, t };
      }
    }
    if (best) direct.push({ cost: best.cost, type: "direct", ...leg(route, best.f.idx, best.t.idx) });
  }
  if (direct.length > 0) {
    direct.sort((a, b) => a.cost - b.cost);
    return { routes: direct.slice(0, 3).map(({ cost, ...r }) => r), transfers: 0 };
  }

  // Rute pindah: trayek pertama dari asal, trayek kedua ke tujuan, bertemu di satu halte.
  const transfers = [];
  for (const first of candidates) {
    if (first.from.length === 0) continue;
    for (const second of candidates) {
      if (second.to.length === 0 || second.route.id === first.route.id) continue;
      let best = null;
      first.route.stops.forEach((stop, t1) => {
        const t2 = second.route.stops.findIndex((s) => s.id === stop.id);
        if (t2 === -1) return;
        for (const f of first.from) {
          for (const t of second.to) {
            if (!reachable(first.route, f.idx, t1) || !reachable(second.route, t2, t.idx)) continue;
            const cost = Math.abs(t1 - f.idx) + Math.abs(t.idx - t2) + (f.walk + t.walk) / WALK_PER_STOP_M;
            if (!best || cost < best.cost) best = { cost, f, t, t1, t2 };
          }
        }
      });
      if (!best) continue;
      const leg1 = leg(first.route, best.f.idx, best.t1);
      const leg2 = leg(second.route, best.t2, best.t.idx);
      transfers.push({
        cost: best.cost,
        type: "transfer",
        leg1,
        leg2,
        totalStops: leg1.totalStops + leg2.totalStops,
      });
    }
  }

  transfers.sort((a, b) => a.cost - b.cost);
  const best = transfers.slice(0, 3).map(({ cost, ...r }) => r);
  return { routes: best, transfers: best.length > 0 ? 1 : 0 };
}

module.exports = {
  findNearbyRoutes,
  getRouteDetail,
  searchStops,
  getAllRoutes,
  findRouteBetween,
};
