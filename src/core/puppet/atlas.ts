export interface AtlasItem {
  key: string;
  canvas: HTMLCanvasElement;
}

export interface AtlasPlacement {
  uv: [number, number, number, number]; // [u0,v0,u1,v1],WebGL 纹理坐标
  pxW: number;
  pxH: number;
}

export interface AtlasBuild {
  canvas: HTMLCanvasElement;
  size: number;
  placements: Record<string, AtlasPlacement>;
}

/**
 * 把多张部件 canvas 打包进一张方形图集(shelf 装箱,2px 间距防线性采样溢出)。
 */
export function buildAtlas(items: AtlasItem[], sizeHint = 1024): AtlasBuild {
  const gap = 2;
  let total = 0;
  for (const it of items) total += (it.canvas.width + gap) * (it.canvas.height + gap);
  let size = 256;
  while (size < sizeHint && size * size < total * 1.35) size *= 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  let x = gap;
  let y = gap;
  let shelfH = 0;
  const placements: Record<string, AtlasPlacement> = {};

  for (const it of items) {
    const w = it.canvas.width;
    const h = it.canvas.height;
    if (x + w + gap > size) {
      x = gap;
      y += shelfH + gap;
      shelfH = 0;
    }
    if (y + h + gap > size) {
      return buildAtlas(items, sizeHint * 2); // 放大重来
    }
    ctx.drawImage(it.canvas, x, y);
    // 纹理以 UNPACK_FLIP_Y=false 上传:纹理坐标 (0,0) 对应画布左上。
    // 因此 v 直接用画布 y/size,不做翻转,与 GL 采样约定一致。
    placements[it.key] = {
      uv: [x / size, y / size, (x + w) / size, (y + h) / size],
      pxW: w,
      pxH: h,
    };
    x += w + gap;
    shelfH = Math.max(shelfH, h);
  }

  return { canvas, size, placements };
}
