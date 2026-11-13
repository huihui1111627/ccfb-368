// WebGL2 shader:皮影透光 + 背光边缘光 + 灯光色彩
// 屏幕坐标系 y 向下,所有角度与 CPU 侧一致。

export const PUPPET_VS = /* glsl */ `#version 300 es
layout(location=0) in vec2 aQuad;       // 单位四角 (0..1)
layout(location=1) in vec4 aModel;      // 实例:世界位移 xy + 整体旋转角 + 整体缩放
layout(location=2) in vec4 aAnchor;     // 实例:部件锚点偏移 xy + 部件局部旋转 + 深度序 zOrder
layout(location=3) in vec4 aShape;      // 实例:部件尺寸 xy(zw 保留)
layout(location=4) in vec4 aUv;         // 实例:uv 矩形 [u0,v0,u1,v1]
layout(location=5) in vec4 aMaterial;   // 实例:translucency, opacity, isCap, 保留
uniform vec2 uHalfSize;   // 画布半宽半高(像素),正确处理宽高比
uniform vec2 uViewCenter; // 画布中心(像素)
out vec2 vUv;
out vec3 vMaterial;
flat out int vCap;

vec2 rotate2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 size = aShape.xy;
  // 所有屏幕世界变换已在 CPU 烘焙进 anchor 与旋转,VS 只绕 anchor 中心摆放四角
  vec2 corner = rotate2((aQuad - vec2(0.5)) * size, aAnchor.z);
  // anchor 为绝对屏幕像素(原点左上),减画布中心转相对中心坐标再进裁剪空间
  vec2 world = corner + aAnchor.xy + aModel.xy - uViewCenter;
  vec2 clip = world / uHalfSize;
  clip.y = -clip.y;
  // zOrder 越大越靠前(近裁剪面),支持最多 ~100 层 × 1000 部件序
  float depth = 0.5 - clamp(aAnchor.w, 0.0, 100000.0) / 250000.0;
  gl_Position = vec4(clip, depth, 1.0);
  vUv = mix(aUv.xy, aUv.zw, aQuad);
  vMaterial = aMaterial.xyz;
  vCap = int(aMaterial.z + 0.5);
}
`;

export const PUPPET_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vMaterial;
flat in int vCap;
uniform sampler2D uAtlas;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec2 uLightPos;       // 视口像素坐标
uniform vec3 uAmbient;
out vec4 outColor;

void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (tex.a < 0.35) discard;           // alpha-test:保证深度/遮挡正确,无半透明排序问题

  float translucency = vMaterial.x;
  float opacity = vMaterial.y;

  // 屏幕空间法线:用片元导数重建表面朝向,近似正对镜头的平面
  vec3 n = normalize(vec3(cross(vec3(dFdx(gl_FragCoord.xy), 0.0), vec3(dFdy(gl_FragCoord.xy), 0.0))));
  vec2 toLight = normalize(uLightPos - gl_FragCoord.xy);
  // 边缘光:片元密度变化越剧烈(轮廓/镂刻边缘),透光越强
  float edge = clamp(length(vec2(length(dFdx(tex.rgb)), length(dFdy(tex.rgb)))), 0.0, 1.0);
  float rim = pow(edge, 1.4);

  // 皮革本色 + 背光透过染色(皮影是背光观赏,整体被灯打亮)
  vec3 leather = tex.rgb;
  vec3 backlit = leather * uLightColor * uLightIntensity;
  vec3 lit = mix(
    leather * (uAmbient + 0.5 * uLightColor * uLightIntensity),
    backlit + leather * 0.25,
    translucency
  );
  lit += uLightColor * rim * (0.25 + translucency * 0.5) * uLightIntensity;

  float alpha = tex.a * opacity * (1.0 - translucency * 0.2);
  outColor = vec4(lit, alpha);
}
`;

// 阴影 pass:只输出黑/红色剪影与 alpha
export const SHADOW_VS = PUPPET_VS;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vMaterial;
flat in int vCap;
uniform sampler2D uAtlas;
uniform float uShadowStrength;
out vec4 outColor;
void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (tex.a < 0.35) discard;
  // 厚的部件(关节帽)影子更实,薄皮革影子略淡
  float a = tex.a * uShadowStrength * (vCap == 1 ? 1.0 : 0.92);
  outColor = vec4(0.08, 0.03, 0.02, a);
}
`;

// 屏幕后处理:模糊(分离高斯)
export const BLUR_VS = /* glsl */ `#version 300 es
layout(location=0) in vec2 aPos;   // 裁剪空间 -1..1
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDirection; // (1,0) 或 (0,1)
out vec4 outColor;
void main() {
  // 9 抽头高斯
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec4 sum = texture(uTex, vUv) * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDirection * uTexel * float(i) * 1.6;
    sum += texture(uTex, vUv + off) * w[i];
    sum += texture(uTex, vUv - off) * w[i];
  }
  outColor = sum;
}
`;

// 合成:幕布底色 + 软阴影 + 影人 + 暗角
export const COMPOSITE_VS = BLUR_VS;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;   // 影人(带透光)
uniform sampler2D uShadow;  // 模糊后的软影
uniform vec3 uStageColor;
uniform vec3 uLightColor;
uniform vec2 uLightPos;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSwayAmp;
out vec4 outColor;

void main() {
  vec2 px = vUv * uResolution;
  vec2 light = uLightPos + vec2(sin(uTime * 0.9) * uSwayAmp, cos(uTime * 0.7) * uSwayAmp * 0.4);
  float d = distance(px, light) / max(uResolution.x, uResolution.y);
  // 灯光在幕布上的暖色光晕(幕布铺满整个视口,不留黑边)
  float glow = exp(-d * 2.2);
  vec3 stage = uStageColor * (0.82 + 0.32 * glow) + uLightColor * glow * 0.12;

  vec4 shadow = texture(uShadow, vUv);
  vec3 withShadow = stage * (1.0 - shadow.a) + shadow.rgb * shadow.a;

  vec4 puppet = texture(uScene, vUv);
  // 标准 over 混合:影人(非预乘 alpha)叠在带影幕布上
  vec3 color = puppet.rgb * puppet.a + withShadow * (1.0 - puppet.a);

  // 幕布暗角(保留边缘略暗,但不到全黑)
  vec2 q = vUv - 0.5;
  float vign = smoothstep(0.95, 0.3, length(q));
  color *= 0.85 + 0.15 * vign;
  outColor = vec4(color, 1.0);
}
`;
