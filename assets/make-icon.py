"""把 icon.svg 的图形重画成一版位图（catalog 只收 png/jpg/webp）。
输出 180x180，方形，约 96px 显示时最清楚。"""
from PIL import Image, ImageDraw

S = 180
k = S / 64.0

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 深蓝圆角底
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=42, fill=(22, 35, 63, 255))

# 峰时的太阳（暖色）
d.ellipse([45 * k, 12 * k, 73 * k, 40 * k], fill=(255, 122, 89, 255))

# 价格曲线：峰 → 谷
pts = [(7, 46), (17, 30), (26, 39), (38, 48), (50, 42), (57, 45)]
d.line([(x * k, y * k) for x, y in pts], fill=(255, 170, 32, 255), width=8, joint="curve")

# 谷底标记（谷价）
cx, cy = 38 * k, 48 * k
d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(62, 207, 142, 255))

img.save("F:/DSH/peak-coach/assets/icon-180.png")
print("saved", img.size)
