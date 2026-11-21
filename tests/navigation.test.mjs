import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3, CatmullRomCurve3} from 'three';
import {ROUTES, canPassDoor, routeAvailable, crossing} from '../src/routes.js';

test('closed, opening, closing, and moving-camera states cannot cross a door', () => {
  const open = {duration: 1, t: 1, target: 1, moving: false};
  assert.equal(canPassDoor(null), false);
  assert.equal(canPassDoor({...open, t: 0, target: 0}), false);
  assert.equal(canPassDoor({...open, t: .6, moving: true}), false);
  assert.equal(canPassDoor({...open, target: 0, moving: true}), false);
  assert.equal(canPassDoor({...open, target: 0}), false);
  assert.equal(canPassDoor(open, true), false);
  assert.equal(canPassDoor(open), true);
});

for (const [id, route] of Object.entries(ROUTES)) {
  test(`${id}: entering and returning use the same doorway in opposite directions`, () => {
    const entry = crossing(id, route.outside);
    const exit = crossing(id, route.room);
    assert.equal(entry.destination, route.room);
    assert.equal(exit.destination, route.outside);
    assert.deepEqual(entry.points, [...exit.points].reverse());
    assert.deepEqual(entry.target, route.insideTarget);
    const signed = point => point.reduce((sum, value, i) => sum + (value - route.center[i]) * route.normal[i], 0);
    assert.ok(signed(entry.points[0]) > .3);
    assert.equal(signed(entry.points[1]), 0);
    assert.ok(signed(entry.points[2]) < -.3);
    assert.ok(entry.points.every(point => point[1] > 1.2 && point[1] < 1.8));
    assert.ok(route.width >= .7);
  });
  test(`${id}: another private room cannot use this passage as an adjacent exit`, () => {
    const other = Object.values(ROUTES).find(r => r.room !== route.room).room;
    assert.equal(routeAvailable(id, other), false);
    assert.equal(crossing(id, other), null);
  });
  test(`${id}: the curved camera path stays within the door aperture at the wall`, () => {
    for (const room of [route.outside, route.room]) {
      const step = crossing(id, room);
      const curve = new CatmullRomCurve3(step.points.map(p => new Vector3(...p)), false, 'centripetal');
      let crossings = 0;
      for (let i = 0; i <= 200; i++) {
        const point = curve.getPoint(i / 200);
        const depth = (point.x - route.center[0]) * route.normal[0] + (point.z - route.center[2]) * route.normal[2];
        if (Math.abs(depth) > .12) continue;
        crossings++;
        const offset = route.normal[0] ? Math.abs(point.z - route.center[2]) : Math.abs(point.x - route.center[0]);
        assert.ok(offset < route.width / 2 - .08);
        assert.ok(point.y > 1.2 && point.y < 1.8);
      }
      assert.ok(crossings > 0);
    }
  });
}
