import { Environment } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BackSide, ShaderMaterial, Vector3, type Mesh } from 'three';
import { cirrusTexture } from './textures';

/** Afternoon sun, 38° up in the west-north-west. */
export const SUN_DIR = new Vector3().setFromSphericalCoords(1, ((90 - 38) * Math.PI) / 180, (235 * Math.PI) / 180);
/** Horizon haze colour (linear, after exposure), shared with the fog. */
export const HORIZON: [number, number, number] = [0.45, 0.56, 0.72];

/**
 * Clear Gulf-coast sky as in the reference photos: deep blue overhead, paler toward the horizon,
 * a bright sun, and thin cirrus streaks projected onto a layer high above.
 * Colours are pre-exposure (the renderer exposes at 0.45 and tone maps).
 */
function skyMaterial(clouds: boolean) {
  return new ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR }, cirrus: { value: cirrusTexture() }, drift: { value: 0 } },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; uniform sampler2D cirrus; uniform float drift; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 zenith = vec3(0.035, 0.24, 1.25), horizon = vec3(1.0, 1.25, 1.6);
        vec3 col = mix(horizon, zenith, pow(h, 0.42));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.1, 1.0, 0.85) * (pow(s, 12.0) * 0.6 + pow(s, 400.0) * 3.0) + vec3(60.0) * smoothstep(0.99985, 0.9999, s);
        ${clouds ? `
        if (d.y > 0.02) {
          vec2 p = d.xz / d.y * 0.18 + vec2(drift, 0.0);
          float a = texture2D(cirrus, p).a * 1.6 + texture2D(cirrus, p * 0.37 + 0.31).a * 0.8;
          a *= smoothstep(0.02, 0.25, d.y);
          col = mix(col, vec3(1.9, 1.95, 2.05) * (1.0 + pow(s, 6.0)), clamp(a, 0.0, 0.85));
        }` : ''}
        col = mix(col, vec3(0.5, 0.55, 0.58), smoothstep(0.0, -0.05, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Sky dome that follows the camera, and the same sky (without clouds) baked into reflections. */
export function Sky() {
  const mat = useMemo(() => skyMaterial(true), []);
  const envMat = useMemo(() => skyMaterial(false), []);
  const dome = useRef<Mesh>(null);
  useFrame(({ camera, clock }) => {
    camera.getWorldPosition(dome.current!.position);
    mat.uniforms.drift.value = clock.elapsedTime * 0.0004;
  });
  return (
    <>
      <mesh ref={dome} material={mat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[30000, 48, 24]} />
      </mesh>
      <Environment frames={1} resolution={256}>
        <mesh material={envMat}>
          <sphereGeometry args={[50, 32, 16]} />
        </mesh>
      </Environment>
    </>
  );
}
