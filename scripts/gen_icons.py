"""Generate Skreeen extension icons (no dependencies, pure stdlib PNG writer).

Design: a circle split vertically — light half / dark half — with an indigo ring.
"""
import math
import os
import struct
import zlib

LIGHT = (248, 250, 252)
DARK = (15, 23, 42)
RING = (99, 102, 241)


def write_png(path, size, pixels):
    def chunk(typ, data):
        block = struct.pack(">I", len(data)) + typ + data
        return block + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

    stride = size * 4
    raw = b"".join(b"\x00" + bytes(pixels[y * stride:(y + 1) * stride]) for y in range(size))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def make_icon(size):
    px = bytearray(size * size * 4)
    c = (size - 1) / 2
    radius = size * 0.47
    ring_w = max(1.2, size * 0.07)
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c)
            alpha = max(0.0, min(1.0, radius - d + 0.5))  # edge anti-aliasing
            if alpha <= 0:
                continue
            ring_mix = max(0.0, min(1.0, (d - (radius - ring_w)) + 0.5))
            # smooth the vertical split over ~1px
            split_mix = max(0.0, min(1.0, (x - c) + 0.5))
            base = tuple(
                round(LIGHT[i] * (1 - split_mix) + DARK[i] * split_mix) for i in range(3)
            )
            col = tuple(
                round(base[i] * (1 - ring_mix) + RING[i] * ring_mix) for i in range(3)
            )
            o = (y * size + x) * 4
            px[o], px[o + 1], px[o + 2], px[o + 3] = col[0], col[1], col[2], round(alpha * 255)
    return px


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        write_png(path, size, make_icon(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
