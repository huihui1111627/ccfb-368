// 全局领域类型定义 —— 影人 / 骨骼 / 部件 / 动画 / 工程

export type Vec2 = [number, number];

/** 骨骼节点:局部相对父节点的旋转(弧度),位置由 rest 链推导 */
export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  /** 静止姿态相对父节点的位置(局部坐标) */
  restLocal: Vec2;
  /** 静止姿态相对父节点的旋转(弧度) */
  restRotation: number;
  /** 关节相对旋转限制 [min,max](弧度,相对静止旋转);null 表示不限制 */
  limits: [number, number] | null;
  /** 骨骼长度(沿 bone 方向,供 IK 使用) */
  length: number;
}

/** 部件挂载到骨骼上的方式 */
export interface PartAnchor {
  boneId: string;
  /** 相对该骨骼原点的偏移(骨骼局部系) */
  offset: Vec2;
  /** 跟随骨骼旋转 */
  followRotation: boolean;
  /** 额外旋转微调(弧度) */
  rotationOffset: number;
}

export interface PuppetPart {
  id: string;
  name: string;
  /** 图集 uv: [u0,v0,u1,v1] */
  uv: [number, number, number, number];
  /** 像素尺寸 */
  size: Vec2;
  anchor: PartAnchor;
  /** 层序:同影人间按 z 排序,小的先画(靠后) */
  z: number;
  /** 透光率 0..1,越大越透 */
  translucency: number;
  /** 皮革/纸张暗度 0..1 */
  opacity: number;
}

/** 关节帽:在关节处生成的圆形覆盖片,保证旋转不露缝 */
export interface JointCap {
  boneId: string;
  radius: number;
  uv: [number, number, number, number];
  z: number;
}

export interface PuppetDef {
  id: string;
  name: string;
  kind: 'procedural' | 'imported';
  bones: Bone[];
  parts: PuppetPart[];
  caps: JointCap[];
  /** 图集 canvas 尺寸(方形) */
  atlasSize: number;
  /** 运行时图集位图(不序列化,导入工程时由 atlasStore 重建) */
  atlasCanvas?: HTMLCanvasElement;
  /** 主色(程序生成时使用) */
  palette: PuppetPalette;
  createdAt: number;
}

export interface PuppetPalette {
  leather: string;   // 皮革基色
  leatherDark: string;
  accent: string;    // 雕花点缀色
  ink: string;       // 镂刻线颜色
}

/** IK 链:两骨,拖末端 */
export interface IkChain {
  id: string;
  name: string;
  rootBoneId: string;   // 肩/髋
  midBoneId: string;    // 肘/膝
  endBoneId: string;    // 腕/踝(末端效应器挂在这)
  /** 弯曲方向:1 正向 / -1 反向(决定肘膝朝向) */
  pole: 1 | -1;
}

/** 场景里的一个影人实例 */
export interface PuppetInstance {
  id: string;
  defId: string;
  name: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** 层:小的在后排 */
  layer: number;
  visible: boolean;
  ikChains: IkChain[];
}

export type ChannelType = 'boneRotation' | 'ikTarget';

export interface Keyframe {
  id: string;
  t: number; // 秒
  /** boneRotation:弧度(相对静止);ikTarget:[x,y] 实例空间;root 平移等也走 number[] */
  value: number[];
  /** 三次贝塞尔缓动,到下一帧生效;两端锚点固定 (0,0)/(1,1) */
  ease: [number, number, number, number];
}

export interface AnimChannel {
  id: string;
  instanceId: string;
  type: ChannelType;
  /** boneRotation 时为 boneId;ikTarget 时为 chainId;root 通道为 'root' */
  targetId: string;
  keyframes: Keyframe[];
}

export interface Timeline {
  duration: number;
  fps: number;
  channels: AnimChannel[];
}

export interface LightConfig {
  x: number;
  y: number;
  color: [number, number, number];
  intensity: number;
  /** 摇摆幅度(像素)与速度(弧度/秒) */
  swayAmp: number;
  swaySpeed: number;
  shadowOpacity: number;
  shadowBlur: number; // 0..1
}

export interface ProjectState {
  puppets: PuppetDef[];
  instances: PuppetInstance[];
  timeline: Timeline;
  light: LightConfig;
  stageColor: string;
  name: string;
  savedAt: number;
}

/** 动作 JSON 的导入导出格式 */
export interface MotionFile {
  format: 'shadow-puppet-motion';
  version: 1;
  defName: string;
  duration: number;
  fps: number;
  channels: AnimChannel[];
}

export interface ProjectFile {
  format: 'shadow-puppet-project';
  version: 1;
  state: ProjectState;
}
