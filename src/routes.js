export const PUBLIC_ROOMS = new Set(['dining', 'entry', 'kitchen']);

export const ROUTES = {
  Door_Master: {
    room: 'master', name: '主卧', outside: 'dining', outsideName: '客餐区',
    center: [3.265, 1.08, 7.101], normal: [1, 0, 0], width: .734,
    outsidePosition: [4.18, 1.48, 7.13], outsideTarget: [5.65, 1.18, 6.37],
    insidePosition: [2.78, 1.48, 6.85], insideTarget: [1.25, 1.05, 5.42],
  },
  Door_Second: {
    room: 'second', name: '次卧', outside: 'dining', outsideName: '客餐区',
    center: [4.240, 1.08, 5.105], normal: [0, 0, 1], width: .728,
    outsidePosition: [4.18, 1.48, 6.28], outsideTarget: [5.65, 1.18, 6.37],
    insidePosition: [4.24, 1.48, 4.62], insideTarget: [5.61, 1.02, 3.60],
  },
  Door_Bath: {
    room: 'bath', name: '卫生间', outside: 'entry', outsideName: '入户过道',
    center: [3.563, 1.08, 8.805], normal: [1, 0, 0], width: .88,
    outsidePosition: [4.17, 1.48, 8.86], outsideTarget: [3.86, 1.20, 7.38],
    insidePosition: [3.02, 1.40, 8.82], insideTarget: [2.55, 1.14, 9.50],
  },
};

export function canPassDoor(door, travelling = false) {
  return Boolean(door && !travelling && !door.moving && door.duration > 0 &&
    door.target >= door.duration - .005 && door.t >= door.duration - .005);
}

export function routeAvailable(id, currentRoom) {
  return Boolean(ROUTES[id] && (ROUTES[id].room === currentRoom || PUBLIC_ROOMS.has(currentRoom)));
}

export function crossing(id, currentRoom) {
  const route = ROUTES[id];
  if (!route || !routeAvailable(id, currentRoom)) return null;
  const inside = currentRoom === route.room;
  const start = inside ? route.insidePosition : route.outsidePosition;
  const end = inside ? route.outsidePosition : route.insidePosition;
  const center = [...route.center];
  center[1] = (start[1] + end[1]) / 2;
  return {
    inside, destination: inside ? route.outside : route.room,
    name: inside ? route.outsideName : route.name,
    label: (inside ? '返回' : '进入') + (inside ? route.outsideName : route.name),
    points: [[...start], center, [...end]],
    target: [...(inside ? route.outsideTarget : route.insideTarget)],
  };
}
