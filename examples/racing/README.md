# racing — 街机赛车（three.js）

[pleiondev/flutter3d](https://github.com/pleiondev/flutter3d) 里
`apps/flutter3d_demo_racing` 的 three.js 复刻：五条赛道一个赛季，四辆车跑三圈，
**同一份源码跑 Flutter 和浏览器**。three.js 的接入方式照 `examples/hello-fjs`
（`native-polyfills` + `@ufjs/webgl`）。

```
src/
  pages/index.vue      # 唯一的页面：canvas、HUD、触屏按钮、标题 / 结算
  game/
    spline.ts          # 闭合 Catmull-Rom，按弧长取样（flutter3d_sim 的 CatmullRom）
    track.ts           # 赛道样条：宽度 / 侧倾 / 路面 / 护栏 / 检查点 / 发车格，读赛道 JSON
    vehicle.ts         # 球形车 + 轮胎曲线 + 地面采样 + 石柱碰撞（SphereVehicle / TireModel）
    race.ts            # 比赛模拟、AI、追尾镜头（RacingSimulation / AiDriver / ChaseCamera）
    scene.ts           # 搭 three 场景：天空着色器、路面带子、护栏、房子、广告牌、车
    game.ts            # 主循环：60Hz 定步长 + 插值渲染，事件 → 提示 / 音效 / 纪录
    sounds.ts          # Web Audio 音效（App 端没有音频 API，自动静默）
    pixel-font.ts      # 广告牌上的点阵字
  assets/tracks/       # 原项目 tool/make_track.py 生成的赛道，原样使用
  assets/models/       # 车模（CC BY 4.0）和 Kenney 房子（CC0），见 LICENSES.md
public/sounds/         # 原项目的 wav 音效
```

## 跑起来

```bash
pnpm install
```

```bash
pnpm dev:web           # 浏览器
pnpm build             # Flutter：dist/app/bundle.js
pnpm run:android
pnpm run:ios
```

## 操作

- 键盘：W / S 或 ↑ / ↓ 油门刹车，A / D 或 ← / → 方向，空格手刹，T 停稳后换胎，M 静音
- 触屏：左下横条打方向（按住拖向弯心），右下手刹 / 刹车 / 油门，右上换胎

## 和原版的对应与取舍

- **物理、AI、镜头数值与原版一致**：车是半径 0.7m、离地 0.55m 的球，轮胎力走
  Pacejka 形状曲线再夹进摩擦圆；公路 / 光头 / 拉力三套轮胎对不同路面抓地不同；
  尾流、撞击损伤、逆行判定、冲出赛道 4 秒复位到上一个检查点都保留。
- **碰撞简化**：原版用通用碰撞世界做球体扫掠；这里的障碍只有关卡里 4m 见方的石柱，
  直接推出穿透，地面平台只当地面。
- **画面**：原版有 PBR + 阴影贴图 + 天空环境光照；这里用 Lambert 材质、天空渐变
  着色器、指数雾和车底的圆形假阴影，App 端的 GL 命令流扛得住。车模隐藏了驾驶舱
  内外看不见的小零件（每辆车 40 → 约 12 次 draw call）。路基侧墙、沥青 / 护栏 /
  起跑线贴图是新加的（原版赛道是悬空的纯色带子）。
- **没做**：幽灵车回放、联机、手柄、烟尘粒子、设置页。

## 素材授权

- `car.glb`「2002 McLaren MP4-17」— Dave Love，**CC BY 4.0**，经原项目修改（贴图缩到
  512、去掉 clearcoat / specular 扩展、模型转向 +Z）。
- `building-*.glb` — Kenney City Kit (Suburban)，**CC0**。

详见 [src/assets/models/LICENSES.md](src/assets/models/LICENSES.md)。
