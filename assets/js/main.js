/**
 * SKY ISLAND — main.js
 * Full-screen 3D scene.
 * - Draco-compressed GLB (SKYC.glb)
 * - SUNSET.webp → PMREM background + lighting
 * - Scroll is wired to the GLB's CameraAction — only the authored
 *   camera path is shown; no extra orbit or invented angles
 * - Scene object animations stay in sync with the same timeline
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { initPictureFrames } from './pictureFrames.js';

/* Disable automatic scroll restoration on reload to prevent jump jank */
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════════════════ */
async function init() {
  const { gsap } = window;
  gsap.registerPlugin(window.ScrollTrigger, window.ScrollToPlugin);

  /* ── DOM ──────────────────────────────────────────────────────────────── */
  const canvas = document.getElementById('webgl-canvas');
  const loaderEl = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-bar');
  const loaderPct = document.getElementById('loader-pct');

  /* ── Device Detection ────────────────────────────────────────────────── */
  const isMobileDevice = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    window.innerWidth / window.innerHeight < 1;

  /* ── Renderer ─────────────────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobileDevice, alpha: false });
  // Bound drawing-buffer size on large/high-DPI screens.
  function pixelRatio() {
    const pixelBudget = isMobileDevice ? 1800000 : 3600000;
    return Math.min(window.devicePixelRatio || 1, isMobileDevice ? 1.5 : 2,
      Math.sqrt(pixelBudget / (window.innerWidth * window.innerHeight)));
  }
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  /* HDR - Balanced for ACES Filmic */
  const HDR_LIGHT = {
    exposure: 1.35,
    backgroundIntensity: 1.0,
    envMapIntensity: 1.2,
  };
  renderer.toneMappingExposure = HDR_LIGHT.exposure;
  renderer.shadowMap.enabled = false; // Shadows disabled globally

  /* ── Scene ────────────────────────────────────────────────────────────── */
  const scene = new THREE.Scene();

  /* ── Loading manager ──────────────────────────────────────────────────── */
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, loaded, total) => {
    const p = Math.round((loaded / total) * 100);
    loaderBar.style.width = p + '%';
    loaderPct.textContent = p + '%';
  };

  /* ══════════════════════════════════════════════════════════════════════
     1. SUNSET.webp  →  scene background + PMREM environment lighting
  ══════════════════════════════════════════════════════════════════════ */
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.setDRACOLoader(draco);

  const modelPromise = new Promise((res, rej) =>
    gltfLoader.load(new URL('../models/SKYC.glb', import.meta.url).href, res, undefined, rej)
  );

  const [bgTexture, gltf] = await Promise.all([
    loadWebP(new URL('../images/SUNSET.webp', import.meta.url).href),
    modelPromise,
  ]);
  draco.dispose();
  bgTexture.mapping = THREE.EquirectangularReflectionMapping;
  bgTexture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(bgTexture).texture;
  pmrem.dispose();
  bgTexture.dispose();

  scene.background = envMap;
  scene.environment = envMap;      // Make sure HDR environment lights the 3D models!
  scene.backgroundBlurriness = 0.0;
  scene.environmentIntensity = HDR_LIGHT.envMapIntensity;
  scene.backgroundIntensity = HDR_LIGHT.backgroundIntensity;

  addSunsetFillLights(scene, HDR_LIGHT);

  /* ══════════════════════════════════════════════════════════════════════
     2. Load SKYC.glb (Draco)
  ══════════════════════════════════════════════════════════════════════ */

  scene.add(gltf.scene);
  boostMaterialEnvReflections(gltf.scene, HDR_LIGHT.envMapIntensity);
  enableSceneShadows(gltf.scene);

  let pictureFrames = null;
  let scrollProgress = 0;

  /* ══════════════════════════════════════════════════════════════════════
     3. GLB camera + scroll-synced CameraAction (no extra orbit)
  ══════════════════════════════════════════════════════════════════════ */
  let glbCam = null;
  gltf.scene.traverse(obj => { if (obj.isCamera && !glbCam) glbCam = obj; });
  if (!glbCam && gltf.cameras?.length) glbCam = gltf.cameras[0];

  if (!glbCam) {
    console.error('[SKY ISLAND] No camera in GLB — cannot render.');
    return;
  }

  function updateCameraProjection() {
    glbCam.aspect = window.innerWidth / window.innerHeight;
    glbCam.updateProjectionMatrix();
  }
  updateCameraProjection();

  const cameraClip = gltf.animations.find(c => c.name === 'CameraAction');
  if (!cameraClip) {
    console.error('[SKY ISLAND] CameraAction not found in GLB.');
    return;
  }

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const timelineActions = gltf.animations.map(clip => {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    return action;
  });

  const cameraDuration = cameraClip.duration;
  const clock = new THREE.Clock();

  /* Silk scroll → camera: target from scroll, eased every frame in rAF
     Mobile: higher damp (5.5) so camera catches the finger much faster — reduces first-swipe lag feel.
     Desktop: smoother/slower (2.2) feels more cinematic. */
  let targetTimeline = 0;
  let smoothTimeline = 0;
  const SCROLL_DAMP = isMobileDevice ? 5.5 : 2.2;

  let lastTimeline = -1;
  function setTimeline(time) {
    if (time === lastTimeline) return;
    lastTimeline = time;
    timelineActions.forEach(action => {
      action.time = Math.min(time, action.getClip().duration);
    });
    mixer.update(0);
    // The renderer updates world matrices before drawing.
  }

  setTimeline(0);

  pictureFrames = await initPictureFrames({
    gltfScene: gltf.scene,
    animations: gltf.animations,
    manager,
  });

  setTimeline(0);
  smoothTimeline = 0;
  targetTimeline = 0;

  let renderFrame = 0;
  let isResetting = false;

  function preventScroll(e) {
    e.preventDefault();
  }

  function triggerFlashRewind() {
    isResetting = true;

    // Disable user scrolling during rewind
    window.addEventListener('wheel', preventScroll, { passive: false });
    window.addEventListener('touchmove', preventScroll, { passive: false });

    // Cinematic zoom impact on canvas
    gsap.to(canvas, {
      scale: 1.05,
      duration: 0.35,
      ease: 'power2.out'
    });

    // Fade in the flash overlay
    gsap.to("#flash-overlay", {
      opacity: 1,
      duration: 0.35,
      ease: 'power2.inOut',
      onComplete: () => {
        // Rewind scroll back to top
        gsap.to(window, {
          scrollTo: 0,
          duration: 2.2, // elegant fast rewind
          ease: 'power3.inOut',
          onComplete: () => {
            // Restore canvas scale
            gsap.to(canvas, {
              scale: 1.0,
              duration: 0.5,
              ease: 'power1.out'
            });

            // Fade out the flash overlay
            gsap.to("#flash-overlay", {
              opacity: 0,
              duration: 1.5,
              ease: 'power2.out',
              onComplete: () => {
                // Re-enable scrolling
                window.removeEventListener('wheel', preventScroll);
                window.removeEventListener('touchmove', preventScroll);
                isResetting = false;
              }
            });
          }
        });
      }
    });
  }

  window.ScrollTrigger.create({
    id: 'main-scroll',
    trigger: '#scroll-container',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      scrollProgress = self.progress;
      targetTimeline = self.progress * cameraDuration;
      requestRender();

      // If we are at the end, trigger the flash-rewind transition!
      if (scrollProgress >= 0.992 && !isResetting) {
        triggerFlashRewind();
      }
    },
  });

  /* ── Resize ───────────────────────────────────────────────────────────── */
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(window.innerWidth, window.innerHeight);
      updateCameraProjection();
      window.ScrollTrigger.refresh();
      pictureFrames?.resize();
      requestRender();
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
     8. Hide loader → render loop
  ══════════════════════════════════════════════════════════════════════ */
  // Small delay so the 100% bar is visible and remove scroll-lock
  setTimeout(() => {
    loaderEl.classList.add('hidden');
    document.body.classList.remove('loading');
    window.ScrollTrigger.refresh();
  }, 400);

  // Render while the camera or frame fades are moving, then let the GPU rest.
  function requestRender() {
    if (!renderFrame && !document.hidden) renderFrame = requestAnimationFrame(animate);
  }
  function animate() {
    renderFrame = 0;
    const dt = Math.min(clock.getDelta(), 0.05);
    const difference = targetTimeline - smoothTimeline;
    if (Math.abs(difference) < 0.0001) {
      smoothTimeline = targetTimeline;
    } else {
      smoothTimeline += difference * (1 - Math.exp(-SCROLL_DAMP * dt));
    }
    setTimeline(smoothTimeline);
    const fading = pictureFrames?.update(scrollProgress, dt);
    renderer.render(scene, glbCam);
    if (smoothTimeline !== targetTimeline || fading) requestRender();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    } else {
      clock.getDelta();
      requestRender();
    }
  });
  requestRender();
}

/* ══════════════════════════════════════════════════════════════════════════
   Natural white daylight — kulay ng textures mismo ang lalabas
══════════════════════════════════════════════════════════════════════════ */
function addSunsetFillLights(scene, hdr) {
  // Matinding Golden Hour Ambient Light para lumiwanag ang buong environment
  const ambient = new THREE.AmbientLight(0xffe1b8, 1.8); // Warm golden hour ambient
  scene.add(ambient);

  // Hemisphere para may konting depth (warm golden sky, warm ground)
  const hemi = new THREE.HemisphereLight(0xffdca8, 0x8a6a4a, 1.5);
  scene.add(hemi);

  // Simpleng Directional Light para hindi magmukhang flat yung mga 3D objects,
  // pero WALANG SHADOW na ica-cast. Normal lighting lang.
  const sun = new THREE.DirectionalLight(0xffdca8, 1.5); // Golden color
  sun.position.set(-35, 30, -25);
  sun.castShadow = false; // TANGGAL ANG SHADOW
  scene.add(sun);
}

function enableSceneShadows(root) {
  // Shadows are fully disabled — just make sure no object wastes GPU on shadow
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Stronger HDR reflections + VIBRANT model colors
══════════════════════════════════════════════════════════════════════════ */
function boostMaterialEnvReflections(root, intensity) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat || !('envMapIntensity' in mat)) return;

      // Natural env reflections — no color boost, no emissive
      // (nagkakaoverexpose pag combined sa Reinhard tone mapping)
      mat.envMapIntensity = intensity;

      // Slightly glossy para may sheen lang
      if (mat.roughness != null)
        mat.roughness = Math.max(0, mat.roughness * 0.92);

      mat.needsUpdate = true;
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   HELPER — load WebP image → Three.js CanvasTexture (equirectangular)
══════════════════════════════════════════════════════════════════════════ */
function loadWebP(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      warmifyHdrCanvas(ctx, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/* Joyful golden-hour HDR: boost yellows, keep some blue for sky depth */
function warmifyHdrCanvas(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const py = Math.floor((i / 4) / w) / h;
    // Upper sky = mas maliwanag (+15%), ibaba = bahagyang shade lang
    const skyBright = py < 0.5 ? 1.18 : 1.05;
    // Mas banayad ang darkening sa lupa (0.92 instead of 0.86) = less gloomy
    const shade = py > 0.4 ? 0.93 - (py - 0.4) * 0.18 : 1;

    d[i] = Math.min(255, (d[i] * 1.12 + 12) * skyBright * shade); // Red   +12%
    d[i + 1] = Math.min(255, (d[i + 1] * 1.08 + 8) * skyBright * shade); // Green +8% (nagdadagdag ng yellow!)
    d[i + 2] = Math.min(255, (d[i + 2] * 0.88 + 5) * skyBright * shade); // Blue  -12% pero may +5 offset (hindi masyado blue-less)
  }
  ctx.putImageData(img, 0, 0);
}

// Wait for the deferred GSAP scripts before starting the scene.
function start() { init().catch(console.error); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
