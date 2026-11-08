// ColorBends, ported from the React + three.js component to plain WebGL.
// The fragment shader and uniform logic are the original, unchanged.
// Usage: ColorBends(containerEl, { colors, rotation, speed, ... })
window.ColorBends = function (container, opts = {}) {
  const MAX_COLORS = 8;
  const o = Object.assign(
    {
      rotation: 90,
      speed: 0.2,
      colors: [],
      transparent: true,
      autoRotate: 0,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 1,
      parallax: 0.5,
      noise: 0.15,
      iterations: 1,
      intensity: 1.5,
      bandWidth: 6,
    },
    opts
  );

  const frag = `
precision highp float;
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer; // in NDC [-1,1]
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 toward = (uPointer - rp);
  q += toward * uMouseInfluence * 0.2;

    for (int j = 0; j < 5; j++) {
      if (j >= uIterations - 1) break;
      vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
      q += (rr - q) * 0.15;
    }

    vec3 col = vec3(0.0);
    float a = 1.0;

    if (uColorCount > 0) {
      vec2 s = q;
      vec3 sumCol = vec3(0.0);
      float cover = 0.0;
      for (int i = 0; i < MAX_COLORS; ++i) {
            if (i >= uColorCount) break;
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3); // strong response across 0..1
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0); // allow >1 to amplify displacement
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float m = mix(m0, m1, kMix);
            float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
            sumCol += uColors[i] * w;
            cover = max(cover, w);
      }
      col = clamp(sumCol, 0.0, 1.0);
      a = uTransparent > 0 ? cover : 1.0;
    } else {
        vec2 s = q;
        for (int k = 0; k < 3; ++k) {
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3);
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float m = mix(m0, m1, kMix);
            col[k] = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
        }
        a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
    }

    col *= uIntensity;

    if (uNoise > 0.0001) {
      float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
      col += (n - 0.5) * uNoise;
      col = clamp(col, 0.0, 1.0);
    }

    vec3 rgb = (uTransparent > 0) ? col * a : col;
    gl_FragColor = vec4(rgb, a);
}
`;

  // three.js derives vUv from the plane's uv attribute; a full-screen triangle gives the same 0..1 range.
  const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  canvas.setAttribute('aria-hidden', 'true');
  container.prepend(canvas);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return { destroy() {} };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return { destroy() {} };
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  [
    'uCanvas', 'uTime', 'uSpeed', 'uRot', 'uColorCount', 'uColors', 'uTransparent', 'uScale', 'uFrequency',
    'uWarpStrength', 'uPointer', 'uMouseInfluence', 'uParallax', 'uNoise', 'uIterations', 'uIntensity', 'uBandWidth',
  ].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

  const toVec3 = (hex) => {
    const h = hex.replace('#', '').trim();
    const v =
      h.length === 3
        ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
        : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return [v[0] / 255, v[1] / 255, v[2] / 255];
  };
  const colors = (o.colors || []).filter(Boolean).slice(0, MAX_COLORS).map(toVec3);
  const colorData = new Float32Array(MAX_COLORS * 3);
  colors.forEach((c, i) => colorData.set(c, i * 3));

  gl.uniform1f(U.uSpeed, o.speed);
  gl.uniform1i(U.uColorCount, colors.length);
  gl.uniform3fv(U.uColors, colorData);
  gl.uniform1i(U.uTransparent, o.transparent ? 1 : 0);
  gl.uniform1f(U.uScale, o.scale);
  gl.uniform1f(U.uFrequency, o.frequency);
  gl.uniform1f(U.uWarpStrength, o.warpStrength);
  gl.uniform1f(U.uMouseInfluence, o.mouseInfluence);
  gl.uniform1f(U.uParallax, o.parallax);
  gl.uniform1f(U.uNoise, o.noise);
  gl.uniform1i(U.uIterations, o.iterations);
  gl.uniform1f(U.uIntensity, o.intensity);
  gl.uniform1f(U.uBandWidth, o.bandWidth);
  gl.clearColor(0, 0, 0, o.transparent ? 0 : 1);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uCanvas, w, h);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Pointer in NDC [-1,1], smoothed exactly like the original (rate 8).
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / (r.width || 1)) * 2 - 1;
    target.y = -(((e.clientY - r.top) / (r.height || 1)) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  function draw(elapsed, dt) {
    gl.uniform1f(U.uTime, elapsed);
    const deg = (o.rotation % 360) + o.autoRotate * elapsed;
    const rad = (deg * Math.PI) / 180;
    gl.uniform2f(U.uRot, Math.cos(rad), Math.sin(rad));
    const amt = Math.min(1, dt * 8);
    cur.x += (target.x - cur.x) * amt;
    cur.y += (target.y - cur.y) * amt;
    gl.uniform2f(U.uPointer, cur.x, cur.y);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    draw((now - t0) / 1000, dt);
    raf = requestAnimationFrame(loop);
  }
  if (reduce) draw(2, 0);
  else raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      canvas.remove();
    },
  };
};
