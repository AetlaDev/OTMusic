# 乌龙茶音乐 · OTMusic

- **专辑封面粒子化**：读取封面像素，按亮度与颜色重建为十万级粒子平面，随视角旋转呈现纵深。
- **音频驱动视觉**：Web Audio API 实时分析低频、中频、高频能量，驱动粒子起伏、整体震动与闪光。
- **节拍检测**：内置自适应增益、起音检测与节拍间隔跟踪，鼓点命中时触发冲击、粒子增亮与歌词抖动。
- **3D 歌词**：歌词在 WebGL 中渲染为带发光效果的立体文字，支持逐行滚动、当前行渐进高亮与翻译歌词对齐。
- **液态玻璃 UI**：搜索栏与播放卡片使用液态玻璃折射效果，展开/收起带弹性动效（GSAP）。
- **沉浸式背景**：封面经过 Kawarp 扭曲模糊处理，形成随音乐呼吸的抽象背景。
- **完整播放控制**：搜索、热门榜单、上一首 / 下一首、播放暂停、进度拖拽、键盘快捷键。
- **手势交互**：拖拽旋转视角、滚轮 / 双指缩放、双击或双击屏幕复位。
- **移动端适配**：自动限制像素比与渲染分辨率，移动端下调粒子尺寸与歌词缩放，兼顾性能与效果。
- **首屏加载门控**：统一编排资源、封面、歌词预热的加载状态，避免闪烁与半成品画面。

| 分类 | 技术 |
| --- | --- |
| 框架 | Svelte 5、TypeScript |
| 构建 | Vite 6 |
| 动画 | GSAP |
| 渲染 | Canvas 2D、WebGL（粒子与歌词着色器） |
| 音频 | Web Audio API、AnalyserNode |
| 视觉特效 | `@kawarp/core`、`@ybouane/liquidglass` |
| 字体 | `@fontsource/inter` |

## 配置

所有视觉与音频参数集中在 [`src/config.json`](./src/config.json)，修改后重新构建即可生效；[`src/lib/config.ts`](./src/lib/config.ts) 提供了同样的默认值作为兜底。

| 配置组 | 作用 | 常用参数 |
| --- | --- | --- |
| `cover` | 默认封面 | `url` |
| `kawarp` | 背景扭曲效果 | `warpIntensity`、`blurPasses`、`animationSpeed`、`saturation`、`overlayOpacity` |
| `particles` | 粒子平面 | `count`、`planeFit`、`coverThickness`、`defaultColor`、`colorBoost`、`dotSizeScale` |
| `vibration` | 音频驱动的位移 | `intensity`、`midWeight`、`trebleWeight`、`shakeDepth`、`punchOvershoot` |
| `camera` | 摄像机与手势 | `focal`、`rotSens`、`rotXLimit`、`zoomSens`、`zoomMin`、`zoomMax` |
| `render` | 渲染预算 | `depthBuckets`、`maxPixelRatio`、`maxRenderPixels`、`dispGridSize` |
| `audio` | 频谱分析 | `fftSize`、`smoothingTimeConstant`、`bassFrom`、`bassTo`、`midHzFrom`、`trebleHzFrom` |
| `beat` | 节拍检测与节拍动效 | `enabled`、`minInterval`、`onsetFloor`、`scoreGate`、`lyricShake`、`lyricScale` |
| `player` | 播放器行为 | `seekStep`（方向键快进秒数）、`loop` |
| `liquidGlass` | 液态玻璃材质 | `blurAmount`、`refraction`、`chromAberration`、`cornerRadius`、`brightness` |

性能不足时，优先降低 `particles.count`、`render.maxPixelRatio` 或 `kawarp.blurPasses`。

## 项目结构

```text
OTMusic/
├─ public/                    # 静态资源
├─ src/
│  ├─ components/
│  │  ├─ KawarpBackground.svelte    # 封面扭曲背景
│  │  ├─ ParticleBackground.svelte  # 粒子、歌词与交互画布
│  │  ├─ PlayerCard.svelte          # 液态玻璃播放卡片
│  │  └─ SearchBar.svelte           # 搜索栏
│  ├─ lib/
│  │  ├─ audio/
│  │  │  ├─ audioVisualizer.ts      # 频谱能量与可视化数据源
│  │  │  └─ beatEngine.ts           # 节拍检测引擎
│  │  ├─ effects/
│  │  │  ├─ particleEngine.ts       # 粒子 / 歌词 WebGL 渲染核心
│  │  │  ├─ liquidGlass.ts          # 液态玻璃初始化与性能补丁
│  │  │  └─ noise.ts                # 噪声场与亮度采样
│  │  ├─ services/api.ts            # 音乐接口封装
│  │  ├─ text/lyrics.ts             # LRC 解析与翻译匹配
│  │  ├─ config.ts                  # 运行时配置加载
│  │  ├─ device.ts                  # 设备与移动端判断
│  │  ├─ loading.ts                 # 首屏加载门控
│  │  └─ types.ts                   # 公共类型定义
│  ├─ App.svelte                    # 应用入口与播放状态管理
│  ├─ main.ts
│  ├─ config.json                   # 视觉效果参数
│  └─ app.css
├─ index.html
├─ package.json
├─ svelte.config.js
└─ vite.config.js
```

## 操作说明

| 操作 | 效果 |
| --- | --- |
| 点击播放卡片 | 展开 / 收起播放器 |
| 点击播放按钮 | 播放 / 暂停 |
| 拖拽画面 | 旋转粒子视角 |
| 滚轮 / 双指捏合 | 缩放视角 |
| 双击画面 / 双击触屏 | 复位视角 |
| `Space` | 播放 / 暂停（焦点不在输入框时） |
| `←` / `→` | 快退 / 快进（进度条获得焦点时） |

## 数据来源

音乐搜索、歌曲详情、播放地址与歌词均来自第三方公开接口（网易云音乐 API 兼容服务），前端不做任何音频代理或缓存。接口地址集中在 [`src/lib/services/api.ts`](./src/lib/services/api.ts) 中，如有变动可自行替换。

第三方接口的可用性与返回内容不由本项目控制，部分歌曲因版权限制可能无法播放。

## 致谢

- [Svelte](https://svelte.dev/) 与 [Vite](https://vite.dev/) 提供了轻量而高效的开发体验
- [GSAP](https://gsap.com/) 负责界面动效
- [`@kawarp/core`](https://www.npmjs.com/package/@kawarp/core) 提供封面扭曲背景
- [`@ybouane/liquidglass`](https://www.npmjs.com/package/@ybouane/liquidglass) 提供液态玻璃材质
- 灵感来自各类开源音乐播放器项目

## 免责声明

本项目仅供学习与交流使用，不提供、不存储任何音频文件。所有歌曲、封面与歌词的版权归原作者及对应平台所有，请勿将本项目用于商业用途。因使用本项目产生的任何版权纠纷与作者无关。

## License

[CC BY-NC-SA 4.0](./LICENSE) © 2026 AetlaDev
