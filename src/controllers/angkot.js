const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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

async function findNearbyRoutes(lat, lng, radius = 500) {
  const stops = await prisma.stop.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    include: {
      routes: {
        include: {
          route: {
            include: {
              stops: { include: { stop: true }, orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  });

  const nearby = stops.filter(
    (s) => getDistance(lat, lng, s.latitude, s.longitude) <= radius
  );

  const routeMap = new Map();
  for (const stop of nearby) {
    for (const rs of stop.routes) {
      const r = rs.route;
      if (!routeMap.has(r.id)) {
        routeMap.set(r.id, {
          ...r,
          stops: r.stops.map((s) => ({
            id: s.stop.id,
            name: s.stop.name,
            latitude: s.stop.latitude,
            longitude: s.stop.longitude,
            order: s.order,
          })),
        });
      }
    }
  }
  return Array.from(routeMap.values());
}

async function getRouteDetail(code) {
  const route = await prisma.route.findUnique({
    where: { code },
    include: {
      stops: { include: { stop: true }, orderBy: { order: "asc" } },
    },
  });
  if (!route) return null;
  return {
    ...route,
    stops: route.stops.map((s) => ({
      id: s.stop.id,
      name: s.stop.name,
      latitude: s.stop.latitude,
      longitude: s.stop.longitude,
      order: s.order,
    })),
  };
}

async function searchStops(query) {
  return prisma.stop.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    take: 10,
  });
}

async function getAllRoutes() {
  const routes = await prisma.route.findMany({
    include: {
      stops: { include: { stop: true }, orderBy: { order: "asc" } },
    },
    orderBy: { code: "asc" },
  });
  return routes.map((r) => ({
    ...r,
    stops: r.stops.map((s) => ({
      id: s.stop.id,
      name: s.stop.name,
      latitude: s.stop.latitude,
      longitude: s.stop.longitude,
      order: s.order,
    })),
  }));
}

async function findRouteBetween(fromLat, fromLng, toLat, toLng) {
  const allStops = await prisma.stop.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    include: {
      routes: {
        include: {
          route: {
            include: {
              stops: { include: { stop: true }, orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  });

  const fromStops = allStops
    .map((s) => ({ ...s, dist: getDistance(fromLat, fromLng, s.latitude, s.longitude) }))
    .filter((s) => s.dist <= 1000)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  const toStops = allStops
    .map((s) => ({ ...s, dist: getDistance(toLat, toLng, s.latitude, s.longitude) }))
    .filter((s) => s.dist <= 1000)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  const fromStopIds = new Set(fromStops.map((s) => s.id));
  const toStopIds = new Set(toStops.map((s) => s.id));

  const fromRoutes = new Map();
  for (const stop of fromStops) {
    for (const rs of stop.routes) {
      const r = rs.route;
      if (!fromRoutes.has(r.id)) {
        fromRoutes.set(r.id, { route: r, fromStop: stop, fromOrder: rs.route.stops.find(s => s.stopId === stop.id)?.order ?? 0 });
      }
    }
  }

  const toRoutes = new Map();
  for (const stop of toStops) {
    for (const rs of stop.routes) {
      const r = rs.route;
      if (!toRoutes.has(r.id)) {
        toRoutes.set(r.id, { route: r, toStop: stop, toOrder: rs.route.stops.find(s => s.stopId === stop.id)?.order ?? 0 });
      }
    }
  }

  const directRoutes = [];
  for (const [routeId, fromInfo] of fromRoutes) {
    if (toRoutes.has(routeId)) {
      const toInfo = toRoutes.get(routeId);
      if (fromInfo.fromOrder <= toInfo.toOrder) {
        const allStopsOnRoute = fromInfo.route.stops;
        const boardIdx = allStopsOnRoute.findIndex((s) => s.id === fromInfo.fromStop.id);
        const alightIdx = allStopsOnRoute.findIndex((s) => s.id === toInfo.toStop.id);
        directRoutes.push({
          type: "direct",
          route: fromInfo.route,
          boardStop: fromInfo.fromStop,
          alightStop: toInfo.toStop,
          boardOrder: fromInfo.fromOrder,
          alightOrder: toInfo.toOrder,
          intermediateStops: allStopsOnRoute.slice(boardIdx + 1, alightIdx),
          totalStops: alightIdx - boardIdx,
        });
      }
    }
  }

  if (directRoutes.length > 0) {
    directRoutes.sort((a, b) => a.totalStops - b.totalStops);
    return { routes: [directRoutes[0]], transfers: 0 };
  }

  const transferRoutes = [];
  for (const [r1Id, r1Info] of fromRoutes) {
    for (const [r2Id, r2Info] of toRoutes) {
      if (r1Id === r2Id) continue;
      const sharedStops = r1Info.route.stops.filter(
        (s1) => s1.stop.latitude && s1.stop.longitude &&
        r2Info.route.stops.some(
          (s2) => s2.stopId === s1.stopId &&
          s2.order >= r2Info.route.stops[0].order
        )
      );
      for (const transferStop of sharedStops) {
        const tOrder1 = r1Info.route.stops.find(s => s.stopId === transferStop.stopId)?.order ?? 0;
        const tOrder2 = r2Info.route.stops.find(s => s.stopId === transferStop.stopId)?.order ?? 0;
        if (tOrder1 > fromInfo.fromOrder) continue;

        const leg1Stops = r1Info.route.stops;
        const boardIdx1 = leg1Stops.findIndex((s) => s.id === fromInfo.fromStop.id);
        const alightIdx1 = leg1Stops.findIndex((s) => s.id === transferStop.stopId);

        const leg2Stops = r2Info.route.stops;
        const boardIdx2 = leg2Stops.findIndex((s) => s.id === transferStop.stopId);
        const alightIdx2 = leg2Stops.findIndex((s) => s.id === toInfo.toStop.id);

        if (alightIdx1 < boardIdx1 || alightIdx2 < boardIdx2) continue;

        transferRoutes.push({
          type: "transfer",
          leg1: {
            route: r1Info.route,
            boardStop: fromInfo.fromStop,
            alightStop: { ...transferStop.stop, name: transferStop.stop.name },
            intermediateStops: leg1Stops.slice(boardIdx1 + 1, alightIdx1),
            totalStops: alightIdx1 - boardIdx1,
          },
          leg2: {
            route: r2Info.route,
            boardStop: { ...transferStop.stop, name: transferStop.stop.name },
            alightStop: toInfo.toStop,
            intermediateStops: leg2Stops.slice(boardIdx2 + 1, alightIdx2),
            totalStops: alightIdx2 - boardIdx2,
          },
          totalStops: (alightIdx1 - boardIdx1) + (alightIdx2 - boardIdx2),
        });
      }
    }
  }

  transferRoutes.sort((a, b) => a.totalStops - b.totalStops);
  const best = transferRoutes.slice(0, 3);
  return { routes: best.length > 0 ? best : [], transfers: best.length > 0 ? 1 : 0 };
}

module.exports = {
  findNearbyRoutes,
  getRouteDetail,
  searchStops,
  getAllRoutes,
  findRouteBetween,
};