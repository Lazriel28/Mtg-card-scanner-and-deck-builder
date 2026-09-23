'use strict';
// WorldForge world view: interactive 3D graph (global THREE from vendored bundle).
// Interaction model (Blender-flavored):
//   click node = select · shift/ctrl+click = add/remove · drag node = move
//   drag empty space = box-select · click empty = deselect · dblclick = open
//   G/R/S = move/rotate/scale the selection · A = select all visible
//   Delete = trash selection · Esc = cancel/deselect
// Hand-placed positions ("pins") persist via handlers.onSaveLayout (layout.json).

(function () {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const TYPE_COLORS = {
    character: 0xe5484d, location: 0x46a758, item: 0xf5a623,
    lore: 0x3b82f6, untyped: 0x8b949e,
  };
  const SEL_COLOR = 0xffe08a;
  const HOVER_COLOR = 0xfff2cc; // hover tint (distinct from selection)
  const PIN_COLOR = 0xd3f9d8; // subtle "this node stays put" tint on unselected pins

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

    // ---- hand-placed positions ("pins") — applied to layout coords BEFORE
    // edges are built, so lines match the placed meshes. (Algebra: src/layout.js)
    const pins = handlers.initialLayout && handlers.initialLayout.nodes ? handlers.initialLayout.nodes : {};

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
      const pin = pins[n.id];
      if (pin) { n.x = pin.x; n.y = pin.y; n.z = pin.z; }
      mesh.position.set(n.x, n.y, n.z);
      mesh.userData = {
        id: n.id, title: meta.title || n.id, type: meta.type || 'untyped', dir: meta.dir || '.', deg: n.deg,
        color: colorFor(meta), pinned: !!pin, selected: false,
      };
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

    function updateEdgePositions() {
      for (const e of edgeObjs) {
        const a = byMesh.get(e.userData.a), b = byMesh.get(e.userData.b);
        if (!a || !b) continue;
        const arr = e.geometry.attributes.position.array;
        arr[0] = a.position.x; arr[1] = a.position.y; arr[2] = a.position.z;
        arr[3] = b.position.x; arr[4] = b.position.y; arr[5] = b.position.z;
        e.geometry.attributes.position.needsUpdate = true;
      }
    }

    // ================= selection =================
    const selPanel = document.getElementById('sel-panel');
    const selTitle = document.getElementById('sel-title');
    const selMeta = document.getElementById('sel-meta');
    const selPinBtn = document.getElementById('sel-pin');
    const xformModal = document.getElementById('xform-modal');
    const xfTitle = document.getElementById('xf-title');
    const xfHint = document.getElementById('xf-hint');

    let pinDirty = false;           // positions moved since last save/unpin
    function selectedMeshes() { return nodeObjs.filter(m => m.userData.selected); }

    function paintMesh(m) {
      if (m === hoverMesh) return; // hover tint wins; restored on hover-out
      if (m.userData.selected) m.material.color.setHex(SEL_COLOR);
      else if (m.userData.pinned) m.material.color.setHex(PIN_COLOR);
      else m.material.color.setHex(m.userData.color);
    }
    function repaintAll() { for (const m of nodeObjs) paintMesh(m); }

    function updateSelPanel() {
      const sel = selectedMeshes();
      if (!sel.length && !pinDirty) { selPanel.classList.add('hidden'); return; }
      if (!sel.length) {
        selTitle.textContent = 'Positions changed';
        selMeta.textContent = '💾 Save positions keeps your arrangement · Pin re-adds it later';
      } else {
        selTitle.textContent = sel.length > 1 ? `${sel.length} nodes selected` : sel[0].userData.title;
        selMeta.textContent = sel.length > 1
          ? 'G move · R rotate · S scale · Del delete · Esc deselect'
          : `${sel[0].userData.type}${sel[0].userData.pinned ? ' · pinned' : ''} · drag to move · G/R/S · double-click to open`;
      }
      selPinBtn.textContent = pinDirty ? '💾 Save positions'
        : (sel.every(m => m.userData.pinned) ? '📌 Unpin (release)' : '📌 Pin in place');
      selPanel.classList.remove('hidden');
    }

    function setSelection(list) {
      for (const m of nodeObjs) m.userData.selected = false;
      for (const m of list) m.userData.selected = true;
      repaintAll();
      updateSelPanel();
    }
    function toggleSel(m) {
      m.userData.selected = !m.userData.selected;
      repaintAll(); updateSelPanel();
    }
    function deselectAll() {
      if (selectedMeshes().length) setSelection([]);
    }

    // ================= transforms (G/R/S) =================
    const xf = { mode: null, objs: [], had: [], center: null, start: null, moved: false };
    function centerOf(list) {
      const box = new THREE.Box3();
      for (const m of list) box.expandByObject(m);
      return box.getCenter(new THREE.Vector3());
    }
    function startTransform(mode) {
      const sel = selectedMeshes();
      if (!sel.length || xf.mode) return false;
      xf.mode = mode; xf.objs = sel; xf.moved = false;
      xf.had = sel.map(m => m.position.clone());
      xf.center = centerOf(sel);
      xf.start = null; // anchor set on first mouse move
      xfTitle.textContent = mode === 'rotate' ? 'Rotate' : mode === 'scale' ? 'Scale' : 'Move';
      xfHint.textContent = mode === 'rotate' ? 'Move mouse sideways to rotate · click / Done to keep · Esc cancels'
        : mode === 'scale' ? 'Move mouse sideways to scale · click / Done to keep · Esc cancels'
        : 'Move the mouse — the selection follows · click / Done to keep · Esc cancels';
      xformModal.classList.remove('hidden');
      return true;
    }
    function transformMousemove(e) {
      if (!xf.mode) return;
      if (xf.start === null) { xf.start = { x: e.clientX, y: e.clientY }; return; }
      const dx = e.clientX - xf.start.x;
      if (xf.mode === 'move') {
        if (xf.grabPlane) {
          const hit = rayOnPlane(e, xf.grabPlane);
          if (hit) {
            const delta = hit.clone().sub(xf.grabPoint);
            for (let i = 0; i < xf.objs.length; i++) xf.objs[i].position.copy(xf.had[i]).add(delta);
          }
        }
      } else if (xf.mode === 'rotate') {
        const ang = dx * 0.01;
        const axis = camera.getWorldDirection(new THREE.Vector3()).negate();
        for (let i = 0; i < xf.objs.length; i++) {
          const p = xf.had[i].clone().sub(xf.center).applyAxisAngle(axis, ang);
          xf.objs[i].position.copy(xf.center).add(p);
        }
      } else if (xf.mode === 'scale') {
        const sc = Math.max(0.05, 1 + dx * 0.008);
        for (let i = 0; i < xf.objs.length; i++) {
          const p = xf.had[i].clone().sub(xf.center).multiplyScalar(sc);
          xf.objs[i].position.copy(xf.center).add(p);
        }
      }
      updateEdgePositions();
      xf.moved = true;
    }
    function commitTransform() {
      if (!xf.mode) return false;
      if (xf.moved) markMoved(xf.objs);
      xf.mode = null; xf.grabPlane = null;
      xformModal.classList.add('hidden');
      return true;
    }
    function cancelTransform() {
      if (!xf.mode) return false;
      for (let i = 0; i < xf.objs.length; i++) xf.objs[i].position.copy(xf.had[i]);
      updateEdgePositions();
      xf.mode = null; xf.grabPlane = null;
      xformModal.classList.add('hidden');
      return true;
    }

    // ================= persistence =================
    const movedNodes = new Set();
    function markMoved(objs) {
      for (const m of objs || []) movedNodes.add(m.userData.id);
      if (!pinDirty) { pinDirty = true; updateSelPanel(); }
    }
    function savePinState() {
      const out = {};
      for (const m of nodeObjs) out[m.userData.id] = { x: m.position.x, y: m.position.y, z: m.position.z };
      if (handlers.onSaveLayout) Promise.resolve(handlers.onSaveLayout({ nodes: out })).then(() => {
        pinDirty = false;
        movedNodes.clear();
        // every position was saved, so every node is now pinned — this matches
        // exactly what a remount would restore from the store
        for (const m of nodeObjs) m.userData.pinned = true;
        repaintAll(); updateSelPanel();
      }).catch(() => {});
    }
    function unpinSelection() {
      const sel = selectedMeshes();
      if (!sel.length) return;
      if (handlers.onUnpin) handlers.onUnpin(sel.map(m => m.userData.id));
      for (const m of sel) { m.userData.pinned = false; movedNodes.delete(m.userData.id); }
      pinDirty = false;
      repaintAll(); updateSelPanel();
    }
    function deleteSelection() {
      const sel = selectedMeshes();
      if (!sel.length || !handlers.onDelete) return;
      const ids = sel.map(m => m.userData.id);
      setSelection([]);
      handlers.onDelete(ids);
    }

    // ================= pointer machinery =================
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dom = renderer.domElement;

    function setRay(e) {
      // canvas-relative coords (the sidebar shifts clientX — see hover note below)
      const r = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
    }
    function rayOnPlane(e, plane) {
      setRay(e);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    }
    function pick(e) {
      setRay(e);
      return raycaster.intersectObjects(nodeObjs.filter(m => m.visible))[0] || null;
    }

    // orbit state (unchanged behavior)
    let theta = 0.9, phi = 1.15, radius = 78;
    const target = new THREE.Vector3(0, 0, 0);
    if (handlers.initialView && handlers.initialView.theta !== undefined) {
      const v = handlers.initialView;
      theta = v.theta; phi = v.phi; radius = v.radius;
      target.set(v.target.x, v.target.y, v.target.z);
    }
    function applyCamera() {
      const sp = Math.sin(phi), cp = Math.cos(phi);
      camera.position.set(
        target.x + radius * sp * Math.sin(theta),
        target.y + radius * cp,
        target.z + radius * sp * Math.cos(theta));
      camera.lookAt(target);
    }

    // pointer interaction state machine
    // mode: null | 'orbit' | 'pan' | 'maybe-node' | 'node-drag' | 'maybe-box' | 'box'
    let mode = null, px = 0, py = 0, movedPx = 0;
    let downHit = null;
    const drag = { objs: [], had: [], plane: null, grabPoint: null, primed: null };
    const box = { div: null, x0: 0, y0: 0, base: [] };
    let hoverMesh = null;

    function beginNodeDrag(e, objs) {
      const center = centerOf(objs);
      drag.plane = new THREE.Plane();
      drag.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), center);
      const hit = rayOnPlane(e, drag.plane);
      drag.grabPoint = hit || center;
      drag.objs = objs;
      drag.had = objs.map(m => m.position.clone());
      mode = 'node-drag';
      dom.style.cursor = 'grabbing';
    }
    function nodeDragMove(e) {
      const hit = rayOnPlane(e, drag.plane);
      if (!hit) return;
      const delta = hit.clone().sub(drag.grabPoint);
      for (let i = 0; i < drag.objs.length; i++) drag.objs[i].position.copy(drag.had[i]).add(delta);
      updateEdgePositions();
    }
    function endInteractions() {
      if (mode === 'node-drag') {
        if (movedPx > 5) markMoved(drag.objs);
        dom.style.cursor = hoverMesh ? 'pointer' : 'default';
      }
      if (box.div) { box.div.remove(); box.div = null; }
      if (mode === 'box') dom.style.cursor = 'default';
      mode = null;
    }

    // box-select rect (fixed coords; lives in container so remount cleans up)
    function boxRectShow(x0, y0, x1, y1) {
      if (!box.div) {
        box.div = document.createElement('div');
        box.div.id = 'box-rect';
        container.appendChild(box.div);
      }
      const cr = container.getBoundingClientRect(); // client → container-local
      box.div.style.left = (Math.min(x0, x1) - cr.left) + 'px';
      box.div.style.top = (Math.min(y0, y1) - cr.top) + 'px';
      box.div.style.width = Math.abs(x1 - x0) + 'px';
      box.div.style.height = Math.abs(y1 - y0) + 'px';
    }
    function screenPos(m) {
      const v = m.position.clone().project(camera);
      const r = dom.getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top, z: v.z };
    }
    function nodesInBox(x0, y0, x1, y1) {
      const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
      return nodeObjs.filter(m => {
        if (!m.visible) return false;
        const p = screenPos(m);
        return p.z < 1 && p.x >= L && p.x <= R && p.y >= T && p.y <= B;
      });
    }

    dom.addEventListener('pointerdown', e => {
      cancelFly();
      px = e.clientX; py = e.clientY; movedPx = 0;
      try { dom.setPointerCapture(e.pointerId); } catch {}

      if (xf.mode) { commitTransform(); return; }         // click confirms G/R/S
      if (e.button === 2) { mode = 'pan'; return; }        // right = pan (menu on contextmenu)
      if (e.button !== 0) return;

      const hit = pick(e);
      downHit = hit;
      if (hit) {
        mode = 'maybe-node';
        // dragging a selected node moves the whole selection; an unselected one
        // promotes itself to the selection once the drag actually starts
        drag.primed = hit.object.userData.selected ? selectedMeshes() : null;
      } else {
        mode = 'maybe-box';
        box.x0 = e.clientX; box.y0 = e.clientY;
        box.base = selectedMeshes().map(m => m.userData.id); // Esc restores this
      }
    });

    dom.addEventListener('pointermove', e => {
      if (!mode) { hover(e); return; }
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      movedPx += Math.abs(dx) + Math.abs(dy);

      if (mode === 'maybe-node' && movedPx > 5) {
        // mouse-down on a node then move = drag the (pre-existing or hit) selection
        const objs = drag.primed || [downHit.object];
        if (!drag.primed) setSelection([downHit.object]);
        beginNodeDrag(e, objs);
        nodeDragMove(e);
        return;
      }
      if (mode === 'node-drag') { nodeDragMove(e); return; }

      if (mode === 'maybe-box' && movedPx > 5) { mode = 'box'; dom.style.cursor = 'crosshair'; }
      if (mode === 'box') {
        boxRectShow(box.x0, box.y0, e.clientX, e.clientY);
        const inBox = nodesInBox(box.x0, box.y0, e.clientX, e.clientY);
        const base = e.shiftKey || e.ctrlKey ? selectedMeshes() : [];
        const ids = new Set([...base, ...inBox].map(m => m.userData.id));
        for (const m of nodeObjs) {
          m.userData.selected = ids.has(m.userData.id);
          paintMesh(m);
        }
      } else if (mode === 'maybe-box') {
        // tiny wiggle before box activates: treat as orbit
        mode = 'orbit';
      }
      if (mode === 'orbit') {
        theta -= dx * 0.0055;
        phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi - dy * 0.005));
      } else if (mode === 'pan') {
        const panScale = radius * 0.0012;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        target.addScaledVector(right, -dx * panScale * 0.6);
        target.addScaledVector(up, dy * panScale * 0.6);
      }
    });

    function finishPointer(e) {
      const wasMode = mode;
      endInteractions();
      if (!e) return;
      const additive = e.shiftKey || e.ctrlKey;

      if (wasMode === 'maybe-node' && movedPx <= 5 && downHit) {
        const m = downHit.object;
        if (additive) toggleSel(m); else setSelection([m]);
        return;
      }
      if (wasMode === 'maybe-box' && movedPx <= 5) deselectAll();
      // 'box' success: selection was painted live; 'node-drag': Pin panel shows "Save positions"
    }
    dom.addEventListener('pointerup', e => finishPointer(e));
    dom.addEventListener('pointercancel', () => { cancelTransform(); endInteractions(); });
    // If a native dialog eats pointerup, no event fires at all — this bubble-phase
    // window listener resets state on the next pointerup anywhere, so a stuck
    // drag can never wedge the app.
    window.addEventListener('pointerup', () => endInteractions(), false);
    window.addEventListener('pointermove', e => { if (xf.mode) transformMousemove(e); });

    dom.addEventListener('contextmenu', e => {
      e.preventDefault();
      try { dom.releasePointerCapture(e.pointerId); } catch {}
      const was = mode; endInteractions();
      if (was === 'pan') return; // right-drag panned; don't also open the menu
      const hit = pick(e);
      if (hit && handlers.onNodeMenu) handlers.onNodeMenu(e, hit.object.userData);
      else if (handlers.onCanvasMenu) handlers.onCanvasMenu(e);
    });

    dom.addEventListener('dblclick', e => {
      const hit = pick(e);
      if (hit && handlers.onOpen) handlers.onOpen(hit.object.userData.id);
    });

    dom.addEventListener('wheel', e => {
      e.preventDefault();
      cancelFly();
      radius = Math.max(6, Math.min(220, radius * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });

    // ---- keyboard (G/R/S/A/Del/Esc) — returns true when consumed ----
    function handleKey(e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
      const modalOpen = !xformModal.classList.contains('hidden');
      if (e.key === 'Escape') {
        if (modalOpen) return cancelTransform();
        if (mode === 'box' || box.div) {
          // abort box-select: restore what was selected before the drag began
          endInteractions();
          setSelection(box.base.map(id => byMesh.get(id)).filter(Boolean));
          return true;
        }
        deselectAll();
        return selectedMeshes().length > 0;
      }
      const k = e.key.toLowerCase();
      if (modalOpen && (k === 'enter' || k === 'g' || k === 'r' || k === 's')) return commitTransform();
      const sel = selectedMeshes();
      if (k === 'g' && sel.length) {
        // Blender-style grab: selection follows the mouse on the camera-facing
        // plane through the selection center; click or Enter keeps it.
        const center = centerOf(sel);
        const plane = new THREE.Plane();
        plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), center);
        startTransform('move');
        xf.grabPlane = plane;
        xf.grabPoint = center.clone();
        return true;
      }
      if (k === 'r' && sel.length) return startTransform('rotate');
      if (k === 's' && sel.length) return startTransform('scale');
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { deleteSelection(); return true; }
      if (k === 'a' && !e.ctrlKey && !e.metaKey) { setSelection(nodeObjs.filter(m => m.visible)); return true; }
      return false;
    }

    // ---- hover (uses pick; keeps selection tinting coherent) ----
    const tooltip = handlers.tooltipEl;
    const previewCache = new Map();
    let hoverId = null;
    function hover(e) {
      const hit = pick(e);
      const m = hit ? hit.object : null;
      if (m !== hoverMesh) {
        const prev = hoverMesh;
        hoverMesh = m;
        if (prev) paintMesh(prev);
        if (m) { m.material.color.setHex(HOVER_COLOR); dom.style.cursor = 'pointer'; }
        else dom.style.cursor = 'default';
      }
      const id = m ? m.userData.id : null;
      if (m) {
        const u = m.userData;
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
        tooltip.style.display = 'none';
        hoverId = null;
      }
    }

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
      const box3 = new THREE.Box3();
      ms.forEach(m => box3.expandByObject(m));
      const c = new THREE.Vector3();
      box3.getCenter(c);
      const sph = box3.getBoundingSphere(new THREE.Sphere());
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
    repaintAll();

    // panel buttons
    document.getElementById('sel-open').addEventListener('click', () => {
      const sel = selectedMeshes();
      if (sel.length && handlers.onOpen) handlers.onOpen(sel[0].userData.id);
    });
    selPinBtn.addEventListener('click', () => {
      const sel = selectedMeshes();
      if (pinDirty) savePinState();
      else if (sel.length && sel.every(m => m.userData.pinned)) unpinSelection();
      else savePinState();
    });
    document.getElementById('sel-deselect').addEventListener('click', deselectAll);
    document.getElementById('sel-delete').addEventListener('click', deleteSelection);
    document.getElementById('xf-done').addEventListener('click', commitTransform);
    document.getElementById('xf-cancel').addEventListener('click', cancelTransform);

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
      handleKey,
      getSelected() { return selectedMeshes().map(m => m.userData.id); },
      pinAt(id) {
        const m = byMesh.get(id);
        if (!m) return;
        m.userData.pinned = true;
        if (handlers.onSaveLayout) handlers.onSaveLayout({ nodes: { [id]: { x: m.position.x, y: m.position.y, z: m.position.z } } });
        repaintAll();
      },
      unpinAt(id) {
        const m = byMesh.get(id);
        if (!m) return;
        m.userData.pinned = false;
        movedNodes.delete(id);
        if (handlers.onUnpin) handlers.onUnpin([id]);
        repaintAll(); updateSelPanel();
      },
      isPinned(id) { const m = byMesh.get(id); return m ? m.userData.pinned : null; },
      nodePos(id) { const m = byMesh.get(id); return m ? { ...m.position } : null; },
      isDirty() { return pinDirty; },
      _test: {
        setSelection(list) { setSelection(list.map(id => byMesh.get(id)).filter(Boolean)); },
        beginNodeDragAt(id) {
          const m = byMesh.get(id); if (!m) return false;
          setSelection([m]);
          const fake = { clientX: innerWidth / 2, clientY: innerHeight / 2, pointerId: 1 };
          beginNodeDrag(fake, [m]);
          return true;
        },
        dragBy(dxyz) {
          if (mode !== 'node-drag') return false;
          for (let i = 0; i < drag.objs.length; i++) drag.objs[i].position.copy(drag.had[i]).add(new THREE.Vector3(dxyz[0], dxyz[1], dxyz[2]));
          updateEdgePositions(); markMoved();
          endInteractions();
          return true;
        },
        transformState() { return { mode: xf.mode, moved: xf.moved }; },
        commitTransform, cancelTransform,
        selectAll() { handleKey({ key: 'a', target: document.body, preventDefault() {} }); return selectedMeshes().length; },
      },
      getView() { return { theta, phi, radius, target: { x: target.x, y: target.y, z: target.z } }; },
      resetView() { theta = 0.9; phi = 1.15; radius = 78; target.set(0, 0, 0); },
      debug: {
        opacity(id) { const m = nodeObjs.find(o => o.userData.id === id); return m ? m.material.opacity : null; },
        linkVisible(a, b) {
          const e = edgeObjs.find(o => (o.userData.a === a && o.userData.b === b) || (o.userData.a === b && o.userData.b === a));
          return e ? e.visible : null;
        },
        project(id) { const p = byMesh.get(id) ? screenPos(byMesh.get(id)) : null; return p ? { ...p, visible: p.z < 1 } : null; },
      },
    };
  }

  window.World3D = { mount };
})();
