"""Generate the five HOS Step-in attachment models as OBJ files (units: mm, Y up, wall side = -Z).

Run: python3 models/make_models.py   (writes the .obj files next to this script)
Measured: hose length 80, water guard height 50, mat 500 x 250 x 5, slope/curve height 96.
Estimated from photos (change below if you measure them): see the constants in each function.
"""
import math, os

class Mesh:
    def __init__(self, name):
        self.name, self.v, self.groups = name, [], []   # groups: (group name, [faces])
    def group(self, name):
        self.groups.append((name, [])); return self
    def vert(self, p):
        self.v.append(p); return len(self.v)          # OBJ indices are 1-based
    def face(self, *idx):
        self.groups[-1][1].append(idx)
    def quad(self, a, b, c, d): self.face(a, b, c, d)
    def box(self, x0, y0, z0, x1, y1, z1):
        p = [self.vert((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        # p index = xi*4 + yi*2 + zi
        q = lambda a, b, c, d: self.quad(p[a], p[b], p[c], p[d])
        q(0, 1, 3, 2); q(4, 6, 7, 5); q(0, 4, 5, 1); q(2, 3, 7, 6); q(0, 2, 6, 4); q(1, 5, 7, 3)
    def prism(self, poly, x0, x1):
        """Extrude a closed (z, y) polygon along X from x0 to x1."""
        n = len(poly)
        a = [self.vert((x0, y, z)) for z, y in poly]
        b = [self.vert((x1, y, z)) for z, y in poly]
        for i in range(n):
            j = (i + 1) % n
            self.quad(a[i], a[j], b[j], b[i])
        self.face(a[0], *reversed(a[1:])); self.face(*b)
    def band(self, top, bot, x0, x1):
        """Solid strip between two matching (z, y) polylines (e.g. a curved plate), extruded along X; fully quad-based."""
        n = len(top)
        t0 = [self.vert((x0, y, z)) for z, y in top]; t1 = [self.vert((x1, y, z)) for z, y in top]
        b0 = [self.vert((x0, y, z)) for z, y in bot]; b1 = [self.vert((x1, y, z)) for z, y in bot]
        for i in range(n - 1):
            j = i + 1
            self.quad(t0[i], t1[i], t1[j], t0[j])      # top surface
            self.quad(b0[i], b0[j], b1[j], b1[i])      # bottom surface
            self.quad(t0[i], t0[j], b0[j], b0[i])      # x0 side
            self.quad(t1[i], b1[i], b1[j], t1[j])      # x1 side
        self.quad(t0[0], b0[0], b1[0], t1[0]); self.quad(t0[-1], t1[-1], b1[-1], b0[-1])
    def save(self, path):
        ntri = sum(len(f) - 2 for _, fs in self.groups for f in fs)
        with open(path, 'w') as o:
            o.write('# %s - HOS Step-in 2026 attachment model\n# units: millimetres, +Y up, wall side = -Z\n# vertices %d, triangles %d\n' % (self.name, len(self.v), ntri))
            o.write('o %s\n' % self.name)
            for x, y, z in self.v: o.write('v %.3f %.3f %.3f\n' % (x, y, z))
            for g, fs in self.groups:
                o.write('g %s\n' % g)
                for f in fs: o.write('f ' + ' '.join(map(str, f)) + '\n')
        return len(self.v), ntri

def tube_along(m, pts, r_out, r_in, seg=32):
    """Hollow tube following a polyline of (x, y, z) points, with annular end caps."""
    def frame(i):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = [b[k] - a[k] for k in range(3)]; l = math.sqrt(sum(c * c for c in t)); t = [c / l for c in t]
        ref = (1, 0, 0) if abs(t[0]) < .9 else (0, 0, 1)
        u = [t[1]*ref[2]-t[2]*ref[1], t[2]*ref[0]-t[0]*ref[2], t[0]*ref[1]-t[1]*ref[0]]; l = math.sqrt(sum(c*c for c in u)); u = [c/l for c in u]
        w = [t[1]*u[2]-t[2]*u[1], t[2]*u[0]-t[0]*u[2], t[0]*u[1]-t[1]*u[0]]
        return u, w
    rings = []
    for i, p in enumerate(pts):
        u, w = frame(i); ro, ri = [], []
        for s in range(seg):
            a = 2 * math.pi * s / seg; c, d = math.cos(a), math.sin(a)
            ro.append(m.vert(tuple(p[k] + r_out * (c*u[k] + d*w[k]) for k in range(3))))
            ri.append(m.vert(tuple(p[k] + r_in * (c*u[k] + d*w[k]) for k in range(3))))
        rings.append((ro, ri))
    for i in range(len(rings) - 1):
        (o0, i0), (o1, i1) = rings[i], rings[i + 1]
        for s in range(seg):
            t = (s + 1) % seg
            m.quad(o0[s], o0[t], o1[t], o1[s]); m.quad(i0[s], i1[s], i1[t], i0[t])
    for (o, ii), flip in ((rings[0], True), (rings[-1], False)):
        for s in range(seg):
            t = (s + 1) % seg
            m.quad(*( (o[s], ii[s], ii[t], o[t]) if flip else (o[s], o[t], ii[t], ii[s]) ))

def hose():
    """Clear rubber hose pushed onto the outlet tip: 80 mm long, hangs and bends slightly toward the user (photo 1013)."""
    L, ID, WALL = 80.0, 15.0, 2.5            # ID matches the 15 mm outlet tip; wall thickness estimated
    m = Mesh('rubber_hose').group('hose')
    n, raw = 40, []
    for i in range(n + 1):                   # quadratic bend: straight down, bottom 12 mm forward
        t = i / n; raw.append((0.0, L * (1 - t), 12.0 * t * t))
    # rescale so the centreline is exactly 80 mm long
    s = sum(math.dist(raw[i], raw[i + 1]) for i in range(n)); pts = [(x, y * L / s, z * L / s) for x, y, z in raw]
    tube_along(m, pts, ID / 2 + WALL, ID / 2)
    return m

def water_guard():
    """White guard strip that sits on the basin lip: 50 mm tall wall whose top curls back toward the basin (photo 1014)."""
    LEN, H, T, BASE, R = 300.0, 50.0, 2.5, 22.0, 8.0   # length, height (measured), wall thickness, foot width, curl radius (estimated)
    m = Mesh('water_guard').group('guard')
    m.box(-LEN / 2, 0, 0, LEN / 2, T, BASE)                 # foot on the lip, toward the user (+Z)
    m.box(-LEN / 2, 0, 0, LEN / 2, H - R, T)                # upright wall
    rc, cz, cy = R - T / 2, T / 2 - (R - T / 2), H - R     # curl centreline radius and centre (curls toward -Z, the basin)
    arc = [math.pi * k / 16 for k in range(17)]
    outer = [(cz + (rc + T / 2) * math.cos(a), cy + (rc + T / 2) * math.sin(a)) for a in arc]
    inner = [(cz + (rc - T / 2) * math.cos(a), cy + (rc - T / 2) * math.sin(a)) for a in arc]
    m.band(outer, inner, -LEN / 2, LEN / 2)
    m.group('tape').box(-LEN / 2, -1.0, 0, LEN / 2, 0, BASE)   # red double-sided tape under the foot
    return m

def porous_mat():
    """Porous anti-splash mat: 500 x 250 x 5 mm triangular lattice (photo 1015)."""
    W, D, H = 500.0, 250.0, 5.0
    P, S, FR = 9.0, 1.6, 6.0                 # lattice pitch, strut width (estimated from the photo), border width
    m = Mesh('porous_mat').group('frame')
    m.box(-W/2, 0, -D/2, W/2, H, -D/2 + FR); m.box(-W/2, 0, D/2 - FR, W/2, H, D/2)
    m.box(-W/2, 0, -D/2 + FR, -W/2 + FR, H, D/2 - FR); m.box(W/2 - FR, 0, -D/2 + FR, W/2, H, D/2 - FR)
    m.group('lattice')
    hx, hz = W/2 - FR, D/2 - FR
    def strut(x0, z0, x1, z1):
        dx, dz = x1 - x0, z1 - z0; l = math.hypot(dx, dz)
        if l < 1: return
        nx, nz = -dz / l * S / 2, dx / l * S / 2
        a = [m.vert((x0 + nx, 0, z0 + nz)), m.vert((x1 + nx, 0, z1 + nz)), m.vert((x1 - nx, 0, z1 - nz)), m.vert((x0 - nx, 0, z0 - nz))]
        b = [m.vert((x0 + nx, H, z0 + nz)), m.vert((x1 + nx, H, z1 + nz)), m.vert((x1 - nx, H, z1 - nz)), m.vert((x0 - nx, H, z0 - nz))]
        m.face(a[3], a[2], a[1], a[0]); m.face(*b)
        for i in range(4):
            j = (i + 1) % 4; m.quad(a[i], a[j], b[j], b[i])
    def clip(px, pz, ux, uz):
        # clip the infinite line p + t*u to the inner rectangle
        lo, hi = -1e9, 1e9
        for p, u, h in ((px, ux, hx), (pz, uz, hz)):
            if abs(u) < 1e-9:
                if abs(p) > h: return None
                continue
            t0, t1 = (-h - p) / u, (h - p) / u
            lo, hi = max(lo, min(t0, t1)), min(hi, max(t0, t1))
        return (px + ux*lo, pz + uz*lo, px + ux*hi, pz + uz*hi) if hi > lo else None
    step = P * math.sqrt(3) / 2              # spacing between parallel lines of a triangular lattice
    for ang in (0, 60, 120):
        a = math.radians(ang); ux, uz = math.cos(a), math.sin(a); nx, nz = -uz, ux
        k = int(math.hypot(hx, hz) / step) + 1
        for i in range(-k, k + 1):
            c = clip(nx * i * step, nz * i * step, ux, uz)
            if c: strut(*c)
    return m

def ramp(curved):
    """Splash ramp: two side plates 96 mm tall, a sloped (or curved) floor and three porous scrub pads on top (photos 1016, 1017).
    The tall end stands against the wall (-Z) under the outlet; water runs down toward the user (+Z)."""
    H, L, WI, T, PAD = 96.0, 220.0, 120.0, 3.0, 25.0   # height (measured); base length, inner width, plate and pad thickness (estimated)
    m = Mesh('curved_ramp' if curved else 'slope_ramp')
    n = 36
    def fy(z):                                 # floor height, z from 0 (wall) to L (front)
        u = z / L
        return H * (1 - u) ** 2 if curved else H * (1 - u)
    def normal(z):                             # upward unit normal of the floor at z
        e = .25; a, b = max(0, z - e), min(L, z + e); d = (fy(b) - fy(a)) / (b - a); l = math.hypot(1, d)
        return -d / l, 1 / l
    zs = [L * i / n for i in range(n + 1)]
    m.group('side_plates')                     # (z, y) outline: base, then up the floor curve back to the wall
    side = [(0.0, 0.0), (L, 0.0)] + [(z, fy(z)) for z in reversed(zs[:-1])]
    for x0 in (-WI / 2 - T, WI / 2):
        m.prism([(z - L / 2, y) for z, y in side], x0, x0 + T)
    def layer(zlist, off0, off1, grp, inset=0.0):
        m.group(grp)
        bot = [(z + normal(z)[0] * off0 - L / 2, fy(z) + normal(z)[1] * off0) for z in zlist]
        top = [(z + normal(z)[0] * off1 - L / 2, fy(z) + normal(z)[1] * off1) for z in zlist]
        m.band(top, bot, -WI / 2 + inset, WI / 2 - inset)
    layer(zs, -T, 0.0, 'floor')
    gap = 2.0                                   # small gaps between the three pads, as in the photos
    for k in range(3):
        z0, z1 = L * k / 3 + (gap / 2 if k else 0), L * (k + 1) / 3 - (gap / 2 if k < 2 else 0)
        layer([z0 + (z1 - z0) * i / 12 for i in range(13)], 0.0, PAD, 'scrub_pad_%d' % (k + 1), inset=1.0)
    return m

if __name__ == '__main__':
    out = os.path.dirname(os.path.abspath(__file__))
    for fn, mk in (('1_rubber_hose.obj', hose), ('2_water_guard.obj', water_guard), ('3_porous_mat.obj', porous_mat),
                   ('4_slope_ramp.obj', lambda: ramp(False)), ('5_curved_ramp.obj', lambda: ramp(True))):
        v, t = mk().save(os.path.join(out, fn)); print('%-20s %6d vertices %7d triangles' % (fn, v, t))
