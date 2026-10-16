"""Render the local handbook PDF for visual review; never reads clinical data."""
from pathlib import Path
import json
import fitz
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[3]
pdf_path = root / "apps/web/public/handbook.pdf"
output = Path(__file__).resolve().parent / "verification_2026-10-16"
output.mkdir(exist_ok=True)
document = fitz.open(pdf_path)
page_data = []
for index, page in enumerate(document):
    blocks = page.get_text("blocks")
    outside = [list(block[:4]) for block in blocks if block[0] < -1 or block[1] < -1 or block[2] > page.rect.width + 1 or block[3] > page.rect.height + 1]
    page_data.append({"page": index + 1, "characters": len(page.get_text()), "outside_page_blocks": outside})
    pix = page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False)
    pix.save(output / f"page-{index + 1:02}.png")

for start in range(0, len(document), 12):
    sheet = Image.new("RGB", (1200, 1440), "#dbe8e3")
    draw = ImageDraw.Draw(sheet)
    for slot, page_index in enumerate(range(start, min(start + 12, len(document)))):
        picture = Image.open(output / f"page-{page_index + 1:02}.png")
        picture.thumbnail((280, 400))
        x, y = (slot % 4) * 300 + 10, (slot // 4) * 480 + 35
        sheet.paste(picture, (x, y))
        draw.text((x, y - 22), f"PAGE {page_index + 1}", fill="#173e38")
    sheet.save(output / f"contact-{start // 12 + 1}.png")

report = {"pdf": str(pdf_path), "pages": len(document), "page_data": page_data,
          "scope": "Rendered every page for inspection; block bounds are a geometric check, not semantic or full visual validation."}
(output / "pdf-inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"pages": len(document), "outside_page_blocks": sum(len(item["outside_page_blocks"]) for item in page_data), "output": str(output)}))
