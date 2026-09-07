import type { SceneSpec } from "@/lib/scene3d";
import { useEffect, useRef } from "react";

/** Renders a validated scene spec with three.js. No user code is executed. */
export function SceneViewer({ spec }: { spec: SceneSpec }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const THREE = await import("three");
      if (disposed || !host) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(spec.background);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
      camera.position.set(0, 1.6, 7);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      host.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(4, 6, 5);
      scene.add(key);

      const meshes = spec.objects.map((object) => {
        const s = object.size;
        const geometry =
          object.shape === "sphere"
            ? new THREE.SphereGeometry(s, 40, 28)
            : object.shape === "torus"
              ? new THREE.TorusGeometry(s, s * 0.36, 28, 64)
              : object.shape === "cone"
                ? new THREE.ConeGeometry(s, s * 2, 40)
                : object.shape === "cylinder"
                  ? new THREE.CylinderGeometry(s, s, s * 2, 40)
                  : object.shape === "plane"
                    ? new THREE.PlaneGeometry(s * 3, s * 3)
                    : new THREE.BoxGeometry(s, s, s);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(object.color),
          roughness: 0.35,
          metalness: 0.15,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...object.position);
        scene.add(mesh);
        return { mesh, spin: object.spin };
      });

      const resize = () => {
        const width = host.clientWidth || 1;
        const height = host.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      let frame = 0;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        for (const item of meshes) {
          item.mesh.rotation.y += item.spin * dt;
          item.mesh.rotation.x += item.spin * dt * 0.35;
        }
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        for (const item of meshes) {
          item.mesh.geometry.dispose();
          (item.mesh.material as { dispose: () => void }).dispose();
        }
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [spec]);

  return <div ref={hostRef} className="h-full w-full" />;
}
