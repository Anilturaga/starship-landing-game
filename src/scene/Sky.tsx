import { Environment } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BackSide, ShaderChunk, ShaderMaterial, Vector3, type Mesh } from 'three';
import { cirrusTexture } from './textures';

/** Sunset: the sun 7° above the land to the west-north-west, so the tower is backlit from over the Gulf. */
export const SUN_DIR = new Vector3().setFromSphericalCoords(1, ((90 - 7) * Math.PI) / 180, (250 * Math.PI) / 180);

const v3 = (v: Vector3) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

/**
 * Colour of the low haze in a world direction (display-linear, after tone mapping): gold toward the sun,
 * dusky mauve away from it. Shared by the sky's horizon and the fog, so distant ground melts into the sky.
 */
const HAZE = /* glsl */ `
  vec3 sunsetHaze(vec3 d) {
    vec2 h = normalize(d.xz + vec2(1e-5));
    float toward = dot(h, normalize(${v3(SUN_DIR)}.xz)) * 0.5 + 0.5;
    return mix(vec3(0.27, 0.27, 0.35), vec3(1.0, 0.58, 0.28), pow(toward, 4.0));
  }`;

// Fog takes its colour from the view direction (the scene's fog colour is left white and ignored).
ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogDir;\n#endif';
ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
  ${HAZE}
#endif`;
ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, sunsetHaze(normalize(vFogDir)), fogFactor);
#endif`;

/**
 * Sunset over Starbase: a deep blue zenith, a gold-to-orange glow around the low sun, the pink Belt of Venus
 * and the blue band of the Earth's shadow opposite it, and cirrus streaks lit from below, gold near the sun
 * and rose away from it. Colours are pre-exposure (the renderer exposes down and tone maps).
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
      ${HAZE}
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        float s = dot(d, sunDir), sp = max(s, 0.0);
        float toward = dot(normalize(d.xz + vec2(1e-5)), normalize(sunDir.xz)) * 0.5 + 0.5;
        float away = pow(1.0 - toward, 1.5);

        vec3 zenith = vec3(0.04, 0.09, 0.38);
        vec3 horizon = mix(vec3(0.62, 0.52, 0.78), vec3(3.4, 1.35, 0.42), pow(toward, 3.0));
        vec3 col = mix(horizon, zenith, pow(h, 0.28 + 0.3 * toward));
        // glow around the sun, wide and orange, then tight and gold
        col += vec3(1.7, 0.62, 0.16) * pow(sp, 5.0) * (1.0 - 0.6 * h);
        col += vec3(3.0, 1.6, 0.55) * pow(sp, 60.0);
        col += vec3(40.0, 26.0, 13.0) * smoothstep(0.99965, 0.9998, s);
        // Belt of Venus over the Earth's shadow, opposite the sun
        col = mix(col, vec3(1.15, 0.6, 0.72), away * smoothstep(0.02, 0.07, h) * smoothstep(0.26, 0.09, h) * 0.6);
        col = mix(col, vec3(0.2, 0.25, 0.48), away * smoothstep(0.05, 0.0, h) * 0.7);
        ${clouds ? `
        if (d.y > 0.015) {
          vec2 p = d.xz / d.y * 0.18 + vec2(drift, 0.0);
          float a = texture2D(cirrus, p).a * 1.7 + texture2D(cirrus, p * 0.37 + 0.31).a * 0.9;
          a = clamp(a * smoothstep(0.015, 0.2, d.y), 0.0, 0.9);
          vec3 lit = mix(vec3(1.2, 0.55, 0.75), vec3(4.0, 1.7, 0.5), pow(toward, 2.5)) * (1.0 + pow(sp, 4.0) * 2.5);
          col = mix(col, lit, a);
        }` : ''}
        col = mix(col, vec3(0.35, 0.3, 0.32), smoothstep(0.0, -0.05, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // right at the horizon, the same haze as the fog on distant ground
        gl_FragColor.rgb = mix(gl_FragColor.rgb, sunsetHaze(d), smoothstep(0.035, 0.0, d.y) * 0.85);
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
