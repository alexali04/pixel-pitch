(function () {
  const U = (PP.U = {});
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  U.norm = (x, y) => {
    const l = Math.hypot(x, y);
    return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  };
  U.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.rot = (x, y, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  };
  // Distance from point p to segment a-b, and the projection parameter t in [0,1].
  U.segPoint = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = U.clamp(t, 0, 1);
    return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
  };
})();
