import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import { BackSide, Mesh, ShaderMaterial, Vector3 } from 'three';

/** Low late-afternoon sun over the Gulf. */
export const SUN_DIR = new Vector3().setFromSphericalCoords(1, ((90 - 17) * Math.PI) / 180, (225 * Math.PI) / 180);
/** Horizon haze colour (linear), shared with the fog. */
export const HORIZON: [number, number, number] = [0.58, 0.61, 0.64];

function skyMaterial() {
  return new ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR } },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = clamp(d.y,0.,1.);
        vec3 zen = vec3(.03,.09,.30); vec3 hor = vec3(${HORIZON.join(',')});
        vec3 col = mix(hor, zen, pow(h,.45));
        float s = max(dot(d,sunDir),0.);
        col += vec3(1.,.6,.3)*pow(s,6.)*.5*(1.-h*.7);
        col += vec3(1.,.93,.8)*smoothstep(.9993,.9997,s)*30.;
        col = mix(col, vec3(.24,.23,.2), smoothstep(0.,-.06,d.y));
        gl_FragColor = vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Sky dome that follows the camera, plus the same sky baked into reflections. */
export function Sky() {
  const mat = useMemo(skyMaterial, []);
  const envMat = useMemo(skyMaterial, []);
  const dome = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    camera.getWorldPosition(dome.current!.position);
  });
  return (
    <>
      <mesh ref={dome} material={mat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[30000, 32, 16]} />
      </mesh>
      <Environment frames={1} resolution={256}>
        <mesh material={envMat}>
          <sphereGeometry args={[50, 32, 16]} />
        </mesh>
      </Environment>
    </>
  );
}
