import io

p = r'F:\个人网站\app\js\version.js'
s = io.open(p, encoding='utf-8', newline='').read()

# 定位 5.7.0 条目的 items 数组结尾
i = s.index("version: '5.7.0',")
si = s.index('items: [', i)
ei = s.index('\n        ]', si)
print('5.7.0 items 数组：行 %d … %d' % (s[:si].count('\n') + 1, s[:ei].count('\n') + 1))

p1_items = [
    "P1 氛围降档收敛 —— 原实现 3s 采样 × 4 个坏样本 = 连续 12 秒不达标才降档，而 downgrade() 一次只摘一层 ⇒ 最坏 9×12 ≈ 108 秒才关到不卡，体感就是「先卡十几秒，机器才开始自救」。现在 1s 采样 × 2 个坏样本（触发窗口 2s）+ 一次连降 2 层 + 2s 冷却，最坏约 10 秒关完",
    "P1 为什么单靠调采样不够 —— 那只能把「12 秒降一层」变成「2 秒降一层」，9 层仍要 18 秒；连降（CASCADE_LIMIT）才是把收敛时间压下来的那一步。冷却则防「一降帧率就回升、又判坏、再降」把氛围一层层抖光",
    "新增 56 号用例 9 条（已登记进 manifest）—— 用桩把帧率按到 10fps 真跑探针，断言：有界时间内真的降档（实测首次 35ms）、一次连降 ≥2 层、从最耗的层开始摘、降档有可见提示、冷却期内只触发一轮、持续低帧率下仍保留静态纹理作底",
    "反向验证 —— 把 CASCADE_LIMIT 改回 1（旧行为）后 56 号 R306b 当场报红，证明「连降」这条判据不是摆设",
    "配套 —— 45 号 R211f 同步（阈值仍 45fps，判据从「连续 4 个坏样本」改为「触发窗口 ≤3s」；降档顺序契约不变）。⚠ 探针采样间隔可由 window.__NEON_ATMO_SAMPLE_MS 覆盖，仅供测试压缩时间，源码里的真实值仍被契约断言钉着",
    "工程基建 —— 本目录此前没有版本控制。本轮装了 MinGit（便携版，解压即用、不写注册表，已加入用户 PATH）并做了首次提交 5bb9d0e；以后每步改动都能 diff/revert。另有独立于 git 的本机快照 _backup/20261002-012016-v5.6.6-pre-hardening"
]

# 组装：原最后一项补逗号，再接新项
segment = s[si + len('items: ['):ei]
lines = [ln for ln in segment.split('\n') if ln.strip()]
assert lines, 'items 段为空'
lines[-1] = lines[-1].rstrip().rstrip(',') + ','
for k, it in enumerate(p1_items):
    lines.append('          "' + it.replace('"', '\\"') + '"' + (',' if k < len(p1_items) - 1 else ''))
s = s[:si + len('items: [')] + '\n' + '\n'.join(lines) + s[ei:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('已补 %d 条 P1 日志' % len(p1_items))
