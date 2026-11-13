# 皮影坊 · Shadow Puppet Studio

浏览器端皮影动画编排系统:TypeScript + WebGL2,零运行时第三方依赖(仅 Vite 构建)。
程序化生成皮革镂刻风格影人,拖末端做 IK、摆关键帧、调缓动曲线,再导出 MP4 与动作 JSON。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

## 测试

```bash
# 纯逻辑单测(数学 / IK / 动画求值,Node 环境)
npx esbuild scripts/smoke.ts --bundle --platform=node --format=esm --outfile=scripts/smoke.mjs && node scripts/smoke.mjs

# 端到端(无头 Chromium,需先 npx playwright install chromium)
npx esbuild scripts/e2e.ts --bundle --platform=node --format=esm --outfile=scripts/e2e.mjs \
  --external:playwright --external:vite --external:fsevents && node scripts/e2e.mjs
```

## 五个页面

| 页面 | 能力 |
| --- | --- |
| 影人库 | 程序化生成武将/文人;按关节命名导入 PNG 部件并按 alpha 轮廓自动对位 |
| 骨骼绑定 | 16 骨骨架、关节角度限位、IK 链管理、部件锚点与层序调整 |
| 动作编排 | 拖末端 IK 摆姿势、记录关键帧、多轨时间线、贝塞尔缓动曲线编辑器 |
| 舞台预览 | 多影人分层遮挡、背光透光与灯影摇摆、60 影人压力测试 |
| 导出 | MP4/WebM 视频录制、动作 JSON 导入导出、工程文件打包 |

## 关键设计

### 防关节露缝 / 撕裂
- 每个肢体部件两端向外多延伸一个 `PAD`,相邻部件在关节处重叠覆盖;
- 每个活动关节额外生成圆形**关节帽**(z 序最高),任意旋转角度都盖住接缝。

### 性能:实例化渲染
- 同一种影人的全部实例打包进一个实例缓冲,按图集纹理分组,**每种影人仅 1 次 draw call**;
- 60 个影人(960 关节、1440 个实例片元)单帧 CPU 装配约 0.15ms,draw call 稳定在个位数;
- 骨骼求解在 CPU,渲染只做实例化绘制 + 半分辨率两遍高斯模糊软阴影。

### 遮挡
- 影人间分层(layer)与部件 z 序编码进 `gl_Position.z`,配合深度测试实现任意交叉的正确前后遮挡,
  避免半透明物体的排序问题(主体走 alpha-test)。

### 坐标系约定
- 屏幕坐标 y 向下,角度 0 朝右、顺时针为正;
- 骨架用**绝对世界坐标 + 世界角度**定义,构建时反算父级局部坐标与局部旋转,保证位置/朝向自洽;
- 图集纹理以 `UNPACK_FLIP_Y=false` 上传,UV 不做 v 翻转,与 GL 采样约定一致。

## 数据与持久化

- 编辑自动存入 IndexedDB(含图集 dataURL),刷新不丢;localStorage 作为兜底;
- 撤销/重做用结构化快照(80 步),拖拽类连续操作通过事务合并为一条历史;
- 动作 JSON 只含单影人的关键帧通道,可跨同类影人复用并再导入。

## 目录

```
src/
  core/
    math/        向量、贝塞尔缓动、骨架求解、两骨 IK(带限位松弛)
    puppet/      程序化影人绘制、图集打包、PNG 导入与自动对位
    animation/   时间线采样、姿态/IK 求值
    state/       中央仓库(撤销重做)、IndexedDB 持久化、默认工程
    io/          视频录制、动作/工程 JSON
  render/        WebGL2 渲染器、shader、视口拾取与交互
  ui/            五个页面、时间线、曲线编辑器、应用外壳
```
