'use strict';
// WorldForge world view: 3D force-directed graph (global THREE from vendored bundle).

(function () {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const TYPE_COLORS = {
    character: 0xe5484d, location: 0x46a758, item: 0xf5a623,
    lore: 0x3b82f6, untyped: 0x8b949e,
  };

  function hashColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return new THREE.Color().setHSL((h % 360) / 360, 0.5, 0.55).getHex();
  }
  function colorFor(node) {
    const t = (node.type || 'untyped').toLowerCase();
    return TYPE_COLORS[t] !== undefined ? TYPE_COLORS[t] : hashColor(t);
  }

  // ---- hand-rolled force layout (no dependencies) ----
  function layout(graph, P = {}) {
    const nodes = graph.nodes.map(n => ({
      id: n.id, x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 60,
      vx: 0, vy: 0, vz: 0, deg: 0,
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const links = [];
    for (const l of graph.links) {
      const a = byId.get(l.source), b = byId.get(l.target);
      if (a && b) { links.push({ a, b, w: l.weight || 1 }); a.deg++; b.deg++; }
    }
    const REP = P.rep || 900, SPRING = 0.012, REST = P.rest || 11, CENTER = 0.004, DT = 0.55;
    const ITER = 260;
    for (let it = 0; it < ITER; it++) {
      // repulsion (capped, skip far pairs)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 0.01) d2 = 0.01;
          if (d2 > 900) continue;
          const f = REP / d2;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d; dz /= d;
          a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
          b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
        }
      }
      // springs
      for (const l of links) {
        let dx = l.a.x - l.b.x, dy = l.a.y - l.b.y, dz = l.a.z - l.b.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const f = SPRING * (d - REST) * (1 + l.w * 0.4);
        dx /= d; dy /= d; dz /= d;
        l.a.vx -= dx * f * 10; l.a.vy -= dy * f * 10; l.a.vz -= dz * f * 10;
        l.b.vx += dx * f * 10; l.b.vy += dy * f * 10; l.b.vz += dz * f * 10;
      }
      // integrate + centering + damping
      let maxV = 0;
      for (const n of nodes) {
        n.vx -= n.x * CENTER; n.vy -= n.y * CENTER; n.vz -= n.z * CENTER;
        n.vx *= 0.86; n.vy *= 0.86; n.vz *= 0.86;
        const v = Math.abs(n.vx) + Math.abs(n.vy) + Math.abs(n.vz);
        if (v > maxV) maxV = v;
        n.x += n.vx * DT; n.y += n.vy * DT; n.z += n.vz * DT;
      }
      if (maxV < 0.02) break;
    }
    // center + normalize scale
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; cz += n.z; }
    const k = nodes.length || 1;
    cx /= k; cy /= k; cz /= k;
    let maxR = 1;
    for (const n of nodes) {
      n.x -= cx; n.y -= cy; n.z -= cz;
      const r = Math.hypot(n.x, n.y, n.z);
      if (r > maxR) maxR = r;
    }
    const s = 34 / maxR;
    for (const n of nodes) { n.x *= s; n.y *= s; n.z *= s; }
    return { nodes, links };
  }

  function mount(container, graph, handlers) {
    const width = () => container.clientWidth || 800;
    const height = () => container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);
    scene.fog = new THREE.Fog(0x0d1117, 90, 240);

    const camera = new THREE.PerspectiveCamera(55, width() / height(), 0.1, 600);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width(), height());
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 1.4, 0.8);
    scene.add(key);

    const S = handlers.settings || {};
    const { nodes, links } = layout(graph, { rep: S.rep, rest: S.rest });
    const metaById = new Map(graph.nodes.map(n => [n.id, n]));
    const nodeObjs = [];
    const group = new THREE.Group();

    for (const n of nodes) {
      const meta = metaById.get(n.id) || {};
      const r = 0.55 + Math.min(1.6, Math.log2(1 + n.deg) * 0.42);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 16),
        new THREE.MeshStandardMaterial({ color: colorFor(meta), roughness: 0.45, metalness: 0.1, transparent: true, opacity: 1 })
      );
      mesh.scale.setScalar(S.nodeScale || 1);
      mesh.position.set(n.x, n.y, n.z);
      mesh.userData = { id: n.id, title: meta.title || n.id, type: meta.type || 'untyped', dir: meta.dir || '.', deg: n.deg };
      group.add(mesh);
      nodeObjs.push(mesh);
    }
    scene.add(group);

    // edges: one Line per link (per-link visibility for filters)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x3d444d, transparent: true, opacity: 0.55 });
    const edgeObjs = [];
    for (const l of links) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([l.a.x, l.a.y, l.a.z, l.b.x, l.b.y, l.b.z]), 3));
      const line = new THREE.Line(g, edgeMat);
      line.userData = { a: l.a.id, b: l.b.id };
      scene.add(line);
      edgeObjs.push(line);
    }
    const byMesh = new Map(nodeObjs.map(m => [m.userData.id, m]));

    // ---- custom orbit controls (drag=rotate, wheel=zoom, right-drag=pan) ----
    let theta = 0.9, phi = 1.15, radius = 78;
    const target = new THREE.Vector3(0, 0, 0);
    // restore a previous view across re-mounts (saves/rescans)
    if (handlers.initialView && handlers.initialView.theta !== undefined) {
      const v = handlers.initialView;
      theta = v.theta; phi = v.phi; radius = v.radius;
      target.set(v.target.x, v.target.y, v.target.z);
    }
    let dragging = 0, px = 0, py = 0, movedPx = 0;
    const dom = renderer.domElement;

    function applyCamera() {
      const sp = Math.sin(phi), cp = Math.cos(phi);
      camera.position.set(
        target.x + radius * sp * Math.sin(theta),
        target.y + radius * cp,
        target.z + radius * sp * Math.cos(theta));
      camera.lookAt(target);
    }
    dom.addEventListener('contextmenu', e => {
      e.preventDefault();
      const hit = pick(e);
      try { dom.releasePointerCapture(e.pointerId); } catch {}
      dragging = 0;
      if (hit && handlers.onNodeMenu) handlers.onNodeMenu(e, hit.object.userData);
      else if (handlers.onCanvasMenu) handlers.onCanvasMenu(e);
    });
    dom.addEventListener('pointerdown', e => {
      cancelFly();
      dragging = e.button === 2 ? 2 : 1; px = e.clientX; py = e.clientY; movedPx = 0;
      try { dom.setPointerCapture(e.pointerId); } catch {}
    });
    dom.addEventListener('pointerup', e => { dragging = 0; try { dom.releasePointerCapture(e.pointerId); } catch {} });
    dom.addEventListener('pointercancel', e => { dragging = 0; try { dom.releasePointerCapture(e.pointerId); } catch {} });
    // If a native dialog (confirm/alert) eats the pointerup, the capture would
    // stick forever — every later click would land on the canvas. The window-
    // level listener below resets drag state no matter who swallowed the release.
    window.addEventListener('pointerup', () => { dragging = 0; }, true);
    dom.addEventListener('pointermove', e => {
      if (!dragging) { hover(e); return; }
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      movedPx += Math.abs(dx) + Math.abs(dy);
      if (dragging === 1) {
        theta -= dx * 0.0055;
        phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi - dy * 0.005));
      } else {
        const panScale = radius * 0.0012;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        target.addScaledVector(right, -dx * panScale * 0.6);
        target.addScaledVector(up, dy * panScale * 0.6);
      }
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      cancelFly();
      radius = Math.max(6, Math.min(220, radius * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });

    // ---- picking & hover ----
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const tooltip = handlers.tooltipEl;

    function pick(e) {
      // CRITICAL: coordinates are relative to the canvas, not the page —
      // the sidebar shifts clientX, which broke hover/click alignment.
      const r = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects(nodeObjs.filter(m => m.visible))[0] || null;
    }

    let hoverId = null;
    const previewCache = new Map();
    function hover(e) {
      const hit = pick(e);
      const id = hit ? hit.object.userData.id : null;
      if (hit) {
        dom.style.cursor = 'pointer';
        const u = hit.object.userData;
        tooltip.style.display = 'block';
        tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 320) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.innerHTML = `<div class="tip-title">${esc(u.title)}</div>` +
          `<div class="tip-meta">${esc(u.type)}${u.dir && u.dir !== '.' ? ' · ' + esc(u.dir) : ''}</div>` +
          `<div class="tip-snippet" id="tip-snippet">…</div>`;
        if (id !== hoverId) {
          hoverId = id;
          if (handlers.getPreview && !previewCache.has(id)) previewCache.set(id, handlers.getPreview(id));
          Promise.resolve(previewCache.get(id)).then(p => {
            if (hoverId !== id || !p) return;
            const snip = tooltip.querySelector('.tip-snippet');
            if (snip) snip.textContent = p.snippet || '(empty note)';
          });
        }
      } else {
        dom.style.cursor = 'default';
        tooltip.style.display = 'none';
      }
      hoverId = id;
    }
    dom.addEventListener('click', e => {
      if (movedPx > 6) return; // that was an orbit drag, not a click
      const hit = pick(e);
      if (hit && handlers.onOpen) handlers.onOpen(hit.object.userData.id);
    });

    // ---- search dimming ----
    const isMatch = (m, q) => !q || m.userData.title.toLowerCase().includes(q) || m.userData.id.toLowerCase().includes(q);
    function highlight(q) {
      const match = (q || '').toLowerCase();
      for (const m of nodeObjs) {
        if (!m.visible) continue; // filters govern visibility; don't resurrect filtered-out nodes
        m.material.opacity = isMatch(m, match) ? 1 : 0.13;
      }
    }

    // ---- fly-to camera (search zoom-to-match) ----
    let camTween = null;
    function flyTo(center, radiusGoal) {
      camTween = {
        t0: performance.now(), dur: 650,
        from: { radius, tx: target.x, ty: target.y, tz: target.z },
        to: { radius: radiusGoal, tx: center.x, ty: center.y, tz: center.z },
      };
    }
    function cancelFly() { camTween = null; }
    function frameMatches() {
      const q = searchQuery.toLowerCase();
      const ms = nodeObjs.filter(m => m.visible && isMatch(m, q));
      if (!ms.length) return;
      const box = new THREE.Box3();
      ms.forEach(m => box.expandByObject(m));
      const c = new THREE.Vector3();
      box.getCenter(c);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const dist = Math.max(10, Math.min(220,
        (sph.radius / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.25));
      flyTo(c, dist);
    }

    // ---- visibility filters (per-category + orphans) ----
    let filters = { types: null, orphans: true }; // null = all types shown
    function applyFilters() {
      for (const m of nodeObjs) {
        const t = (m.userData.type || 'untyped').toLowerCase();
        const typeOk = !filters.types || filters.types.includes(t);
        const orphanOk = filters.orphans || m.userData.deg > 0;
        const vis = typeOk && orphanOk;
        m.visible = vis;
        if (vis) m.material.opacity = 1; else m.material.opacity = 0.13;
      }
      for (const e of edgeObjs) {
        const a = byMesh.get(e.userData.a), b = byMesh.get(e.userData.b);
        e.visible = !!(a && b && a.visible && b.visible);
      }
    }
    function applySearch() { highlight(searchQuery); }

    let searchQuery = '';
    function setFilters(next) {
      if (next.types !== undefined) filters.types = next.types;
      if (next.orphans !== undefined) filters.orphans = next.orphans;
      applyFilters(); applySearch();
    }

    applyFilters(); applySearch();

    // resize + render loop
    (function frame() {
      requestAnimationFrame(frame);
      const w = width(), h = height();
      if (Math.abs(camera.aspect - w / h) > 0.01) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      if (camTween) {
        const k = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        radius = camTween.from.radius + (camTween.to.radius - camTween.from.radius) * e;
        target.set(
          camTween.from.tx + (camTween.to.tx - camTween.from.tx) * e,
          camTween.from.ty + (camTween.to.ty - camTween.from.ty) * e,
          camTween.from.tz + (camTween.to.tz - camTween.from.tz) * e);
        if (k >= 1) camTween = null;
      }
      applyCamera();
      renderer.render(scene, camera);
    })();

    return {
      highlight(q) { searchQuery = q || ''; applySearch(); },
      frameMatches,
      setFilters,
      applyScale(s) { for (const m of nodeObjs) m.scale.setScalar(s); },
      getView() { return { theta, phi, radius, target: { x: target.x, y: target.y, z: target.z } }; },
      resetView() { theta = 0.9; phi = 1.15; radius = 78; target.set(0, 0, 0); },
      debug: {
        opacity(id) { const m = nodeObjs.find(o => o.userData.id === id); return m ? m.material.opacity : null; },
        linkVisible(a, b) {
          const e = edgeObjs.find(o => (o.userData.a === a && o.userData.b === b) || (o.userData.a === b && o.userData.b === a));
          return e ? e.visible : null;
        },
        project(id) {
          const m = nodeObjs.find(o => o.userData.id === id);
          if (!m) return null;
          const v = m.position.clone().project(camera);
          const r = dom.getBoundingClientRect();
          return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top, visible: v.z < 1 };
        },
      },
    };
  }

  window.World3D = { mount };
})();
