# Spec: 样式槽（把重排的规模从「节点数」换成「样式数」）

- **ID**: 002-style-slots
- **状态**: draft
- **日期**: 2026-09-03
- **前身**: [001-restyle-performance](../001-restyle-performance/spec.md)

## 1. 要解决什么

001 把一次主题切换拆到了三段，并且证明了过桥那一段已经是 0 ms。剩下两段是
JS 的重排和 Flutter 的重建，而**引擎的计数器自己就指出了 JS 那一段在做多余的事**：

```
mark 13ms/3330   flush 42ms/3330   miss 25   applied 3175
3330 elements  27 rules
```

`computeMiss` 25、`computeHit` 3305。**3330 个元素塌到 27 种样式**——一次切换真正
产生新信息的计算是 25 次，剩下 3305 次是「查一下发现还是那一份」。但为了查这一
下，每个元素都付了：一次标脏遍历的访问、一次 `recompute`、一次匹配缓存查询、一次
`sameStyle` 比较、一次 `applyStyle`，以及桥上 13 个字节。**42 KB 的帧里，信息量
是 2 KB。**

主题切换恰好是这件事最极端的形态：树的结构没变、class 没变、匹配的规则没变，
**变的只有 12 个自定义属性的取值**。

真机/模拟器实测（001 记录，iPhone 17 Pro 模拟器、debug、3330 个元素）：

| | 现在 |
|---|---:|
| JS 重排 + 编码 | 34–98 ms（取决于这一趟有没有撞上 GC）|
| 过桥 + 应用 | 0.00 ms |
| 帧大小 | 42.0 KB |
| 每帧能改多少节点还守住 60fps（list-view）| 400 |

## 2. 不做什么（Non-goals）

- **不改 CSS 语义。** `docs/css-compat.md` 一格不动，`css.test.ts` /
  `vue_styles.test.ts` 必须原样通过。
- **不把 cascade 下沉到 Dart 或 C++。** 001 已经登记过这条 non-goal（会变成第二个
  CSS 引擎）；而且实测说转输不是成本——过桥 + 应用是 0 ms，C++ 在这条链上目前只是
  个字节搬运工（`fjs_on_ui_ops_fn` 不解析任何 op）。**要省的是「算了 3330 遍」，
  不是「算得不够快」。**
- **不改 class 变化的路径。** class 变了就是匹配结果变了，那时每节点重算是对的。
  本规格只针对**结构与匹配都没变、只有自定义属性取值变了**的重排。
- **不动 Flutter 那一半。** 脏节点数不减少（见第 3 节），Dart 侧的收益要靠
  `list-view` 和 001 里那条「`scroll-view` 变懒」，各自立项。
- **不把 JS 挪出 UI 线程。** 那是抬并发上限的另一条路，代价是
  `docs/threading-model.md` 里「点击到界面更新在同一帧」的同步保证，另立项。

## 3. 用户可见的行为

**页面代码写法不变，一个字都不改。** 这是纯引擎优化。

唯一会变的可观测面是 `styleEngine.stats`：同一次主题切换，`recompute` 应该从
「元素数」掉到「样式数」量级。压测屏上的读数因此会变成：

| | 现在 | 目标 |
|---|---:|---:|
| `recompute` | 3330 | ~27 |
| `markVisited` | 3330 | 0（不再需要标脏遍历）|
| 帧大小 | 42.0 KB | < 3 KB |
| JS 重算 + 编码 | 34–98 ms | < 5 ms |

**Web 侧不适用**：浏览器有自己的 CSS 引擎，`styleEngine.stats` 在 web 上本来就
全零（001 第 4 节已登记）。

## 4. 机制

### 4.1 稳定的槽标识

`compute()` 今天已经在做塌缩：memo 的键是 `matched.byParent.get(parentStyleId)`，
也就是**（匹配结果，父的 computed style id，tag 默认样式）**这个三元组。问题在于
第二项——父的 computed style id 每次重排都会变，所以键跟着变，塌缩的结果留不住。

把第二项换成**父的槽 id**，三元组就稳定了：

```
slot(el) = intern(matchResult(el), slot(parent(el)), defaultsId(el))
```

递归定义，根的槽是 0。只要元素自身的签名（tag / class / scope / 内联样式的有无）
和祖先链没变，槽就不变——而这正是「只改自定义属性」这一类重排的定义。

### 4.2 自定义属性变了：重算槽，不走树

今天：`setInlineCustomProps` → `markDirty(subtree)` → 遍历 3330 个节点 → 逐个
`recompute`。

之后：自定义属性挂在某个元素上 → 它的槽（以及以它为祖先的那些槽）的解析结果失效
→ **按槽的创建顺序重算这些槽**（父槽先于子槽，创建顺序天然保证）→ 每个变了的槽
发一条 `DEFINE_STYLE`。**元素一个都不用访问。**

### 4.3 协议：`DEFINE_STYLE` 变成「就地重定义」

今天 Dart 侧是 `_styles[id] = FjsStyleEntry(id, map)`——换掉整个对象，而节点
`node.style` 指着旧对象，所以必须再补一条 `SET_STYLE` 才能让节点看见新值。

之后：id 已存在时**原地改** `entry.map`，再按 `styleId → nodes` 的反向索引把用到
它的节点标脏。`SET_STYLE` 只在**挂载**和**结构/class 变化**时发。

（渲染层今天没有挂在 `FjsStyleEntry` 上的解析缓存——解析是按**值**记忆的，见
`render/style_parse.dart`。要不要顺手加一个按样式的，等这条落地时再量。）

## 5. 契约变更（宪法 II）

- [ ] **UI op 协议**：`7 DEFINE_STYLE` 的语义扩一条——**对已存在的 id 是重定义**，
      对端必须让已经引用它的节点看见新值。字节格式不变，所以
      `native/tools/fjsrun.cpp` 的解码器不用改；`uiOpsVersion` 也不用升，
      因为老宿主收到重定义只会「换掉表项但节点看不见」——**这是静默错误，所以
      仍然要升 announce 版本**（待澄清 A）。
- [ ] **`FJS_ABI_VERSION` 不动**：op 帧对原生层仍然是不透明字节。
- [ ] `styleEngine.stats`：不新增字段，但 `recompute` / `markVisited` 的量级会变，
      `docs/performance.md` 里引用这两个数的地方要跟着改。

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过；新增 `style_slots.test.ts`：一次
   自定义属性变更后 `recompute ≤ 规则数`、`markVisited === 0`、发出的 op 里
   没有 `SET_STYLE`
2. `ops_intern.test.ts` 补一条字节级契约：同一个 id 的第二次 `DEFINE_STYLE`
3. `cd packages/flutter_fjs && flutter test` 通过；`mirror_tree_test.dart` 补：
   重定义一个已被引用的 style id，节点读到新值且被标脏
4. `examples/bench` 的 `theme-switch-vars` 从 25.5 ms 掉到个位数
5. 压测屏（`examples/hello-js`，4000 节点、list-view）：JS < 5 ms、帧 < 3 KB、
   `recompute` < 50
6. `example/theme` 与 `example/dnd` 观感不变；`dnd` 尤其要看——它是结构会变的那一类
7. `docs/architecture.md`（op 协议）、`docs/performance.md`、
   `docs/custom-renderer.md` 与实现一致（宪法 VII）

## 7. 待澄清

- [ ] **A. 老宿主怎么办？** 重定义对老宿主是静默失效（表项换了、节点看不见）。
      是升 `uiOpsVersion` 到 3、老宿主回落到「重定义 + 全量 SET_STYLE」，还是
      干脆不回落？回落的代价是要保留两条编码路径
- [ ] **B. 一个 var 变了，哪些槽要重算？** 先做最笨的「全部槽重算一遍」（27 个，
      够便宜），还是建 `var → 用到它的槽` 的依赖索引？后者在规则多的 app 上才有
      意义，**先量再决定**
- [ ] **C. 槽表怎么回收？** 槽比 computed style 活得久（这正是它有用的原因），
      所以它会随着页面进出累积。用 `matchEpoch` 整体作废？还是引用计数？
- [ ] **D. 脏节点还是 N 个。** JS 侧降到 O(样式)，但 Dart 侧仍要把用到这些槽的
      节点标脏。配合 `list-view` 时只有可见的那十几个会真的重建；配合
      `scroll-view` 时仍然是整棵树重画——**所以这条和「`scroll-view` 变懒」是
      互补的，不是替代**
