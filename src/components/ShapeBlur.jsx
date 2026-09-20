// Adapted from React Bits ShapeBlur supplied in promt.txt.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec2 v_texcoord;
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    v_texcoord = uv;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 v_texcoord;

uniform vec2 u_mouse;
uniform vec2 u_resolution;
uniform float u_pixelRatio;

uniform float u_shapeSize;
uniform float u_roundness;
uniform float u_borderSize;
uniform float u_circleSize;
uniform float u_circleEdge;

#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif
#ifndef TWO_PI
#define TWO_PI 6.2831853071795864769252867665590
#endif

#ifndef VAR
#define VAR 0
#endif

#ifndef FNC_COORD
#define FNC_COORD
vec2 coord(in vec2 p) {
    p = p / u_resolution.xy;
    if (u_resolution.x > u_resolution.y) {
        p.x *= u_resolution.x / u_resolution.y;
        p.x += (u_resolution.y - u_resolution.x) / u_resolution.y / 2.0;
    } else {
        p.y *= u_resolution.y / u_resolution.x;
        p.y += (u_resolution.x - u_resolution.y) / u_resolution.x / 2.0;
    }
    p -= 0.5;
    p *= vec2(-1.0, 1.0);
    return p;
}
#endif

#define st0 coord(gl_FragCoord.xy)
#define mx coord(u_mouse * u_pixelRatio)

float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p - 0.5) * 4.2 - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}
float sdCircle(in vec2 st, in vec2 center) {
    return length(st - center) * 2.0;
}
float sdPoly(in vec2 p, in float w, in int sides) {
    float a = atan(p.x, p.y) + PI;
    float r = TWO_PI / float(sides);
    float d = cos(floor(0.5 + a / r) * r - a) * length(max(abs(p) * 1.0, 0.0));
    return d * 2.0 - w;
}

float aastep(float threshold, float value) {
    float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
    return smoothstep(threshold - afwidth, threshold + afwidth, value);
}
float fill(in float x) { return 1.0 - aastep(0.0, x); }
float fill(float x, float size, float edge) {
    return 1.0 - smoothstep(size - edge, size + edge, x);
}
float stroke(in float d, in float t) { return (1.0 - aastep(t, abs(d))); }
float stroke(float x, float size, float w, float edge) {
    float d = smoothstep(size - edge, size + edge, x + w * 0.5) - smoothstep(size - edge, size + edge, x - w * 0.5);
    return clamp(d, 0.0, 1.0);
}

float strokeAA(float x, float size, float w, float edge) {
    float afwidth = length(vec2(dFdx(x), dFdy(x))) * 0.70710678;
    float d = smoothstep(size - edge - afwidth, size + edge + afwidth, x + w * 0.5)
            - smoothstep(size - edge - afwidth, size + edge + afwidth, x - w * 0.5);
    return clamp(d, 0.0, 1.0);
}

void main() {
    vec2 st = st0 + 0.5;
    vec2 posMouse = mx * vec2(1., -1.) + 0.5;

    float size = u_shapeSize;
    float roundness = u_roundness;
    float borderSize = u_borderSize;
    float circleSize = u_circleSize;
    float circleEdge = u_circleEdge;

    float sdfCircle = fill(
        sdCircle(st, posMouse),
        circleSize,
        circleEdge
    );

    float sdf;
    if (VAR == 0) {
        sdf = sdRoundRect(st, vec2(size), roundness);
        sdf = strokeAA(sdf, 0.0, borderSize, sdfCircle) * 4.0;
    } else if (VAR == 1) {
        sdf = sdCircle(st, vec2(0.5));
        sdf = fill(sdf, 0.6, sdfCircle) * 1.2;
    } else if (VAR == 2) {
        sdf = sdCircle(st, vec2(0.5));
        sdf = strokeAA(sdf, 0.58, 0.02, sdfCircle) * 4.0;
    } else if (VAR == 3) {
        sdf = sdPoly(st - vec2(0.5, 0.45), 0.3, 3);
        sdf = fill(sdf, 0.05, sdfCircle) * 1.4;
    }

    vec3 color = vec3(1.0);
    float alpha = sdf;
    gl_FragColor = vec4(color.rgb, alpha);
}
`;


export default function ShapeBlur({ variation = 0, shapeSize = .5, roundness = .5, borderSize = .05, circleSize = .5, circleEdge = 1 }) {
  const mountRef = useRef(null);
  useEffect(() => {
    const mount = mountRef.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({alpha: true, antialias: false, powerPreference: 'low-power'}); }
    catch { return; } // The CSS illustration stays visible when WebGL is unavailable.
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
    camera.position.z = 1;
    const mouse = new THREE.Vector2(-500, -500), damp = mouse.clone(), resolution = new THREE.Vector2();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({vertexShader, fragmentShader, transparent: true, defines: {VAR: variation}, uniforms: {
      u_mouse: {value: damp}, u_resolution: {value: resolution}, u_pixelRatio: {value: 1},
      u_shapeSize: {value: shapeSize}, u_roundness: {value: roundness}, u_borderSize: {value: borderSize},
      u_circleSize: {value: circleSize}, u_circleEdge: {value: circleEdge}
    }});
    const quad = new THREE.Mesh(geometry, material); scene.add(quad);
    renderer.setClearColor(0x000000, 0); mount.appendChild(renderer.domElement);
    let frame = 0, visible = true, lost = false, last = 0;
    const draw = now => {
      frame = 0;
      if (!visible || document.hidden || lost) return;
      const dt = Math.min((now - last) / 1000 || .016, .05); last = now;
      damp.x = THREE.MathUtils.damp(damp.x, mouse.x, 8, dt);
      damp.y = THREE.MathUtils.damp(damp.y, mouse.y, 8, dt);
      renderer.render(scene, camera);
      if (damp.distanceTo(mouse) > .1) frame = requestAnimationFrame(draw);
    };
    const request = () => { if (!frame && visible && !document.hidden && !lost) frame = requestAnimationFrame(draw); };
    const resize = () => {
      const w = Math.max(1, mount.clientWidth), h = Math.max(1, mount.clientHeight);
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(dpr); renderer.setSize(w, h);
      camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2; camera.updateProjectionMatrix();
      quad.scale.set(w, h, 1); resolution.set(w * dpr, h * dpr); material.uniforms.u_pixelRatio.value = dpr;
      request();
    };
    const move = event => { const rect = mount.getBoundingClientRect(); mouse.set(event.clientX - rect.left, event.clientY - rect.top); request(); };
    const leave = () => { mouse.set(-500, -500); request(); };
    const visibility = () => { if (document.hidden) {cancelAnimationFrame(frame); frame = 0;} else request(); };
    const contextLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; };
    const contextRestored = () => { lost = false; resize(); };
    const hero = mount.closest('.hero');
    hero.addEventListener('pointermove', move, {passive:true}); hero.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', visibility);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    const ro = new ResizeObserver(resize); ro.observe(mount);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) request(); else {cancelAnimationFrame(frame); frame = 0;} }); io.observe(mount);
    resize();
    return () => {
      cancelAnimationFrame(frame); ro.disconnect(); io.disconnect();
      hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      renderer.domElement.remove(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    };
  }, [variation, shapeSize, roundness, borderSize, circleSize, circleEdge]);
  return <div ref={mountRef} className="shape-blur" />;
}
