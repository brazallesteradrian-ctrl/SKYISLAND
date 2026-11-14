/** Fixed gallery shared by corresponding desktop and phone frames. */
import * as THREE from 'three';

// Order follows the gallery path. Desktop frame_2 is unused in the model layout.
export const FRAME_IMAGES = Object.freeze([
  'art.webp', 'art1.webp', 'art2.webp', 'art3.webp', 'art5.webp',
  'art6.webp', 'cat.webp', 'spidey.webp', 'onep.webp', 'shark.webp', 'car.webp',
]);

const ANIMATED_FRAMES = new Set([
  'frame_10', 'frame_11', 'frame_12', 'phone_9', 'phone_10', 'phone_11',
]);

export async function initPictureFrames({ gltfScene, animations = [], manager }) {
  // Load each photo once and share its texture across both device layouts.
  // Awaiting these loads keeps the loading screen up until the gallery is ready.
  const loader = new THREE.TextureLoader(manager);
  const textures = await Promise.all(FRAME_IMAGES.map(async filename => {
    const texture = await loader.loadAsync(new URL(`../images/${filename}`, import.meta.url).href);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Preserve the horizontal correction used by the original Blender frames.
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.center.set(0.5, 0.5);
    return texture;
  }));

  const frames = [];
  const maxDuration = Math.max(0.001, ...animations.map(clip => clip.duration));
  let isPortrait = window.innerWidth / window.innerHeight < 1;

  gltfScene.traverse(group => {
    const match = /^(frame|phone)_(\d+)$/.exec(group.name || '');
    if (!match) return;
    const number = Number(match[2]);
    if (group.name === 'frame_2') {
      group.visible = false;
      return;
    }
    const photoIndex = match[1] === 'frame' && number > 2 ? number - 2 : number - 1;
    if (!textures[photoIndex]) throw new Error(`No fixed photo for ${group.name}`);

    let photoMesh;
    group.traverse(child => {
      if (child.isMesh && !photoMesh) photoMesh = child;
    });
    if (!photoMesh) return;

    const photoMaterial = new THREE.MeshBasicMaterial({
      map: textures[photoIndex],
      color: 0xffdca8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    photoMesh.material = photoMaterial;

    const materials = new Set([photoMaterial]);
    group.traverse(child => {
      if (!child.isMesh || child === photoMesh) return;
      // Separate border materials so fading one frame cannot affect another.
      const originals = Array.isArray(child.material) ? child.material : [child.material];
      const copies = originals.map(material => {
        const copy = material.clone();
        materials.add(copy);
        return copy;
      });
      child.material = Array.isArray(child.material) ? copies : copies[0];
    });

    const animated = ANIMATED_FRAMES.has(group.name);
    let endTime = 0;
    if (animated) {
      animations.forEach(clip => clip.tracks.forEach(track => {
        if (track.name.startsWith(group.name + '.') && track.times.length) {
          endTime = Math.max(endTime, track.times[track.times.length - 1]);
        }
      }));
    }
    frames.push({
      group, materials, animated,
      phone: match[1] === 'phone',
      fade: animated ? 0 : 1,
      endProgress: endTime / maxDuration,
    });
  });

  function update(progress, dt = 1 / 60) {
    let fading = false;
    const alpha = 1 - Math.exp(-2.76 * dt);
    frames.forEach(frame => {
      if (frame.phone !== isPortrait) {
        frame.group.visible = false;
        return;
      }
      const targetFade = !frame.animated || progress >= frame.endProgress - 0.03 ? 1 : 0;
      if (Math.abs(frame.fade - targetFade) < 0.001) {
        frame.fade = targetFade;
      } else {
        frame.fade = THREE.MathUtils.lerp(frame.fade, targetFade, alpha);
        fading = true;
      }
      frame.group.visible = frame.fade > 0.01;
      frame.materials.forEach(material => {
        material.opacity = frame.fade;
        const transparent = frame.fade < 0.99;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
      });
    });
    return fading;
  }

  update(0);
  return {
    update,
    resize: () => { isPortrait = window.innerWidth / window.innerHeight < 1; },
  };
}
