# 五层参考池

## 用法
TASK 的 G2 每步标注"用到哪一层的哪个源"。
不许从零发明。搜不到写"未搜到，自制"。

## L1 · 设计系统（品牌规范）
| 仓库 / 网站 | 收录量 | 说明 |
|---|---|---|
| VoltAgent/awesome-design-md | 55–62 品牌 | Apple, Claude, Linear, Vercel, Stripe, Notion, Figma, Nike, Nvidia, Runway |
| HU-UH/awesome-design-md | 55+ 网站 | Airbnb, Spotify, Uber, BMW, Notion, Linear, Stripe, Figma, Vercel |
| getdesign.md | 62 品牌 | awesome-design-md 配套网站 |
| brands-design-md | 68 品牌 | Airbnb, Apple, Figma, Stripe, Vercel, Notion, Claude, Duolingo |
| Refero Styles | 2000+ DESIGN.md | 品牌设计参考库 |
| Google Design.md | 60+ 大厂规范 | 一键复刻大厂设计规范 |

用法：复制 DESIGN.md 到项目，直接告诉 AI "按这个设计系统做"。

## L2 · 组件库

### React 生态
| 组件库 | 特点 | 场景 |
|---|---|---|
| Ant Design | 蚂蚁集团，120 色板 | 中后台，生态最完善 |
| Arco Design | 字节跳动，4000+ 项目 | 中后台 + ToB |
| Semi Design | 字节跳动，企业级 | 中后台 |
| shadcn/ui | 无 npm 依赖，76 组件 | 现代 Web，AI 友好 |
| Mantine 7 | 预样式，开箱即用 | Indie SaaS, Dashboard |
| Chakra UI v3 | 无障碍优先 | 重视 a11y |
| MUI | 70+ 核心组件 + MUI X | 通用 |
| Headless UI | 无样式，完全可控 | 自定义设计 |

### Vue 生态
| 组件库 | 特点 |
|---|---|
| Element Plus | 饿了么，功能全面 |
| Ant Design Vue | 企业级设计体系 |
| TDesign | 腾讯，React/Vue/小程序 |
| Vant | 轻量级移动端 |
| NutUI | 京东风格移动端 |
| Varlet | Vue 移动端 |

## L3 · 配色 / 字体 / 图标

### 成熟配色方案
| 来源 | 类型 | 说明 |
|---|---|---|
| Tailwind CSS 默认调色板 | 事实标准 | OKLCH 感知均匀色彩空间，50–950 全阶 |
| Radix Colors | 程序可用 | Tailwind v4 集成，支持 alpha + P3 |
| Ant Design 色板 | 事实标准 | 120 色（12 主色 + 衍生），HSB 模型 |
| tunio-colors | npm 包 | 柔和 Tailwind 替代 |
| Sagewai Tokens | npm 包 | 设计令牌，支持暗色模式 |
| Design Token Generator (ColorArchive) | 工具 | 输入品牌色生成完整令牌系统，可导出 CSS/Tailwind/SCSS/JSON |

### 配色工具
| 网站 | 特色 |
|---|---|
| Coolors | 最流行，快速生成 |
| Adobe Color | 色轮 + 配色法则 |
| Huemint | 机器学习配色 |
| Khroma | AI 配色生成器 |
| Muzli AI Colors | AI 配色 |
| Happy Hues | 色盘嵌入示例预览 |
| Realtime Colors | 即时套在模拟网站上 |
| Colormind | AI 配色 |
| ColorSpace | 生成配色方案 |
| Nippon Color | 日本传统色 |
| Picular | 关键词搜颜色 |
| Pigment | 色彩探索 |
| BrandColors | 品牌官方色码 |
| CSS Gradient | 渐变代码导出 |

### 配色编码体系
| 体系 | 说明 |
|---|---|
| OKLCH | 感知均匀。L（明度）0–1，C（彩度），H（色相） |
| HSB | Ant Design 使用 |
| Primitive / Semantic 双层 | Primitive 原始值；Semantic 赋予含义 |
| 三阶体系 | Global / Alias / Component |

色阶映射：
50      → 95% 明度 → 微妙背景
100–200 → 90–85% → 浅色背景、悬停态
300–400 → 75–65% → 边框、禁用态
500–600 → 主色、品牌色
700–800 → 深色文字、强调
900–950 → 最深背景、暗色模式

### 字体
| 网站 | 说明 |
|---|---|
| Google Fonts | 开源字体目录，1500+ |
| Typewolf | 字体趋势与搭配 |
| FontPair | 字体配对工具 |

### 图标
| 网站 | 说明 |
|---|---|
| Font Awesome | 成熟 SVG + 动画 |
| Iconify | 聚合多库，200,000+ |
| Tabler Icons | 数量丰富 |
| Lucide | 极简，React 友好 |
| IconPark | 字节跳动，可商用 |
| Remix Icon | 2000+ 可商用 |
| Iconfont | 阿里图标库 |

## L4 · UI 模式与灵感
| 网站 | 说明 |
|---|---|
| Lazyweb | 25.7 万张真实截图，MCP 协议 |
| Mobbin | 移动 & Web UI 库 |
| Site of Sites | 人工精选 589 网站 |
| Refero | 设计参考 |
| Landbook | 网页设计灵感 |
| Siteinspire | 网页设计灵感 |
| Awwwards | 获奖网站 |
| Lapa Ninja | 落地页灵感 |
| Collect UI | UI 组件灵感 |
| Checklist Design | UI/UX 检查清单 |
| Dribbble | 设计师作品 |
| Behance | 完整案例 |
| Pinterest | Moodboard |
| Curated Design | 前 Google 设计师精选 |
| Curations.supply | 设计师导航站 |

## L5 · 声音 / 图片 / 动效
| 源 | 类型 |
|---|---|
| LottieFiles | Lottie 动画 |
| uiGradients | 渐变库 |
| Unsplash | 高分辨率摄影 |
| Pexels | 免费图片 |
| Freepik | 矢量插画 |

## AI 设计资源
| 资源 | 说明 |
|---|---|
| joaorrios/awesome-ai-design | AI 设计资源合集 |
| Open Design | 开源 Claude Design 替代，71 品牌设计系统 |
| Penpot | 开源设计平台，4.9 万 Stars |
| Astryx by Meta | Meta 开源，150+ 无障碍组件 |
| yehyakin/ai-frontend-design-bookmarks | 中文前端设计资源库 |

## Design Tokens
| 资源 | 说明 |
|---|---|
| Awesome-Design-Tokens | 令牌资源大全 |
| W3C Design Token Spec | 标准规范 |
| Style Dictionary | Amazon 令牌转换工具 |
| Engramma | 令牌编辑器和转换器 |

## 安全参考池
| 资源 | 说明 |
|---|---|
| OWASP Agentic Top 10 (2026) | Agent 系统威胁清单 |
| agent-audit | 静态扫描器（51–72 规则） |
| Microsoft Agent Governance Toolkit | 运行时治理 |
| STRIDE | 六类威胁分类 |

## 部署参考池（四层治理蓝图，Qovery 2026）
| 层 | 机制 | 工具 |
|---|---|---|
| 作用域身份 | 独立 ServiceAccount | K8s / OIDC |
| 准入时策略 | 不合规拒绝 | Kyverno / OPA Gatekeeper |
| 人工审批门 | 不可逆需批准 | Argo CD PR |
| 不可变审计 | append-only | S3 Object Lock + Falco |

## 存疑区
标注 `未确认` 的条目不许当依据。
