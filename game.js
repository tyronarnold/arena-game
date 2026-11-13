(() => {
  const HALF = 18;
  const PLAYER_R = 0.42;
  const ENEMY_R = 0.7;
  const EYE = 1.55;

  // Difficulty tuning. Lower enemy numbers / higher player numbers = easier.
  const TUNE = {
    playerDamage: 34,      // damage per player hit on the Warden (3 hits to win)
    enemyHitRadius: 0.8,   // how forgiving player shots are
    enemyDamage: 10,       // damage per Warden hit on you (was 16)
    enemyCooldown: 1.7,    // seconds between Warden shots (was 1.15)
    enemyWindup: 0.7,      // warning time before each Warden shot (was 0.42)
    enemySpread: 0.3,      // Warden aim inaccuracy (was 0.16)
    enemyBulletSpeed: 16,  // slower shots are easier to dodge (was 22)
    enemySpeed: 4.4,       // Warden move speed (was 5.4)
    playerHitRadius: 0.4,  // Warden shots must land closer to hit you (was 0.48)
    regenDelay: 3,         // seconds without damage before you heal
    regenRate: 12          // HP per second while healing
  };

  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("start");
  const resultEl = document.getElementById("result");
  const titleEl = document.getElementById("title");
  const blurbEl = document.getElementById("blurb");
  const playerFill = document.getElementById("player-fill");
  const enemyFill = document.getElementById("enemy-fill");
  const hitmark = document.getElementById("hitmark");
  const damageEl = document.getElementById("damage");
  const winsEl = document.getElementById("wins");
  const playerHpEl = document.getElementById("player-hp");
  const enemyHpEl = document.getElementById("enemy-hp");
  const playerPlate = document.getElementById("player-plate");
  const pointerEl = document.getElementById("pointer");
  const warnEl = document.getElementById("warn");
  const chargeFill = document.getElementById("charge-fill");
  const distEl = document.getElementById("enemy-dist");
  const radar = document.getElementById("radar");
  const rctx = radar.getContext("2d");

  let wins = 0;
  try { wins = parseInt(localStorage.getItem("arena.wins"), 10) || 0; } catch (e) {}
  winsEl.textContent = wins;

  if (!window.THREE) {
    blurbEl.textContent = "Three.js failed to load. Check your connection and refresh.";
    startBtn.disabled = true;
    return;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a2230");
  scene.fog = new THREE.Fog("#1a2230", 28, 68);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 80);
  camera.rotation.order = "YXZ";

  const keys = Object.create(null);
  addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
  });
  addEventListener("keyup", (e) => { keys[e.code] = false; });

  let audioCtx = null;
  function tone(freq, dur, gain, type = "square") {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }

  function floorTexture() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const g = c.getContext("2d");
    g.fillStyle = "#2a3344";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#46536b";
    g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
    }
    g.strokeStyle = "#3c4c66";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(256, 256, 90, 0, Math.PI * 2);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  const cover = [];
  const solids = [];

  function addBox(w, h, d, x, y, z, color, emissive = 0x000000) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.18, emissive })
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    solids.push(mesh);
    cover.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2
    });
    return mesh;
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: "#5d6b82", roughness: 0.78, metalness: 0.22 });
  function wall(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    solids.push(mesh);
  }
  const t = 1.2;
  const span = HALF * 2 + t * 2;
  wall(span, 5.5, t, 0, 2.75, -HALF - t / 2);
  wall(span, 5.5, t, 0, 2.75, HALF + t / 2);
  wall(t, 5.5, span, -HALF - t / 2, 2.75, 0);
  wall(t, 5.5, span, HALF + t / 2, 2.75, 0);

  const trimMat = new THREE.MeshStandardMaterial({
    color: "#ffb020",
    emissive: "#ff8a00",
    emissiveIntensity: 0.7,
    roughness: 0.4
  });
  function trim(x, z, rot) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), trimMat);
    m.position.set(x, 2.4, z);
    m.rotation.y = rot;
    scene.add(m);
  }
  trim(0, -HALF + 0.08, 0);
  trim(0, HALF - 0.08, 0);
  trim(-HALF + 0.08, 0, Math.PI / 2);
  trim(HALF - 0.08, 0, Math.PI / 2);

  const pillarSpots = [
    [-7.2, -7.2, 2.3],
    [7.2, -7.2, 2.3],
    [-7.2, 7.2, 2.3],
    [7.2, 7.2, 2.3],
    [0, 0, 2.8]
  ];
  for (const [x, z, s] of pillarSpots) {
    addBox(s, 4.2, s, x, 2.1, z, "#6d7c93");
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(s + 0.25, 0.18, s + 0.25),
      trimMat
    );
    cap.position.set(x, 4.15, z);
    scene.add(cap);
  }

  scene.add(new THREE.HemisphereLight("#c5d4ee", "#3a2a22", 1.15));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.45);
  sun.position.set(8, 16, 6);
  scene.add(sun);
  const glowA = new THREE.PointLight("#ff7a18", 8, 22);
  glowA.position.set(-12, 3.2, -12);
  scene.add(glowA);
  const glowB = new THREE.PointLight("#2f8cff", 8, 22);
  glowB.position.set(12, 3.2, 12);
  scene.add(glowB);

  const gun = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: "#1c2430", metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.46), gunMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.34), gunMat);
  barrel.position.set(0, 0.05, -0.32);
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.12),
    new THREE.MeshStandardMaterial({ color: "#3ee0ff", emissive: "#139ab8", emissiveIntensity: 0.8 })
  );
  accent.position.set(0, 0.09, -0.18);
  gun.add(body, barrel, accent);
  gun.position.set(0.28, -0.28, -0.55);
  camera.add(gun);
  scene.add(camera);

  const flash = new THREE.PointLight("#9aefff", 0, 6);
  flash.position.set(0, 0.05, -0.55);
  gun.add(flash);

  function makeEnemy() {
    const group = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: "#c43232", metalness: 0.35, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: "#2a1214", metalness: 0.5, roughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: "#3a3f48", metalness: 0.8, roughness: 0.3 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: "#ffd0a0", emissive: "#ff6a00", emissiveIntensity: 1.4 });
    const coreMat = new THREE.MeshStandardMaterial({ color: "#ffb38a", emissive: "#ff3a00", emissiveIntensity: 1 });

    function part(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      group.add(m);
      return m;
    }

    // Legs and hips
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.22, 0.46, 0.26), dark, 0.18 * s, 0.62, 0);
      part(new THREE.BoxGeometry(0.2, 0.42, 0.22), steel, 0.18 * s, 0.22, 0.02);
      part(new THREE.BoxGeometry(0.24, 0.08, 0.38), dark, 0.18 * s, 0.04, 0.06);
      part(new THREE.BoxGeometry(0.24, 0.16, 0.08), armor, 0.18 * s, 0.46, 0.15, -0.2);
    }
    part(new THREE.BoxGeometry(0.6, 0.18, 0.34), steel, 0, 0.86, 0);

    // Torso, chest plate and glowing core
    part(new THREE.BoxGeometry(0.72, 0.85, 0.4), armor, 0, 1.25, 0);
    part(new THREE.BoxGeometry(0.56, 0.42, 0.08), dark, 0, 1.36, 0.22);
    const core = part(new THREE.OctahedronGeometry(0.1), coreMat, 0, 1.36, 0.28);
    for (let i = 0; i < 3; i++) {
      part(new THREE.BoxGeometry(0.5, 0.035, 0.05), steel, 0, 1.0 - i * 0.07, 0.21);
    }

    // Backpack with exhaust vents
    part(new THREE.BoxGeometry(0.5, 0.56, 0.22), dark, 0, 1.34, -0.3);
    for (const s of [-1, 1]) {
      part(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), steel, 0.15 * s, 1.72, -0.34);
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), eyeMat, 0.15 * s, 1.88, -0.34);
    }

    // Shoulder pads with spikes
    for (const s of [-1, 1]) {
      part(new THREE.BoxGeometry(0.32, 0.2, 0.48), armor, 0.5 * s, 1.62, 0, 0, 0, -0.25 * s);
      part(new THREE.ConeGeometry(0.06, 0.24, 6), steel, 0.56 * s, 1.82, 0.08, 0, 0, -0.35 * s);
      part(new THREE.ConeGeometry(0.06, 0.24, 6), steel, 0.56 * s, 1.82, -0.1, 0, 0, -0.35 * s);
    }

    // Left arm hanging with a claw
    part(new THREE.BoxGeometry(0.16, 0.5, 0.18), dark, -0.5, 1.22, 0);
    part(new THREE.BoxGeometry(0.2, 0.36, 0.22), armor, -0.5, 0.86, 0.04);
    for (const z of [-0.06, 0.06, 0.16]) {
      part(new THREE.ConeGeometry(0.03, 0.16, 5), steel, -0.5, 0.62, z, Math.PI);
    }

    // Right arm: a heavy cannon aimed forward
    part(new THREE.BoxGeometry(0.16, 0.16, 0.3), dark, 0.42, 1.28, 0.08);
    part(new THREE.BoxGeometry(0.22, 0.24, 0.46), steel, 0.42, 1.28, 0.38);
    part(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 12), dark, 0.42, 1.3, 0.78, Math.PI / 2);
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 12), steel, 0.42, 1.3, 0.96, Math.PI / 2);
    const muzzle = part(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), coreMat, 0.42, 1.3, 1.0, Math.PI / 2);
    part(new THREE.BoxGeometry(0.03, 0.06, 0.3), eyeMat, 0.42, 1.42, 0.38);

    // Head: helmet, visor, horns
    part(new THREE.BoxGeometry(0.16, 0.12, 0.16), steel, 0, 1.73, 0);
    part(new THREE.BoxGeometry(0.38, 0.34, 0.34), dark, 0, 1.9, 0);
    part(new THREE.BoxGeometry(0.42, 0.1, 0.06), steel, 0, 1.92, 0.17);
    part(new THREE.BoxGeometry(0.08, 0.06, 0.04), eyeMat, -0.09, 1.92, 0.2);
    part(new THREE.BoxGeometry(0.08, 0.06, 0.04), eyeMat, 0.09, 1.92, 0.2);
    part(new THREE.BoxGeometry(0.08, 0.14, 0.4), armor, 0, 2.1, -0.02);
    for (const s of [-1, 1]) {
      part(new THREE.ConeGeometry(0.05, 0.3, 6), steel, 0.2 * s, 2.12, 0.02, 0, 0, -0.5 * s);
    }

    scene.add(group);
    return { group, mats: [armor, dark], coreMat, core, muzzle };
  }

  const enemyView = makeEnemy();
  const raycaster = new THREE.Raycaster();
  const bullets = [];
  const bulletGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const playerBulletMat = new THREE.MeshBasicMaterial({ color: "#7af6ff" });
  const enemyBulletMat = new THREE.MeshBasicMaterial({ color: "#ffb15a" });

  const state = {
    playing: false,
    over: false,
    yaw: 0,
    pos: new THREE.Vector3(0, EYE, 12),
    enemy: new THREE.Vector3(0, 0, -12),
    enemyYaw: 0,
    playerHp: 100,
    enemyHp: 100,
    playerCd: 0,
    enemyCd: 0,
    enemyAim: 0,
    enemySees: false,
    sinceHurt: 99,
    flash: 0,
    hurt: 0,
    bob: 0,
    wp: 0,
    recoil: 0
  };

  const waypoints = [
    new THREE.Vector3(-12, 0, -12),
    new THREE.Vector3(12, 0, -12),
    new THREE.Vector3(12, 0, 12),
    new THREE.Vector3(-12, 0, 12)
  ];

  function setHealth() {
    playerFill.style.transform = `scaleX(${Math.max(state.playerHp, 0) / 100})`;
    enemyFill.style.transform = `scaleX(${Math.max(state.enemyHp, 0) / 100})`;
    playerHpEl.textContent = Math.ceil(state.playerHp);
    enemyHpEl.textContent = Math.ceil(state.enemyHp);
    playerPlate.classList.toggle("low", state.playerHp > 0 && state.playerHp <= 30);
  }

  function blocked(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.001) return false;
    dir.multiplyScalar(1 / dist);
    raycaster.set(from, dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(solids, false);
    return hits.length > 0 && hits[0].distance < dist - 0.35;
  }

  function resolveCircle(pos, radius) {
    const limit = HALF - radius;
    pos.x = Math.max(-limit, Math.min(limit, pos.x));
    pos.z = Math.max(-limit, Math.min(limit, pos.z));
    for (const b of cover) {
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          const left = pos.x - b.minX;
          const right = b.maxX - pos.x;
          const back = pos.z - b.minZ;
          const front = b.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = b.minX - radius;
          else if (m === right) pos.x = b.maxX + radius;
          else if (m === back) pos.z = b.minZ - radius;
          else pos.z = b.maxZ + radius;
        }
      }
    }
  }

  function separateActors() {
    const dx = state.pos.x - state.enemy.x;
    const dz = state.pos.z - state.enemy.z;
    const min = PLAYER_R + ENEMY_R;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-8) return;
    const d = Math.sqrt(d2);
    const push = (min - d) / 2;
    const nx = dx / d;
    const nz = dz / d;
    state.pos.x += nx * push;
    state.pos.z += nz * push;
    state.enemy.x -= nx * push;
    state.enemy.z -= nz * push;
    resolveCircle(state.pos, PLAYER_R);
    resolveCircle(state.enemy, ENEMY_R);
  }

  function hitsSolid(p) {
    if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF) return true;
    return cover.some((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ);
  }

  function spawnBullet(origin, dir, owner) {
    const mesh = new THREE.Mesh(bulletGeo, owner === "player" ? playerBulletMat : enemyBulletMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    bullets.push({
      mesh,
      vel: dir.clone().multiplyScalar(owner === "player" ? 34 : TUNE.enemyBulletSpeed),
      owner,
      life: 1.6
    });
  }

  function shootPlayer(forward) {
    const origin = state.pos.clone().add(forward.clone().multiplyScalar(0.85));
    origin.y = EYE - 0.05;
    spawnBullet(origin, forward, "player");
    state.playerCd = 0.26;
    state.recoil = 1;
    state.flash = 1;
    tone(520, 0.06, 0.05, "square");
    tone(180, 0.08, 0.04, "sawtooth");
  }

  function shootEnemy(dir) {
    const origin = state.enemy.clone();
    origin.y = 1.35;
    origin.add(dir.clone().multiplyScalar(0.9));
    spawnBullet(origin, dir, "enemy");
    state.enemyCd = TUNE.enemyCooldown;
    tone(240, 0.09, 0.04, "sawtooth");
  }

  function hurtPlayer(amount) {
    if (!state.playing) return;
    state.playerHp = Math.max(0, state.playerHp - amount);
    state.hurt = 1;
    state.sinceHurt = 0;
    tone(90, 0.12, 0.06, "triangle");
    setHealth();
    if (state.playerHp <= 0) endMatch(false);
  }

  function hurtEnemy(amount) {
    if (!state.playing) return;
    state.enemyHp = Math.max(0, state.enemyHp - amount);
    enemyView.mats.forEach((m) => { m.emissive = new THREE.Color("#ffffff"); m.emissiveIntensity = 0.8; });
    hitmark.classList.remove("show");
    void hitmark.offsetWidth;
    hitmark.classList.add("show");
    tone(660, 0.07, 0.05, "square");
    setHealth();
    if (state.enemyHp <= 0) endMatch(true);
  }

  function endMatch(won) {
    state.playing = false;
    state.over = true;
    if (won) {
      wins += 1;
      winsEl.textContent = wins;
      try { localStorage.setItem("arena.wins", String(wins)); } catch (e) {}
    }
    resultEl.textContent = won ? "Warden down" : "You were dropped";
    titleEl.textContent = won ? "WIN" : "LOSS";
    blurbEl.textContent = won
      ? "The arena is yours. Run it back if you want another round."
      : "The Warden kept the room. Reset and take the pillars this time.";
    startBtn.textContent = "Fight again";
    overlay.classList.remove("hidden");
  }

  function resetMatch() {
    state.playing = true;
    state.over = false;
    state.yaw = -0.22;
    state.pos.set(-5, EYE, 11);
    state.enemy.set(0, 0, -12);
    state.enemyYaw = 0;
    state.playerHp = 100;
    state.enemyHp = 100;
    state.sinceHurt = 99;
    state.enemySees = false;
    state.playerCd = 0;
    state.enemyCd = 0.6;
    state.enemyAim = 0;
    state.wp = 0;
    state.recoil = 0;
    for (const b of bullets) scene.remove(b.mesh);
    bullets.length = 0;
    enemyView.mats[0].emissive = new THREE.Color("#000000");
    enemyView.mats[0].emissiveIntensity = 0;
    setHealth();
    resultEl.textContent = "";
    overlay.classList.add("hidden");
  }

  function start() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    startBtn.blur();
    resetMatch();
  }
  startBtn.addEventListener("click", start);
  addEventListener("keydown", (e) => {
    if (!state.playing && (e.code === "Enter" || e.code === "Space") && overlay && !overlay.classList.contains("hidden")) {
      e.preventDefault();
      start();
    }
    if (state.over && e.code === "KeyR") start();
  });

  const forward = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const enemyDir = new THREE.Vector3();

  const RADAR_RANGE = 22;
  function updateHud(now) {
    const dx = state.enemy.x - state.pos.x;
    const dz = state.enemy.z - state.pos.z;
    const dist = Math.hypot(dx, dz);
    const sinY = Math.sin(state.yaw);
    const cosY = Math.cos(state.yaw);
    const ahead = -dx * sinY - dz * cosY;
    const right = dx * cosY - dz * sinY;
    const rel = Math.atan2(right, ahead);
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);

    // Edge arrow pointing at the Warden when it is off-screen.
    const offscreen = state.playing && state.enemyHp > 0 && Math.abs(rel) > halfFov * 0.85;
    pointerEl.style.opacity = offscreen ? "1" : "0";
    if (offscreen) {
      const r = Math.min(innerWidth, innerHeight) * 0.3;
      pointerEl.style.transform = `rotate(${rel}rad) translateY(${-r}px)`;
    }

    // "Incoming" warning with wind-up bar.
    const charge = state.playing && state.enemySees ? Math.min(1, state.enemyAim / TUNE.enemyWindup) : 0;
    warnEl.style.opacity = charge > 0 ? String(0.55 + charge * 0.45) : "0";
    chargeFill.style.transform = `scaleX(${charge})`;

    distEl.textContent = state.enemyHp > 0 ? dist.toFixed(0) : "--";

    // Radar: player-centred, forward is up.
    const S = radar.width;
    const k = S / 2 / RADAR_RANGE;
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.clearRect(0, 0, S, S);
    rctx.save();
    rctx.beginPath();
    rctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    rctx.clip();

    rctx.strokeStyle = "rgba(255,255,255,0.08)";
    rctx.lineWidth = 2;
    for (const ring of [1 / 3, 2 / 3]) {
      rctx.beginPath();
      rctx.arc(S / 2, S / 2, (S / 2) * ring, 0, Math.PI * 2);
      rctx.stroke();
    }

    rctx.translate(S / 2, S / 2);
    rctx.scale(k, k);
    rctx.rotate(state.yaw);
    rctx.translate(-state.pos.x, -state.pos.z);

    rctx.strokeStyle = "rgba(255,176,32,0.7)";
    rctx.lineWidth = 2 / k;
    rctx.strokeRect(-HALF, -HALF, HALF * 2, HALF * 2);
    rctx.fillStyle = "rgba(147,160,181,0.55)";
    for (const b of cover) rctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);

    for (const b of bullets) {
      rctx.fillStyle = b.owner === "enemy" ? "#ffb15a" : "#7af6ff";
      rctx.beginPath();
      rctx.arc(b.mesh.position.x, b.mesh.position.z, 3 / k, 0, Math.PI * 2);
      rctx.fill();
    }

    if (state.enemyHp > 0) {
      const blink = charge > 0 ? 0.5 + 0.5 * Math.sin(now * 0.03) : 1;
      rctx.fillStyle = `rgba(255,77,77,${0.4 + blink * 0.6})`;
      rctx.beginPath();
      rctx.arc(state.enemy.x, state.enemy.z, 9 / k, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.restore();

    // Player marker (always centred, pointing up).
    rctx.fillStyle = "#7dffb2";
    rctx.beginPath();
    rctx.moveTo(S / 2, S / 2 - 12);
    rctx.lineTo(S / 2 + 8, S / 2 + 9);
    rctx.lineTo(S / 2 - 8, S / 2 + 9);
    rctx.closePath();
    rctx.fill();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state.playing) {
      if (keys.ArrowLeft) state.yaw += 2.15 * dt;
      if (keys.ArrowRight) state.yaw -= 2.15 * dt;
      camera.rotation.y = state.yaw;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0) forward.normalize();

      wish.set(0, 0, 0);
      if (keys.ArrowUp) wish.add(forward);
      if (keys.ArrowDown) wish.sub(forward);
      const moving = wish.lengthSq() > 0;
      if (moving) {
        wish.normalize().multiplyScalar(8.2 * dt);
        state.pos.add(wish);
        state.bob += dt * 10;
      }
      resolveCircle(state.pos, PLAYER_R);

      state.playerCd = Math.max(0, state.playerCd - dt);
      if (keys.Space && state.playerCd <= 0) shootPlayer(forward);

      state.sinceHurt += dt;
      const regenerating = state.sinceHurt >= TUNE.regenDelay && state.playerHp < 100;
      if (regenerating) {
        state.playerHp = Math.min(100, state.playerHp + TUNE.regenRate * dt);
        setHealth();
      }
      playerPlate.classList.toggle("regen", regenerating);

      const eye = state.enemy.clone();
      eye.y = 1.45;
      const playerChest = state.pos.clone();
      const los = !blocked(eye, playerChest);
      state.enemySees = los;
      const toPlayer = new THREE.Vector3(state.pos.x - state.enemy.x, 0, state.pos.z - state.enemy.z);
      const dist = toPlayer.length();
      enemyDir.set(0, 0, 0);
      if (los && dist > 0.01) {
        const flat = toPlayer.clone().multiplyScalar(1 / dist);
        const side = new THREE.Vector3(-flat.z, 0, flat.x);
        if (dist > 8.5) enemyDir.add(flat);
        else if (dist < 4.2) enemyDir.sub(flat);
        enemyDir.add(side.multiplyScalar(Math.sin(now * 0.0017)));
        const aim = flat.clone();
        aim.x += (Math.random() - 0.5) * TUNE.enemySpread;
        aim.z += (Math.random() - 0.5) * TUNE.enemySpread;
        aim.normalize();
        state.enemyCd -= dt;
        if (dist < 26 && state.enemyCd <= 0) {
          state.enemyAim += dt;
          enemyView.mats[0].emissive = new THREE.Color("#ffd2a8");
          enemyView.mats[0].emissiveIntensity = Math.min(1.2, (state.enemyAim / TUNE.enemyWindup) * 1.26);
          if (state.enemyAim >= TUNE.enemyWindup) {
            shootEnemy(aim);
            state.enemyAim = 0;
          }
        } else {
          state.enemyAim = 0;
        }
        const face = Math.atan2(flat.x, flat.z);
        let diff = face - state.enemyYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        state.enemyYaw += diff * Math.min(1, dt * 6);
      } else {
        const wp = waypoints[state.wp];
        const to = new THREE.Vector3(wp.x - state.enemy.x, 0, wp.z - state.enemy.z);
        if (to.length() < 1.1) state.wp = (state.wp + 1) % waypoints.length;
        else enemyDir.add(to.normalize());
        state.enemyYaw = Math.atan2(enemyDir.x, enemyDir.z);
        state.enemyCd = Math.max(state.enemyCd, 0.35);
      }
      if (enemyDir.lengthSq() > 0) {
        enemyDir.normalize().multiplyScalar(TUNE.enemySpeed * dt);
        state.enemy.add(enemyDir);
        resolveCircle(state.enemy, ENEMY_R);
      }
      separateActors();
      enemyView.group.position.set(state.enemy.x, 0, state.enemy.z);
      enemyView.group.rotation.y = state.enemyYaw;

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.life -= dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        const p = b.mesh.position;
        let dead = b.life <= 0 || hitsSolid(p);
        if (!dead && b.owner === "player") {
          const dx = p.x - state.enemy.x;
          const dz = p.z - state.enemy.z;
          if (dx * dx + dz * dz < TUNE.enemyHitRadius ** 2 && p.y > 0.3 && p.y < 2.3) {
            dead = true;
            hurtEnemy(TUNE.playerDamage);
          }
        }
        if (!dead && b.owner === "enemy") {
          const dx = p.x - state.pos.x;
          const dz = p.z - state.pos.z;
          if (dx * dx + dz * dz < TUNE.playerHitRadius ** 2 && Math.abs(p.y - EYE) < 1.1) {
            dead = true;
            hurtPlayer(TUNE.enemyDamage);
          }
        }
        if (dead) {
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        }
      }
    }

    state.recoil = Math.max(0, state.recoil - dt * 6);
    state.flash = Math.max(0, state.flash - dt * 10);
    state.hurt = Math.max(0, state.hurt - dt * 2.2);
    flash.intensity = state.flash * 7;
    gun.position.z = -0.55 + state.recoil * 0.08;
    gun.position.y = -0.28 + Math.sin(state.bob) * 0.012;
    damageEl.style.opacity = String(state.hurt * 0.85);
    if (state.enemyAim <= 0) {
      enemyView.mats[0].emissiveIntensity = Math.max(0, enemyView.mats[0].emissiveIntensity - dt * 3.5);
    }
    if (state.enemyHp > 0) {
      const pulse = 0.35 + Math.sin(now * 0.008) * 0.15;
      enemyView.mats[1].emissive = new THREE.Color("#ff4a1a");
      enemyView.mats[1].emissiveIntensity = pulse * 0.45;
      const charge = Math.min(1, state.enemyAim / TUNE.enemyWindup);
      enemyView.coreMat.emissiveIntensity = 0.8 + pulse + charge * 2.5;
      enemyView.core.rotation.y += dt * (1.5 + charge * 10);
      enemyView.muzzle.scale.setScalar(1 + charge * 0.8);
    }

    updateHud(now);
    camera.position.copy(state.pos);
    camera.position.y = EYE + Math.sin(state.bob) * 0.03;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  setHealth();
  requestAnimationFrame(frame);
})();
