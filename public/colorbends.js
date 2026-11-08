// Vanilla WebGL port of the ColorBends background (no React, no three.js).
// Usage: ColorBends(containerEl, { colors, rotation, speed, ... })
window.ColorBends = function (container, opts = {}) {
  const o = Object.assign(
    {
      colors: ['#ff5c7a', '#8a5cff', '#00ffd1'],
      rotation: 90,
      speed: 0.2,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 1,
      noise: 0.15,
      parallax: 0.5,
      intensity: 1.5,
      bandWidth: 6,
    },
    opts
  );

  const canvas = document.createElement('canvas');
  canvas.className = 'absolute inset-0 h-full w-full';
  canvas.setAttribute('aria-hidden', 'true');
  container.prepend(canvas);
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: true });
  if (!gl) return { destroy() {} };

  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform vec2 uPar;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
uniform float uRot,uScale,uFreq,uWarp,uNoise,uInt,uBand;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 q=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  q+=uPar*.08;
  float a=radians(uRot);
  q=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
  q/=max(uScale,.001);
  vec2 m=(uMouse-.5)*vec2(uRes.x/uRes.y,1.);
  float d=length(q-m*.6);
  q+=normalize(q-m*.6+1e-4)*exp(-d*3.)*.25*uWarp;
  float t=uTime;
  float w=0.;
  for(int i=0;i<3;i++){
    float fi=float(i)+1.;
    w+=sin(q.y*uFreq*(2.+fi)+t*(.6+.2*fi)+sin(q.x*uFreq*fi*1.3+t*.5)*uWarp*1.4)/fi;
  }
  float band=smoothstep(-1.,1.,sin((q.x*uFreq*1.2+w*.8)*uBand*.5+t*.4));
  float band2=.5+.5*sin(q.x*uFreq*2.+w*1.5-t*.3);
  vec3 col=mix(uC0,uC1,band);
  col=mix(col,uC2,band2*band2);
  col*=uInt*.55;
  col+=(hash(gl_FragCoord.xy+t)-.5)*uNoise*.25;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { destroy() {} };
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n) => gl.getUniformLocation(prog, n);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  gl.uniform3fv(U('uC0'), hex(o.colors[0]));
  gl.uniform3fv(U('uC1'), hex(o.colors[1]));
  gl.uniform3fv(U('uC2'), hex(o.colors[2]));
  gl.uniform1f(U('uRot'), o.rotation);
  gl.uniform1f(U('uScale'), o.scale);
  gl.uniform1f(U('uFreq'), o.frequency);
  gl.uniform1f(U('uWarp'), o.warpStrength);
  gl.uniform1f(U('uNoise'), o.noise);
  gl.uniform1f(U('uInt'), o.intensity);
  gl.uniform1f(U('uBand'), o.bandWidth);

  const target = { x: 0.5, y: 0.5 };
  const mouse = { x: 0.5, y: 0.5 };
  const par = { x: 0, y: 0 };
  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width;
    target.y = 1 - (e.clientY - r.top) / r.height;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6; // cheap: render at reduced resolution
  const resize = () => {
    const r = container.getBoundingClientRect();
    canvas.width = Math.max(2, Math.floor(r.width * dpr));
    canvas.height = Math.max(2, Math.floor(r.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U('uRes'), canvas.width, canvas.height);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, visible = true, start = performance.now();
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !reduce) raf = requestAnimationFrame(frame);
  });
  io.observe(container);

  function draw(time) {
    mouse.x += (target.x - mouse.x) * 0.05;
    mouse.y += (target.y - mouse.y) * 0.05;
    par.x += ((target.x - 0.5) * o.parallax - par.x) * 0.05;
    par.y += ((target.y - 0.5) * o.parallax - par.y) * 0.05;
    gl.uniform1f(U('uTime'), time * o.speed);
    gl.uniform2f(U('uMouse'), 0.5 + (mouse.x - 0.5) * o.mouseInfluence, 0.5 + (mouse.y - 0.5) * o.mouseInfluence);
    gl.uniform2f(U('uPar'), par.x, par.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    if (!visible) return;
    draw((now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }
  if (reduce) draw(2);
  else raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      io.disconnect();
      canvas.remove();
    },
  };
};
